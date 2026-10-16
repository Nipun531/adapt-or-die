/**
 * The main play screen. Without a run: start a new run or resume an active one.
 * With a run: both fighters, the preparation phase, "begin round", the latest round (combat log,
 * rewards, boss analysis/decision), and the run's round history.
 */
import { useEffect, useState } from 'react';
import { api, type AttackMode, type RoundDetail, type RunView } from '../api';
import { FighterCard } from '../components/FighterCard';
import { PrepPanel } from '../components/PrepPanel';
import { RoundView } from '../components/RoundView';
import { Empty, ErrorBox, Loading, useAction, useCatalog, useLoad } from '../util';

export function DuelView({ runId, go }: { runId: number | null; go: (hash: string) => void }) {
  return runId ? <RunScreen runId={runId} go={go} /> : <StartScreen go={go} />;
}

function StartScreen({ go }: { go: (hash: string) => void }) {
  const catalog = useCatalog();
  const [maxRounds, setMaxRounds] = useState(10);
  useEffect(() => { if (catalog) setMaxRounds(catalog.rules.defaultMaxRounds); }, [catalog]);
  const act = useAction();
  const active = useLoad(() => api.listRuns('manual'), []);
  const start = async () => {
    const v = await act.run(() => api.createRun(maxRounds));
    if (v) go(`#/duel/${v.run.id}`);
  };
  const resumable = active.data?.runs.filter((r) => r.status === 'active') ?? [];
  return (
    <div className="start">
      <section className="card hero">
        <h1>The Boss Remembers</h1>
        <p>A medieval duel over many rounds. You and the boss start from the same base — unarmed, level 1, no gold — and each gets 2 stat points to spend before round 1. After every round both of you earn XP and gold, level up, buy gear and change loadouts. The boss studies each fight and adapts.</p>
        <div className="row">
          <label>Rounds in this run <input type="number" min={1} max={100} value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} /></label>
          <button className="btn primary" disabled={act.busy} onClick={start}>⚔ Start new run</button>
        </div>
        <ErrorBox error={act.error} />
      </section>
      <section className="card">
        <h2>Resume a run</h2>
        {active.loading && <Loading />}
        <ErrorBox error={active.error} onRetry={active.reload} />
        {!active.loading && !resumable.length && <Empty>No active manual runs. Start one above.</Empty>}
        <ul className="run-list">
          {resumable.map((r) => (
            <li key={r.id}><button className="link" onClick={() => go(`#/duel/${r.id}`)}>Run #{r.id}</button> — {r.rounds_completed}/{r.max_rounds} rounds · you {r.player_wins} – boss {r.boss_wins}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RunScreen({ runId, go }: { runId: number; go: (hash: string) => void }) {
  const catalog = useCatalog();
  const run = useLoad(() => api.getRun(runId), [runId]);
  const [round, setRound] = useState<RoundDetail | null>(null);
  const act = useAction();
  const view = run.data;

  // Show the in-progress round if any, otherwise the most recent completed round.
  useEffect(() => {
    if (!view) return;
    const id = view.inProgressRoundId ?? view.rounds[view.rounds.length - 1]?.id;
    if (id && round?.round.id !== id) api.getRound(id).then(setRound).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.inProgressRoundId, view?.rounds.length]);

  if (run.loading && !view) return <Loading what="Loading run" />;
  if (!view) return <ErrorBox error={run.error ?? 'Run not found'} onRetry={run.reload} />;

  const setView = (v: RunView) => run.setData(v);
  const begin = async () => {
    const d = await act.run(() => api.startRound(runId));
    if (d) {
      setRound(d);
      await run.reload();
      document.getElementById('round-view')?.scrollIntoView({ behavior: 'smooth' });
    }
  };
  const choose = async (mode: AttackMode, repeat: boolean) => {
    if (!round) return;
    const d = await act.run(() => api.choose(round.round.id, mode, repeat));
    if (d) {
      setRound(d);
      if (d.round.status === 'completed') await run.reload();
    }
  };
  const end = async () => {
    if (!confirm('End this run now? You cannot play more rounds in it.')) return;
    const v = await act.run(() => api.endRun(runId));
    if (v) setView(v);
  };
  const viewRound = async (id: number) => {
    const d = await act.run(() => api.getRound(id));
    if (d) setRound(d);
  };

  const active = view.run.status === 'active';
  const inProgress = view.inProgressRoundId !== null;
  const nextRound = view.rounds.length + 1;
  // Runs from an older engine (e.g. before Version 2) are view-only; the server refuses to continue them.
  const legacy = !!catalog && view.run.engine_version !== catalog.rules.engineVersion;
  const readOnly = view.run.source === 'simulation' || legacy;
  // Engine 1.1.0: initial stat points must be spent before round 1 (the server enforces this too).
  const mustAllocateInitial = view.rounds.length === 0 && view.player.statPoints > 0;
  const bossNote = view.rounds.length === 0 && view.boss.statPoints > 0
    ? `The boss spends its ${view.boss.statPoints} initial stat points when round 1 begins (shown in its round-1 decision).`
    : undefined;

  return (
    <div className="duel">
      <div className="duel-bar">
        <h2>Run #{view.run.id} {view.run.source === 'simulation' && <span className="pill">simulation · {view.run.player_strategy}</span>}{legacy && <span className="pill">engine {view.run.engine_version} · view only</span>}</h2>
        <span>Round {Math.min(view.rounds.length, view.run.max_rounds)} / {view.run.max_rounds} · You {view.record.wins} – {view.record.losses} Boss</span>
        <span className={`pill ${active ? 'ok' : ''}`}>{view.run.status}{view.run.end_reason ? ` (${view.run.end_reason.replace(/_/g, ' ')})` : ''}</span>
        {active && !inProgress && (!readOnly || legacy) && <button className="btn ghost small" onClick={end} disabled={act.busy}>End run</button>}
      </div>
      <ErrorBox error={act.error} />
      {legacy && (
        <p className="warn-text small">This run was created under older rules (engine {view.run.engine_version}). You can review it, but it cannot be continued under the current rules (engine {catalog?.rules.engineVersion}). Start a new run to play Version 2.</p>
      )}
      <div className="fighters">
        <FighterCard c={view.player} title={view.run.source === 'simulation' ? `Agent (${view.run.player_strategy})` : 'You'} />
        <FighterCard c={view.boss} title="The Boss" note={bossNote} />
      </div>

      {round && <RoundView detail={round} onChoose={!readOnly ? choose : undefined} busy={act.busy} />}

      {active && !inProgress && !readOnly && (
        <>
          <PrepPanel view={view} onChange={setView} />
          <div className="begin">
            <button className="btn primary big" disabled={act.busy || mustAllocateInitial} onClick={begin}>
              {act.busy ? 'The boss is preparing…' : `⚔ Begin round ${nextRound}`}
            </button>
            {mustAllocateInitial && <p className="warn-text small">Spend your {view.player.statPoints} initial stat point(s) above before round 1.</p>}
            <p className="muted small">The boss reviews its history and prepares first — it only sees your last observed build, not the changes you just made.</p>
          </div>
        </>
      )}
      {!active && !readOnly && (
        <Empty>This run is over. <button className="link" onClick={() => go('#/duel')}>Start a new run</button></Empty>
      )}

      <section className="card">
        <h3>Round history</h3>
        {!view.rounds.length ? <Empty>No rounds played yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Round</th><th>Result</th><th>Your HP</th><th>Boss HP</th><th>Attacks</th><th></th></tr></thead>
            <tbody>
              {view.rounds.map((r) => (
                <tr key={r.id} className={round?.round.id === r.id ? 'hl' : ''}>
                  <td>{r.round_number}</td>
                  <td>{r.status !== 'completed' ? r.status : r.winner === 'player' ? 'Victory' : 'Defeat'}</td>
                  <td>{r.player_hp_end === null ? '—' : Math.max(0, r.player_hp_end).toFixed(1)}</td>
                  <td>{r.boss_hp_end === null ? '—' : Math.max(0, r.boss_hp_end).toFixed(1)}</td>
                  <td>{r.attack_count}</td>
                  <td><button className="link" onClick={() => viewRound(r.id)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
