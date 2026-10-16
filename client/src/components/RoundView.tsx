/**
 * Everything about one round: initiative, the boss's pre-round decision, the auditable combat log
 * (click an attack to see every formula input and random roll), the result + rewards, and the boss's
 * post-round analysis. Also renders the Ranged/Melee choice prompt while the round is paused.
 */
import { useState } from 'react';
import type { AttackMode, CombatEvent, Decision, RoundDetail, Analysis, Side } from '../api';
import { Bar, cap, itemName, loadoutText, n2, pct, sideName, useCatalog } from '../util';

export function RoundView({ detail, onChoose, busy }: {
  detail: RoundDetail; onChoose?: (mode: AttackMode, repeat: boolean) => void; busy?: boolean;
}) {
  const r = detail.round;
  const catalog = useCatalog();
  const hp = r.hp ?? { player: r.player_hp_end ?? 0, boss: r.boss_hp_end ?? 0 };
  const done = r.status === 'completed';
  return (
    <div className="round-view" id="round-view">
      <section className="card">
        <header className="round-head">
          <h2>Round {r.round_number}</h2>
          {done
            ? <span className={`pill big ${r.winner === 'player' ? 'ok' : 'bad'}`}>{r.winner === 'player' ? 'Victory' : 'Defeat'}</span>
            : <span className="pill big warn">In progress</span>}
        </header>
        <div className="hp-duel">
          <div><label>You {n2(Math.max(0, hp.player))} / {r.player_snapshot.derived.maxHp}</label><Bar value={hp.player} max={r.player_snapshot.derived.maxHp} kind="hp" /></div>
          <div><label>Boss {n2(Math.max(0, hp.boss))} / {r.boss_snapshot.derived.maxHp}</label><Bar value={hp.boss} max={r.boss_snapshot.derived.maxHp} kind="boss" /></div>
        </div>
        <div className="two-col small">
          <p><b>You:</b> {loadoutText(catalog, r.player_snapshot.loadout)} · ATK {n2(r.player_snapshot.derived.netAtk)} · DEF {n2(r.player_snapshot.derived.netDef)} · DEX {n2(r.player_snapshot.derived.effDex)}</p>
          <p><b>Boss:</b> {loadoutText(catalog, r.boss_snapshot.loadout)} · ATK {n2(r.boss_snapshot.derived.netAtk)} · DEF {n2(r.boss_snapshot.derived.netDef)} · DEX {n2(r.boss_snapshot.derived.effDex)}</p>
        </div>
        <InitiativeLine detail={detail} />
        {r.pending_choice && onChoose && <ChoicePrompt options={r.pending_choice.options} turn={r.pending_choice.turn} phase={r.pending_choice.phase} onChoose={onChoose} busy={busy} />}
      </section>

      {done && <Rewards detail={detail} />}

      <section className="card">
        <h3>Combat log <span className="muted">({detail.events.length} attacks — click a line for the full calculation)</span></h3>
        <CombatLog events={detail.events} />
      </section>

      {detail.analysis && <AnalysisPanel a={detail.analysis} />}
      {detail.decision && <DecisionPanel d={detail.decision} />}
      <p className="muted small">Round seed {r.seed} · engine {r.engine_version} — the seed plus the stored snapshots reproduce this fight.</p>
    </div>
  );
}

function InitiativeLine({ detail }: { detail: RoundDetail }) {
  const i = detail.round.initiative;
  return (
    <ul className="initiative small">
      <li><b>Opening shot:</b> {openingText(i)}</li>
      <li><b>Turn order:</b> {i.turnOrder.map(sideName).join(' → ')} {i.dexTie ? `(DEX tie → seeded coin flip ${n2(i.tieBreakRoll)} → ${sideName(i.tieWinner)})` : '(higher effective DEX first)'}</li>
      <li><b>DEX bonus attacks per turn:</b> you +{i.bonusAttacks.player}, boss +{i.bonusAttacks.boss} (advantage ≥15 → +1, ≥30 → +2)</li>
    </ul>
  );
}

function openingText(i: RoundDetail['round']['initiative']): string {
  const who = i.openingOrder.map(sideName).join(' → ');
  switch (i.openingRule) {
    case 'none': return 'none (no ranged weapons)';
    case 'single': return `${who} (the only fighter with a ranged weapon)`;
    case 'dex_advantage': return `${who} only — both held ranged weapons; higher effective DEX takes the shot`;
    case 'tie_none': return 'none — both held ranged weapons with equal effective DEX, so neither has the advantage';
    default: // rounds from engines before 2.0.0: every ranged holder shot
      return i.openingOrder.length ? `${who} (older rules: every ranged holder shot)` : 'none (no ranged weapons)';
  }
}

function ChoicePrompt({ options, turn, phase, onChoose, busy }: {
  options: AttackMode[]; turn: number; phase: string; onChoose: (m: AttackMode, repeat: boolean) => void; busy?: boolean;
}) {
  const [repeat, setRepeat] = useState(false);
  return (
    <div className="choice">
      <p><b>Your move</b> — turn {turn}, {phase === 'dex_bonus' ? 'DEX bonus attack' : 'regular attack'}. Ranged uses effective DEX; melee uses Net ATK. Either can pierce if the weapon has a pierce chance.</p>
      <div className="choice-buttons">
        {options.map((m) => <button key={m} className="btn primary" disabled={busy} onClick={() => onChoose(m, repeat)}>{m === 'ranged' ? '🏹 Ranged' : m === 'melee' ? '⚔ Melee' : cap(m)}</button>)}
        <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> use for the rest of this round</label>
      </div>
    </div>
  );
}

function CombatLog({ events }: { events: CombatEvent[] }) {
  const catalog = useCatalog();
  const [open, setOpen] = useState<number | null>(null);
  if (!events.length) return <p className="muted">No attacks yet.</p>;
  return (
    <ol className="log">
      {events.map((e) => {
        const c = e.calc;
        const weapon = e.weaponId ? itemName(catalog, e.weaponId) : 'fists';
        return (
          <li key={e.seq} className={`log-${e.attacker} ${open === e.seq ? 'open' : ''}`}>
            <button className="log-line" onClick={() => setOpen(open === e.seq ? null : e.seq)}>
              <span className="log-turn">{e.phase === 'opening' ? 'Open' : `T${e.turn}`}</span>
              <span>
                <b>{sideName(e.attacker)}</b> {e.mode === 'ranged' ? 'shoot' : 'strike'}{e.attacker === 'boss' ? 's' : ''} with {weapon} ({e.mode})
                {e.phase === 'dex_bonus' && <span className="tag">DEX bonus</span>}
                {e.phase === 'opening' && <span className="tag">opening shot</span>}
                {c.pierce?.success && <span className="tag pierce">PIERCE −{Math.round(c.pierce.defIgnore * 100)}% DEF</span>}
                {' '}for <b>{n2(e.damage)}</b> → {sideName(e.defender)} HP {n2(e.defenderHpBefore)} → {n2(Math.max(0, e.defenderHpAfter))}
                {e.defenderHpAfter <= 0 && <span className="tag ko">KO</span>}
              </span>
            </button>
            {open === e.seq && (
              <div className="calc">
                <div>Attack value = {c.attackValueSource === 'effDex' ? 'effective DEX' : 'Net ATK'} = <b>{n2(c.attackValue)}</b></div>
                <div>Defender Net DEF = {n2(c.defenderNetDef)}{c.pierce ? `; pierce roll ${n2(c.pierce.roll)} vs chance ${c.pierce.chance} → ${c.pierce.success ? `pierced, ignore ${Math.round(c.pierce.defIgnore * 100)}%${c.pierce.extraDamage !== undefined ? ` (+${n2(c.pierce.extraDamage)} damage)` : ''}` : 'no pierce'}${c.pierce.placeholder ? ' (placeholder values)' : ''}` : ''} → DEF used <b>{n2(c.defUsed)}</b></div>
                <div>Net damage = ATK × ATK / (ATK + DEF) = {n2(c.attackValue)} × {n2(c.attackValue)} / ({n2(c.attackValue)} + {n2(c.defUsed)}) = <b>{n2(c.netDamage)}</b></div>
                <div>DEX ratio = defender DEX / attacker DEX = {n2(c.defenderDex)} / {n2(c.attackerDex)} = {n2(c.dexRatio)}</div>
                <div>Mitigation = max(0, roll {n2(c.mitigationRoll)} × (1 − 1/{n2(c.dexRatio)})) = {n2(c.rawMitigation)}{c.mitigationClamped ? ' → clamped to 0 (no DEX advantage)' : ''} → <b>{pct(c.mitigation, 1)}</b></div>
                <div>Final damage = {n2(c.netDamage)} × (1 − {n2(c.mitigation)}) = <b>{n2(c.finalDamage)}</b></div>
                <div className="muted">Choice: {e.choiceSource}{e.choiceReason ? ` — ${e.choiceReason}` : ''}</div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Rewards({ detail }: { detail: RoundDetail }) {
  const rows = detail.progression.filter((p) => p.actor === 'rules');
  const bySide = (s: Side) => rows.filter((p) => p.side === s);
  const text = (p: { kind: string; payload: any }) => {
    if (p.kind === 'xp') return `+${p.payload.amount} XP (${p.payload.reason})`;
    if (p.kind === 'gold') return `+${p.payload.amount} gold (${p.payload.reason.replace('_', '-')})`;
    if (p.kind === 'level_up') return `LEVEL UP ${p.payload.fromLevel} → ${p.payload.toLevel}: HP+${p.payload.statIncrease.hp} STR+${p.payload.statIncrease.str} DEF+${p.payload.statIncrease.def} DEX+${p.payload.statIncrease.dex}, +${p.payload.statPointsGained} stat point`;
    return p.kind;
  };
  return (
    <section className="card">
      <h3>Rewards</h3>
      <div className="two-col">
        {(['player', 'boss'] as Side[]).map((s) => (
          <div key={s}>
            <h4>{sideName(s)}</h4>
            <ul>{bySide(s).map((p) => <li key={p.id} className={p.kind === 'level_up' ? 'hl' : ''}>{text(p)}</li>)}</ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function AnalysisPanel({ a }: { a: Analysis }) {
  return (
    <section className="card boss-mind">
      <h3>🧠 Boss post-round analysis</h3>
      <p className="small">Outcome: <b>{a.outcome === 'boss_won' ? 'boss won' : 'boss lost'}</b> · Damage taken {n2(a.damageTaken.total)} (ranged {n2(a.damageTaken.byMode.ranged)}, melee {n2(a.damageTaken.byMode.melee)}, unarmed {n2(a.damageTaken.byMode.unarmed)}; {a.damageTaken.pierces} pierces) · Damage dealt {n2(a.damageDealt.total)} ({n2(a.damageDealt.perAttack)}/attack) · DEX you {n2(a.initiative.playerEffDex)} vs boss {n2(a.initiative.bossEffDex)}</p>
      <p className="small">Observed player: {a.playerProfile.loadout.join(' + ') || 'unarmed'}; ranged share of attacks {pct(a.playerProfile.rangedShare)}</p>
      {a.weaknesses.length ? (
        <ul className="weak">
          {a.weaknesses.map((w) => <li key={w.code}><span className="tag">{w.code.replace(/_/g, ' ')}</span> <span className="muted">severity {n2(w.severity)}</span><br />{w.evidence}</li>)}
        </ul>
      ) : <p className="muted">No clear weakness exposed this round.</p>}
    </section>
  );
}

const signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;

/** Honest statement of where the boss's read of your style came from (V2_DEMANDS D-P0-2). */
function PredictionLine({ p }: { p: Decision['predictor'] }) {
  const basis = p.basis ?? (p.kind === 'model' ? 'model' : 'legacy');
  return (
    <>
      <p>
        {basis === 'model' && <><span className="pill ok">Trained ML model {p.modelVersion}</span> predicted P(you mostly ranged) = <b>{pct(p.probabilityRanged)}</b> <span className="muted">(baseline would say {pct(p.baselineProbability)})</span></>}
        {basis === 'baseline' && <><span className="pill warn">Transparent baseline (fallback)</span> predicted P(you mostly ranged) = <b>{pct(p.probabilityRanged)}</b></>}
        {basis === 'rule' && <><span className="pill">Rule</span> You can&apos;t field a ranged weapon next round, so the boss only prepares against melee.</>}
        {basis === 'unknown' && <><span className="pill">No evidence yet</span> The boss has not seen your style, so it weighs every style you could use equally.</>}
        {basis === 'legacy' && <><span className="pill warn">Transparent baseline (fallback)</span> P(you mostly ranged) = <b>{pct(p.probabilityRanged)}</b> <span className="muted">(older record: a round-1 50% here was a placeholder, not an estimate)</span></>}
      </p>
      {p.fallbackReason && basis !== 'model' && <p className="muted small">{basis === 'rule' ? 'Why' : 'Why fallback'}: {p.fallbackReason}</p>}
    </>
  );
}

export function DecisionPanel({ d }: { d: Decision }) {
  const catalog = useCatalog();
  const p = d.predictor;
  const plan = d.selected.plan;
  const v2 = d.selected.policyVersion === 'v2-diverse';
  const band = d.selected.band ?? [];
  return (
    <section className="card boss-mind">
      <h3>♟ Boss pre-round decision (before round {d.for_round_number})</h3>
      {d.for_round_number === 1 && <p className="small">Includes the boss's <b>initial stat allocation</b>: {d.evidence.constraints.statPointsAvailable} point(s) available.</p>}
      <PredictionLine p={p} />
      {v2 && plan.archetype && (
        <p className="small">Build style: <span className="tag">{plan.archetype}</span>
          {band.length > 1 ? ` chosen from ${band.length} equally strong plans (${[...new Set(band.map((b) => b.archetype))].join(', ')}) by a seeded draw.` : ' — the clear best plan.'}
        </p>
      )}
      <ul className="small">{d.selected.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
      <p className="small"><b>Actions:</b> {d.actions.length ? d.actions.map((a, i) => (
        <span key={i} className="tag">{a.kind === 'stat_allocation' ? `+${a.detail.points} ${a.detail.stat.toUpperCase()}` : a.kind === 'purchase' ? `buy ${itemName(catalog, a.detail.itemId)} (${a.detail.cost}g)` : `equip ${loadoutText(catalog, a.detail.loadout)}`}</span>
      )) : 'none (kept current build)'} · gold spent {d.gold_spent} of {d.evidence.constraints.goldAvailable}</p>
      {d.evidence.weaknesses.length > 0 && (
        <>
          <h4>Evidence → response</h4>
          <ul className="small">{d.evidence.weaknesses.map((w) => <li key={w.code}><span className="tag">{w.code.replace(/_/g, ' ')}</span> {w.addressed ? `addressed by ${w.addressedBy.join(', ')}` : 'not directly addressed by the chosen plan'}</li>)}</ul>
        </>
      )}
      <details>
        <summary className="small">Options considered ({d.options.candidatesEvaluated} legal plans; top plans verified by simulated fights)</summary>
        <table className="table small">
          <thead><tr><th>Plan</th>{v2 && <th>Style</th>}<th>Cost</th><th>Win vs ranged</th><th>Win vs melee</th><th>{v2 ? 'HP margin' : 'Weighted'}</th></tr></thead>
          <tbody>
            {[plan, ...d.options.alternatives, d.options.current].map((o, i) => (
              <tr key={i} className={i === 0 ? 'hl' : ''}>
                <td>{i === 0 ? '✔ ' : ''}{i === d.options.alternatives.length + 1 ? '(unchanged build) ' : ''}{o.label}</td>
                {v2 && <td>{o.archetype ?? '—'}</td>}
                <td>{o.cost}g</td><td>{pct(o.winRate?.ranged)}</td><td>{pct(o.winRate?.melee)}</td>
                <td>{v2 ? signed(o.weighted) : pct(o.weighted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{v2 ? 'Ways you could prepare that the boss considered (from your last observed state):' : 'Scenarios built from your last observed build:'}{' '}
          {d.evidence.scenarios.map((s) => `${s.label ?? s.kind}${s.weight !== undefined ? ` (${pct(s.weight)})` : ''}${s.hypotheticalItems.length ? ` [assumes ${s.hypotheticalItems.map((id) => itemName(catalog, id)).join(', ')}]` : ''}`).join('; ')}.</p>
      </details>
    </section>
  );
}
