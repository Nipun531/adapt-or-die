/** V3 Phase C1: the boss policy and the in-memory run harness under RuleSet v3 (v2 stays the default). */
import { describe, expect, it } from 'vitest';
import { choosePlan } from '../../src/boss/policy.js';
import { initialCombatant } from '../../src/game/progression.js';
import { RULES_V3 } from '../../src/game/rules.js';
import { MIRROR, playInMemoryRun } from '../../src/sim/balance.js';

describe('runs under RuleSet v3', () => {
  it('a full in-memory run uses V3 combat for both sides (announced attacks, defences)', () => {
    const r = playInMemoryRun('shield_turtle', 'v3-run-test', 3, { rules: RULES_V3 });
    expect(r.rounds).toHaveLength(3);
    const attacks = r.rounds.flatMap((x) => x.events).filter((e) => e.kind === 'attack');
    expect(attacks.length).toBeGreaterThan(0);
    for (const e of attacks) expect(e.defense).toBeDefined();
    // The shield turtle always blocks; the boss answers with its expected-value policy.
    const turtle = attacks.filter((e) => e.defender === 'player' && e.defense!.action !== 'none');
    expect(turtle.every((e) => e.defense!.action === 'block')).toBe(true);
    expect(attacks.filter((e) => e.defender === 'boss').every((e) => e.defense!.source === 'boss_policy' || e.defense!.action === 'none')).toBe(true);
  });
  it('v2 is still the default (no V3 fields)', () => {
    const r = playInMemoryRun('shield_turtle', 'v3-run-test', 2);
    for (const e of r.rounds.flatMap((x) => x.events)) expect(e.defense).toBeUndefined();
  });
  it('the mirror player and the boss plan with the same rules; same seed → same run', () => {
    const a = playInMemoryRun(MIRROR, 'v3-mirror-test', 2, { rules: RULES_V3 });
    const b = playInMemoryRun(MIRROR, 'v3-mirror-test', 2, { rules: RULES_V3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('choosePlan verifies plans with the V3 engine when asked', () => {
    const boss = { ...initialCombatant('boss'), gold: 40 };
    const res = choosePlan({ boss, observedPlayer: initialCombatant('player'), pRanged: null, seed: 's', rules: RULES_V3 });
    expect(res.selected).toBeDefined();
    expect(res.selected.margin).toBeDefined();
  });
});
