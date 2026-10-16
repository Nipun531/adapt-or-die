/**
 * Boss POST-ROUND ANALYSIS.
 * Turns a finished round (snapshots + combat events) into structured, evidence-backed findings:
 * what the player used, where the boss's damage came from, DEX/initiative comparison, outcome,
 * and a list of weaknesses — each with the metric values that triggered it.
 * Thresholds are heuristics (not game rules) and are listed in WEAKNESS_THRESHOLDS for easy tuning.
 */
import { getItem } from '../game/catalog.js';
import type { CombatEvent } from '../game/combat.js';
import { summarizeCombat, type CombatSummary } from '../game/summary.js';
import type { FighterSnapshot, Side } from '../game/types.js';

export const WEAKNESS_THRESHOLDS = {
  rangedDamageShare: 0.5,      // ≥50% of damage taken came from ranged attacks
  meleeDamageShare: 0.5,
  heavyWeaponStrMod: 8,         // Iron Club / Greatsword class
  defensePenetration: 0.6,      // avg (net damage / attack value) the player achieved
  damagePerAttackRatio: 0.85,   // boss dmg/attack below 85% of player's
  narrowMarginHp: 0.2,          // lost with player at ≤20% HP
};

export type WeaknessCode =
  | 'ranged_pressure' | 'pierce_exposure' | 'heavy_melee_pressure' | 'dex_deficit'
  | 'low_defense' | 'low_damage_output' | 'outmatched' | 'narrow_loss';

export interface Weakness {
  code: WeaknessCode;
  severity: number; // 0..1, larger = more urgent
  evidence: string;
  metrics: Record<string, number>;
}

export interface BossAnalysis {
  roundNumber: number;
  outcome: 'boss_won' | 'boss_lost';
  hp: { playerEnd: number; playerMax: number; bossEnd: number; bossMax: number };
  playerProfile: {
    loadout: string[];
    stats: FighterSnapshot['stats'];
    netAtk: number; netDef: number; effDex: number;
    attacksByMode: Record<string, number>;
    rangedShare: number | null;
    heavyMelee: boolean;
  };
  damageTaken: { total: number; byMode: Record<string, number>; byPhase: Record<string, number>; byWeapon: Record<string, number>; pierces: number; defIgnoredTotal: number };
  damageDealt: { total: number; perAttack: number; byMode: Record<string, number> };
  initiative: { bossEffDex: number; playerEffDex: number; actedFirst: Side; playerBonusPerTurn: number; bossBonusPerTurn: number; avgMitigationBossApplied: number; avgMitigationPlayerApplied: number };
  weaknesses: Weakness[];
  conclusions: string[];
  summary: CombatSummary;
}

const names = (s: FighterSnapshot) =>
  [s.loadout.hand1, s.loadout.hand2, s.loadout.armour].filter(Boolean).map((id) => getItem(id!)!.name);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function analyzeRound(input: {
  roundNumber: number;
  winner: Side;
  player: FighterSnapshot;
  boss: FighterSnapshot;
  events: CombatEvent[];
  playerHpEnd: number;
  bossHpEnd: number;
  initiative: { turnOrder: [Side, Side]; bonusAttacks: Record<Side, number> };
}): BossAnalysis {
  const { player, boss, events } = input;
  const summary = summarizeCombat(events);
  const ps = summary.player;
  const bs = summary.boss;
  const taken = ps.damageDealt;
  const heavyWeapon = player.derived.meleeWeaponId ? getItem(player.derived.meleeWeaponId)!.mods.str >= WEAKNESS_THRESHOLDS.heavyWeaponStrMod : false;
  const weaknesses: Weakness[] = [];
  const lost = input.winner === 'player';

  const rangedShare = taken > 0 ? ps.damageByMode.ranged / taken : 0;
  if (rangedShare >= WEAKNESS_THRESHOLDS.rangedDamageShare) {
    weaknesses.push({
      code: 'ranged_pressure', severity: rangedShare,
      evidence: `${Math.round(rangedShare * 100)}% of damage taken (${r2(ps.damageByMode.ranged)} of ${r2(taken)}) came from ranged attacks, incl. ${r2(ps.damageByPhase.opening)} from the opening shot.`,
      metrics: { rangedShare: r2(rangedShare), rangedDamage: r2(ps.damageByMode.ranged), openingDamage: r2(ps.damageByPhase.opening) },
    });
  }
  if (ps.pierces > 0) {
    weaknesses.push({
      code: 'pierce_exposure', severity: Math.min(1, ps.pierces / Math.max(1, ps.pierceAttempts)),
      evidence: `Player pierced ${ps.pierces}/${ps.pierceAttempts} ranged attacks, ignoring ${r2(ps.defIgnoredTotal)} total DEF.`,
      metrics: { pierces: ps.pierces, attempts: ps.pierceAttempts, defIgnored: r2(ps.defIgnoredTotal) },
    });
  }
  const meleeShare = taken > 0 ? (ps.damageByMode.melee + ps.damageByMode.unarmed) / taken : 0;
  if (heavyWeapon && meleeShare >= WEAKNESS_THRESHOLDS.meleeDamageShare) {
    weaknesses.push({
      code: 'heavy_melee_pressure', severity: meleeShare,
      evidence: `${Math.round(meleeShare * 100)}% of damage came from heavy melee (${getItem(player.derived.meleeWeaponId!)!.name}, Net ATK ${r2(player.derived.netAtk)}).`,
      metrics: { meleeShare: r2(meleeShare), playerNetAtk: r2(player.derived.netAtk) },
    });
  }
  const dexGap = player.derived.effDex - boss.derived.effDex;
  if (dexGap > 0) {
    weaknesses.push({
      code: 'dex_deficit', severity: Math.min(1, dexGap / 30 + input.initiative.bonusAttacks.player * 0.3),
      evidence: `Player effective DEX ${r2(player.derived.effDex)} vs boss ${r2(boss.derived.effDex)}: player acted first, gained ${input.initiative.bonusAttacks.player} bonus attack(s)/turn and mitigated boss hits by avg ${Math.round(bs.avgMitigationSuffered * 100)}%.`,
      metrics: { dexGap: r2(dexGap), playerBonusPerTurn: input.initiative.bonusAttacks.player, mitigationOnBossHits: r2(bs.avgMitigationSuffered) },
    });
  }
  const penetration = events.filter((e) => e.attacker === 'player').map((e) => e.calc.netDamage / e.calc.attackValue);
  const avgPen = penetration.length ? penetration.reduce((a, b) => a + b, 0) / penetration.length : 0;
  if (avgPen >= WEAKNESS_THRESHOLDS.defensePenetration) {
    weaknesses.push({
      code: 'low_defense', severity: avgPen,
      evidence: `Boss Net DEF ${r2(boss.derived.netDef)} let player hits keep ${Math.round(avgPen * 100)}% of their attack value before mitigation.`,
      metrics: { bossNetDef: r2(boss.derived.netDef), avgPenetration: r2(avgPen) },
    });
  }
  const pPer = ps.attacks ? ps.damageDealt / ps.attacks : 0;
  const bPer = bs.attacks ? bs.damageDealt / bs.attacks : 0;
  if (pPer > 0 && bPer < pPer * WEAKNESS_THRESHOLDS.damagePerAttackRatio) {
    weaknesses.push({
      code: 'low_damage_output', severity: Math.min(1, 1 - bPer / pPer),
      evidence: `Boss dealt ${r2(bPer)} damage/attack vs player's ${r2(pPer)}.`,
      metrics: { bossPerAttack: r2(bPer), playerPerAttack: r2(pPer) },
    });
  }
  if (lost) {
    const hpFrac = Math.max(0, input.playerHpEnd) / player.derived.maxHp;
    if (hpFrac <= WEAKNESS_THRESHOLDS.narrowMarginHp) {
      weaknesses.push({ code: 'narrow_loss', severity: 0.3, evidence: `Lost narrowly: player ended at ${Math.round(hpFrac * 100)}% HP.`, metrics: { playerHpFrac: r2(hpFrac) } });
    } else {
      weaknesses.push({ code: 'outmatched', severity: hpFrac, evidence: `Lost clearly: player ended at ${Math.round(hpFrac * 100)}% HP.`, metrics: { playerHpFrac: r2(hpFrac) } });
    }
  }
  weaknesses.sort((a, b) => b.severity - a.severity);

  const conclusions = weaknesses.length
    ? weaknesses.map((w) => `${w.code.replace(/_/g, ' ')}: ${w.evidence}`)
    : ['No clear weakness exposed this round.'];

  return {
    roundNumber: input.roundNumber,
    outcome: lost ? 'boss_lost' : 'boss_won',
    hp: { playerEnd: r2(input.playerHpEnd), playerMax: player.derived.maxHp, bossEnd: r2(input.bossHpEnd), bossMax: boss.derived.maxHp },
    playerProfile: {
      loadout: names(player), stats: player.stats,
      netAtk: r2(player.derived.netAtk), netDef: r2(player.derived.netDef), effDex: r2(player.derived.effDex),
      attacksByMode: ps.attacksByMode, rangedShare: ps.rangedShare, heavyMelee: heavyWeapon,
    },
    damageTaken: { total: r2(taken), byMode: ps.damageByMode, byPhase: ps.damageByPhase, byWeapon: ps.damageByWeapon, pierces: ps.pierces, defIgnoredTotal: r2(ps.defIgnoredTotal) },
    damageDealt: { total: r2(bs.damageDealt), perAttack: r2(bPer), byMode: bs.damageByMode },
    initiative: {
      bossEffDex: r2(boss.derived.effDex), playerEffDex: r2(player.derived.effDex), actedFirst: input.initiative.turnOrder[0],
      playerBonusPerTurn: input.initiative.bonusAttacks.player, bossBonusPerTurn: input.initiative.bonusAttacks.boss,
      avgMitigationBossApplied: r2(ps.avgMitigationSuffered), avgMitigationPlayerApplied: r2(bs.avgMitigationSuffered),
    },
    weaknesses,
    conclusions,
    summary,
  };
}
