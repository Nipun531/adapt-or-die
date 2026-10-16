/**
 * Simulation runner: launch a batch (runs, rounds, strategies, seed), watch its progress (polled from
 * the server, which persists counters after every run), and inspect past batches and their summaries.
 */
import { useEffect, useState } from 'react';
import { api, type Batch } from '../api';
import { Empty, ErrorBox, Loading, Notice, pct, useAction, useLoad } from '../util';

export function SimView({ go }: { go: (hash: string) => void }) {
  const meta = useLoad(() => api.strategies(), []);
  const batches = useLoad(() => api.listBatches(), []);
  const [runs, setRuns] = useState(30);
  const [maxRounds, setMaxRounds] = useState(10);
  const [seed, setSeed] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const act = useAction();
  useEffect(() => { if (meta.data && !chosen.length) setChosen(meta.data.strategies.map((s) => s.name)); }, [meta.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = batches.data?.batches.find((b) => b.status === 'running' || b.status === 'queued');
  // Poll while a batch is running.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void batches.reload(), 1500);
    return () => clearInterval(t);
  }, [running?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const launch = async () => {
    const b = await act.run(() => api.startBatch({ runs, maxRounds, strategies: chosen, seed: seed.trim() || undefined }), 'Batch started');
    if (b) {
      setSelected(b.id);
      await batches.reload();
    }
  };
  const toggle = (name: string) => setChosen(chosen.includes(name) ? chosen.filter((c) => c !== name) : [...chosen, name]);
  const shown = batches.data?.batches.find((b) => b.id === (selected ?? running?.id ?? batches.data?.batches[0]?.id));

  return (
    <div className="sim">
      <section className="card">
        <h2>Run a simulation batch</h2>
        <p className="muted small">Simulated agents play complete runs against the real boss through the same rules and services as manual play. Every completed round appends raw records and, from round 2, one training example (source = simulation).</p>
        {meta.loading && <Loading />}
        <ErrorBox error={meta.error} onRetry={meta.reload} />
        {meta.data && (
          <>
            <div className="row">
              <label>Runs <input type="number" min={1} max={meta.data.limits.maxRuns} value={runs} onChange={(e) => setRuns(Number(e.target.value))} /></label>
              <label>Rounds per run <input type="number" min={1} max={meta.data.limits.maxRounds} value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} /></label>
              <label>Seed <input placeholder="auto" value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
            </div>
            <div className="strategies">
              {meta.data.strategies.map((s) => (
                <label key={s.name} className="check strategy"><input type="checkbox" checked={chosen.includes(s.name)} onChange={() => toggle(s.name)} /> <b>{s.name}</b> <span className="muted small">{s.description}</span></label>
              ))}
            </div>
            <button className="btn primary" disabled={act.busy || !!running || !chosen.length} onClick={launch}>
              {running ? `Batch ${running.id} running…` : '▶ Launch batch'}
            </button>
            <p className="muted small">Strategies are assigned round-robin. Same seed + settings + boss predictor (same active model or fallback) reproduce the same fights; re-running always appends new rows.</p>
            <ErrorBox error={act.error} /><Notice text={act.notice} />
          </>
        )}
      </section>

      {shown && <BatchDetail b={shown} go={go} />}

      <section className="card">
        <h3>Batches</h3>
        {batches.loading && !batches.data && <Loading />}
        <ErrorBox error={batches.error} onRetry={batches.reload} />
        {batches.data && !batches.data.batches.length && <Empty>No batches yet.</Empty>}
        {batches.data && batches.data.batches.length > 0 && (
          <table className="table">
            <thead><tr><th>Batch</th><th>Status</th><th>Runs ok / failed / requested</th><th>Rounds</th><th>Examples</th><th>Seed</th><th>Created</th></tr></thead>
            <tbody>
              {batches.data.batches.map((b) => (
                <tr key={b.id} className={shown?.id === b.id ? 'hl' : ''} onClick={() => setSelected(b.id)} style={{ cursor: 'pointer' }}>
                  <td>#{b.id}</td><td>{b.status}</td><td>{b.runs_completed} / {b.runs_failed} / {b.runs_requested}</td>
                  <td>{b.rounds_completed}</td><td>{b.examples_created}</td><td className="mono">{b.seed}</td><td>{new Date(b.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function BatchDetail({ b, go }: { b: Batch; go: (hash: string) => void }) {
  const done = b.runs_completed + b.runs_failed;
  return (
    <section className="card">
      <h3>Batch #{b.id} — {b.status}</h3>
      <div className="progress"><div style={{ width: `${(done / b.runs_requested) * 100}%` }} /></div>
      <p className="small">{done} / {b.runs_requested} runs attempted · {b.rounds_completed} rounds · {b.examples_created} training examples · strategies {b.config.strategies.join(', ')} · ≤{b.config.maxRounds} rounds · simulator {b.simulator_version}</p>
      {b.summary.byStrategy && (
        <table className="table small">
          <thead><tr><th>Strategy</th><th>Runs</th><th>Rounds</th><th>Player wins</th><th>Boss wins</th><th>Boss win rate</th></tr></thead>
          <tbody>{b.summary.byStrategy.map((s) => <tr key={s.strategy}><td>{s.strategy}</td><td>{s.runs}</td><td>{s.rounds}</td><td>{s.player_wins}</td><td>{s.boss_wins}</td><td>{pct(s.boss_win_rate, 1)}</td></tr>)}</tbody>
        </table>
      )}
      {b.summary.labelDistribution && <p className="small">Labels: mostly ranged {b.summary.labelDistribution.ranged}, mostly melee {b.summary.labelDistribution.melee}, invalid {b.summary.labelDistribution.invalid}</p>}
      {b.errors.length > 0 && <ul className="small error-list">{b.errors.slice(0, 10).map((e, i) => <li key={i}>{e.strategy ? `${e.strategy} (seed ${e.seed}): ` : ''}{e.message}</li>)}</ul>}
      <button className="link small" onClick={() => go('#/runs')}>Browse simulated runs →</button>
    </section>
  );
}
