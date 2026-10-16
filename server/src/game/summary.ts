/**
 * Aggregates a round's combat events into per-side statistics.
 * Used by the boss's post-round analysis AND by ML feature construction, so both read the
 * same numbers. Pure function of the event list → can be recomputed from raw DB rows at any time.
 */
import type { CombatEvent } from './combat.js';
import type { Side } from './types.js';

type ModeCounts = { melee: number; ranged: number; unarmed: number };
type PhaseCounts = { opening: number; regular: number; dex_bonus: number };

export interface SideCombatSummary {
  attacks: number;
  attacksByMode: ModeCounts;
  attacksByPhase: PhaseCounts;
  damageDealt: number;
  damageByMode: ModeCounts;
  damageByPhase: PhaseCounts;
  damageByWeapon: Record<string, number>;
  pierceAttempts: number;
  pierces: number;
  /** Sum of DEF points removed by successful pierces on this side's attacks. */
  defIgnoredTotal: number;
  /** Net damage (before mitigation) added by successful pierces — the pierce's own contribution. */
  pierceExtraDamage: number;
  /** Mean DEX mitigation applied by the OPPONENT to this side's attacks. */
  avgMitigationSuffered: number;
  /** Share of this side's attacks that were ranged (null if it made no attacks). */
  rangedShare: number | null;
}

export interface CombatSummary {
  player: SideCombatSummary;
  boss: SideCombatSummary;
  totalAttacks: number;
  lastTurn: number;
}

function emptySide(): SideCombatSummary {
  return {
    attacks: 0,
    attacksByMode: { melee: 0, ranged: 0, unarmed: 0 },
    attacksByPhase: { opening: 0, regular: 0, dex_bonus: 0 },
    damageDealt: 0,
    damageByMode: { melee: 0, ranged: 0, unarmed: 0 },
    damageByPhase: { opening: 0, regular: 0, dex_bonus: 0 },
    damageByWeapon: {},
    pierceAttempts: 0,
    pierces: 0,
    defIgnoredTotal: 0,
    pierceExtraDamage: 0,
    avgMitigationSuffered: 0,
    rangedShare: null,
  };
}

export function summarizeCombat(events: CombatEvent[]): CombatSummary {
  const out: Record<Side, SideCombatSummary> = { player: emptySide(), boss: emptySide() };
  const mitSum: Record<Side, number> = { player: 0, boss: 0 };
  let lastTurn = 0;
  for (const e of events) {
    const s = out[e.attacker];
    s.attacks++;
    s.attacksByMode[e.mode]++;
    s.attacksByPhase[e.phase]++;
    s.damageDealt += e.damage;
    s.damageByMode[e.mode] += e.damage;
    s.damageByPhase[e.phase] += e.damage;
    const w = e.weaponId ?? 'unarmed';
    s.damageByWeapon[w] = (s.damageByWeapon[w] ?? 0) + e.damage;
    if (e.calc.pierce) {
      s.pierceAttempts++;
      if (e.calc.pierce.success) {
        s.pierces++;
        s.defIgnoredTotal += e.calc.defenderNetDef - e.calc.defUsed;
        s.pierceExtraDamage += e.calc.pierce.extraDamage
          ?? e.calc.netDamage - e.calc.attackValue * (e.calc.attackValue / (e.calc.attackValue + e.calc.defenderNetDef));
      }
    }
    mitSum[e.attacker] += e.calc.mitigation;
    lastTurn = Math.max(lastTurn, e.turn);
  }
  for (const side of ['player', 'boss'] as Side[]) {
    const s = out[side];
    s.avgMitigationSuffered = s.attacks ? mitSum[side] / s.attacks : 0;
    s.rangedShare = s.attacks ? s.attacksByMode.ranged / s.attacks : null;
  }
  return { player: out.player, boss: out.boss, totalAttacks: events.length, lastTurn };
}
