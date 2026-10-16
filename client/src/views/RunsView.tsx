/** Browse past runs (manual and simulated), paginated, and open any of them. */
import { useState } from 'react';
import { api } from '../api';
import { Empty, ErrorBox, Loading, useLoad } from '../util';

export function RunsView({ go }: { go: (hash: string) => void }) {
  const [source, setSource] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const list = useLoad(() => api.listRuns(source || undefined, offset), [source, offset]);
  return (
    <section className="card">
      <div className="row">
        <h2>Run history</h2>
        <select value={source} onChange={(e) => { setSource(e.target.value); setOffset(0); }}>
          <option value="">All sources</option>
          <option value="manual">Manual play</option>
          <option value="simulation">Simulations</option>
        </select>
      </div>
      {list.loading && <Loading />}
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.data && !list.data.runs.length && <Empty>No runs yet.</Empty>}
      {list.data && list.data.runs.length > 0 && (
        <>
          <table className="table">
            <thead><tr><th>Run</th><th>Source</th><th>Status</th><th>Rounds</th><th>Player – Boss</th><th>Created</th></tr></thead>
            <tbody>
              {list.data.runs.map((r) => (
                <tr key={r.id}>
                  <td><button className="link" onClick={() => go(`#/duel/${r.id}`)}>#{r.id}</button></td>
                  <td>{r.source}{r.player_strategy ? ` · ${r.player_strategy}` : ''}{r.simulation_batch_id ? ` · batch ${r.simulation_batch_id}` : ''}</td>
                  <td>{r.status}{r.end_reason ? ` (${r.end_reason.replace(/_/g, ' ')})` : ''}</td>
                  <td>{r.rounds_completed}/{r.max_rounds}</td>
                  <td>{r.player_wins} – {r.boss_wins}</td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>← Newer</button>
            <span className="muted">{offset + 1}–{offset + list.data.runs.length} of {list.data.total}</span>
            <button className="btn small" disabled={offset + 25 >= list.data.total} onClick={() => setOffset(offset + 25)}>Older →</button>
          </div>
        </>
      )}
    </section>
  );
}
