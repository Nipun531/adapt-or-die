/**
 * Combat engine — an authoritative, resumable state machine. One engine, two rule sets (game/rules.ts):
 *
 * RULE SET v2 (engine 2.0.0; docs/GAME_MECHANICS.md §5–6) — kept bit-for-bit as the V3 control:
 *  1. Tie-break coin flip is drawn first (always, so the RNG sequence is stable). It is only used for turn
 *     order when both fighters have equal effective DEX.
 *  2. Opening phase (`openingShooters`): if exactly one fighter has a ranged weapon, it makes ONE ranged
 *     opening attack. If both do, ONLY the fighter with strictly higher effective DEX shoots; on an exact
 *     DEX tie nobody gets the opening shot (user-approved V2 rule, V2_DEMANDS D-OPEN-3).
 *  3. Turns: the fighter with higher effective DEX acts first each turn. On its action a fighter makes
 *     1 regular attack + DEX bonus attacks (plan §4: +1 at 15 advantage, +2 at 30+, applied every turn).
 *  4. The round ends the instant a fighter's HP reaches 0 or below.
 *  Piercing: any attack made WITH a weapon that has a pierce spec rolls pierce. Every attack hits.
 *
 * RULE SET v3 (docs/V3_DEMANDS.md) — same skeleton, plus for every attack:
 *  a. Start of a fighter's action (regular turn): a stunned fighter loses the action (`skip` note); otherwise it may
 *     use one healing stim (`stim` note).
 *  b. The attacker picks its attack mode, the attack is ANNOUNCED, the defender picks Block or Dodge
 *     (a fighter stunned since its last defence cannot defend: the attack hits).
 *  c. Six fixed RNG draws per attack (defence, counter, pierce, mitigation, counter pierce, counter mitigation),
 *     so a defence choice never shifts later rolls.
 *  d. The would-be hit is computed with the V2 damage pipeline. Defence fails → it lands and adds stun to the
 *     defender. Block succeeds → no damage (a very heavy hit still adds stun) and a block counter may follow.
 *     Dodge succeeds → no damage and a dodge counter may follow (dodge-counter weapons only).
 *  e. A counter is a MINI MOVE inside the attacker's sequence (the defender's turn has not begun): the counterer's
 *     own melee/unarmed attack through the same pipeline × 1.5 (block) / × 0.75 (dodge). Counters cannot be
 *     blocked, dodged or countered; ranged attacks are never countered. A block counter adds 20 stun.
 *  f. Stun: when a meter reaches 100 and the hit came from a can-stun weapon, the target takes extra damage,
 *     loses its next defence and one attack turn, and the meter resets to 0. Without a can-stun weapon the meter
 *     waits at 100. Meters start at 0 every round (each round is a new CombatState).
 *
 * Fighters with Ranged+Melee choose 'ranged' (DEX) or 'melee' (STR) for each regular/bonus attack.
 * When a choice is needed and no chooser answers, the engine pauses (`pending`) and can be resumed
 * later — the whole state, including the RNG and the rule set, is JSON-serialisable.
 *
 * Every attack produces a CombatEvent containing all formula inputs, random rolls and intermediates.
 */
import { MAX_ATTACKS_PER_ROUND } from './constants.js';
import {
  attackShavedOff,
  blockChance,
  blockCounterChance,
  defAfterPierce,
  dexBonusAttacks,
  dexMitigation,
  dexRatio,
  dodgeChance,
  dodgeCounterChance,
  dodgeDelta,
  dodgeDeltaPercent,
  effectiveDex,
  netDex,
  finalDamage,
  isHeavyHit,
  mitigationRollFromUniform,
  netDamage,
  rawDexMitigation,
  stimHealAmount,
  stunGain,
} from './formulas.js';
import { Rng } from './rng.js';
import { itemLookup, RULES_V2, type RuleSet } from './rules.js';
import type { AttackMode, FighterSnapshot, Side } from './types.js';
import { otherSide } from './types.js';

export type AttackPhase = 'opening' | 'regular' | 'dex_bonus' | 'counter';
/** Who decided: forced (only one option), the human, the human's "repeat" setting, boss policy, a sim agent, or the engine's automatic default. */
export type ChoiceSource = 'forced' | 'player' | 'player_auto' | 'boss_policy' | 'agent' | 'auto';

export type DefenseAction = 'block' | 'dodge';
export type StimAction = 'use' | 'skip';
export type DecisionKind = 'attack_mode' | 'defense' | 'stim';

export interface PierceRoll {
  chance: number;
  defIgnore: number;
  roll: number;
  success: boolean;
  placeholder: boolean;
  /** Weapon whose pierce spec was rolled (engine ≥ 2.0.0; absent on older events). */
  weaponId?: string;
  /** Net damage added by the pierce, before DEX mitigation: netDamage(A, DEF used) − netDamage(A, Net DEF). 0 when no pierce. */
  extraDamage?: number;
}

/** All intermediate values for one attack — enough to recompute the damage by hand. */
export interface AttackCalc {
  attackValueSource: 'netAtk' | 'effDex';
  attackValue: number;
  defenderNetDef: number;
  pierce: PierceRoll | null;
  defUsed: number;
  netDamage: number;
  attackerDex: number;
  defenderDex: number;
  dexRatio: number;
  mitigationUniform: number;
  mitigationRoll: number;
  rawMitigation: number;
  mitigation: number;
  mitigationClamped: boolean;
  /** v3: true when DEX mitigation is switched off by a harness ablation (the roll is still drawn and logged). */
  mitigationDisabled?: boolean;
  finalDamage: number;
}

/** v3: how the defender answered an attack. */
export interface DefenseResult {
  /** 'none' = could not defend (stunned). */
  action: DefenseAction | 'none';
  source: ChoiceSource;
  reason?: string;
  chance: number;
  roll: number;
  success: boolean;
  /** Attack shaved off (0..1): share of the attack value DEF + DEX would remove had it hit. */
  shaved: number;
  /** The damage it would have done (= damage taken when the defence fails). */
  wouldBeDamage: number;
  /** Block only: the hit counted as very heavy (adds stun to the blocker). */
  heavy?: boolean;
  /** Counter roll (null when no counter was possible). */
  counter: { type: DefenseAction; chance: number; roll: number; success: boolean } | null;
  /** Why no counter was possible, when none was. */
  noCounterReason?: string;
}

/** v3: stun-meter changes caused by one event. */
export interface StunChange {
  /** Who gained stun, how much and why. */
  gains: { side: Side; amount: number; cause: 'hit' | 'heavy_block' | 'block_counter' }[];
  /** A stun triggered by this event. */
  triggered: { target: Side; extraDamage: number; weaponId: string } | null;
  /** Meters after the event. */
  meters: Record<Side, number>;
}

export interface CombatEvent {
  seq: number;
  turn: number;
  phase: AttackPhase;
  attacker: Side;
  defender: Side;
  mode: AttackMode;
  weaponId: string | null;
  choiceSource: ChoiceSource;
  choiceReason?: string;
  calc: AttackCalc;
  /** HP the defender lost to this event (v3: includes stun extra damage; 0 when blocked/dodged). */
  damage: number;
  defenderHpBefore: number;
  defenderHpAfter: number;
  attackerHp: number;
  /** v3 only. 'counter' events are mini moves by the defender of `parentSeq`. */
  kind?: 'attack' | 'counter';
  parentSeq?: number;
  defense?: DefenseResult;
  stun?: StunChange;
}

/** v3: things that happen between attacks (no attack roll). Shares the `seq` counter with events. */
export interface CombatNote {
  seq: number;
  turn: number;
  side: Side;
  kind: 'skip' | 'stim' | 'turn_limit';
  /** skip: why; stim: heal amount, HP before/after and stims left; turn_limit: both HP shares (`side` = the winner). */
  detail: {
    reason?: string; heal?: number; hpBefore?: number; hpAfter?: number; stimsLeft?: number; source?: ChoiceSource;
    hpShare?: Record<Side, number>;
  };
}

/** Why the opening phase looks the way it does (engine ≥ 2.0.0; absent on older rounds). 'off' = harness ablation. */
export type OpeningRule = 'none' | 'single' | 'dex_advantage' | 'tie_none' | 'off';

export interface Initiative {
  tieBreakRoll: number;
  tieWinner: Side;
  dexTie: boolean;
  openingOrder: Side[];
  /** Fighters holding a ranged weapon (eligible for the opening shot). */
  openingEligible?: Side[];
  openingRule?: OpeningRule;
  turnOrder: [Side, Side];
  bonusAttacks: Record<Side, number>;
}

/** v3: the attack announced to the defender while it decides. */
export interface Incoming {
  attacker: Side;
  mode: AttackMode;
  weaponId: string | null;
  phase: AttackPhase;
  turn: number;
  source: ChoiceSource;
  reason?: string;
  /** Can this attack be countered at all (melee/unarmed vs a defender able to counter)? */
  counterable: boolean;
}

export interface CombatCursor {
  stage: 'opening' | 'turns' | 'done';
  openingIndex: number;
  turn: number;
  sideIndex: 0 | 1;
  attackIndex: number;
  /** v3: progress inside the current attack slot (absent = slot not started). */
  step?: 'attack' | 'defense';
  incoming?: Incoming;
  /** v3: the stim decision of the current action was already taken. */
  stimDone?: boolean;
}

export interface PendingChoice {
  side: Side;
  /** Absent = 'attack_mode' (all pre-V3 rows). */
  kind?: DecisionKind;
  options: (AttackMode | DefenseAction | StimAction)[];
  phase: AttackPhase;
  turn: number;
  /** defense: the announced attack and the odds of each answer. */
  incoming?: Incoming;
  odds?: DefenseOdds;
  /** stim: what one stim would heal now. */
  heal?: number;
}

/** v3 per-fighter meters and flags. */
export interface V3State {
  stun: Record<Side, number>;
  /** Lost its next attack turn (stunned outside its own action). */
  skipAction: Record<Side, boolean>;
  /** Cannot defend the next incoming attack (stunned). */
  loseDefense: Record<Side, boolean>;
  /** Stims left (written back to the fighter's supplies after the round). */
  stims: Record<Side, number>;
  stimsUsed: Record<Side, number>;
  stunsSuffered: Record<Side, number>;
}

export interface CombatState {
  seed: number;
  rngState: number;
  /** Absent = RuleSet v2 (every state stored before V3). */
  rules?: RuleSet;
  fighters: Record<Side, FighterSnapshot>;
  hp: Record<Side, number>;
  initiative: Initiative;
  cursor: CombatCursor;
  seq: number;
  winner: Side | null;
  /** "Use this mode for the rest of the round" — set by the human player. */
  autoMode: Partial<Record<Side, AttackMode>>;
  pending: PendingChoice | null;
  v3?: V3State;
  /** v3: how the round ended (absent = KO, and on every v2 state). */
  endReason?: 'turn_limit';
}

/**
 * What a chooser may see: public combat information only (V3 Phase A, plan §F.1 / §D-E).
 * Deliberately excludes the RNG state (future rolls), the seed and the opponent's "repeat" setting (autoMode),
 * so no chooser — boss, agent or human proxy — can act on information a real player would not have.
 */
export interface ChooserView {
  fighters: Readonly<Record<Side, FighterSnapshot>>;
  hp: Readonly<Record<Side, number>>;
  initiative: Readonly<Initiative>;
  /** Attacks resolved so far this round. */
  seq: number;
  /** v3: public meters (absent under v2). */
  stun?: Readonly<Record<Side, number>>;
  stims?: Readonly<Record<Side, number>>;
}

export function chooserView(state: CombatState): ChooserView {
  const view: ChooserView = { fighters: state.fighters, hp: { ...state.hp }, initiative: state.initiative, seq: state.seq };
  if (state.v3) {
    view.stun = { ...state.v3.stun };
    view.stims = { ...state.v3.stims };
  }
  return view;
}

export interface ChoiceContext {
  view: ChooserView;
  side: Side;
  options: AttackMode[];
  phase: AttackPhase;
  turn: number;
}
export interface ChoiceResult {
  mode: AttackMode;
  source: ChoiceSource;
  reason?: string;
}
/** Return null to pause the engine and wait for external input. */
export type Chooser = (ctx: ChoiceContext) => ChoiceResult | null;

/** v3: chances the defender can see before answering (public: derived from both snapshots, no rolls). */
export interface DefenseOdds {
  block: { chance: number; counterPossible: boolean; heavy: boolean };
  dodge: { chance: number; counterPossible: boolean; counterChance: number };
  /** Estimated would-be damage and attack shaved off with the mean mitigation roll and no pierce. */
  expectedDamage: number;
  expectedShaved: number;
}
export interface DefenseContext {
  view: ChooserView;
  side: Side;
  incoming: Incoming;
  odds: DefenseOdds;
}
export interface DefenseChoice {
  action: DefenseAction;
  source: ChoiceSource;
  reason?: string;
}
export type DefenseChooser = (ctx: DefenseContext) => DefenseChoice | null;

export interface StimContext {
  view: ChooserView;
  side: Side;
  turn: number;
  heal: number;
  stimsLeft: number;
}
export interface StimChoice {
  use: boolean;
  source: ChoiceSource;
  reason?: string;
}
export type StimChooser = (ctx: StimContext) => StimChoice | null;

/** Default v3 defence: the higher success chance (tie → block, which can counter more often). */
export const autoDefense: DefenseChooser = ({ odds }) =>
  odds.dodge.chance > odds.block.chance
    ? { action: 'dodge', source: 'auto', reason: `dodge ${(odds.dodge.chance * 100).toFixed(0)}% > block ${(odds.block.chance * 100).toFixed(0)}%` }
    : { action: 'block', source: 'auto', reason: `block ${(odds.block.chance * 100).toFixed(0)}% ≥ dodge ${(odds.dodge.chance * 100).toFixed(0)}%` };

/** Default v3 stim use: heal only when the whole heal would be used (HP lost ≥ heal amount). */
export const autoStim: StimChooser = ({ view, side, heal }) => {
  const lost = view.fighters[side].derived.maxHp - view.hp[side];
  return lost >= heal
    ? { use: true, source: 'auto', reason: `missing ${lost.toFixed(0)} HP ≥ heal ${heal.toFixed(0)}` }
    : { use: false, source: 'auto', reason: `missing ${lost.toFixed(0)} HP < heal ${heal.toFixed(0)}` };
};

/**
 * Opening-shot rule (engine 2.0.0). Eligible = a ranged weapon in a hand (Ranged+Melee holders included).
 *  - nobody eligible            → no opening phase
 *  - exactly one eligible       → it shoots, whatever its DEX
 *  - both eligible              → only the fighter with strictly higher effective DEX shoots
 *  - both eligible, equal DEX   → nobody shoots (no one has the advantage)
 */
/**
 * The DEX that makes a fighter quick (turn order, First Shot, bonus attacks, mitigation, dodge). Normally effective DEX;
 * under the harness experiment `v3.dex.rangedModShotsOnly` the ranged weapon's DEX modifier is left out.
 */
export function agilityDex(f: FighterSnapshot, rules: RuleSet = RULES_V2): number {
  const x = rules.v3?.dex;
  const share = x?.rangedModShotsOnly ? 0 : x?.rangedModAgilityShare ?? 1;
  if (share >= 1 || !f.derived.rangedWeaponId) return f.derived.effDex;
  const rangedMod = itemLookup(rules)(f.derived.rangedWeaponId).mods.dex;
  return effectiveDex(netDex(f.stats.dex, f.derived.dexModSum - (1 - share) * rangedMod));
}

export function openingShooters(player: FighterSnapshot, boss: FighterSnapshot, rules: RuleSet = RULES_V2): { openingOrder: Side[]; openingEligible: Side[]; openingRule: OpeningRule } {
  const fighters = { player, boss };
  const openingEligible = (['player', 'boss'] as Side[]).filter((s) => fighters[s].derived.rangedWeaponId !== null);
  if (openingEligible.length === 0) return { openingOrder: [], openingEligible, openingRule: 'none' };
  if (openingEligible.length === 1) return { openingOrder: openingEligible, openingEligible, openingRule: 'single' };
  const pDex = agilityDex(player, rules);
  const bDex = agilityDex(boss, rules);
  if (pDex === bDex) return { openingOrder: [], openingEligible, openingRule: 'tie_none' };
  return { openingOrder: [pDex > bDex ? 'player' : 'boss'], openingEligible, openingRule: 'dex_advantage' };
}

export function startCombat(player: FighterSnapshot, boss: FighterSnapshot, seed: number, rules: RuleSet = RULES_V2): CombatState {
  const rng = new Rng(seed);
  const tieBreakRoll = rng.next();
  const tieWinner: Side = tieBreakRoll < 0.5 ? 'player' : 'boss';
  const pDex = agilityDex(player, rules);
  const bDex = agilityDex(boss, rules);
  const dexTie = pDex === bDex;
  const dx = rules.dexBenefits;
  const faster: Side = dexTie || !dx.turnOrder ? tieWinner : pDex > bDex ? 'player' : 'boss';
  const turnOrder: [Side, Side] = [faster, otherSide(faster)];
  const fighters = { player, boss };
  const opening = openingShooters(player, boss, rules);
  const { openingOrder, openingEligible, openingRule } = dx.firstShot ? opening : { ...opening, openingOrder: [] as Side[], openingRule: 'off' as const };
  const state: CombatState = {
    seed,
    rngState: rng.state,
    fighters,
    hp: { player: player.derived.maxHp, boss: boss.derived.maxHp },
    initiative: {
      tieBreakRoll,
      tieWinner,
      dexTie,
      openingOrder,
      openingEligible,
      openingRule,
      turnOrder,
      bonusAttacks: {
        player: dx.bonusAttacks ? dexBonusAttacks(pDex, bDex) : 0,
        boss: dx.bonusAttacks ? dexBonusAttacks(bDex, pDex) : 0,
      },
    },
    cursor: { stage: openingOrder.length > 0 ? 'opening' : 'turns', openingIndex: 0, turn: 1, sideIndex: 0, attackIndex: 0 },
    seq: 0,
    winner: null,
    autoMode: {},
    pending: null,
  };
  // v2 states stay exactly as before (no `rules` / `v3` keys), so stored rounds and goldens are unchanged.
  if (rules.id !== 'v2' || rules !== RULES_V2) state.rules = rules;
  if (rules.v3) {
    state.v3 = {
      stun: { player: 0, boss: 0 },
      skipAction: { player: false, boss: false },
      loseDefense: { player: false, boss: false },
      stims: { player: player.supplies?.stims ?? 0, boss: boss.supplies?.stims ?? 0 },
      stimsUsed: { player: 0, boss: 0 },
      stunsSuffered: { player: 0, boss: 0 },
    };
  }
  return state;
}

interface Slot {
  attacker: Side;
  phase: AttackPhase;
  turn: number;
}

function currentSlot(state: CombatState): Slot | null {
  const c = state.cursor;
  if (c.stage === 'opening') {
    if (c.openingIndex < state.initiative.openingOrder.length) {
      return { attacker: state.initiative.openingOrder[c.openingIndex], phase: 'opening', turn: 0 };
    }
    c.stage = 'turns';
  }
  if (c.stage === 'turns') {
    const attacker = state.initiative.turnOrder[c.sideIndex];
    return { attacker, phase: c.attackIndex === 0 ? 'regular' : 'dex_bonus', turn: c.turn };
  }
  return null;
}

function clearSlotProgress(c: CombatCursor): void {
  delete c.step;
  delete c.incoming;
}

function advanceCursor(state: CombatState, attacker: Side): void {
  const c = state.cursor;
  if (state.v3) clearSlotProgress(c);
  if (c.stage === 'opening') {
    c.openingIndex++;
    if (c.openingIndex >= state.initiative.openingOrder.length) c.stage = 'turns';
    return;
  }
  c.attackIndex++;
  if (c.attackIndex > state.initiative.bonusAttacks[attacker]) {
    c.attackIndex = 0;
    if (state.v3) delete c.stimDone;
    if (c.sideIndex === 0) c.sideIndex = 1;
    else {
      c.sideIndex = 0;
      c.turn++;
    }
  }
}

/** v3: end the current fighter's whole action now (skipped turn, or stunned during its own action). */
function endAction(state: CombatState, attacker: Side): void {
  const c = state.cursor;
  if (c.stage === 'opening') return advanceCursor(state, attacker);
  c.attackIndex = state.initiative.bonusAttacks[attacker];
  advanceCursor(state, attacker);
}

/** The weapon an attack in `mode` is made with (null for unarmed). */
export function weaponForMode(att: FighterSnapshot, mode: AttackMode): string | null {
  return mode === 'ranged' ? att.derived.rangedWeaponId : mode === 'melee' ? att.derived.meleeWeaponId : null;
}

/**
 * The plan's damage pipeline with injectable draws. `drawPierce` is called only when the weapon has a pierce spec,
 * then `drawMitigation` — the exact V2 order.
 */
function computeAttack(
  att: FighterSnapshot,
  def: FighterSnapshot,
  mode: AttackMode,
  drawPierce: () => number,
  drawMitigation: () => number,
  rules: RuleSet,
): AttackCalc {
  const ranged = mode === 'ranged';
  const attackValue = ranged ? att.derived.effDex : att.derived.netAtk;
  const defenderNetDef = def.derived.netDef;

  let pierce: PierceRoll | null = null;
  let ignore = 0;
  const weaponId = weaponForMode(att, mode);
  const spec = weaponId ? itemLookup(rules)(weaponId).pierce : undefined;
  if (spec) {
    const roll = drawPierce();
    const success = roll < spec.chance;
    pierce = { chance: spec.chance, defIgnore: spec.defIgnore, roll, success, placeholder: spec.placeholder, weaponId: weaponId!, extraDamage: 0 };
    ignore = success ? spec.defIgnore : 0;
  }
  const defUsed = defAfterPierce(defenderNetDef, ignore);
  const net = netDamage(attackValue, defUsed);
  if (pierce && pierce.success) pierce.extraDamage = net - netDamage(attackValue, defenderNetDef);

  const attackerDex = agilityDex(att, rules);
  const defenderDex = agilityDex(def, rules);
  const ratio = dexRatio(defenderDex, attackerDex);
  const mitigationUniform = drawMitigation();
  const mitigationRoll = mitigationRollFromUniform(mitigationUniform);
  const rawMitigation = rawDexMitigation(ratio, mitigationRoll);
  const mitigationOn = rules.dexBenefits.mitigation;
  const mitigation = mitigationOn ? dexMitigation(ratio, mitigationRoll) : 0;

  const calc: AttackCalc = {
    attackValueSource: ranged ? 'effDex' : 'netAtk',
    attackValue,
    defenderNetDef,
    pierce,
    defUsed,
    netDamage: net,
    attackerDex,
    defenderDex,
    dexRatio: ratio,
    mitigationUniform,
    mitigationRoll,
    rawMitigation,
    mitigation,
    mitigationClamped: rawMitigation < 0,
    finalDamage: finalDamage(net, mitigation),
  };
  if (!mitigationOn) calc.mitigationDisabled = true;
  return calc;
}

/**
 * Resolve one attack with the plan's damage pipeline.
 * Consumes RNG: pierce roll (only if the weapon used has a pierce spec), then mitigation roll.
 */
export function resolveAttack(att: FighterSnapshot, def: FighterSnapshot, mode: AttackMode, rng: Rng, rules: RuleSet = RULES_V2): AttackCalc {
  return computeAttack(att, def, mode, () => rng.next(), () => rng.next(), rules);
}

// ---------------------------------------------------------------------------------------------------------------
// V3 helpers (pure; also used by previews, expected values and the UI odds)
// ---------------------------------------------------------------------------------------------------------------

/** Mode a defender counters with: its melee weapon, or bare hands when it holds no weapon. null = cannot counter. */
export function counterMode(def: FighterSnapshot): AttackMode | null {
  if (def.derived.meleeWeaponId) return 'melee';
  if (def.derived.attackModes.includes('unarmed')) return 'unarmed';
  return null;
}

export function blockChanceFor(def: FighterSnapshot, rules: RuleSet): number {
  const cfg = rules.v3!.block;
  const item = itemLookup(rules);
  const gear = [def.loadout.hand1, def.loadout.hand2, def.loadout.armour]
    .filter((x): x is string => x !== null)
    .reduce((s, id) => s + (item(id).combat?.blockBonus ?? 0), 0);
  const d = cfg.defSource === 'raw' ? def.stats.def : def.derived.netDef;
  return blockChance(d, gear, cfg.defFactor, cfg.cap);
}

/** Dodge delta under the rule set's delta definition (DEX points by default). */
export function dodgeDeltaFor(def: FighterSnapshot, att: FighterSnapshot, rules: RuleSet): number {
  const mode = rules.v3!.dodge.delta;
  const d = agilityDex(def, rules), a = agilityDex(att, rules);
  if (mode === 'percent') return dodgeDeltaPercent(d, a);
  if (mode === 'signed') return d - a;
  return dodgeDelta(d, a);
}

export function dodgeChanceFor(def: FighterSnapshot, att: FighterSnapshot, rules: RuleSet): number {
  const cfg = rules.v3!.dodge;
  return dodgeChance(dodgeDeltaFor(def, att, rules), cfg.perDexPoint, cfg.cap, cfg.base, cfg.delta === 'signed');
}

/** Dodge-counter modifier of the defender's melee weapon (0 = no dodge counter). */
function dodgeCounterMod(def: FighterSnapshot, rules: RuleSet): number {
  return def.derived.meleeWeaponId ? itemLookup(rules)(def.derived.meleeWeaponId).combat?.dodgeCounter ?? 0 : 0;
}

/** Public odds for the defender's decision (mean mitigation roll, no pierce). */
export function defenseOdds(att: FighterSnapshot, def: FighterSnapshot, mode: AttackMode, rules: RuleSet): DefenseOdds {
  const cfg = rules.v3!;
  const mean = 0.5;
  const est = computeAttack(att, def, mode, () => 1, () => mean, rules); // pierce roll 1 → never pierces
  const shaved = attackShavedOff(est.attackValue, est.finalDamage);
  const melee = mode !== 'ranged';
  const cMode = counterMode(def);
  const mod = dodgeCounterMod(def, rules);
  const delta = dodgeDeltaFor(def, att, rules);
  return {
    block: { chance: blockChanceFor(def, rules), counterPossible: melee && cMode !== null, heavy: isHeavyHit(est.finalDamage, def.derived.maxHp, cfg.stun.heavyBlockFraction) },
    dodge: {
      chance: dodgeChanceFor(def, att, rules),
      counterPossible: melee && mod > 0,
      counterChance: melee && mod > 0 ? dodgeCounterChance(delta, mod, cfg.counter.dodgeChanceCap) : 0,
    },
    expectedDamage: est.finalDamage,
    expectedShaved: shaved,
  };
}

export function stimHealFor(f: FighterSnapshot, rules: RuleSet): number {
  const s = rules.v3!.stim;
  return stimHealAmount(f.derived.maxHp, f.supplies?.effectiveness ?? 0, s.healBase, s.healPerUpgrade);
}

export interface AdvanceOptions {
  /** A choice supplied by the human for the currently pending decision. */
  provided?: { side: Side; mode?: AttackMode; repeat?: boolean; defense?: DefenseAction; stim?: boolean };
  /** v3: defence/stim choosers per side; missing → automatic defaults (autoDefense / autoStim). Return null to pause. */
  defense?: Partial<Record<Side, DefenseChooser>>;
  stim?: Partial<Record<Side, StimChooser>>;
}

/**
 * Run the combat forward until it finishes or needs an external choice.
 * Returns a NEW state (input untouched), the attack events and (v3) the notes produced in this call.
 */
export function advanceCombat(
  input: CombatState,
  choosers: Record<Side, Chooser>,
  options: AdvanceOptions = {},
): { state: CombatState; events: CombatEvent[]; notes: CombatNote[] } {
  const state: CombatState = structuredClone(input);
  if (state.v3) return advanceV3(state, choosers, options);

  const events: CombatEvent[] = [];
  let provided = options.provided;
  const rules = state.rules ?? RULES_V2;

  if (provided) {
    if (!state.pending || state.pending.side !== provided.side) throw new Error('No choice is pending for that side');
    if (!provided.mode || !state.pending.options.includes(provided.mode)) {
      throw new Error(`Mode "${provided.mode}" is not available (options: ${state.pending.options.join(', ')})`);
    }
    if (provided.repeat) state.autoMode[provided.side] = provided.mode;
  }
  state.pending = null;
  const rng = new Rng(state.rngState);

  while (state.winner === null) {
    const slot = currentSlot(state);
    if (!slot) break;
    if (state.seq >= MAX_ATTACKS_PER_ROUND) {
      throw new Error(`Combat exceeded ${MAX_ATTACKS_PER_ROUND} attacks — aborting round (safety guard)`);
    }
    const att = state.fighters[slot.attacker];
    const defSide = otherSide(slot.attacker);
    const def = state.fighters[defSide];

    const choice = chooseMode(state, slot, choosers, provided);
    if (choice === 'pause') break;
    if (choice.consumedProvided) provided = undefined;

    const calc = resolveAttack(att, def, choice.mode, rng, rules);
    const before = state.hp[defSide];
    const after = before - calc.finalDamage;
    state.hp[defSide] = after;
    state.seq++;
    events.push({
      seq: state.seq,
      turn: slot.turn,
      phase: slot.phase,
      attacker: slot.attacker,
      defender: defSide,
      mode: choice.mode,
      weaponId: weaponForMode(att, choice.mode),
      choiceSource: choice.source,
      choiceReason: choice.reason,
      calc,
      damage: calc.finalDamage,
      defenderHpBefore: before,
      defenderHpAfter: after,
      attackerHp: state.hp[slot.attacker],
    });
    advanceCursor(state, slot.attacker);
    if (after <= 0) {
      state.winner = slot.attacker;
      state.cursor.stage = 'done';
    }
  }
  state.rngState = rng.state;
  return { state, events, notes: [] };
}

/** Attack-mode decision shared by both rule sets. 'pause' = waiting for the human (state.pending set). */
function chooseMode(
  state: CombatState,
  slot: Slot,
  choosers: Record<Side, Chooser>,
  provided: AdvanceOptions['provided'],
): (ChoiceResult & { consumedProvided: boolean }) | 'pause' {
  const att = state.fighters[slot.attacker];
  if (slot.phase === 'opening') return { mode: 'ranged', source: 'forced', reason: 'Opening attack is always ranged', consumedProvided: false };
  if (att.derived.attackModes.length === 1) return { mode: att.derived.attackModes[0], source: 'forced', consumedProvided: false };
  if (provided && provided.side === slot.attacker && provided.mode) return { mode: provided.mode, source: 'player', consumedProvided: true };
  if (state.autoMode[slot.attacker]) return { mode: state.autoMode[slot.attacker]!, source: 'player_auto', consumedProvided: false };
  const res = choosers[slot.attacker]({ view: chooserView(state), side: slot.attacker, options: att.derived.attackModes, phase: slot.phase, turn: slot.turn });
  if (!res) {
    state.pending = { side: slot.attacker, options: att.derived.attackModes, phase: slot.phase, turn: slot.turn };
    if (state.v3) state.pending.kind = 'attack_mode';
    return 'pause';
  }
  if (!att.derived.attackModes.includes(res.mode)) throw new Error(`Chooser returned illegal mode "${res.mode}"`);
  return { ...res, consumedProvided: false };
}

// ---------------------------------------------------------------------------------------------------------------
// V3 loop
// ---------------------------------------------------------------------------------------------------------------

function validateProvided(state: CombatState, provided: NonNullable<AdvanceOptions['provided']>): void {
  const p = state.pending;
  if (!p || p.side !== provided.side) throw new Error('No choice is pending for that side');
  const kind = p.kind ?? 'attack_mode';
  if (kind === 'attack_mode' && (!provided.mode || !p.options.includes(provided.mode))) {
    throw new Error(`Mode "${provided.mode}" is not available (options: ${p.options.join(', ')})`);
  }
  if (kind === 'defense' && (!provided.defense || !p.options.includes(provided.defense))) {
    throw new Error(`Defence "${provided.defense}" is not available (options: ${p.options.join(', ')})`);
  }
  if (kind === 'stim' && typeof provided.stim !== 'boolean') throw new Error('A stim decision (use: true/false) is pending');
}

function advanceV3(state: CombatState, choosers: Record<Side, Chooser>, options: AdvanceOptions): { state: CombatState; events: CombatEvent[]; notes: CombatNote[] } {
  const rules = state.rules!;
  const v3 = state.v3!;
  const events: CombatEvent[] = [];
  const notes: CombatNote[] = [];
  let provided = options.provided;
  if (provided) {
    validateProvided(state, provided);
    if (provided.mode && provided.repeat) state.autoMode[provided.side] = provided.mode;
  }
  const pendingKind = state.pending?.kind ?? 'attack_mode';
  state.pending = null;
  const rng = new Rng(state.rngState);
  const take = <K extends 'mode' | 'defense' | 'stim'>(kind: DecisionKind, key: K): NonNullable<AdvanceOptions['provided']>[K] | undefined => {
    if (!provided || pendingKind !== kind || provided[key] === undefined) return undefined;
    const v = provided[key];
    provided = undefined;
    return v;
  };

  while (state.winner === null) {
    const slot = currentSlot(state);
    if (!slot) break;
    if (state.seq >= MAX_ATTACKS_PER_ROUND) {
      throw new Error(`Combat exceeded ${MAX_ATTACKS_PER_ROUND} attacks — aborting round (safety guard)`);
    }
    const c = state.cursor;
    // D-19: turn limit — after the last allowed turn, the higher HP share wins (tie → initiative coin-flip winner).
    if (slot.phase !== 'opening' && slot.turn > rules.v3!.round.turnLimit) {
      const share = { player: state.hp.player / state.fighters.player.derived.maxHp, boss: state.hp.boss / state.fighters.boss.derived.maxHp };
      const winner: Side = share.player === share.boss ? state.initiative.tieWinner : share.player > share.boss ? 'player' : 'boss';
      notes.push({
        seq: ++state.seq, turn: rules.v3!.round.turnLimit, side: winner, kind: 'turn_limit',
        detail: { reason: `turn limit ${rules.v3!.round.turnLimit}: higher HP share wins${share.player === share.boss ? ' (tie → initiative winner)' : ''}`, hpShare: share },
      });
      state.winner = winner;
      state.endReason = 'turn_limit';
      state.cursor.stage = 'done';
      break;
    }
    const A = slot.attacker;
    const D = otherSide(A);
    const att = state.fighters[A];
    const def = state.fighters[D];

    // a. Start of a regular action: lost turn (stun), then the optional stim.
    if (slot.phase === 'regular' && !c.step) {
      if (v3.skipAction[A]) {
        v3.skipAction[A] = false;
        notes.push({ seq: ++state.seq, turn: slot.turn, side: A, kind: 'skip', detail: { reason: 'stunned: loses this attack turn' } });
        endAction(state, A);
        continue;
      }
      if (!c.stimDone) {
        const heal = stimHealFor(att, rules);
        if (v3.stims[A] > 0 && state.hp[A] < att.derived.maxHp) {
          const given = take('stim', 'stim');
          let decision: StimChoice | null = given !== undefined ? { use: given, source: 'player' } : null;
          if (!decision) {
            const chooser = options.stim?.[A] ?? autoStim;
            decision = chooser({ view: chooserView(state), side: A, turn: slot.turn, heal, stimsLeft: v3.stims[A] });
          }
          if (!decision) {
            state.pending = { side: A, kind: 'stim', options: ['use', 'skip'], phase: slot.phase, turn: slot.turn, heal };
            break;
          }
          if (decision.use) {
            const hpBefore = state.hp[A];
            const amount = Math.min(heal, att.derived.maxHp - hpBefore);
            state.hp[A] = hpBefore + amount;
            v3.stims[A]--;
            v3.stimsUsed[A]++;
            notes.push({ seq: ++state.seq, turn: slot.turn, side: A, kind: 'stim', detail: { heal: amount, hpBefore, hpAfter: state.hp[A], stimsLeft: v3.stims[A], source: decision.source } });
          }
        }
        c.stimDone = true;
      }
    }

    // b. Attack mode, then the announced attack.
    if (!c.step) {
      const choice = chooseMode(state, slot, choosers, provided && pendingKind === 'attack_mode' ? provided : undefined);
      if (choice === 'pause') break;
      if (choice.consumedProvided) provided = undefined;
      const weaponId = weaponForMode(att, choice.mode);
      c.incoming = {
        attacker: A, mode: choice.mode, weaponId, phase: slot.phase, turn: slot.turn, source: choice.source, reason: choice.reason,
        counterable: choice.mode !== 'ranged' && counterMode(def) !== null,
      };
      c.step = 'defense';
    }
    const incoming = c.incoming!;

    // c. The defender answers (or cannot, when stunned).
    const odds = defenseOdds(att, def, incoming.mode, rules);
    let defense: DefenseChoice | null = null;
    const stunnedDefender = v3.loseDefense[D];
    if (!stunnedDefender) {
      const given = take('defense', 'defense');
      defense = given ? { action: given, source: 'player' } : null;
      if (!defense) {
        const chooser = options.defense?.[D] ?? autoDefense;
        defense = chooser({ view: chooserView(state), side: D, incoming, odds });
      }
      if (!defense) {
        state.pending = { side: D, kind: 'defense', options: ['block', 'dodge'], phase: slot.phase, turn: slot.turn, incoming, odds };
        break;
      }
    } else {
      v3.loseDefense[D] = false;
    }

    // d–f. Resolve the exchange.
    const ended = resolveExchange(state, slot, incoming, defense, rng, events);
    if (state.winner !== null) {
      state.cursor.stage = 'done';
      clearSlotProgress(state.cursor);
      break;
    }
    if (ended) endAction(state, A);
    else advanceCursor(state, A);
  }
  state.rngState = rng.state;
  return { state, events, notes };
}

/**
 * Resolve one announced attack and its counter. Returns true when the attacker was stunned during its own
 * action (its remaining attacks this action are lost — that is its lost attack turn).
 */
function resolveExchange(state: CombatState, slot: Slot, incoming: Incoming, defense: DefenseChoice | null, rng: Rng, events: CombatEvent[]): boolean {
  const rules = state.rules!;
  const cfg = rules.v3!;
  const v3 = state.v3!;
  const item = itemLookup(rules);
  const A = slot.attacker;
  const D = otherSide(A);
  const att = state.fighters[A];
  const def = state.fighters[D];
  // Six fixed draws, always, in this order.
  const [uDefense, uCounter, uPierce, uMit, uCPierce, uCMit] = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];

  const calc = computeAttack(att, def, incoming.mode, () => uPierce, () => uMit, rules);
  const would = calc.finalDamage;
  const shaved = attackShavedOff(calc.attackValue, would);
  const attWeapon = incoming.weaponId;
  const boost = attWeapon ? item(attWeapon).combat?.stunBoost ?? 0 : 0;
  const gain = stunGain(shaved, calc.mitigationRoll, cfg.stun.boostScale * boost, cfg.stun.base, cfg.stun.span, cfg.stun.sumCap);

  let result: DefenseResult;
  if (!defense) {
    result = { action: 'none', source: 'forced', reason: 'stunned: cannot defend', chance: 0, roll: uDefense, success: false, shaved, wouldBeDamage: would, counter: null, noCounterReason: 'no defence' };
  } else {
    const chance = defense.action === 'block' ? blockChanceFor(def, rules) : dodgeChanceFor(def, att, rules);
    result = { action: defense.action, source: defense.source, reason: defense.reason, chance, roll: uDefense, success: uDefense < chance, shaved, wouldBeDamage: would, counter: null };
  }

  let attackerEnded = false;
  const stunChange: StunChange = { gains: [], triggered: null, meters: { ...v3.stun } };
  /** Add stun to `target`; trigger when full and the hit's weapon can stun. Returns extra damage dealt. */
  const addStun = (target: Side, amount: number, cause: StunChange['gains'][number]['cause'], weaponId: string | null, damageBase: number, change: StunChange): number => {
    change.gains.push({ side: target, amount, cause });
    v3.stun[target] = Math.min(cfg.stun.threshold, v3.stun[target] + amount);
    let extra = 0;
    if (cfg.stun.trigger && v3.stun[target] >= cfg.stun.threshold && weaponId && item(weaponId).combat?.canStun) {
      extra = cfg.stun.extraDamageFraction * damageBase;
      change.triggered = { target, extraDamage: extra, weaponId };
      v3.stun[target] = 0;
      v3.stunsSuffered[target]++;
      v3.loseDefense[target] = true;
      // Exactly one lost attack turn: stunned during its own action with attacks left → the rest of this action;
      // otherwise its next action.
      const attacksLeft = state.cursor.stage === 'turns' && state.cursor.attackIndex < state.initiative.bonusAttacks[A];
      if (target === A && attacksLeft) attackerEnded = true;
      else v3.skipAction[target] = true;
    }
    change.meters = { ...v3.stun };
    return extra;
  };

  let damage = 0;
  if (!result.success) {
    damage = would + addStun(D, gain, 'hit', attWeapon, would, stunChange);
  } else if (result.action === 'block') {
    result.heavy = isHeavyHit(would, def.derived.maxHp, cfg.stun.heavyBlockFraction);
    if (result.heavy) damage = addStun(D, gain, 'heavy_block', attWeapon, would, stunChange);
  }

  // Counter eligibility (after a successful defence only).
  let counterKind: DefenseAction | null = null;
  if (result.success) {
    const cMode = counterMode(def);
    if (incoming.mode === 'ranged') result.noCounterReason = 'ranged attacks cannot be countered';
    else if (result.action === 'block') {
      if (!cMode) result.noCounterReason = 'no melee weapon to counter with';
      else {
        const ch = blockCounterChance(shaved, cfg.counter.blockChanceCap);
        result.counter = { type: 'block', chance: ch, roll: uCounter, success: uCounter < ch };
        if (result.counter.success) counterKind = 'block';
      }
    } else {
      const mod = dodgeCounterMod(def, rules);
      if (mod <= 0) result.noCounterReason = 'weapon has no dodge counter';
      else {
        const ch = dodgeCounterChance(dodgeDeltaFor(def, att, rules), mod, cfg.counter.dodgeChanceCap);
        result.counter = { type: 'dodge', chance: ch, roll: uCounter, success: uCounter < ch };
        if (result.counter.success) counterKind = 'dodge';
      }
    }
  }

  const before = state.hp[D];
  state.hp[D] = before - damage;
  const parentSeq = ++state.seq;
  events.push({
    seq: parentSeq, turn: slot.turn, phase: slot.phase, attacker: A, defender: D, mode: incoming.mode, weaponId: attWeapon,
    choiceSource: incoming.source, choiceReason: incoming.reason, calc, damage, defenderHpBefore: before, defenderHpAfter: state.hp[D],
    attackerHp: state.hp[A], kind: 'attack', defense: result, stun: stunChange,
  });
  if (state.hp[D] <= 0) {
    state.winner = A;
    return false;
  }

  // e. Counter mini move by the defender against the attacker (cannot be defended or countered).
  if (counterKind) {
    const cMode = counterMode(def)!;
    const cCalc = computeAttack(def, att, cMode, () => uCPierce, () => uCMit, rules);
    const mult = counterKind === 'block' ? cfg.counter.blockMultiplier : cfg.counter.dodgeMultiplier;
    const hit = cCalc.finalDamage * mult;
    const cStun: StunChange = { gains: [], triggered: null, meters: { ...v3.stun } };
    const cWeapon = weaponForMode(def, cMode);
    const extra = counterKind === 'block' ? addStun(A, cfg.counter.blockCounterStun, 'block_counter', cWeapon, hit, cStun) : 0;
    const cBefore = state.hp[A];
    state.hp[A] = cBefore - hit - extra;
    events.push({
      seq: ++state.seq, turn: slot.turn, phase: 'counter', attacker: D, defender: A, mode: cMode, weaponId: cWeapon,
      choiceSource: 'forced', choiceReason: `${counterKind} counter ×${mult}`, calc: cCalc, damage: hit + extra,
      defenderHpBefore: cBefore, defenderHpAfter: state.hp[A], attackerHp: state.hp[D], kind: 'counter', parentSeq, stun: cStun,
    });
    if (state.hp[A] <= 0) {
      state.winner = D;
      return false;
    }
  }
  return attackerEnded;
}

/** Convenience for tests/simulations: run a whole round with choosers that never pause. */
export function runFullCombat(
  player: FighterSnapshot,
  boss: FighterSnapshot,
  seed: number,
  choosers: Record<Side, Chooser>,
  opts: { rules?: RuleSet } & Omit<AdvanceOptions, 'provided'> = {},
): { state: CombatState; events: CombatEvent[]; notes: CombatNote[] } {
  const { rules, ...adv } = opts;
  const res = advanceCombat(startCombat(player, boss, seed, rules), choosers, adv);
  if (res.state.winner === null) throw new Error('runFullCombat: a chooser paused the combat');
  return res;
}
