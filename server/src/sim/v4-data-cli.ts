/**
 * V4 next-build data + model pipeline (docs/V4_IMPLEMENTATION_PLAN.md §4):
 *   npm run ml:v4-data -- build     append missing build_examples (Prepared Boss runs, live engine)
 *   npm run ml:v4-data -- export    versioned CSV snapshot in artifacts/datasets/
 *   npm run ml:v4-data -- train     export + ml/train_build.py → artifacts/models/build-<stamp>/ (+ eval)
 *   npm run ml:v4-data -- eval <dir> whole-build evaluation among LEGAL candidates + the declared eligibility rule
 * Nothing here activates a model.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { env, REPO_ROOT } from '../config/env.js';
import { closePool, getPool } from '../db/pool.js';
import { HEAD_CLASSES, HEAD_NAMES } from '../boss/build-heads.js';
import { legalCandidates } from '../boss/candidates.js';
import { jointLogLoss, uniformHeads, type HeadProbs } from '../boss/forecast.js';
import { buildMissingBuildExamples, exportBuildDataset } from '../ml/build-examples.js';
import { meanCiOf } from './stats.js';

/** Declared before results (V4 plan §4). A build model is eligible only if every line passes. */
export const BUILD_ELIGIBILITY = {
  maxUnseenFamilyRegression: 0.10, // joint log loss vs persistence, per unseen agent family
  minRows: 2000,
};

async function evalDir(dirRel: string) {
  const dir = path.resolve(REPO_ROOT, dirRel);
  const db = getPool();
  const load = (f: string) => {
    const [head, ...lines] = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n');
    const cols = head.split(',');
    return new Map(lines.map((l) => { const v = l.split(','); return [Number(v[0]), Object.fromEntries(cols.map((c, i) => [c, Number(v[i])]))]; }));
  };
  const oof = { heldout: load('oof_heldout.csv'), loao: load('oof_loao.csv') };
  const ids = [...oof.loao.keys()];
  const rows = (await db.query(
    `SELECT b.id, b.heads, b.run_id, b.features, u.player_strategy, r.round_number, f.player_post
     FROM build_examples b JOIN runs u ON u.id = b.run_id JOIN rounds r ON r.id = b.label_round_id JOIN rounds f ON f.id = b.feature_round_id
     WHERE b.id = ANY($1)`, [ids])).rows;
  // Persistence from the row's own features (last_/freq_ columns = 0.5·last + 0.5·Laplace frequency over rounds 1..N).
  const persistenceOf = (feat: Record<string, number | null>): HeadProbs => Object.fromEntries(HEAD_NAMES.map((h) => [h, Object.fromEntries(HEAD_CLASSES[h].map((c) =>
    [c, 0.5 * (feat[`last_${h}_${c}`] ?? 1 / HEAD_CLASSES[h].length) + 0.5 * (feat[`freq_${h}_${c}`] ?? 0)]))])) as HeadProbs;
  const toHeads = (o: Record<string, number>): HeadProbs =>
    Object.fromEntries(HEAD_NAMES.map((h) => [h, Object.fromEntries(HEAD_CLASSES[h].map((c) => [c, o[`p_${h}_${c}`] ?? 0]))])) as HeadProbs;
  type Acc = Record<string, number[]>;
  const res: Record<string, { pooled: Acc; byAgent: Record<string, Acc>; byRound: Record<number, Acc> }> = {
    heldout: { pooled: {}, byAgent: {}, byRound: {} }, loao: { pooled: {}, byAgent: {}, byRound: {} },
  };
  let covered = 0;
  const push = (a: Acc, k: string, v: number) => { (a[k] ??= []).push(v); };
  for (const r of rows) {
    const cands = legalCandidates(r.player_post);
    const f: Record<string, HeadProbs> = { uniform: uniformHeads(), persistence: persistenceOf(r.features) };
    if (jointLogLoss(cands, f.uniform, r.heads) === null) continue;
    covered++;
    for (const split of ['heldout', 'loao'] as const) {
      const o = oof[split].get(Number(r.id));
      if (!o) continue;
      const all = { ...f, model: toHeads(o) };
      for (const [k, h] of Object.entries(all)) {
        const l = jointLogLoss(cands, h, r.heads)!;
        push(res[split].pooled, k, l);
        push(res[split].byAgent[r.player_strategy] ??= {}, k, l);
        push(res[split].byRound[r.round_number] ??= {}, k, l);
      }
    }
  }
  const sum = (a: Acc) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, meanCiOf(v)]));
  const report: any = { dir: dirRel, rows: rows.length, coverage: covered / rows.length, splits: {} };
  for (const s of ['heldout', 'loao'] as const) {
    report.splits[s] = {
      pooled: sum(res[s].pooled),
      byAgent: Object.fromEntries(Object.entries(res[s].byAgent).map(([g, a]) => [g, sum(a)])),
      byRound: Object.fromEntries(Object.entries(res[s].byRound).map(([n, a]) => [n, Object.fromEntries(Object.entries(a).map(([k, v]) => [k, meanCiOf(v).mean]))])),
    };
  }
  const lo = report.splits.loao;
  const worst = Object.entries(lo.byAgent as Record<string, any>).map(([g, a]) => [g, a.model.mean - a.persistence.mean] as const).sort((a, b) => b[1] - a[1]);
  const better = worst.filter(([, d]) => d < 0).length;
  const checks = [
    [rows.length >= BUILD_ELIGIBILITY.minRows, `rows ${rows.length} ≥ ${BUILD_ELIGIBILITY.minRows}`],
    [report.splits.heldout.pooled.model.mean < report.splits.heldout.pooled.persistence.mean, `held-out runs: joint log loss ${report.splits.heldout.pooled.model.mean.toFixed(3)} < persistence ${report.splits.heldout.pooled.persistence.mean.toFixed(3)}`],
    [lo.pooled.model.mean < lo.pooled.persistence.mean, `unseen families pooled: ${lo.pooled.model.mean.toFixed(3)} < persistence ${lo.pooled.persistence.mean.toFixed(3)}`],
    [worst[0][1] <= BUILD_ELIGIBILITY.maxUnseenFamilyRegression, `worst unseen family (${worst[0][0]}): ${worst[0][1] >= 0 ? '+' : ''}${worst[0][1].toFixed(3)} ≤ +${BUILD_ELIGIBILITY.maxUnseenFamilyRegression}`],
  ] as const;
  report.eligibility = { rule: BUILD_ELIGIBILITY, checks: checks.map(([ok, t]) => `${ok ? 'PASS' : 'FAIL'}: ${t}`), statisticalOk: checks.every(([ok]) => ok), unseenFamiliesBetter: `${better}/${worst.length}` };
  fs.writeFileSync(path.join(dir, 'eval.json'), JSON.stringify(report, null, 2));
  console.log(`[v4-data] ${rows.length} rows; true build is a legal candidate in ${(100 * report.coverage).toFixed(1)}%`);
  for (const s of ['heldout', 'loao'] as const) {
    const p = report.splits[s].pooled;
    console.log(`  ${s.padEnd(8)} joint log loss  model ${p.model.mean.toFixed(3)}  persistence ${p.persistence.mean.toFixed(3)}  uniform ${p.uniform.mean.toFixed(3)}`);
  }
  console.log('  unseen family (model − persistence):', worst.map(([g, d]) => `${g} ${d >= 0 ? '+' : ''}${d.toFixed(3)}`).join(', '));
  for (const c of report.eligibility.checks) console.log(`  ${c}`);
  console.log(`  statistically eligible: ${report.eligibility.statisticalOk ? 'YES (decision check still required)' : 'NO'}`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const db = getPool();
  if (cmd === 'build') console.log('[v4-data]', await buildMissingBuildExamples(db));
  else if (cmd === 'export') console.log('[v4-data]', await exportBuildDataset(db));
  else if (cmd === 'train') {
    const snap = await exportBuildDataset(db);
    console.log('[v4-data] snapshot', snap.csvPath, snap.rows, 'rows');
    const out = path.join('artifacts', 'models', `build-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
    const r = spawnSync(env.pythonBin, [path.join(REPO_ROOT, 'ml', 'train_build.py'), '--dataset', path.resolve(REPO_ROOT, snap.csvPath), '--out-dir', path.resolve(REPO_ROOT, out), '--classes', JSON.stringify(HEAD_CLASSES)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`train_build.py failed: ${r.stderr.slice(-800)}`);
    console.log('[v4-data] trained', out);
    fs.writeFileSync(path.resolve(REPO_ROOT, out, 'dataset.json'), JSON.stringify(snap, null, 2));
    await evalDir(out);
  } else if (cmd === 'eval' && arg) await evalDir(arg);
  else throw new Error('Usage: ml:v4-data -- build | export | train | eval <dir>');
}

main().catch((e) => { console.error('[v4-data]', e.message ?? e); process.exitCode = 1; }).finally(() => closePool());
