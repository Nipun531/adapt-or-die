/**
 * V3 PHASE A — V2 CONTROL BASELINE (docs/V3_IMPLEMENTATION_PLAN.md §G Phase A, §H.4).
 *
 *   npm run v3:baseline   (CLI: sim/v3-baseline-cli.ts)
 *   npm run v3:baseline -- [--runs 100] [--rounds 10] [--seed v3-baseline] [--mirror-r1 2000] [--out artifacts/balance]
 *
 * Pure in-memory harness (sim/balance.ts playInMemoryRun): NO database reads or writes.
 * For every agent + the mirror player it measures the boss against engine 2.0.0 rules, per game stage, with
 * uncertainty: run-level bootstrap 95% CIs (rounds inside a run are correlated through progression) and Wilson CIs
 * for single proportions. A separate, larger round-1-only mirror batch tests the round-1 asymmetry (plan D-16).
 *
 * The JSON (seeds, git SHA, versions, results, sha256 of the results) is the control every V3 candidate is paired
 * against: same seed list → paired comparison.
 */
import { Rng, hashSeed } from '../game/rng.js';
import { requireItem } from '../game/catalog.js';
import { MIRROR, playInMemoryRun, type RunOptions, type RunResult } from './balance.js';

export const BOOT = 2000;

export const STAGES = [
  { name: 'r1-2', from: 1, to: 2 },
  { name: 'r3-5', from: 3, to: 5 },
  { name: 'r6-10', from: 6, to: 10 },
] as const;

// ---------- statistics ----------
export interface Interval { value: number; lo: number; hi: number; n: number }

/** Wilson score interval for a proportion (95%). */
export function wilson(successes: number, n: number, z = 1.96): Interval {
  if (n === 0) return { value: NaN, lo: NaN, hi: NaN, n };
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { value: p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), n };
}

/**
 * Run-level (cluster) bootstrap of a ratio statistic: each run contributes (numerator, denominator);
 * runs are resampled with replacement, the statistic is Σnum / Σden. Seeded → reproducible.
 */
export function clusterBootstrap(clusters: { num: number; den: number }[], seed: string, B = BOOT): Interval {
  const used = clusters.filter((c) => c.den > 0);
  const stat = (cs: { num: number; den: number }[]) => cs.reduce((a, c) => a + c.num, 0) / cs.reduce((a, c) => a + c.den, 0);
  if (!used.length) return { value: NaN, lo: NaN, hi: NaN, n: 0 };
  const rng = new Rng(hashSeed(seed));
  const xs: number[] = [];
  for (let b = 0; b < B; b++) {
    const sample = Array.from({ length: used.length }, () => used[rng.int(used.length)]);
    xs.push(stat(sample));
  }
  xs.sort((a, c) => a - c);
  return { value: stat(used), lo: xs[Math.floor(0.025 * B)], hi: xs[Math.floor(0.975 * B)], n: used.reduce((a, c) => a + c.den, 0) };
}

/** Shannon entropy (bits) of a categorical distribution. */
export function entropy(counts: Record<string, number>): number {
  const total = Object.values(counts).reduce((a, c) => a + c, 0);
  const h = -Object.values(counts).reduce((a, c) => (c ? a + (c / total) * Math.log2(c / total) : a), 0);
  return h === 0 ? 0 : h; // avoid -0
}

// ---------- metrics ----------
const loadoutKey = (l: { hand1: string | null; hand2: string | null; armour: string | null }) =>
  [l.hand1, l.hand2, l.armour].filter(Boolean).map((id) => requireItem(id!).name).sort().join(' + ') || 'unarmed';

export interface StageMetrics {
  bossWin: Interval;
  bossMargin: Interval;
  attacksPerRound: number;
  dexLeadBossMedian: number;
  bossTopBuild: { build: string; share: number };
  bossBuildEntropy: number;
  bossArchetypes: Record<string, number>;
  pierceDamageShare: number;
}

export interface AgentReport {
  strategy: string;
  runs: number;
  bossWin: Interval;
  roundOneBossWin: Interval;
  /** P(boss wins round n+1 | boss lost round n). */
  bossComeback: Interval;
  /** P(player wins round n+1 | player lost round n). */
  playerComeback: Interval;
  runWinnerFromRoundOne: Interval;
  stages: Record<string, StageMetrics>;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function reportFor(strategy: string, results: RunResult[], seed: string): AgentReport {
  const tag = (s: string) => `${seed}:${strategy}:${s}`;
  const winC = results.map((r) => ({ num: r.rounds.filter((x) => x.winner === 'boss').length, den: r.rounds.length }));
  const r1 = results.filter((r) => r.rounds.length).map((r) => r.rounds[0].winner === 'boss');
  const comeback = (side: 'boss' | 'player') => results.map((r) => {
    let num = 0, den = 0;
    for (let i = 0; i + 1 < r.rounds.length; i++) if (r.rounds[i].winner !== side) { den++; if (r.rounds[i + 1].winner === side) num++; }
    return { num, den };
  });
  // "Snowball": does the round-1 winner win the majority of the run?
  const snow = results.filter((r) => r.rounds.length).map((r) => {
    const bossRounds = r.rounds.filter((x) => x.winner === 'boss').length;
    const runWinner = bossRounds * 2 > r.rounds.length ? 'boss' : bossRounds * 2 < r.rounds.length ? 'player' : 'tie';
    return runWinner === r.rounds[0].winner;
  });
  const stages: Record<string, StageMetrics> = {};
  for (const st of STAGES) {
    const inStage = results.map((r) => r.rounds.filter((x) => x.roundNumber >= st.from && x.roundNumber <= st.to));
    const flat = inStage.flat();
    const builds: Record<string, number> = {};
    const arch: Record<string, number> = {};
    let pierce = 0, dmg = 0;
    const leads: number[] = [];
    for (const rd of flat) {
      builds[loadoutKey(rd.bossLoadout)] = (builds[loadoutKey(rd.bossLoadout)] ?? 0) + 1;
      arch[rd.bossArchetype] = (arch[rd.bossArchetype] ?? 0) + 1;
      for (const e of rd.events) {
        dmg += e.damage;
        if (e.calc.pierce?.success) pierce += (e.calc.pierce.extraDamage ?? 0) * (1 - e.calc.mitigation);
      }
      const e0 = rd.events.find((e) => e.attacker === 'boss') ?? rd.events[0];
      if (e0) leads.push(e0.attacker === 'boss' ? e0.calc.attackerDex - e0.calc.defenderDex : e0.calc.defenderDex - e0.calc.attackerDex);
    }
    const top = Object.entries(builds).sort((a, b) => b[1] - a[1])[0] ?? ['—', 0];
    stages[st.name] = {
      bossWin: clusterBootstrap(inStage.map((rs) => ({ num: rs.filter((x) => x.winner === 'boss').length, den: rs.length })), tag(`win:${st.name}`)),
      bossMargin: clusterBootstrap(inStage.map((rs) => ({ num: rs.reduce((a, x) => a + x.bossMargin, 0), den: rs.length })), tag(`margin:${st.name}`)),
      attacksPerRound: flat.length ? flat.reduce((a, x) => a + x.events.length, 0) / flat.length : NaN,
      dexLeadBossMedian: median(leads),
      bossTopBuild: { build: top[0], share: flat.length ? top[1] / flat.length : NaN },
      bossBuildEntropy: entropy(builds),
      bossArchetypes: arch,
      pierceDamageShare: dmg ? pierce / dmg : 0,
    };
  }
  return {
    strategy,
    runs: results.length,
    bossWin: clusterBootstrap(winC, tag('win')),
    roundOneBossWin: wilson(r1.filter(Boolean).length, r1.length),
    bossComeback: clusterBootstrap(comeback('boss'), tag('cb-boss')),
    playerComeback: clusterBootstrap(comeback('player'), tag('cb-player')),
    runWinnerFromRoundOne: wilson(snow.filter(Boolean).length, snow.length),
    stages,
  };
}

/**
 * Round-1 mirror check (plan D-16). Both sides use the boss policy and start identical, so a fair rule set gives 50%.
 * Also splits by who won the initiative coin flip and whether DEX tied, to locate any edge.
 */
export function mirrorRoundOne(n: number, seed: string, opts: RunOptions = {}) {
  let boss = 0, coinBoss = 0, coinBossWins = 0, coinPlayerWins = 0, tie = 0, faster = { boss: 0, player: 0 }, fasterWins = 0;
  for (let i = 0; i < n; i++) {
    const r = playInMemoryRun(MIRROR, `${seed}:mirror-r1:${i}`, 1, opts).rounds[0];
    const bossWon = r.winner === 'boss';
    if (bossWon) boss++;
    const e = r.events[0];
    const pDex = e.attacker === 'player' ? e.calc.attackerDex : e.calc.defenderDex;
    const bDex = e.attacker === 'boss' ? e.calc.attackerDex : e.calc.defenderDex;
    if (pDex === bDex) {
      tie++;
      const firstIsBoss = r.events[0].attacker === 'boss';
      if (firstIsBoss) { coinBoss++; if (bossWon) coinBossWins++; } else if (!bossWon) coinPlayerWins++;
    } else {
      const f = bDex > pDex ? 'boss' : 'player';
      faster[f]++;
      if ((f === 'boss') === bossWon) fasterWins++;
    }
  }
  return {
    n,
    bossWin: wilson(boss, n),
    dexTieRounds: tie,
    tieFirstMoverIsBoss: wilson(coinBoss, tie),
    tieFirstMoverWins: wilson(coinBossWins + coinPlayerWins, tie),
    fasterSide: faster,
    fasterSideWins: wilson(fasterWins, n - tie),
  };
}

