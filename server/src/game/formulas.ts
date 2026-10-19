/**
 * Combat & progression FORMULAS — one small, named function per rule in the game plan.
 * These are pure functions with no randomness: random rolls are passed in, so every value
 * can be unit-tested and every combat-log entry can be recomputed by hand.
 *
 * Plan §3 (verbatim intent):
 *   Net ATK  = ATK + 0.25 × (ATK × weapon modifiers)
 *   Net DEF  = DEF + 0.5  × (DEF × item modifiers)
 *   Net DEX  = DEX + 0.25 × (DEX × modifiers)                (§5, ranged)
 *   Net damage (before DEX mitigation) = ATK × (ATK / (ATK + DEF))
 *   DEX ratio = defender DEX / attacker DEX
 *   DEX mitigation = roll[0.20..0.50] × (1 − 1 / DEX ratio), clamped to 0 when the defender has no DEX advantage
 *   Final damage = net damage × (1 − DEX mitigation)
 */
import {
  ATK_MOD_FACTOR,
  DEF_MOD_FACTOR,
  DEX_BONUS_THRESHOLDS,
  DEX_MOD_FACTOR,
  EFFECTIVE_DEX_FLOOR,
  MITIGATION_ROLL_MAX,
  MITIGATION_ROLL_MIN,
  XP_BASE,
  XP_MULTIPLIER,
} from './constants.js';

/** Net ATK = ATK + 0.25 × (ATK × summed STR modifiers of equipped gear). */
export function netAtk(str: number, strModSum: number): number {
  return str + ATK_MOD_FACTOR * (str * strModSum);
}

/** Net DEF = DEF + 0.5 × (DEF × summed DEF modifiers of equipped gear). */
export function netDef(def: number, defModSum: number): number {
  return def + DEF_MOD_FACTOR * (def * defModSum);
}

/** Net DEX = DEX + 0.25 × (DEX × summed DEX modifiers of equipped gear). Not floored. */
export function netDex(dex: number, dexModSum: number): number {
  return dex + DEX_MOD_FACTOR * (dex * dexModSum);
}

/** Effective DEX = Net DEX floored at 1 (developer decision; avoids zero/negative DEX ratio). */
export function effectiveDex(netDexValue: number): number {
  return Math.max(EFFECTIVE_DEX_FLOOR, netDexValue);
}

/** DEF actually used in the damage formula after piercing (ignoreFraction = 0 when not pierced). */
export function defAfterPierce(defenderNetDef: number, ignoreFraction: number): number {
  return defenderNetDef * (1 - ignoreFraction);
}

/** Net damage before DEX mitigation = ATK × (ATK / (ATK + DEF)). */
export function netDamage(atk: number, def: number): number {
  const denom = atk + def;
  if (denom <= 0) return 0;
  return atk * (atk / denom);
}

/** DEX ratio = defender DEX / attacker DEX (effective DEX values, both >= 1). */
export function dexRatio(defenderDex: number, attackerDex: number): number {
  return defenderDex / attackerDex;
}

/** Map a uniform [0,1) draw onto the plan's mitigation roll range [0.20, 0.50). */
export function mitigationRollFromUniform(u: number): number {
  return MITIGATION_ROLL_MIN + (MITIGATION_ROLL_MAX - MITIGATION_ROLL_MIN) * u;
}

/** Unclamped DEX mitigation = roll × (1 − 1 / ratio). Negative when the defender is slower. */
export function rawDexMitigation(ratio: number, roll: number): number {
  return roll * (1 - 1 / ratio);
}

/** DEX mitigation clamped to 0 when the defender has no DEX advantage (negative values discarded). */
export function dexMitigation(ratio: number, roll: number): number {
  return Math.max(0, rawDexMitigation(ratio, roll));
}

/** Final damage = net damage × (1 − DEX mitigation). */
export function finalDamage(net: number, mitigation: number): number {
  return net * (1 - mitigation);
}

/**
 * Plan §4: DEX advantage of 15 → +1 attack, 30 or more → +2 attacks (per turn — developer decision).
 * "Advantage" = attacker effective DEX − defender effective DEX; 15 is treated as inclusive.
 */
export function dexBonusAttacks(attackerDex: number, defenderDex: number): number {
  const advantage = attackerDex - defenderDex;
  for (const t of DEX_BONUS_THRESHOLDS) {
    if (advantage >= t.advantage) return t.attacks;
  }
  return 0;
}

/**
 * Plan §2: XP needed to go from `level` to `level + 1`.
 * Requirement to reach level L = 100 × 1.12^(L − 2) → from level n: 100 × 1.12^(n − 1).
 * Rounded to the nearest integer (developer decision) → 100, 112, 125, 140, 157, ...
 */
export function xpToNextLevel(level: number): number {
  return Math.round(XP_BASE * Math.pow(XP_MULTIPLIER, level - 1));
}

// ---------------------------------------------------------------------------------------------------------------
// V3 combat formulas (docs/V3_DEMANDS.md). Probabilities are 0..1. Numbers come from RuleSet v3 (rules.ts).
// ---------------------------------------------------------------------------------------------------------------

/** Dodge delta = defender effective DEX − attacker effective DEX, floored at 0 (the DEX the First Shot compares). */
export function dodgeDelta(defenderDex: number, attackerDex: number): number {
  return Math.max(0, defenderDex - attackerDex);
}

/** Dodge chance = min(cap, perDexPoint × dodge delta). Owner: 2% per DEX point, cap 70%. */
export function dodgeChance(delta: number, perDexPoint: number, cap: number): number {
  return Math.min(cap, perDexPoint * Math.max(0, delta));
}

/** Block chance = min(cap, defFactor × DEF + Σ gear block bonus), never below 0. Owner: 0.5 × DEF (as %), cap 70%. */
export function blockChance(def: number, gearBonus: number, defFactor: number, cap: number): number {
  return Math.min(cap, Math.max(0, defFactor * def + gearBonus));
}

/**
 * Attack shaved off = share of the attack value that DEF and DEX would remove if the attack hit:
 * (A − would-be final damage) / A, in 0..1 (owner Q-1). Used for block-counter chance and stun gain.
 */
export function attackShavedOff(attackValue: number, wouldBeFinal: number): number {
  if (attackValue <= 0) return 0;
  return Math.min(1, Math.max(0, (attackValue - wouldBeFinal) / attackValue));
}

/** Block-counter chance = min(cap, attack shaved off). */
export function blockCounterChance(shaved: number, cap: number): number {
  return Math.min(cap, Math.max(0, shaved));
}

/** Dodge-counter chance = min(cap, dodge delta % + weapon dodge-counter modifier). Delta 15 + Spear 10% → 25%. */
export function dodgeCounterChance(delta: number, weaponMod: number, cap: number): number {
  return Math.min(cap, Math.max(0, delta / 100 + weaponMod));
}

/** Stun gain of one hit = base + span × min(1, shaved + mitigation roll + weapon stun boost) — 10..20 (owner Q-2). */
export function stunGain(shaved: number, mitigationRoll: number, stunBoost: number, base: number, span: number): number {
  return base + span * Math.min(1, Math.max(0, shaved + mitigationRoll + stunBoost));
}

/** A blocked hit is "very heavy" when its would-be damage reaches `fraction` of the blocker's max HP. */
export function isHeavyHit(wouldBeFinal: number, blockerMaxHp: number, fraction: number): boolean {
  return wouldBeFinal >= fraction * blockerMaxHp;
}

/** Stim heal amount = (base + perUpgrade × effectiveness upgrades) × max HP. */
export function stimHealAmount(maxHp: number, effectivenessUpgrades: number, base: number, perUpgrade: number): number {
  return (base + perUpgrade * effectivenessUpgrades) * maxHp;
}
