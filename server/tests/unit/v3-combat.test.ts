/**
 * V3 combat (docs/V3_DEMANDS.md): formulas, attack → defence → counter → stun order, stims, pauses, RNG stability,
 * and that RuleSet v2 is untouched. Harness rule variants (`withRules`) force outcomes deterministically.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceCombat,
  runFullCombat,
  startCombat,
  type Chooser,
  type CombatEvent,
  type CombatNote,
  type DefenseChooser,
} from '../../src/game/combat.js';
import { ITEMS_V2, ITEMS_V3 } from '../../src/game/catalog.js';
import { MAX_ATTACKS_PER_ROUND } from '../../src/game/constants.js';
import { snapshotOf } from '../../src/game/derive.js';
import {
  attackShavedOff,
  blockChance,
  blockCounterChance,
  dodgeChance,
  dodgeCounterChance,
  isHeavyHit,
  stimHealAmount,
  stunGain,
} from '../../src/game/formulas.js';
import { initialCombatant } from '../../src/game/progression.js';
import { Rng } from '../../src/game/rng.js';
import { RULES_V2, RULES_V3, withRules } from '../../src/game/rules.js';
import type { CombatantState, Loadout, Side, Supplies } from '../../src/game/types.js';

function fighter(side: Side, loadout: Partial<Loadout>, stats: Partial<CombatantState['stats']> = {}, supplies?: Supplies) {
  const base = initialCombatant(side);
  const lo = { hand1: null, hand2: null, armour: null, ...loadout };
  const inv = [lo.hand1, lo.hand2, lo.armour].filter(Boolean) as string[];
  const snap = snapshotOf({ ...base, stats: { ...base.stats, ...stats }, inventory: inv, loadout: lo });
  return supplies ? { ...snap, supplies } : snap;
}
const melee: Chooser = (c) => ({ mode: c.options.includes('melee') ? 'melee' : c.options[0], source: 'agent' });
const choosers = { player: melee, boss: melee };
const always = (action: 'block' | 'dodge'): DefenseChooser => () => ({ action, source: 'agent' });
const attacks = (evs: CombatEvent[]) => evs.filter((e) => e.kind === 'attack');

/** Defences never succeed (block and dodge capped at 0). */
const NO_DEFENCE = withRules(RULES_V3, { v3: { block: { cap: 0 }, dodge: { cap: 0 } } });
/** Blocks always succeed. */
const ALWAYS_BLOCK = withRules(RULES_V3, { v3: { block: { defFactor: 1, cap: 1 } } });

describe('V3 formulas', () => {
  it('dodge: 2% per DEX point of lead, capped at 70%, never negative', () => {
    expect(dodgeChance(15, 0.02, 0.7)).toBeCloseTo(0.3);
    expect(dodgeChance(40, 0.02, 0.7)).toBe(0.7);
    expect(dodgeChance(-5, 0.02, 0.7)).toBe(0);
  });
  it('block: 0.5% per DEF point + gear bonus, capped at 70%', () => {
    expect(blockChance(10, 0.3, 0.005, 0.7)).toBeCloseTo(0.35);
    expect(blockChance(90, 0.35, 0.005, 0.7)).toBe(0.7);
    expect(blockChance(0, 0, 0.005, 0.7)).toBe(0);
  });
  it('attack shaved off = (A − would-be final) / A (owner example: 56 → 34 = 39%)', () => {
    expect(attackShavedOff(56, 34)).toBeCloseTo(0.3929, 3);
    expect(attackShavedOff(10, 12)).toBe(0);
    expect(attackShavedOff(0, 0)).toBe(0);
  });
  it('counter chances: block = shaved (cap), dodge = delta% + weapon mod (cap)', () => {
    expect(blockCounterChance(0.39, 0.7)).toBeCloseTo(0.39);
    expect(blockCounterChance(0.9, 0.7)).toBe(0.7);
    expect(dodgeCounterChance(15, 0.1, 0.7)).toBeCloseTo(0.25);
    expect(dodgeCounterChance(80, 0.3, 0.7)).toBe(0.7);
  });
  it('stun gain = 10 + 10 × min(1, shaved + roll + boost): 10..20', () => {
    expect(stunGain(0.39, 0.35, 0.12, 10, 10)).toBeCloseTo(18.6);
    expect(stunGain(0.6, 0.5, 0.2, 10, 10)).toBe(20);
    expect(stunGain(0, 0, 0, 10, 10)).toBe(10);
  });
  it('heavy hit and stim heal', () => {
    expect(isHeavyHit(25, 100, 0.25)).toBe(true);
    expect(isHeavyHit(24.9, 100, 0.25)).toBe(false);
    expect(stimHealAmount(100, 0, 0.2, 0.05)).toBeCloseTo(20);
    expect(stimHealAmount(120, 2, 0.2, 0.05)).toBeCloseTo(36);
  });
});

describe('V3 catalogue', () => {
  it('= V2 (tuned pierce, same mods) + Warhammer 45 + the doc combat properties', () => {
    expect(ITEMS_V3.map((i) => i.id)).toEqual(ITEMS_V2.map((i) => i.id));
    for (const v3 of ITEMS_V3) {
      const v2 = ITEMS_V2.find((i) => i.id === v3.id)!;
      expect(v3.mods).toEqual(v2.mods);
      expect(v3.pierce).toEqual(v2.pierce);
      expect(v3.cost).toBe(v3.id === 'warhammer' ? 45 : v2.cost);
    }
    const c = (id: string) => ITEMS_V3.find((i) => i.id === id)!.combat;
    expect(c('great_shield')).toEqual({ blockBonus: 0.3 });
    expect(c('heavy_armour')).toEqual({ blockBonus: 0.05 });
    expect(c('mace')).toEqual({ stunBoost: 0.12, canStun: true });
    expect(c('flail')).toEqual({ canStun: true, dodgeCounter: 0.05 });
    expect(c('pike')).toEqual({ dodgeCounter: 0.3 });
    expect(c('wooden_club')).toEqual({ stunBoost: 0.04 });
    expect(c('bow')).toBeUndefined();
  });
});

describe('RuleSet v2 is untouched', () => {
  it('a v2 state carries no rules/v3 keys and v2 events no V3 fields', () => {
    const p = fighter('player', { hand1: 'sword' });
    const b = fighter('boss', { hand1: 'mace' });
    const s = startCombat(p, b, 5);
    expect('rules' in s).toBe(false);
    expect('v3' in s).toBe(false);
    const { events, notes } = runFullCombat(p, b, 5, choosers);
    expect(notes).toEqual([]);
    for (const e of events) {
      expect(e.kind).toBeUndefined();
      expect(e.defense).toBeUndefined();
      expect(e.damage).toBe(e.calc.finalDamage);
    }
  });
  it('dexBenefits ablations switch single DEX advantages off', () => {
    const p = fighter('player', { hand1: 'bow' }, { dex: 60 });
    const b = fighter('boss', { hand1: 'sword' });
    expect(startCombat(p, b, 3).initiative.bonusAttacks.player).toBe(2);
    expect(startCombat(p, b, 3, withRules(RULES_V2, { dexBenefits: { bonusAttacks: false } })).initiative.bonusAttacks.player).toBe(0);
    const noShot = startCombat(p, b, 3, withRules(RULES_V2, { dexBenefits: { firstShot: false } })).initiative;
    expect(noShot.openingOrder).toEqual([]);
    expect(noShot.openingRule).toBe('off');
    const { events } = runFullCombat(p, b, 3, choosers, { rules: withRules(RULES_V2, { dexBenefits: { mitigation: false } }) });
    for (const e of events) expect(e.calc.mitigation).toBe(0);
  });
});

describe('V3 attack sequence', () => {
  const big = { hp: 5000 };

  it('every attack is announced and answered; failed defence = the V2 hit lands', () => {
    const p = fighter('player', { hand1: 'sword' }, big);
    const b = fighter('boss', { hand1: 'sword' }, big);
    const { events } = runFullCombat(p, b, 9, choosers, { rules: NO_DEFENCE, defense: { player: always('block'), boss: always('dodge') } });
    const a = attacks(events);
    expect(a.length).toBeGreaterThan(10);
    for (const e of a) {
      expect(e.defense!.success).toBe(false);
      expect(e.defense!.action).toBe(e.defender === 'player' ? 'block' : 'dodge');
      expect(e.defense!.wouldBeDamage).toBeCloseTo(e.calc.finalDamage);
      expect(e.damage).toBeGreaterThanOrEqual(e.calc.finalDamage);
    }
  });

  it('pauses on the DEFENDER and resumes with the human answer', () => {
    const p = fighter('player', { hand1: 'sword' });
    const b = fighter('boss', { hand1: 'sword' }, { dex: 30 }); // boss faster → attacks first
    const wait: DefenseChooser = () => null;
    const r1 = advanceCombat(startCombat(p, b, 4, RULES_V3), choosers, { defense: { player: wait } });
    expect(r1.state.pending).toMatchObject({ side: 'player', kind: 'defense', options: ['block', 'dodge'] });
    expect(r1.state.pending!.incoming).toMatchObject({ attacker: 'boss', mode: 'melee', weaponId: 'sword', counterable: true });
    expect(r1.state.pending!.odds!.block.chance).toBeCloseTo(0.05); // raw DEF 10 × 0.5%
    expect(r1.events).toEqual([]);
    const r2 = advanceCombat(r1.state, choosers, { provided: { side: 'player', defense: 'dodge' }, defense: { player: wait } });
    expect(r2.events[0].defense).toMatchObject({ action: 'dodge', source: 'player' });
    expect(r2.state.pending?.kind).toBe('defense'); // waits again on the next boss attack (if the round goes on)
  });

  it('rejects a defence answer that does not match the pending decision', () => {
    const p = fighter('player', { hand1: 'sword' });
    const b = fighter('boss', { hand1: 'sword' }, { dex: 30 });
    const r1 = advanceCombat(startCombat(p, b, 4, RULES_V3), choosers, { defense: { player: () => null } });
    expect(() => advanceCombat(r1.state, choosers, { provided: { side: 'player', mode: 'melee' } })).toThrow(/Defence/);
  });

  it('ranged attacks can be blocked but never countered (the First Shot included)', () => {
    const p = fighter('player', { hand1: 'bow' }, big);
    const b = fighter('boss', { hand1: 'sword' }, big);
    // Only the boss defends successfully (the player dodges with 0% chance), so the round still ends.
    const { events } = runFullCombat(p, b, 2, choosers, { rules: ALWAYS_BLOCK, defense: { player: always('dodge'), boss: always('block') } });
    const shots = attacks(events).filter((e) => e.mode === 'ranged');
    expect(shots[0].phase).toBe('opening');
    for (const e of shots) {
      expect(e.defense!.success).toBe(true);
      expect(e.damage).toBe(0);
      expect(e.defense!.counter).toBeNull();
      expect(e.defense!.noCounterReason).toMatch(/ranged/);
    }
    expect(events.some((e) => e.kind === 'counter' && e.attacker === 'boss')).toBe(false);
  });

  it('block counter: a mini move inside the attacker sequence, ×1.5, +20 stun, undefendable', () => {
    // Weak attacker into a huge DEF: shaved ≈ 1 → counter chance = cap; cap raised to 1 to force it.
    const rules = withRules(RULES_V3, { v3: { block: { defFactor: 1, cap: 1 }, counter: { blockChanceCap: 1 } } });
    const p = fighter('player', {}, { str: 5, hp: 5000 }); // unarmed
    const b = fighter('boss', { hand1: 'sword' }, { def: 400, hp: 5000 });
    const { events } = runFullCombat(p, b, 8, choosers, { rules });
    const parent = attacks(events).find((e) => e.attacker === 'player' && e.defense!.counter?.success)!;
    expect(parent).toBeDefined();
    expect(parent.damage).toBe(0);
    const counter = events.find((e) => e.parentSeq === parent.seq)!;
    expect(counter).toMatchObject({ kind: 'counter', phase: 'counter', attacker: 'boss', defender: 'player', mode: 'melee', weaponId: 'sword', turn: parent.turn });
    expect(counter.seq).toBe(parent.seq + 1); // resolves before anything else
    expect(counter.defense).toBeUndefined(); // cannot be blocked or dodged
    expect(counter.damage).toBeCloseTo(counter.calc.finalDamage * 1.5);
    expect(counter.stun!.gains).toEqual([{ side: 'player', amount: 20, cause: 'block_counter' }]);
    // The boss's own regular attack in the same turn is still to come: the counter did not use its turn.
    expect(events.some((e) => e.kind === 'attack' && e.attacker === 'boss' && e.turn === parent.turn)).toBe(true);
  });

  it('dodge counter: needs a dodge-counter weapon, ×0.75, no stun', () => {
    const rules = withRules(RULES_V3, { v3: { dodge: { perDexPoint: 1, cap: 1 }, counter: { dodgeChanceCap: 1 } } });
    const p = fighter('player', { hand1: 'sword' }, { hp: 5000 });
    const spear = fighter('boss', { hand1: 'spear' }, { dex: 200, hp: 5000 });
    const sword = fighter('boss', { hand1: 'sword' }, { dex: 200, hp: 5000 });
    const dodge = { defense: { player: always('dodge'), boss: always('dodge') } };
    const withSpear = runFullCombat(p, spear, 6, choosers, { rules, ...dodge }).events;
    const c = withSpear.find((e) => e.kind === 'counter')!;
    expect(c.weaponId).toBe('spear');
    expect(c.damage).toBeCloseTo(c.calc.finalDamage * 0.75);
    expect(c.stun!.gains).toEqual([]);
    const withSword = runFullCombat(p, sword, 6, choosers, { rules, ...dodge }).events;
    expect(withSword.some((e) => e.kind === 'counter')).toBe(false);
    expect(attacks(withSword).find((e) => e.attacker === 'player')!.defense!.noCounterReason).toMatch(/dodge counter/);
  });

  it('stun: a can-stun weapon triggers at a full meter → extra damage, lost defence + lost turn, meter reset', () => {
    const rules = withRules(NO_DEFENCE, { v3: { stun: { threshold: 15 } } });
    const p = fighter('player', { hand1: 'mace' }, { hp: 5000, dex: 40 }); // faster: hits first
    const b = fighter('boss', { hand1: 'sword' }, { hp: 5000 });
    const { events, notes } = runFullCombat(p, b, 1, choosers, { rules });
    const first = attacks(events)[0];
    expect(first.attacker).toBe('player');
    expect(first.stun!.triggered).toMatchObject({ target: 'boss', weaponId: 'mace' });
    expect(first.stun!.triggered!.extraDamage).toBeCloseTo(0.25 * first.calc.finalDamage);
    expect(first.damage).toBeCloseTo(first.calc.finalDamage * 1.25);
    expect(first.stun!.meters.boss).toBe(0);
    expect(notes.find((n) => n.side === 'boss')).toMatchObject({ kind: 'skip' });
    // The boss's first defence after the stun is lost.
    const nextOnBoss = attacks(events).filter((e) => e.defender === 'boss')[1];
    expect(nextOnBoss.defense!.action).toBe('none');
  });

  it('a weapon that cannot stun fills the meter but never triggers', () => {
    const rules = withRules(NO_DEFENCE, { v3: { stun: { threshold: 15 } } });
    const p = fighter('player', { hand1: 'sword' }, { hp: 5000, dex: 40 });
    const b = fighter('boss', { hand1: 'sword' }, { hp: 5000 });
    const { events, notes } = runFullCombat(p, b, 1, choosers, { rules });
    for (const e of attacks(events)) {
      expect(e.stun!.triggered).toBeNull();
      expect(Math.max(e.stun!.meters.player, e.stun!.meters.boss)).toBeLessThanOrEqual(15);
    }
    expect(notes.filter((n) => n.kind === 'skip')).toEqual([]);
  });

  it('stims: heal 20% max HP before the fighter’s own action, capped at max HP, one use per stim', () => {
    const p = fighter('player', { hand1: 'sword' }, { hp: 200 }, { stims: 1, slots: 1, effectiveness: 0 });
    const b = fighter('boss', { hand1: 'greatsword' }, { str: 60, dex: 30, hp: 400 });
    const { notes, state } = runFullCombat(p, b, 3, choosers, { rules: NO_DEFENCE });
    const stim = notes.find((n) => n.kind === 'stim') as CombatNote;
    expect(stim.side).toBe('player');
    expect(stim.detail.heal).toBeCloseTo(40);
    expect(stim.detail.hpAfter).toBeLessThanOrEqual(200);
    expect(state.v3!.stims.player).toBe(0);
    expect(notes.filter((n) => n.kind === 'stim')).toHaveLength(1);
  });

  it('stim decision pauses for the human and resumes', () => {
    const p = fighter('player', { hand1: 'sword' }, { hp: 200 }, { stims: 1, slots: 1, effectiveness: 1 });
    const b = fighter('boss', { hand1: 'greatsword' }, { str: 60, dex: 30, hp: 400 });
    const r1 = advanceCombat(startCombat(p, b, 3, NO_DEFENCE), choosers, { stim: { player: () => null } });
    expect(r1.state.pending).toMatchObject({ side: 'player', kind: 'stim', options: ['use', 'skip'] });
    expect(r1.state.pending!.heal).toBeCloseTo(50); // 25% of 200
    const r2 = advanceCombat(r1.state, choosers, { provided: { side: 'player', stim: true }, stim: { player: () => null } });
    expect(r2.notes[0]).toMatchObject({ kind: 'stim', side: 'player', detail: { source: 'player' } });
  });

  it('six fixed draws per attack: the defence choice does not shift later rolls', () => {
    const p = fighter('player', { hand1: 'sword' }, { hp: 5000 });
    const b = fighter('boss', { hand1: 'sword' }, { hp: 5000 });
    const run = (d: 'block' | 'dodge') => attacks(runFullCombat(p, b, 77, choosers, { rules: RULES_V3, defense: { player: always(d), boss: always(d) } }).events).slice(0, 6).map((e) => e.calc.mitigationUniform);
    expect(run('block')).toEqual(run('dodge'));
  });

  it('is deterministic and serialisable mid-round', () => {
    const p = fighter('player', { hand1: 'mace', hand2: 'small_shield' });
    const b = fighter('boss', { hand1: 'spear', armour: 'light_armour' }, { dex: 20 });
    const a = runFullCombat(p, b, 31, choosers, { rules: RULES_V3 });
    const c = runFullCombat(p, b, 31, choosers, { rules: RULES_V3 });
    expect(c.events).toEqual(a.events);
    const paused = advanceCombat(startCombat(p, b, 31, RULES_V3), choosers, { defense: { player: () => null } }).state;
    expect(JSON.parse(JSON.stringify(paused))).toEqual(paused);
  });

  it('robustness: 1,500 random V3 fights terminate with a winner, under the attack guard', () => {
    const rng = new Rng(2026);
    const hands = [null, 'knife', 'sword', 'mace', 'warhammer', 'spear', 'pike', 'flail', 'bow', 'crossbow', 'wood_shield', 'great_shield'];
    const armours = [null, 'leather_armour', 'heavy_armour'];
    let longest = 0;
    for (let i = 0; i < 1500; i++) {
      const lo = (): Partial<Loadout> => {
        const h1 = rng.pick(hands);
        const h2 = rng.pick(hands);
        const cats = new Set([h1, h2].filter(Boolean).map((id) => ITEMS_V3.find((x) => x.id === id)!.category));
        const ok = h1 !== h2 && !(cats.size === 1 && h1 && h2) && !(cats.has('shield') && cats.size === 1 && h1 && h2);
        return { hand1: h1, hand2: ok ? h2 : null, armour: rng.pick(armours) };
      };
      const stats = () => ({ hp: 100 + rng.int(60), str: 20 + rng.int(30), def: 10 + rng.int(20), dex: 10 + rng.int(40) });
      const sup = { stims: rng.int(3), slots: 2, effectiveness: rng.int(3) };
      const { state, events } = runFullCombat(fighter('player', lo(), stats(), sup), fighter('boss', lo(), stats(), sup), i, choosers, { rules: RULES_V3 });
      expect(state.winner).not.toBeNull();
      longest = Math.max(longest, events.length);
    }
    expect(longest).toBeLessThan(MAX_ATTACKS_PER_ROUND / 10);
  });
});
