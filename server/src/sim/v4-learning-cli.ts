/**
 * V4 LEARNING BOSS CAMPAIGN EVALUATION — synthetic fixtures (simulated agents), harness only, explicitly NOT human data.
 *
 *   npm run ml:v4-learning -- [--campaign 4] [--rounds 10] [--seed v4-learn] [--base v3|v4]
 *
 * For every agent family: a campaign of `campaign` consecutive runs against ONE Learning Boss profile (observations
 * carry over between runs, exactly like profile_observations), on paired seeds against:
 *   cold      the same boss that never learns (uniform forecast every round) — the no-learning control
 *   learning  the profile forecaster (boss/forecast.ts profileHeads) fed only with this campaign's observations
 *   prepared  the Prepared Boss's planner (V3 reachable scenarios + P(ranged) baseline), for reference
 * Reported: paired Δ margin learning − cold (overall, per agent, per campaign run → does it improve with experience?)
 * and the profile forecast's joint log loss among legal candidates per campaign run (does the prediction improve?).
 */
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.js';
import { legalCandidates } from '../boss/candidates.js';
import { jointLogLoss, profileHeads, uniformHeads, type ProfileEvidence } from '../boss/forecast.js';
import { LIVE_RULES } from '../game/rules.js';
import { STRATEGY_NAMES } from './agents.js';
import { baselinePredict, playInMemoryRunWith, type InMemoryPredictor, type RunOptions, type RunResult } from './balance.js';
import { meanCiOf } from './stats.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean) as [string, string][]);
const CAMPAIGN = Number(args.campaign ?? 4);
const ROUNDS = Number(args.rounds ?? 10);
const SEED = args.seed ?? 'v4-learn';
const BASE = (args.base ?? 'v3') as 'v3' | 'v4';
const AGENTS = args.only ? args.only.split(',') : STRATEGY_NAMES;

const runEvidence = (r: RunResult): ProfileEvidence[] => r.rounds.map((rd, i) => ({ heads: rd.truthHeads, previousWinner: i ? r.rounds[i - 1].winner : null }));

function learningPredictor(campaign: ProfileEvidence[]): InMemoryPredictor {
  return async (q) => {
    const thisRun: ProfileEvidence[] = q.historyHeads.map((h, i) => ({ heads: h, previousWinner: i ? q.records[i - 1].winner : null }));
    return {
      heads: profileHeads([...campaign, ...thisRun], {
        previousWinner: q.records.length ? q.records[q.records.length - 1].winner : null,
        lastHeads: q.historyHeads[q.historyHeads.length - 1] ?? null,
      }),
    };
  };
}

async function main() {
  const opts: RunOptions = { rules: LIVE_RULES, scenarioBase: BASE };
  const margin = (r: RunResult) => r.rounds.reduce((a, x) => a + x.bossMargin, 0) / r.rounds.length;
  const out: any = { synthetic: true, campaign: CAMPAIGN, rounds: ROUNDS, seed: SEED, base: BASE, agents: {} };
  const diffs: number[] = [];
  const diffByRun: number[][] = Array.from({ length: CAMPAIGN }, () => []);
  const llByRun: Record<'learning' | 'cold', number[][]> = { learning: Array.from({ length: CAMPAIGN }, () => []), cold: Array.from({ length: CAMPAIGN }, () => []) };
  const prepVsCold: number[] = [];
  for (const a of AGENTS) {
    const ev: ProfileEvidence[] = [];
    const rows: any[] = [];
    for (let k = 0; k < CAMPAIGN; k++) {
      const seed = `${SEED}:${a}:c${k}`;
      const learned = await playInMemoryRunWith(a, seed, learningPredictor([...ev]), ROUNDS, opts);
      const cold = await playInMemoryRunWith(a, seed, async () => ({ heads: uniformHeads() }), ROUNDS, opts);
      const prepared = await playInMemoryRunWith(a, seed, async (q) => baselinePredict(q), ROUNDS, { rules: LIVE_RULES });
      // Prediction quality of the profile forecast vs a cold (uniform) one, on the learning games.
      learned.rounds.forEach((rd, i) => {
        const cands = legalCandidates(rd.observed);
        const thisRun = learned.rounds.slice(0, i).map((x, j) => ({ heads: x.truthHeads, previousWinner: j ? learned.rounds[j - 1].winner : null }));
        const f = profileHeads([...ev, ...thisRun], { previousWinner: i ? learned.rounds[i - 1].winner : null, lastHeads: i ? learned.rounds[i - 1].truthHeads : null });
        const ll = jointLogLoss(cands, f, rd.truthHeads);
        const lu = jointLogLoss(cands, uniformHeads(), rd.truthHeads);
        if (ll !== null && lu !== null) { llByRun.learning[k].push(ll); llByRun.cold[k].push(lu); }
      });
      const d = margin(learned) - margin(cold);
      diffs.push(d);
      diffByRun[k].push(d);
      prepVsCold.push(margin(prepared) - margin(cold));
      rows.push({ run: k, learning: margin(learned), cold: margin(cold), prepared: margin(prepared), bossWinsLearning: learned.rounds.filter((x) => x.winner === 'boss').length, bossWinsCold: cold.rounds.filter((x) => x.winner === 'boss').length });
      ev.push(...runEvidence(learned)); // the profile keeps what it saw (observations of the learning games)
    }
    out.agents[a] = { runs: rows, meanDiff: rows.reduce((s, r) => s + r.learning - r.cold, 0) / rows.length };
    console.log(`[v4-learning] ${a.padEnd(16)} Δ learning−cold by campaign run: ${rows.map((r) => (r.learning - r.cold >= 0 ? '+' : '') + (r.learning - r.cold).toFixed(3)).join(' ')}`);
  }
  out.summary = {
    learningVsCold: meanCiOf(diffs),
    preparedVsCold: meanCiOf(prepVsCold),
    byCampaignRun: diffByRun.map((x) => meanCiOf(x)),
    jointLogLossByCampaignRun: { learning: llByRun.learning.map((x) => meanCiOf(x).mean), cold: llByRun.cold.map((x) => meanCiOf(x).mean) },
  };
  const s = out.summary;
  console.log(`\n[v4-learning] synthetic fixtures — learning − cold: Δ ${s.learningVsCold.mean.toFixed(3)} [${s.learningVsCold.lo.toFixed(3)}, ${s.learningVsCold.hi.toFixed(3)}] over ${s.learningVsCold.n} runs`);
  console.log(`  by campaign run: ${s.byCampaignRun.map((c: any, i: number) => `#${i + 1} ${c.mean.toFixed(3)} [${c.lo.toFixed(3)}, ${c.hi.toFixed(3)}]`).join('  ')}`);
  console.log(`  profile joint log loss by campaign run: ${s.jointLogLossByCampaignRun.learning.map((x: number) => x.toFixed(3)).join(' → ')} (cold ${s.jointLogLossByCampaignRun.cold.map((x: number) => x.toFixed(3)).join(' / ')})`);
  console.log(`  reference prepared − cold: Δ ${s.preparedVsCold.mean.toFixed(3)} [${s.preparedVsCold.lo.toFixed(3)}, ${s.preparedVsCold.hi.toFixed(3)}]`);
  const dir = path.join(env.artifactsDir, 'ml', 'v4');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `learning-${SEED}-${BASE}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`[v4-learning] wrote ${file}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
