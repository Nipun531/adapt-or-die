/**
 * Expected-value ESTIMATES built on the real formulas (no randomness).
 * Not game rules — used by the boss policy, boss in-fight mode choice and simulation agents
 * to compare options transparently. Expected mitigation uses the mean roll (0.35).
 */
import { requireItem } from './catalog.js';
import { MITIGATION_ROLL_MAX, MITIGATION_ROLL_MIN } from './constants.js';
import { defAfterPierce, dexMitigation, dexRatio, netDamage } from './formulas.js';
import type { ChoiceSource, DefenseChooser } from './combat.js';
import type { RuleSet } from './rules.js';
import type { AttackMode, FighterSnapshot } from './types.js';

const MEAN_ROLL = (MITIGATION_ROLL_MIN + MITIGATION_ROLL_MAX) / 2;

/** Expected final damage of one attack in `mode` (pierce chance of the weapon used and mean mitigation roll folded in). */
export function expectedAttackDamage(att: FighterSnapshot, def: FighterSnapshot, mode: AttackMode): number {
  const ranged = mode === 'ranged';
  const atk = ranged ? att.derived.effDex : att.derived.netAtk;
  const d = def.derived.netDef;
  const weaponId = ranged ? att.derived.rangedWeaponId : mode === 'melee' ? att.derived.meleeWeaponId : null;
  const p = weaponId ? requireItem(weaponId).pierce : undefined;
  const net = p
    ? p.chance * netDamage(atk, defAfterPierce(d, p.defIgnore)) + (1 - p.chance) * netDamage(atk, d)
    : netDamage(atk, d);
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

/**
 * V3 "smart" defence (expected value, public odds only): value of a successful defence = the hit avoided plus half the
 * counter's expected worth; a blocked very heavy hit still costs stun. Used by the boss and by simulated players.
 * Not a game rule.
 */
export function smartDefense(rules: RuleSet, source: ChoiceSource = 'agent'): DefenseChooser {
  return ({ odds }) => {
    const c = rules.v3!.counter;
    const blockV = odds.block.chance * (1 + (odds.block.counterPossible ? Math.min(c.blockChanceCap, odds.expectedShaved) * c.blockMultiplier * 0.5 : 0) - (odds.block.heavy ? 0.15 : 0));
    const dodgeV = odds.dodge.chance * (1 + odds.dodge.counterChance * c.dodgeMultiplier * 0.5);
    return dodgeV > blockV
      ? { action: 'dodge', source, reason: `dodge value ${dodgeV.toFixed(2)} > block ${blockV.toFixed(2)}` }
      : { action: 'block', source, reason: `block value ${blockV.toFixed(2)} ≥ dodge ${dodgeV.toFixed(2)}` };
  };
}
