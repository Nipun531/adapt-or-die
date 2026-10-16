/**
 * Expected-value ESTIMATES built on the real formulas (no randomness).
 * Not game rules — used by the boss policy, boss in-fight mode choice and simulation agents
 * to compare options transparently. Expected mitigation uses the mean roll (0.35).
 */
import { requireItem } from './catalog.js';
import { MITIGATION_ROLL_MAX, MITIGATION_ROLL_MIN } from './constants.js';
import { defAfterPierce, dexMitigation, dexRatio, netDamage } from './formulas.js';
import type { AttackMode, FighterSnapshot } from './types.js';

const MEAN_ROLL = (MITIGATION_ROLL_MIN + MITIGATION_ROLL_MAX) / 2;

/** Expected final damage of one attack in `mode` (pierce chance and mean mitigation roll folded in). */
export function expectedAttackDamage(att: FighterSnapshot, def: FighterSnapshot, mode: AttackMode): number {
  const ranged = mode === 'ranged';
  const atk = ranged ? att.derived.effDex : att.derived.netAtk;
  const d = def.derived.netDef;
  let net: number;
  if (ranged && att.derived.rangedWeaponId) {
    const p = requireItem(att.derived.rangedWeaponId).pierce ?? { chance: 0, defIgnore: 0 };
    net = p.chance * netDamage(atk, defAfterPierce(d, p.defIgnore)) + (1 - p.chance) * netDamage(atk, d);
  } else {
    net = netDamage(atk, d);
  }
  const mit = dexMitigation(dexRatio(def.derived.effDex, att.derived.effDex), MEAN_ROLL);
  return net * (1 - mit);
}

/** Highest expected-damage mode among the attacker's available modes (deterministic tie → first option). */
export function bestMode(att: FighterSnapshot, def: FighterSnapshot, options = att.derived.attackModes): { mode: AttackMode; expected: Record<string, number> } {
  const expected: Record<string, number> = {};
  let best = options[0];
  for (const m of options) {
    expected[m] = expectedAttackDamage(att, def, m);
    if (expected[m] > expected[best]) best = m;
  }
  return { mode: best, expected };
}
