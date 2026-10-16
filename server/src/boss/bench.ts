/**
 * Boss policy benchmark (no database):  npm run boss:bench -- [--seeds 200] [--runs 12]
 *
 *  1. Round-1 diversity (V2_DEMANDS AC-DIV-2): the round-1 decision for many run seeds → allocation and archetype
 *     distribution + Shannon entropy, for policy v1 (deterministic) and v2 (reachable scenarios + controlled diversity).
 *  2. Strength + speed (AC-DIV-3, AC-DIV-5): full in-memory runs of every agent and the mirror player vs each policy:
 *     boss win rate and milliseconds per boss decision.
 */
import { initialCombatant } from '../game/progression.js';
import { deriveSeed } from '../game/rng.js';
import { STRATEGY_NAMES } from '../sim/agents.js';
import { MIRROR, playInMemoryRun, summarizeRuns } from '../sim/balance.js';
import { choosePlan, type PolicyVersion } from './policy.js';

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : Number(def);
};
const SEEDS = arg('seeds', '200');
const RUNS = arg('runs', '12');

const entropy = (counts: number[]) => {
  const n = counts.reduce((a, b) => a + b, 0);
  return -counts.filter((c) => c > 0).reduce((s, c) => s + (c / n) * Math.log2(c / n), 0);
};

export function roundOneDistribution(version: PolicyVersion, seeds: number) {
  const alloc = new Map<string, number>();
  const arch = new Map<string, number>();
  for (let i = 0; i < seeds; i++) {
    const r = choosePlan({
      boss: initialCombatant('boss'), observedPlayer: initialCombatant('player'), pRanged: 0,
      seed: String(deriveSeed(`bench:${i}`, 'boss:1')), version,
    });
    const a = Object.entries(r.selected.allocation).filter(([, n]) => n).map(([k, n]) => `+${n} ${k.toUpperCase()}`).join(' ') || 'none';
    alloc.set(a, (alloc.get(a) ?? 0) + 1);
    arch.set(r.selected.archetype, (arch.get(r.selected.archetype) ?? 0) + 1);
  }
  return { alloc: [...alloc.entries()].sort((x, y) => y[1] - x[1]), arch: [...arch.entries()].sort((x, y) => y[1] - x[1]), allocEntropy: entropy([...alloc.values()]) };
}

function main() {
  for (const v of ['v1-deterministic', 'v2-diverse'] as PolicyVersion[]) {
    const d = roundOneDistribution(v, SEEDS);
    console.log(`\n[bench] ${v} — round-1 boss allocation over ${SEEDS} seeds (entropy ${d.allocEntropy.toFixed(2)} bits)`);
    for (const [k, n] of d.alloc) console.log(`  ${k.padEnd(14)} ${n} (${Math.round((n / SEEDS) * 100)}%)`);
    console.log(`  archetypes: ${d.arch.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
  for (const v of ['v1-deterministic', 'v2-diverse'] as PolicyVersion[]) {
    const t0 = Date.now();
    const res = [...STRATEGY_NAMES, MIRROR].flatMap((s) => Array.from({ length: RUNS }, (_, i) => playInMemoryRun(s, `bench:${s}:${i}`, 10, { policyVersion: v })));
    const ms = Date.now() - t0;
    const decisions = res.length * 10;
    console.log(`\n[bench] ${v} — ${res.length} runs, ${(ms / decisions).toFixed(1)} ms per round (boss decision dominates)`);
    for (const s of summarizeRuns(res)) console.log(`  ${s.strategy.padEnd(14)} boss wins ${Math.round(s.bossWinRate * 100)}%  (round 1: ${Math.round(s.roundOneBossWinRate * 100)}%)`);
    const archs = new Map<string, number>();
    for (const rd of res.flatMap((r) => r.rounds)) archs.set(rd.bossArchetype, (archs.get(rd.bossArchetype) ?? 0) + 1);
    console.log(`  boss archetypes over all rounds: ${[...archs.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }
}

if (process.argv[1]?.includes('bench')) main();
