/**
 * Aggregates a round's combat events into per-side statistics.
 * Used by the boss's post-round analysis AND by ML feature construction, so both read the
 * same numbers. Pure function of the event list → can be recomputed from raw DB rows at any time.
 */
import type { CombatEvent, CombatNote } from './combat.js';
import type { Side } from './types.js';

type ModeCounts = { melee: number; ranged: number; unarmed: number };
/** `counter` appears only for V3 rounds (counter mini moves). */
type PhaseCounts = { opening: number; regular: number; dex_bonus: number; counter?: number };

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
  /** Attacks outside the forced opening phase (regular + DEX bonus) — the ones that reflect a style choice. */
  nonOpeningAttacks: number;
  nonOpeningRanged: number;
  /** V3 only (absent for v2 rounds): this side as DEFENDER, its counters, stun and stims. */
  v3?: SideV3Summary;
}

export interface SideV3Summary {
  /** Attacks aimed at this side and how it answered ('none' = stunned, could not defend). */
  defended: number;
  blocks: number;
  dodges: number;
  undefended: number;
  blockSuccesses: number;
  dodgeSuccesses: number;
  /** Counter mini moves this side made / suffered. */
  countersDealt: number;
  countersReceived: number;
  /** Stun meter points this side gained, and stuns triggered on it. */
  stunGained: number;
  stunsSuffered: number;
  stimsUsed: number;
  healed: number;
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
    nonOpeningAttacks: 0,
    nonOpeningRanged: 0,
  };
}

const emptyV3 = (): SideV3Summary => ({
  defended: 0, blocks: 0, dodges: 0, undefended: 0, blockSuccesses: 0, dodgeSuccesses: 0,
  countersDealt: 0, countersReceived: 0, stunGained: 0, stunsSuffered: 0, stimsUsed: 0, healed: 0,
});

/** `notes` (v3 stims, skips) are optional; a round is V3 when any event carries a defence/counter or a note exists. */
export function summarizeCombat(events: CombatEvent[], notes: CombatNote[] = []): CombatSummary {
  const out: Record<Side, SideCombatSummary> = { player: emptySide(), boss: emptySide() };
  const isV3 = notes.length > 0 || events.some((e) => e.defense || e.kind === 'counter');
  if (isV3) { out.player.v3 = emptyV3(); out.boss.v3 = emptyV3(); }
  for (const e of isV3 ? events : []) {
    const d = out[e.defender].v3!;
    if (e.kind === 'counter') { out[e.attacker].v3!.countersDealt++; d.countersReceived++; }
    else if (e.defense) {
      d.defended++;
      if (e.defense.action === 'block') { d.blocks++; if (e.defense.success) d.blockSuccesses++; }
      else if (e.defense.action === 'dodge') { d.dodges++; if (e.defense.success) d.dodgeSuccesses++; }
      else d.undefended++;
    }
    for (const g of e.stun?.gains ?? []) out[g.side].v3!.stunGained += g.amount;
    if (e.stun?.triggered) out[e.stun.triggered.target].v3!.stunsSuffered++;
  }
  for (const n of isV3 ? notes : []) {
    if (n.kind === 'stim') { out[n.side].v3!.stimsUsed++; out[n.side].v3!.healed += n.detail.heal ?? 0; }
  }
  const mitSum: Record<Side, number> = { player: 0, boss: 0 };
  let lastTurn = 0;
  for (const e of events) {
    const s = out[e.attacker];
    if (e.kind === 'counter') {
      // V3 counter mini move: real damage, but not a style choice (forced melee) — kept out of attack/mode/label counts.
      s.damageDealt += e.damage;
      s.damageByPhase.counter = (s.damageByPhase.counter ?? 0) + e.damage;
      const cw = e.weaponId ?? 'unarmed';
      s.damageByWeapon[cw] = (s.damageByWeapon[cw] ?? 0) + e.damage;
      lastTurn = Math.max(lastTurn, e.turn);
      continue;
    }
    const landed = !e.defense || !e.defense.success; // V3: a blocked/dodged attack still shows the style, but deals nothing
    s.attacks++;
    s.attacksByMode[e.mode]++;
    s.attacksByPhase[e.phase as 'opening' | 'regular' | 'dex_bonus']++;
    if (e.phase !== 'opening') {
      s.nonOpeningAttacks++;
      if (e.mode === 'ranged') s.nonOpeningRanged++;
    }
    s.damageDealt += e.damage;
    s.damageByMode[e.mode] += e.damage;
    s.damageByPhase[e.phase as 'opening' | 'regular' | 'dex_bonus'] += e.damage;
    const w = e.weaponId ?? 'unarmed';
    s.damageByWeapon[w] = (s.damageByWeapon[w] ?? 0) + e.damage;
    if (e.calc.pierce && landed) {
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
  return { player: out.player, boss: out.boss, totalAttacks: events.filter((e) => e.kind !== 'counter').length, lastTurn };
}
