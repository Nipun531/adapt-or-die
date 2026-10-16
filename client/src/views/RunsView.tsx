/** Workshop · Runs: every manual and simulated run, paginated; open any of them. */
import { useState } from 'react';
import { api } from '../api';
import { Empty, ErrorBox, Skeleton } from '../ui/states';
import { useCatalog, useLoad } from '../util';

export function RunsView({ go }: { go: (hash: string) => void }) {
  const catalog = useCatalog();
  const [source, setSource] = useState<string>('');
  const [offset, setOffset] = useState(0);
  const list = useLoad(() => api.listRuns(source || undefined, offset), [source, offset]);
  return (
    <section className="panel stock" aria-labelledby="runs-h">
      <header className="panel-head">
        <h3 id="runs-h">Runs</h3>
        <label className="field-inline">Source
          <select value={source} onChange={(e) => { setSource(e.target.value); setOffset(0); }}>
            <option value="">All</option>
            <option value="manual">Manual play</option>
            <option value="simulation">Simulations</option>
          </select>
        </label>
      </header>
      {list.loading && !list.data && <Skeleton lines={6} />}
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.data && !list.data.runs.length && <Empty title="No runs yet">Play a duel or launch a simulation batch.</Empty>}
      {list.data && list.data.runs.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Run</th><th>Source</th><th>Status</th><th>Rounds</th><th>You – Boss</th><th>Engine</th><th>Created</th></tr></thead>
              <tbody>
                {list.data.runs.map((r) => (
                  <tr key={r.id}>
                    <td><button className="link" onClick={() => go(`#/duel/${r.id}`)}>#{r.id}</button></td>
                    <td>{r.source}{r.player_strategy ? ` · ${r.player_strategy}` : ''}{r.simulation_batch_id ? ` · batch ${r.simulation_batch_id}` : ''}</td>
                    <td>{r.status}{r.end_reason ? ` (${r.end_reason.replace(/_/g, ' ')})` : ''}</td>
                    <td>{r.rounds_completed}/{r.max_rounds}</td>
                    <td><b className="tone-player">{r.player_wins}</b> – <b className="tone-boss">{r.boss_wins}</b></td>
                    <td>{r.engine_version}{catalog && r.engine_version !== catalog.rules.engineVersion ? ' (older)' : ''}</td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn btn-quiet btn-small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Newer</button>
            <span>{offset + 1}–{offset + list.data.runs.length} of {list.data.total}</span>
            <button className="btn btn-quiet btn-small" disabled={offset + 25 >= list.data.total} onClick={() => setOffset(offset + 25)}>Older</button>
          </div>
        </>
      )}
    </section>
  );
}
