/**
 * ML Lab: states plainly whether data was collected, a model trained, a model is active, and whether the
 * latest boss decision used the model or the transparent baseline. Lets the user build/export the dataset,
 * train + evaluate (held-out metrics vs baseline, eligibility reasons) and activate/deactivate models.
 */
import { useState } from 'react';
import { api } from '../api';
import { Empty, ErrorBox, Loading, n2, Notice, pct, useAction, useLoad } from '../util';

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
    <div className="ml">
      <section className="card">
        <h2>ML Lab <span className="muted">— task: predict whether you will attack mostly ranged next round</span></h2>
        {status.loading && !s && <Loading />}
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
            <p className="small">Labels: mostly ranged {s.dataset.labelDistribution.ranged} · mostly melee/unarmed {s.dataset.labelDistribution.melee} · sources {Object.entries(s.dataset.sourceDistribution).map(([k, v]) => `${k} ${v}`).join(', ') || '—'} · feature schema {s.featureSchemaVersion} ({s.featureNames.length} features){s.dataset.otherSchemaRows ? ` · ${s.dataset.otherSchemaRows} rows of older schemas kept` : ''}</p>
            <p className="small">Rows by game-rules (engine) version: {s.dataset.byEngine.length ? s.dataset.byEngine.map((e) => `${e.engine_version}${e.engine_version === s.engineVersion ? ' (current — used for training)' : ' (historical — kept, not trained on)'}: ${e.valid} valid / ${e.invalid} invalid from ${e.runs} runs`).join(' · ') : '—'}</p>
            <p className="small">Boss decisions under engine {s.engineVersion}: model {s.decisionBasis?.model ?? 0}, baseline {s.decisionBasis?.baseline ?? 0}, rule-determined {s.decisionBasis?.rule ?? 0} (player could not field a ranged weapon), no evidence {s.decisionBasis?.unknown ?? 0}. New data never changes the active model by itself — train and activate explicitly.</p>
            {s.dataset.roundsMissingExamples > 0 && <p className="small warn-text">{s.dataset.roundsMissingExamples} completed round(s) have no example for this schema — click “Build dataset”.</p>}
            <div className="row">
              <button className="btn" disabled={act.busy} onClick={async () => { const r = await act.run(() => api.buildDataset()); if (r) { setTrainMsg(`Built ${r.inserted} missing example(s).`); await refresh(); } }}>Build dataset</button>
              <button className="btn" disabled={act.busy} onClick={async () => { const r = await act.run(() => api.exportDataset()); if (r) { setTrainMsg(`Snapshot ${r.snapshotId}: ${r.rowCount} rows → ${r.csvPath} (+ .json)`); await refresh(); } }}>Export snapshot</button>
              <label className="check"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> activate if eligible</label>
              <button className="btn primary" disabled={act.busy || s.trainingInProgress} onClick={async () => {
                const r = await train();
                if (r) setTrainMsg(r.trained ? `Trained ${r.model.version}: ${r.model.eligible ? 'ELIGIBLE' : 'not eligible'}${r.activated ? ', activated' : ''}.` : `Not trained: ${r.error}`);
              }}>{act.busy ? 'Working…' : '🧪 Train + evaluate'}</button>
              {s.activeModel && <button className="btn ghost" disabled={act.busy} onClick={async () => { if (await act.run(() => api.activate(null))) { setTrainMsg('Model deactivated — boss uses the baseline.'); await refresh(); } }}>Use baseline</button>}
            </div>
            <ErrorBox error={act.error} /><Notice text={trainMsg} />
          </>
        )}
      </section>

      <section className="card">
        <h3>Model versions</h3>
        {models.loading && !models.data && <Loading />}
        <ErrorBox error={models.error} onRetry={models.reload} />
        {models.data && !models.data.models.length && <Empty>No models trained yet. Run simulations (≥200 valid rows from ≥20 runs are needed for eligibility), then train.</Empty>}
        {models.data?.models.map((m) => (
          <div key={m.id} className={`model ${m.is_active ? 'active' : ''}`}>
            <div className="row">
              <b className="mono">{m.version}</b>
              {m.is_active && <span className="pill ok">ACTIVE</span>}
              <span className={`pill ${m.eligible ? 'ok' : 'bad'}`}>{m.eligible ? 'eligible' : 'not eligible'}</span>
              {m.engine_version !== s?.engineVersion && <span className="pill warn">trained on engine {m.engine_version} data — not usable with current rules</span>}
              <span className="muted small">{m.model_type} · schema {m.feature_schema_version} · engine {m.engine_version} · {m.data_stats.rows} rows / {m.data_stats.distinct_runs} runs · trained {new Date(m.trained_at).toLocaleString()} in {n2(m.training_seconds)}s</span>
              {!m.is_active && m.eligible && m.engine_version === s?.engineVersion && <button className="btn small" disabled={act.busy} onClick={async () => { if (await act.run(() => api.activate(m.version))) { setTrainMsg(`Activated ${m.version}.`); await refresh(); } }}>Activate</button>}
            </div>
            <table className="table small">
              <thead><tr><th>Held-out ({m.data_stats.test_rows} rows, {m.data_stats.test_runs} runs)</th><th>Accuracy</th><th>Log loss</th><th>ROC AUC</th><th>Brier</th></tr></thead>
              <tbody>
                <tr><td>XGBoost model</td><td>{pct(m.metrics.accuracy, 1)}</td><td>{M(m.metrics.log_loss)}</td><td>{M(m.metrics.roc_auc)}</td><td>{M(m.metrics.brier)}</td></tr>
                <tr><td>Transparent baseline</td><td>{pct(m.baseline_metrics.accuracy, 1)}</td><td>{M(m.baseline_metrics.log_loss)}</td><td>{M(m.baseline_metrics.roc_auc)}</td><td>{M(m.baseline_metrics.brier)}</td></tr>
              </tbody>
            </table>
            <details>
              <summary className="small">Eligibility checks, data split and top features</summary>
              <ul className="small">{m.eligibility_reasons.map((r, i) => <li key={i} className={r.startsWith('FAIL') ? 'warn-text' : ''}>{r}</li>)}</ul>
              <p className="small muted">{m.data_stats.split} · train {m.data_stats.train_rows} rows / test {m.data_stats.test_rows} rows · run overlap {m.data_stats.group_overlap}</p>
              {m.data_stats.feature_importance_gain && <p className="small muted">Top features (gain): {Object.entries(m.data_stats.feature_importance_gain as Record<string, number>).slice(0, 8).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}</p>}
              <p className="small muted">Artifact: {m.artifact_path}/model.json + metadata.json</p>
            </details>
          </div>
        ))}
      </section>
    </div>
  );
}

function Status({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <div className={`status ${ok ? 'ok' : 'no'}`}>
      <label>{label}</label>
      <b>{ok ? '✔' : '✖'} {text}</b>
    </div>
  );
}
