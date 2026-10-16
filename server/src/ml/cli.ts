/**
 * ML CLI (run from repo root):
 *   npm run ml:build-dataset            build any missing training_examples from raw rounds (current schema)
 *   npm run ml:export                   write a CSV/JSON dataset snapshot to artifacts/datasets/ + dataset_snapshots row
 *   npm run ml:train [-- --activate]    build → export → train/evaluate (ml/train.py) → record model version
 *   npm run ml:activate -- <version>    activate an ELIGIBLE model   (npm run ml:activate -- --none  → use baseline)
 *   npm run ml:status                   dataset counts, models, active model, latest decision (model vs fallback)
 */
import { closePool, explainDbError, getPool } from '../db/pool.js';
import { datasetStats, exportDataset } from './dataset.js';
import { buildMissingExamples } from './examples.js';
import { stopInferenceWorker } from './predictor.js';
import { activateModel, deactivateModels, listModels, mlStatus, trainModel } from './training.js';

const fmt = (x: unknown) => (typeof x === 'number' ? x.toFixed(4) : String(x ?? '—'));

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const db = getPool();
  switch (cmd) {
    case 'build-dataset': {
      const r = await buildMissingExamples(db);
      const s = await datasetStats(db);
      console.log(`[ml] scanned ${r.scanned} round(s) without examples, inserted ${r.inserted}.`);
      console.log(`[ml] schema ${s.featureSchemaVersion}: ${s.valid} valid / ${s.invalid} invalid rows from ${s.distinctRuns} runs; labels ranged ${s.labelDistribution.ranged} / melee ${s.labelDistribution.melee}`);
      break;
    }
    case 'export': {
      const r = await exportDataset(db);
      console.log(`[ml] snapshot ${r.snapshotId} (engine ${r.engineVersion}): ${r.rowCount} rows (${r.invalidExcluded} invalid excluded), ${r.distinctRuns} runs`);
      console.log(`[ml]   ${r.csvPath}\n[ml]   ${r.jsonPath}\n[ml]   sha256 ${r.sha256}`);
      break;
    }
    case 'train': {
      const r = await trainModel(db, { activate: rest.includes('--activate') });
      if (!r.trained) {
        console.log(`[ml] NOT trained: ${r.error}`);
        console.log(`[ml] snapshot ${r.snapshot.snapshotId} (${r.snapshot.rowCount} rows). Run more simulations: npm run sim -- --runs 100`);
        process.exitCode = 2;
        break;
      }
      const m = r.model;
      console.log(`[ml] trained ${m.version} (engine ${m.engine_version} data) on snapshot ${r.snapshot.snapshotId} (${r.snapshot.rowCount} rows) in ${m.training_seconds.toFixed(2)}s`);
      console.log(`[ml]   held-out   model: acc ${fmt(m.metrics.accuracy)}  logloss ${fmt(m.metrics.log_loss)}  auc ${fmt(m.metrics.roc_auc)}  brier ${fmt(m.metrics.brier)}`);
      console.log(`[ml]   held-out baseline: acc ${fmt(m.baseline_metrics.accuracy)}  logloss ${fmt(m.baseline_metrics.log_loss)}  auc ${fmt(m.baseline_metrics.roc_auc)}  brier ${fmt(m.baseline_metrics.brier)}`);
      for (const reason of m.eligibility_reasons) console.log(`[ml]   ${reason}`);
      console.log(`[ml] eligible: ${m.eligible ? 'YES' : 'NO'}${r.activated ? ' — ACTIVATED (boss will use it from the next decision)' : m.eligible ? ` — activate with: npm run ml:activate -- ${m.version}` : ''}`);
      break;
    }
    case 'activate': {
      const version = rest[0];
      if (!version) throw new Error('Usage: npm run ml:activate -- <version>   (or --none to use the baseline)');
      if (version === '--none') {
        await deactivateModels(db);
        console.log('[ml] no active model — boss decisions will use the transparent baseline');
      } else {
        await activateModel(db, version);
        console.log(`[ml] activated ${version}`);
      }
      break;
    }
    case 'status': {
      const s = await mlStatus(db, { pingPython: true });
      const d = s.dataset;
      console.log(`[ml] task ${s.task}, feature schema ${s.featureSchemaVersion} (${s.featureNames.length} features), engine ${s.engineVersion} (only current-engine rows are trained on)`);
      console.log(`[ml] rows by engine version: ${d.byEngine.map((e) => `${e.engine_version}${e.engine_version === s.engineVersion ? ' (current)' : ' (historical)'}: ${e.valid} valid / ${e.invalid} invalid, ${e.runs} runs`).join('; ') || 'none'}`);
      console.log(`[ml] current-engine dataset: ${d.valid} valid / ${d.invalid} invalid rows, ${d.distinctRuns} runs, labels ranged ${d.labelDistribution.ranged} / melee ${d.labelDistribution.melee}, sources ${JSON.stringify(d.sourceDistribution)}; ${d.roundsMissingExamples} round(s) missing examples`);
      console.log(`[ml] models: ${s.models.total} trained, ${s.models.eligible} eligible; active: ${s.activeModel ? `${s.activeModel.version}${s.activeModel.engine_version !== s.engineVersion ? ` (UNUSABLE: trained on engine ${s.activeModel.engine_version} data → boss uses baseline fallback until a current-engine model is activated)` : ''}` : 'none (baseline fallback)'}`);
      console.log(`[ml] python: ${s.python?.ok ? s.python.detail : `UNAVAILABLE — ${s.python?.detail}`}`);
      const ld = s.latestDecision;
      console.log(ld
        ? `[ml] latest boss decision (run ${ld.run_id}, round ${ld.for_round_number}, ${ld.source}): ${ld.kind === 'model' ? `MODEL ${ld.model_version}` : `FALLBACK — ${ld.fallback_reason}`}, P(ranged)=${fmt(ld.probability_ranged)}`
        : '[ml] no boss decisions yet');
      console.log(`[ml] decisions by predictor: ${JSON.stringify(s.decisionUsage)}`);
      for (const m of (await listModels(db)).slice(0, 5)) {
        console.log(`       ${m.is_active ? '*' : ' '} ${m.version}  engine=${m.engine_version}  eligible=${m.eligible}  logloss ${fmt(m.metrics.log_loss)} vs baseline ${fmt(m.baseline_metrics.log_loss)}`);
      }
      break;
    }
    default:
      throw new Error(`Unknown command "${cmd ?? ''}". Use build-dataset | export | train | activate | status`);
  }
}

main()
  .catch((err) => {
    console.error(`[ml] ${explainDbError(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    stopInferenceWorker();
    await closePool();
  });
