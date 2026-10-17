/**
 * The Duel. Without a run: start a new run or resume one. With a run: the Versus bar, then the round loop as three
 * phases — Prepare (Armory), Fight (the replay) and Aftermath (result, rewards, what the boss remembers) — with one
 * primary action per phase in the action bar.
 */
import { useEffect, useState } from 'react';
import { api, type AttackMode, type RoundDetail, type RunView } from '../api';
import { Aftermath } from '../duel/Aftermath';
import { Armory } from '../duel/Armory';
import { Fight } from '../duel/Fight';
import { Versus } from '../duel/Versus';
import { Icon } from '../ui/Icon';
import { Empty, ErrorBox, Skeleton, useConfirm, useToast } from '../ui/states';
import { useAction, useCatalog, useLoad } from '../util';

export function DuelView({ runId, go }: { runId: number | null; go: (hash: string) => void }) {
  return runId ? <RunScreen runId={runId} go={go} /> : <StartScreen go={go} />;
}

function StartScreen({ go }: { go: (hash: string) => void }) {
  const catalog = useCatalog();
  const [maxRounds, setMaxRounds] = useState(10);
  useEffect(() => { if (catalog) setMaxRounds(catalog.rules.defaultMaxRounds); }, [catalog]);
  const act = useAction();
  const runs = useLoad(() => api.listRuns('manual'), []);
  const start = async () => {
    const v = await act.run(() => api.createRun(maxRounds));
    if (v) go(`#/duel/${v.run.id}`);
  };
  const resumable = (runs.data?.runs ?? []).filter((r) => r.status === 'active' && (!catalog || r.engine_version === catalog.rules.engineVersion));
  const down = act.error?.kind === 'network' || runs.error?.kind === 'network';
  return (
    <div className="start">
      <section className="start-hero">
        <h1>The Boss Remembers</h1>
        <p>A duel over many rounds. You and the boss start from the same cards: level 1, no gold, no gear, two stat points each. Win or lose, both of you earn XP and gold, level up and re-arm. The boss studies every fight and adapts under exactly the same rules.</p>
        <div className="start-form">
          <label>Rounds in this run
            <input type="number" min={1} max={100} value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} />
          </label>
          <button className="btn btn-primary btn-big" disabled={act.busy || down} onClick={start}>Deal a new run <Icon name="arrow" /></button>
        </div>
        <ErrorBox error={act.error} />
      </section>
      <section className="resume stock" aria-labelledby="resume-h">
        <header className="panel-head"><h3 id="resume-h">Resume a run</h3></header>
        {runs.loading && !runs.data && <Skeleton lines={3} />}
        <ErrorBox error={runs.error} onRetry={runs.reload} />
        {runs.data && !resumable.length && <Empty title="No runs in progress">Deal a new run to start.</Empty>}
        {resumable.length > 0 && (
          <ul className="resume-list">
            {resumable.map((r) => (
              <li key={r.id}>
                <a href={`#/duel/${r.id}`}><b>Run #{r.id}</b><span>{r.rounds_completed}/{r.max_rounds} rounds</span><span className="resume-score"><b className="tone-player">{r.player_wins}</b> – <b className="tone-boss">{r.boss_wins}</b></span><Icon name="arrow" size={16} /></a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Phase = 'prepare' | 'fight' | 'aftermath';

function RunScreen({ runId, go }: { runId: number; go: (hash: string) => void }) {
  const catalog = useCatalog();
  const toast = useToast();
  const { ask, dialog } = useConfirm();
  const run = useLoad(() => api.getRun(runId), [runId]);
  const [round, setRound] = useState<RoundDetail | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [deal, setDeal] = useState(false);
  const act = useAction();
  const view = run.data;

  // Load the in-progress round, or the latest completed one; pick the phase the run is in.
  useEffect(() => {
    if (!view) return;
    const id = view.inProgressRoundId ?? view.rounds[view.rounds.length - 1]?.id;
    if (id && round?.round.id !== id) api.getRound(id).then(setRound).catch(() => undefined);
    if (phase === null) setPhase(view.inProgressRoundId ? 'fight' : view.run.status !== 'active' && view.rounds.length ? 'aftermath' : 'prepare');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.inProgressRoundId, view?.rounds.length]);

  if (run.loading && !view) return <div className="run-loading"><Skeleton lines={6} label="Loading run" /></div>;
  if (!view) return <ErrorBox error={run.error ?? 'Run not found'} onRetry={run.reload} />;

  const setView = (v: RunView) => run.setData(v);
  const simulated = view.run.source === 'simulation';
  const legacy = !!catalog && view.run.engine_version !== catalog.rules.engineVersion;
  const readOnly = simulated || legacy;
  const active = view.run.status === 'active';
  const inProgress = view.inProgressRoundId !== null;
  const nextRound = view.rounds.length + 1;
  const mustAllocate = view.rounds.length === 0 && view.player.statPoints > 0;
  const canPrepare = active && !inProgress && !readOnly;
  const current: Phase = phase ?? 'prepare';

  const begin = async () => {
    const d = await act.run(() => api.startRound(runId));
    if (d) {
      setRound(d);
      setDeal(true);
      setPhase('fight');
      await run.reload();
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
    if (!(await ask('End this run?', 'You will not be able to play more rounds in it. Its history stays in Runs.', 'End run'))) return;
    const v = await act.run(() => api.endRun(runId));
    if (v) { setView(v); toast('Run ended'); }
  };
  const viewRound = async (id: number) => {
    const d = await act.run(() => api.getRound(id));
    if (d) { setRound(d); setDeal(false); }
  };

  const tabs: { id: Phase; label: string; disabled: boolean }[] = [
    { id: 'prepare', label: 'Prepare', disabled: false },
    { id: 'fight', label: 'Fight', disabled: !round },
    { id: 'aftermath', label: 'Aftermath', disabled: !round },
  ];
  const bossNote = view.rounds.length === 0 && view.boss.statPoints > 0 ? `Spends its ${view.boss.statPoints} starting points when round 1 begins.` : undefined;

  // One primary action per phase.
  let primary: { label: string; onClick: () => void; disabled?: boolean; hint?: string } | null = null;
  if (canPrepare && current === 'prepare') primary = { label: act.busy ? 'The boss is preparing…' : `Begin round ${nextRound}`, onClick: begin, disabled: act.busy || mustAllocate, hint: mustAllocate ? `Spend your ${view.player.statPoints} starting point${view.player.statPoints > 1 ? 's' : ''} first.` : 'The boss prepares first; it only sees your last round’s build.' };
  else if (current === 'fight' && round?.round.status === 'completed') primary = { label: 'See what the boss learned', onClick: () => setPhase('aftermath') };
  else if (current === 'aftermath' && canPrepare) primary = { label: `Prepare round ${nextRound}`, onClick: () => setPhase('prepare') };

  return (
    <div className="run">
      {dialog}
      <div className="run-bar">
        <h2>Run #{view.run.id}</h2>
        <span className="run-meta">Round {Math.min(view.rounds.length + (canPrepare ? 1 : 0), view.run.max_rounds)} of {view.run.max_rounds}</span>
        <span className="run-record" aria-label={`Record: you ${view.record.wins}, boss ${view.record.losses}`}><b className="tone-player">{view.record.wins}</b>–<b className="tone-boss">{view.record.losses}</b></span>
        {simulated && <span className="chip chip-dark">simulation · {view.run.player_strategy}</span>}
        {legacy && <span className="chip chip-dark">engine {view.run.engine_version} · view only</span>}
        {!active && <span className="chip chip-dark">{view.run.status}{view.run.end_reason ? ` · ${view.run.end_reason.replace(/_/g, ' ')}` : ''}</span>}
        {active && !inProgress && (!simulated) && <button className="btn btn-ghost btn-small run-end" onClick={end} disabled={act.busy}>End run</button>}
      </div>
      {legacy && <p className="banner">This run was created under older rules (engine {view.run.engine_version}). You can review it, but it can’t continue under the current rules (engine {catalog?.rules.engineVersion}).</p>}
      <ErrorBox error={act.error} />

      <Versus player={view.player} boss={view.boss} record={view.record} playerTitle={simulated ? `Agent: ${view.run.player_strategy}` : 'You'} bossNote={bossNote} />

      <div className="phase-bar">
        <div className="phases" role="tablist" aria-label="Round phase">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={current === t.id} className={`phase ${current === t.id ? 'is-on' : ''}`} disabled={t.disabled} onClick={() => setPhase(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {primary && current === 'prepare' && (
          <button className="btn btn-primary phase-bar-action" onClick={primary.onClick} disabled={primary.disabled} title={primary.hint}>{primary.label} <Icon name="arrow" /></button>
        )}
        {view.rounds.length > 0 && current !== 'prepare' && (
          <label className="round-pick">Round
            <select value={round?.round.id ?? ''} onChange={(e) => viewRound(Number(e.target.value))}>
              {view.rounds.map((r) => <option key={r.id} value={r.id}>{r.round_number} · {r.status !== 'completed' ? r.status : r.winner === 'player' ? 'won' : 'lost'}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="phase-body" role="tabpanel">
        {current === 'prepare' && (canPrepare
          ? <Armory view={view} onChange={setView} begin={primary ?? undefined} onShowAftermath={round ? () => setPhase('aftermath') : undefined} />
          : <Empty title={inProgress ? 'A round is in progress' : readOnly ? 'This run is view-only' : 'This run is over'}>
              {inProgress ? <button className="btn btn-primary" onClick={() => setPhase('fight')}>Back to the fight</button>
                : !readOnly ? <button className="btn btn-primary" onClick={() => go('#/duel')}>Deal a new run</button> : null}
            </Empty>)}
        {current === 'fight' && round && <Fight detail={round} onChoose={!readOnly ? choose : undefined} busy={act.busy} deal={deal} next={primary ?? undefined} />}
        {current === 'aftermath' && round && <Aftermath detail={round} next={primary ?? undefined} />}
      </div>

      {primary && current === 'prepare' && (
        <div className="action-bar">
          {primary.hint && <p>{primary.hint}</p>}
          <button className="btn btn-primary btn-big" onClick={primary.onClick} disabled={primary.disabled}>{primary.label} <Icon name="arrow" /></button>
        </div>
      )}
    </div>
  );
}
