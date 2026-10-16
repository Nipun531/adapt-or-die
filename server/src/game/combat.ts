/**
 * Combat engine — an authoritative, resumable state machine.
 *
 * Round structure (plan + approved developer decisions, see docs/GAME_MECHANICS.md §Combat order):
 *  1. Tie-break coin flip is drawn first (always, so the RNG sequence is stable). It is only used when
 *     both fighters have equal effective DEX.
 *  2. Opening phase: every fighter with a ranged weapon equipped makes ONE ranged opening attack.
 *     If both have one, higher effective DEX shoots first (plan §5 priority).
 *  3. Turns: the fighter with higher effective DEX acts first each turn. On its action a fighter makes
 *     1 regular attack + DEX bonus attacks (plan §4: +1 at 15 advantage, +2 at 30+, applied every turn).
 *  4. The round ends the instant a fighter's HP reaches 0 or below.
 *
 * Fighters with Ranged+Melee choose 'ranged' (DEX) or 'melee' (STR) for each regular/bonus attack.
 * When a choice is needed and no chooser answers, the engine pauses (`pending`) and can be resumed
 * later — the whole state, including the RNG, is JSON-serialisable.
 *
 * Every attack produces a CombatEvent containing all formula inputs, random rolls and intermediates.
 */
import { requireItem } from './catalog.js';
import { MAX_ATTACKS_PER_ROUND } from './constants.js';
import {
  defAfterPierce,
  dexBonusAttacks,
  dexMitigation,
  dexRatio,
  finalDamage,
  mitigationRollFromUniform,
  netDamage,
  rawDexMitigation,
} from './formulas.js';
import { Rng } from './rng.js';
import type { AttackMode, FighterSnapshot, Side } from './types.js';
import { otherSide } from './types.js';

export type AttackPhase = 'opening' | 'regular' | 'dex_bonus';
/** Who decided the attack mode: forced (only one option), the human, the human's "repeat" setting, boss policy, or a sim agent. */
export type ChoiceSource = 'forced' | 'player' | 'player_auto' | 'boss_policy' | 'agent';

export interface PierceRoll {
  chance: number;
  defIgnore: number;
  roll: number;
  success: boolean;
  placeholder: boolean;
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
  finalDamage: number;
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
  damage: number;
  defenderHpBefore: number;
  defenderHpAfter: number;
  attackerHp: number;
}

export interface Initiative {
  tieBreakRoll: number;
  tieWinner: Side;
  dexTie: boolean;
  openingOrder: Side[];
  turnOrder: [Side, Side];
  bonusAttacks: Record<Side, number>;
}

export interface CombatCursor {
  stage: 'opening' | 'turns' | 'done';
  openingIndex: number;
  turn: number;
  sideIndex: 0 | 1;
  attackIndex: number;
}

export interface PendingChoice {
  side: Side;
  options: AttackMode[];
  phase: AttackPhase;
  turn: number;
}

export interface CombatState {
  seed: number;
  rngState: number;
  fighters: Record<Side, FighterSnapshot>;
  hp: Record<Side, number>;
  initiative: Initiative;
  cursor: CombatCursor;
  seq: number;
  winner: Side | null;
  /** "Use this mode for the rest of the round" — set by the human player. */
  autoMode: Partial<Record<Side, AttackMode>>;
  pending: PendingChoice | null;
}

export interface ChoiceContext {
  state: CombatState;
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

export function startCombat(player: FighterSnapshot, boss: FighterSnapshot, seed: number): CombatState {
  const rng = new Rng(seed);
  const tieBreakRoll = rng.next();
  const tieWinner: Side = tieBreakRoll < 0.5 ? 'player' : 'boss';
  const pDex = player.derived.effDex;
  const bDex = boss.derived.effDex;
  const dexTie = pDex === bDex;
  const faster: Side = dexTie ? tieWinner : pDex > bDex ? 'player' : 'boss';
  const turnOrder: [Side, Side] = [faster, otherSide(faster)];
  const fighters = { player, boss };
  const openingOrder = turnOrder.filter((s) => fighters[s].derived.rangedWeaponId !== null);
  return {
    seed,
    rngState: rng.state,
    fighters,
    hp: { player: player.derived.maxHp, boss: boss.derived.maxHp },
    initiative: {
      tieBreakRoll,
      tieWinner,
      dexTie,
      openingOrder,
      turnOrder,
      bonusAttacks: {
        player: dexBonusAttacks(pDex, bDex),
        boss: dexBonusAttacks(bDex, pDex),
      },
    },
    cursor: { stage: openingOrder.length > 0 ? 'opening' : 'turns', openingIndex: 0, turn: 1, sideIndex: 0, attackIndex: 0 },
    seq: 0,
    winner: null,
    autoMode: {},
    pending: null,
  };
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

function advanceCursor(state: CombatState, attacker: Side): void {
  const c = state.cursor;
  if (c.stage === 'opening') {
    c.openingIndex++;
    if (c.openingIndex >= state.initiative.openingOrder.length) c.stage = 'turns';
    return;
  }
  c.attackIndex++;
  if (c.attackIndex > state.initiative.bonusAttacks[attacker]) {
    c.attackIndex = 0;
    if (c.sideIndex === 0) c.sideIndex = 1;
    else {
      c.sideIndex = 0;
      c.turn++;
    }
  }
}

/** Resolve one attack with the plan's damage pipeline. Consumes RNG: pierce roll (ranged only), then mitigation roll. */
export function resolveAttack(
  att: FighterSnapshot,
  def: FighterSnapshot,
  mode: AttackMode,
  rng: Rng,
): AttackCalc {
  const ranged = mode === 'ranged';
  const attackValue = ranged ? att.derived.effDex : att.derived.netAtk;
  const defenderNetDef = def.derived.netDef;

  let pierce: PierceRoll | null = null;
  let ignore = 0;
  if (ranged) {
    const weapon = requireItem(att.derived.rangedWeaponId!);
    const spec = weapon.pierce ?? { chance: 0, defIgnore: 0, placeholder: true };
    const roll = rng.next();
    const success = roll < spec.chance;
    pierce = { chance: spec.chance, defIgnore: spec.defIgnore, roll, success, placeholder: spec.placeholder };
    ignore = success ? spec.defIgnore : 0;
  }
  const defUsed = defAfterPierce(defenderNetDef, ignore);
  const net = netDamage(attackValue, defUsed);

  const attackerDex = att.derived.effDex;
  const defenderDex = def.derived.effDex;
  const ratio = dexRatio(defenderDex, attackerDex);
  const mitigationUniform = rng.next();
  const mitigationRoll = mitigationRollFromUniform(mitigationUniform);
  const rawMitigation = rawDexMitigation(ratio, mitigationRoll);
  const mitigation = dexMitigation(ratio, mitigationRoll);

  return {
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
}

export interface AdvanceOptions {
  /** A choice supplied by the human for the currently pending attack. */
  provided?: { side: Side; mode: AttackMode; repeat?: boolean };
}

/**
 * Run the combat forward until it finishes or needs an external choice.
 * Returns a NEW state (input untouched) and the events produced in this call.
 */
export function advanceCombat(
  input: CombatState,
  choosers: Record<Side, Chooser>,
  options: AdvanceOptions = {},
): { state: CombatState; events: CombatEvent[] } {
  const state: CombatState = structuredClone(input);
  const events: CombatEvent[] = [];
  let provided = options.provided;

  if (provided) {
    if (!state.pending || state.pending.side !== provided.side) throw new Error('No choice is pending for that side');
    if (!state.pending.options.includes(provided.mode)) {
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

    let choice: ChoiceResult;
    if (slot.phase === 'opening') {
      choice = { mode: 'ranged', source: 'forced', reason: 'Opening attack is always ranged' };
    } else if (att.derived.attackModes.length === 1) {
      choice = { mode: att.derived.attackModes[0], source: 'forced' };
    } else if (provided && provided.side === slot.attacker) {
      choice = { mode: provided.mode, source: 'player' };
      provided = undefined;
    } else if (state.autoMode[slot.attacker]) {
      choice = { mode: state.autoMode[slot.attacker]!, source: 'player_auto' };
    } else {
      const res = choosers[slot.attacker]({
        state,
        side: slot.attacker,
        options: att.derived.attackModes,
        phase: slot.phase,
        turn: slot.turn,
      });
      if (!res) {
        state.pending = { side: slot.attacker, options: att.derived.attackModes, phase: slot.phase, turn: slot.turn };
        break;
      }
      if (!att.derived.attackModes.includes(res.mode)) throw new Error(`Chooser returned illegal mode "${res.mode}"`);
      choice = res;
    }

    const calc = resolveAttack(att, def, choice.mode, rng);
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
      weaponId: choice.mode === 'ranged' ? att.derived.rangedWeaponId : choice.mode === 'melee' ? att.derived.meleeWeaponId : null,
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
  return { state, events };
}

/** Convenience for tests/simulations: run a whole round with choosers that never pause. */
export function runFullCombat(
  player: FighterSnapshot,
  boss: FighterSnapshot,
  seed: number,
  choosers: Record<Side, Chooser>,
): { state: CombatState; events: CombatEvent[] } {
  const res = advanceCombat(startCombat(player, boss, seed), choosers);
  if (res.state.winner === null) throw new Error('runFullCombat: a chooser paused the combat');
  return res;
}
