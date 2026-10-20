/**
 * V4 Learning Boss setup: create or continue this browser's learning profile, see what the boss has recorded about
 * you (only evidence-backed lines from the server), start or resume a run, or start fresh. There are no accounts:
 * the profile key lives in this browser, and the page says so.
 */
import { useEffect, useState } from 'react';
import { api, getProfileKey, setProfileKey, type ProfileSummary } from '../api';
import { Icon } from '../ui/Icon';
import { Empty, ErrorBox, Skeleton, useConfirm } from '../ui/states';
import { useAction, useCatalog, useLoad } from '../util';

export function LearnedPanel({ summary }: { summary: ProfileSummary }) {
  return (
    <section className="learned stock" aria-labelledby="learned-h">
      <header className="panel-head"><h3 id="learned-h">What the boss has learned</h3><span className="panel-meta"><b>{summary.observations}</b> round{summary.observations === 1 ? '' : 's'} observed</span></header>
      {summary.observations === 0
        ? <p className="muted">Nothing yet. The boss knows the rules and prices, but nothing about you. It records what you bring to each round you finish.</p>
        : summary.insights.length
          ? <ul className="learned-list">{summary.insights.map((i) => <li key={i.text}>{i.text}</li>)}</ul>
          : <p className="muted">No clear pattern yet. A habit is shown once it is seen in at least 3 rounds and most of them.</p>}
    </section>
  );
}

export function LearningView({ go }: { go: (hash: string) => void }) {
  const catalog = useCatalog();
  const [hasKey, setHasKey] = useState(() => !!getProfileKey());
  const [name, setName] = useState('');
  const act = useAction();
  const { ask, dialog } = useConfirm();
  const summary = useLoad(async () => (hasKey ? api.profile() : null), [hasKey]);
  const [maxRounds, setMaxRounds] = useState(10);

  const create = async () => {
    const p = await act.run(() => api.createProfile(name.trim() || undefined));
    if (p) { setProfileKey(p.key); setHasKey(true); }
  };
  const fresh = async () => {
    const ok = await ask('Start a fresh learning campaign?', 'The boss forgets you: a new, empty profile starts. The old profile and its runs are kept as history but can no longer be continued from this browser.', 'Start fresh');
    if (!ok) return;
    const p = await act.run(() => api.freshProfile());
    if (p) { setProfileKey(p.key); summary.reload(); }
  };
  const start = async () => {
    const v = await act.run(() => api.createRun(maxRounds, 'learning'));
    if (v) go(`#/duel/${v.run.id}`);
  };
  // A key this server does not know (e.g. a different database): forget it and offer a new profile.
  useEffect(() => {
    if (summary.error && /not found/i.test(summary.error.message)) { setProfileKey(null); setHasKey(false); }
  }, [summary.error]);

  const s = summary.data;
  const active = s?.runs.filter((r) => r.status === 'active') ?? [];
  return (
    <div className="start">
      {dialog}
      <section className="start-hero">
        <h1>Learning Boss</h1>
        <p className="start-lede">This boss starts knowing only the rules: prices, legal builds and how combat works. It learns how <i>you</i> prepare from the rounds you finish, and plans against what you are likely to bring next.</p>
        {!hasKey && (
          <div className="start-form">
            <label className="field-inline">Your name <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Challenger" /></label>
            <button className="btn btn-primary btn-big" disabled={act.busy} onClick={create}>Create my profile <Icon name="arrow" /></button>
          </div>
        )}
        {hasKey && s && (
          <div className="start-form">
            <button className="btn btn-primary btn-big" disabled={act.busy || !catalog} onClick={start}>{active.length ? 'Start another run' : 'Start a run'} <Icon name="arrow" /></button>
            <details className="start-more">
              <summary>More options</summary>
              <label>Rounds in this run <input type="number" min={1} max={100} value={maxRounds} onChange={(e) => setMaxRounds(Number(e.target.value))} /></label>
              <button className="btn btn-quiet btn-small" onClick={fresh} disabled={act.busy}>Start a fresh learning campaign</button>
            </details>
          </div>
        )}
        <p className="muted">Your profile lives in this browser, because there are no accounts. Another browser or a cleared browser starts a new, separate profile.</p>
        <ErrorBox error={act.error} />
      </section>
      <div className="learning-side">
        {hasKey && summary.loading && !s && <Skeleton lines={4} />}
        {s && <LearnedPanel summary={s} />}
        {s && (
          <section className="resume stock" aria-labelledby="lresume-h">
            <header className="panel-head"><h3 id="lresume-h">{s.profile.name}’s runs</h3></header>
            {!s.runs.length ? <Empty title="No runs yet">Start one to begin teaching the boss.</Empty> : (
              <ul className="resume-list">
                {s.runs.map((r) => (
                  <li key={r.id}><a href={`#/duel/${r.id}`}><b>Run #{r.id}</b><span>{r.status}</span><span className="resume-score"><b className="tone-player">{r.player_wins}</b> – <b className="tone-boss">{r.boss_wins}</b></span><Icon name="arrow" size={16} /></a></li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
