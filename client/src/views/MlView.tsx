/**
 * ML Lab: states plainly whether data was collected, a model trained, a model is active, and whether the
 * latest boss decision used the model or the transparent baseline. Lets the user build/export the dataset,
 * train + evaluate (held-out metrics vs baseline, eligibility reasons) and activate/deactivate models.
 */
import { useState } from 'react';
import { api } from '../api';
import { Icon } from '../ui/Icon';
import { Empty, ErrorBox, Notice, Skeleton } from '../ui/states';
import { n2, pct, useAction, useLoad } from '../util';

const M = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(4));

export function MlView() {
  const status = useLoad(() => api.mlStatus(true), []);
  const models = useLoad(() => api.models(), []);
  const act = useAction();
  const [activate, setActivate] = useState(false);
  const refresh = async () => { await Promise.all([status.reload(), models.reload()]); };
  const s = status.data;

  const train = async () => {
    const r = await act.run(() => api.train(activate));
    if (r) await refresh();
    return r;
  };
  const [trainMsg, setTrainMsg] = useState<string | null>(null);

  return (
    <div className="workshop">
      <section className="panel stock" aria-labelledby="ml-h">
        <header className="panel-head"><h3 id="ml-h">ML Lab</h3><span className="panel-meta">predicts whether you fight mostly ranged next round</span></header>
        {status.loading && !s && <Skeleton lines={5} />}
        <ErrorBox error={status.error} onRetry={status.reload} />
        {s && (
          <>
            <div className="status-grid">
              <Status label={`Data collected (engine ${s.engineVersion})`} ok={s.dataset.valid > 0} text={`${s.dataset.valid} valid rows (${s.dataset.invalid} invalid) from ${s.dataset.distinctRuns} runs`} />
              <Status label="Model trained" ok={s.models.total > 0} text={`${s.models.total} trained, ${s.models.eligible} eligible`} />
              <Status label="Active model" ok={!!s.activeModel && s.activeModel.engine_version === s.engineVersion}
                text={!s.activeModel ? 'none — boss uses the transparent baseline'
                  : s.activeModel.engine_version !== s.engineVersion ? `${s.activeModel.version} — trained on engine ${s.activeModel.engine_version} data, so the boss falls back to the baseline` : s.activeModel.version} />
              <Status label="Latest boss decision" ok={s.latestDecision?.kind === 'model'}
                text={s.latestDecision ? (s.latestDecision.kind === 'model' ? `used model ${s.latestDecision.model_version}` : `used fallback: ${s.latestDecision.fallback_reason}`) : 'no decisions yet'} />
              <Status label="Python / XGBoost" ok={!!s.python?.ok} text={s.python ? s.python.detail : 'not checked'} />
            </div>
            <p className="panel-lede">Labels: mostly ranged {s.dataset.labelDistribution.ranged} · mostly melee/unarmed {s.dataset.labelDistribution.melee} · sources {Object.entries(s.dataset.sourceDistribution).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} · feature schema {s.featureSchemaVersion} ({s.featureNames.length} features){s.dataset.otherSchemaRows ? ` · ${s.dataset.otherSchemaRows} rows of older schemas kept` : ''}</p>
            <p className="panel-lede">Rows by game-rules (engine) version: {s.dataset.byEngine.length ? s.dataset.byEngine.map((e) => `${e.engine_version}${e.engine_version === s.engineVersion ? ' (current — used for training)' : ' (historical — kept, not trained on)'}: ${e.valid} valid / ${e.invalid} invalid from ${e.runs} runs`).join(' · ') : '—'}</p>
            <p className="panel-lede">Boss decisions under engine {s.engineVersion}: model {s.decisionBasis?.model ?? 0}, baseline {s.decisionBasis?.baseline ?? 0}, rule-determined {s.decisionBasis?.rule ?? 0} (player could not field a ranged weapon), no evidence {s.decisionBasis?.unknown ?? 0}. New data never changes the active model by itself — train and activate explicitly.</p>
            {s.dataset.roundsMissingExamples > 0 && <p className="banner banner-warn">{s.dataset.roundsMissingExamples} completed round(s) have no example for this schema — click “Build dataset”.</p>}
            <div className="form-row">
              <button className="btn btn-quiet" disabled={act.busy} onClick={async () => { const r = await act.run(() => api.buildDataset()); if (r) { setTrainMsg(`Built ${r.inserted} missing example(s).`); await refresh(); } }}>Build dataset</button>
              <button className="btn btn-quiet" disabled={act.busy} onClick={async () => { const r = await act.run(() => api.exportDataset()); if (r) { setTrainMsg(`Snapshot ${r.snapshotId}: ${r.rowCount} rows → ${r.csvPath} (+ .json)`); await refresh(); } }}>Export snapshot</button>
              <label className="check"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> activate if eligible</label>
              <button className="btn btn-primary" disabled={act.busy || s.trainingInProgress} onClick={async () => {
                const r = await train();
                if (r) setTrainMsg(r.trained ? `Trained ${r.model.version}: ${r.model.eligible ? 'ELIGIBLE' : 'not eligible'}${r.activated ? ', activated' : ''}.` : `Not trained: ${r.error}`);
              }}>{act.busy ? 'Working…' : 'Train + evaluate'}</button>
              {s.activeModel && <button className="btn btn-quiet" disabled={act.busy} onClick={async () => { if (await act.run(() => api.activate(null))) { setTrainMsg('Model deactivated — boss uses the baseline.'); await refresh(); } }}>Use baseline</button>}
            </div>
            <ErrorBox error={act.error} /><Notice text={trainMsg} />
          </>
        )}
      </section>

      <section className="panel stock" aria-labelledby="models-h">
        <header className="panel-head"><h3 id="models-h">Model versions</h3></header>
        {models.loading && !models.data && <Skeleton lines={4} />}
        <ErrorBox error={models.error} onRetry={models.reload} />
        {models.data && !models.data.models.length && <Empty title="No models trained yet">Run simulations (≥ 200 valid rows from ≥ 20 runs are needed for eligibility), then train.</Empty>}
        {models.data?.models.map((m) => (
          <div key={m.id} className={`model ${m.is_active ? 'active' : ''}`}>
            <div className="model-head">
              <b className="model-version">{m.version}</b>
              {m.is_active && <span className="chip chip-ok">Active</span>}
              <span className={`chip ${m.eligible ? 'chip-ok' : 'chip-bad'}`}>{m.eligible ? 'eligible' : 'not eligible'}</span>
              {typeof m.params?.blend_weight === 'number' && <span className="chip">ensemble {m.params.blend_weight}·model + {n2(1 - m.params.blend_weight)}·baseline</span>}
              {m.engine_version !== s?.engineVersion && <span className="chip chip-warn">trained on engine {m.engine_version} data — not usable with current rules</span>}
              <span className="muted-ink">{m.model_type} · schema {m.feature_schema_version} · engine {m.engine_version} · {m.data_stats.rows} rows / {m.data_stats.distinct_runs} runs · trained {new Date(m.trained_at).toLocaleString()} in {n2(m.training_seconds)}s</span>
              {!m.is_active && m.eligible && m.engine_version === s?.engineVersion && <button className="btn btn-primary btn-small" disabled={act.busy} onClick={async () => { if (await act.run(() => api.activate(m.version))) { setTrainMsg(`Activated ${m.version}.`); await refresh(); } }}>Activate</button>}
            </div>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Held-out ({m.data_stats.test_rows} rows, {m.data_stats.test_runs} runs)</th><th>Accuracy</th><th>Log loss</th><th>ROC AUC</th><th>Brier</th></tr></thead>
              <tbody>
                <tr><td>XGBoost model</td><td>{pct(m.metrics.accuracy, 1)}</td><td>{M(m.metrics.log_loss)}</td><td>{M(m.metrics.roc_auc)}</td><td>{M(m.metrics.brier)}</td></tr>
                <tr><td>Transparent baseline</td><td>{pct(m.baseline_metrics.accuracy, 1)}</td><td>{M(m.baseline_metrics.log_loss)}</td><td>{M(m.baseline_metrics.roc_auc)}</td><td>{M(m.baseline_metrics.brier)}</td></tr>
              </tbody>
            </table></div>
            <details>
              <summary>Eligibility checks, data split and top features</summary>
              <ul className="checks">{m.eligibility_reasons.map((r, i) => <li key={i} className={r.startsWith('FAIL') ? 'is-fail' : r.startsWith('PASS') ? 'is-pass' : ''}>{r}</li>)}</ul>
              <p className="muted-ink">{m.data_stats.split} · train {m.data_stats.train_rows} rows / test {m.data_stats.test_rows} rows · run overlap {m.data_stats.group_overlap}</p>
              {m.data_stats.feature_importance_gain && <p className="muted-ink">Top features (gain): {Object.entries(m.data_stats.feature_importance_gain as Record<string, number>).slice(0, 8).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}</p>}
              <p className="muted-ink">Artifact: {m.artifact_path}/model.json + metadata.json</p>
            </details>
          </div>
        ))}
      </section>
    </div>
  );
}

function Status({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <div className={`status ${ok ? 'is-ok' : 'is-no'}`}>
      <label>{label}</label>
      <b><Icon name={ok ? 'check' : 'close'} size={14} /> {text}</b>
    </div>
  );
}
