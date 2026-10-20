/**
 * V4 PvP Arena (local, two players on one device). Setup: names and number of rounds. Match: each round, both players
 * prepare in turn behind a hand-over screen (the other player's build stays hidden until the fight), then fight on the
 * shared stage, where the name of the player who must decide is always shown. Every action goes to the server,
 * which validates it and resolves the combat; the AI boss is never involved.
 */
import { useEffect, useState } from 'react';
import { api, type PlayerAnswer, type RoundDetail, type Side } from '../api';
import { Armory } from '../duel/Armory';
import { Fight } from '../duel/Fight';
import { Icon } from '../ui/Icon';
import { Empty, ErrorBox, Skeleton } from '../ui/states';
import { useAction, useLoad } from '../util';

export function PvpSetup({ go }: { go: (hash: string) => void }) {
  const [names, setNames] = useState<[string, string]>(['', '']);
  const [rounds, setRounds] = useState(5);
  const act = useAction();
  const start = async () => {
    const n: [string, string] = [names[0].trim() || 'Player 1', names[1].trim() || 'Player 2'];
    const v = await act.run(() => api.createRun(rounds, 'pvp', n));
    if (v) go(`#/pvp/${v.run.id}`);
  };
  const recent = useLoad(() => api.listRuns(undefined, 0, 'pvp'), []);
  return (
    <div className="start">
      <section className="start-hero">
        <h1>PvP Arena</h1>
        <p className="start-lede">Two players, one device. Before each round you both prepare in turn while the other looks away. Then you fight, each answering the attacks aimed at you. The same rules apply to both, and there is no AI.</p>
        <div className="pvp-names">
          <label className="field-inline">Player 1 <input value={names[0]} maxLength={40} placeholder="Player 1" onChange={(e) => setNames([e.target.value, names[1]])} /></label>
          <label className="field-inline">Player 2 <input value={names[1]} maxLength={40} placeholder="Player 2" onChange={(e) => setNames([names[0], e.target.value])} /></label>
          <label className="field-inline">Rounds <input type="number" min={1} max={100} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} /></label>
        </div>
        <div className="start-form"><button className="btn btn-primary btn-big" disabled={act.busy} onClick={start}>Start the match <Icon name="arrow" /></button></div>
        <ErrorBox error={act.error} />
      </section>
      <section className="resume stock" aria-labelledby="presume-h">
        <header className="panel-head"><h3 id="presume-h">Matches in progress</h3></header>
        {recent.loading && !recent.data && <Skeleton lines={2} />}
        {recent.data && !recent.data.runs.filter((r) => r.status === 'active').length && <Empty title="None">Start one above.</Empty>}
        <ul className="resume-list">
          {(recent.data?.runs ?? []).filter((r) => r.status === 'active').map((r) => (
            <li key={r.id}><a href={`#/pvp/${r.id}`}><b>Match #{r.id}</b><span>{(r as any).names?.join(' vs ') ?? ''}</span><span className="resume-score"><b className="tone-player">{r.player_wins}</b> – <b className="tone-boss">{r.boss_wins}</b></span><Icon name="arrow" size={16} /></a></li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type Step = { kind: 'handoff'; side: Side } | { kind: 'prepare'; side: Side };

export function PvpMatch({ runId, go }: { runId: number; go: (hash: string) => void }) {
  const run = useLoad(() => api.getRun(runId), [runId]);
  const [round, setRound] = useState<RoundDetail | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'handoff', side: 'player' });
  const [showResult, setShowResult] = useState(false);
  const act = useAction();
  const view = run.data;

  useEffect(() => {
    if (!view) return;
    const id = view.inProgressRoundId;
    if (id && round?.round.id !== id) api.getRound(id).then(setRound).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.inProgressRoundId]);

  if (run.loading && !view) return <div className="run-loading"><Skeleton lines={6} label="Loading match" /></div>;
  if (!view) return <ErrorBox error={run.error ?? 'Match not found'} onRetry={run.reload} />;
  if (view.run.mode !== 'pvp') return <Empty title="This is not a PvP match"><a className="btn btn-primary" href={`#/duel/${runId}`}>Open it</a></Empty>;

  const names = { player: view.run.config?.names?.[0] ?? 'Player 1', boss: view.run.config?.names?.[1] ?? 'Player 2' };
  const active = view.run.status === 'active';
  const inFight = !!view.inProgressRoundId || showResult;
  const nextRound = view.rounds.length + 1;
  const me = (s: Side) => (s === 'player' ? view.player : view.boss);
  const mustAllocate = (s: Side) => view.rounds.length === 0 && me(s).statPoints > 0;

  const begin = async () => {
    const d = await act.run(() => api.startRound(runId));
    if (d) { setRound(d); setShowResult(false); await run.reload(); window.scrollTo({ top: 0 }); }
  };
  const choose = async (a: PlayerAnswer) => {
    if (!round?.round.pending_choice) return;
    const d = await act.run(() => api.answer(round.round.id, a, round.round.pending_choice!.side));
    if (d) {
      setRound(d);
      if (d.round.status === 'completed') { setShowResult(true); await run.reload(); }
    }
  };
  const afterRound = () => { setShowResult(false); setRound(null); setStep({ kind: 'handoff', side: 'player' }); };

  const pending = round?.round.pending_choice;
  return (
    <div className="run pvp">
      <div className="run-bar">
        <h2>Round <span className="num">{Math.min(nextRound - (inFight && !showResult ? 1 : 0) || 1, view.run.max_rounds)}</span> <small>of {view.run.max_rounds}</small></h2>
        <span className="run-record"><span>{names.player}</span><b className="tone-player">{view.record.wins}</b><span>–</span><b className="tone-boss">{view.record.losses}</b><span>{names.boss}</span></span>
        <span className="run-meta">Local match #{view.run.id}</span>
      </div>
      <ErrorBox error={act.error} />

      {!active && !showResult && (
        <section className="handoff">
          <h2>{view.record.wins === view.record.losses ? 'A draw' : `${view.record.wins > view.record.losses ? names.player : names.boss} wins the match`}</h2>
          <p className="muted">{names.player} {view.record.wins} – {view.record.losses} {names.boss} over {view.rounds.length} round{view.rounds.length === 1 ? '' : 's'}.</p>
          <div className="pick-actions"><button className="btn btn-primary" onClick={() => go('#/pvp')}>New match</button><button className="btn btn-quiet" onClick={() => go('#/')}>Main menu</button></div>
        </section>
      )}

      {inFight && round && (
        <>
          {pending && <p className={`turn-owner tone-${pending.side === 'player' ? 'player' : 'boss'}`} aria-live="polite"><b>{names[pending.side]}</b> decides now</p>}
          <Fight detail={round} onChoose={choose} busy={act.busy} names={names}
            next={round.round.status === 'completed' ? (active ? { label: `Prepare round ${nextRound}`, onClick: afterRound } : { label: 'See the match result', onClick: afterRound }) : undefined} />
        </>
      )}

      {active && !inFight && step.kind === 'handoff' && (
        <section className="handoff">
          <h2>Pass the device to {names[step.side]}</h2>
          <p className="muted">{names[step.side === 'player' ? 'boss' : 'player']}, look away: {names[step.side]} prepares round {nextRound} in secret.</p>
          <button className="btn btn-primary btn-big" onClick={() => setStep({ kind: 'prepare', side: step.side })}>I am {names[step.side]} <Icon name="arrow" /></button>
        </section>
      )}
      {active && !inFight && step.kind === 'prepare' && (
        <>
          <p className={`turn-owner tone-${step.side === 'player' ? 'player' : 'boss'}`}><b>{names[step.side]}</b> prepares</p>
          <Armory view={view} onChange={(v) => run.setData(v)} side={step.side} pvp
            begin={{
              label: step.side === 'player' ? `Done. Hand over to ${names.boss}` : act.busy ? 'Starting…' : `Start round ${nextRound}`,
              onClick: step.side === 'player' ? () => setStep({ kind: 'handoff', side: 'boss' }) : begin,
              disabled: act.busy || mustAllocate(step.side),
              hint: mustAllocate(step.side) ? `Spend your ${me(step.side).statPoints} starting points first.` : step.side === 'player' ? 'Your build stays hidden from your opponent.' : 'Both builds are revealed when the fight starts.',
            }} />
        </>
      )}
    </div>
  );
}
