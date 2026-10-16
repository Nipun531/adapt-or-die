/**
 * AFTERMATH — the result and rewards, then "The Boss Remembers": what it saw in this round (evidence → weakness),
 * the hand it played before this round (the equally strong plans it drew from, the one it played face up, with the
 * draw probability), and an honest statement of where its read of your style came from.
 */
import type { Decision, ProgressionRow, RoundDetail, Side } from '../api';
import { Icon, SuitIcon } from '../ui/Icon';
import { itemName, loadoutText, n2, pct, signed, useCatalog } from '../util';

const METRIC_LABEL: Record<string, string> = { netAtk: 'Net ATK', netDef: 'Net DEF', effDex: 'Eff. DEX', maxHp: 'HP' };
const metricText = (s: string) => s.replace(/^(netAtk|netDef|effDex|maxHp)/, (m) => METRIC_LABEL[m] ?? m);

const WEAKNESS_LABEL: Record<string, string> = {
  ranged_pressure: 'Ranged pressure', pierce_exposure: 'Pierced', heavy_melee_pressure: 'Heavy melee',
  dex_deficit: 'Slower than you', low_defense: 'Low defense', low_damage_output: 'Low damage', outmatched: 'Outmatched', narrow_loss: 'Narrow loss',
};

function rewardText(p: ProgressionRow): string {
  if (p.kind === 'xp') return `+${p.payload.amount} XP`;
  if (p.kind === 'gold') return `+${p.payload.amount} gold${p.payload.reason === 'level_up' ? ' (level-up)' : ''}`;
  if (p.kind === 'level_up') return `Level ${p.payload.fromLevel} → ${p.payload.toLevel}, +${p.payload.statPointsGained} stat point`;
  return p.kind;
}

function Result({ detail }: { detail: RoundDetail }) {
  const r = detail.round;
  const won = r.winner === 'player';
  const rows = detail.progression.filter((p) => p.actor === 'rules');
  const side = (s: Side) => rows.filter((p) => p.side === s);
  const hpLeft = won ? r.player_hp_end : r.boss_hp_end;
  return (
    <section className={`result ${won ? 'is-win' : 'is-loss'}`} aria-live="polite">
      <div className="result-main">
        <h2>{won ? 'Victory' : 'Defeat'}</h2>
        <p>Round {r.round_number} · {won ? 'you' : 'the boss'} finished with {n2(Math.max(0, hpLeft ?? 0))} HP · {r.attack_count} attacks</p>
      </div>
      <div className="result-rewards">
        {(['player', 'boss'] as Side[]).map((s) => (
          <div key={s} className="reward-col">
            <h4>{s === 'player' ? 'You' : 'The Boss'}</h4>
            <ul>{side(s).map((p) => <li key={p.id} className={p.kind === 'level_up' ? 'is-levelup' : ''}>{p.kind === 'level_up' && <Icon name="crown" size={14} />}{rewardText(p)}</li>)}</ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Honest statement of where the boss's read of your style came from. */
export function PredictionLine({ p }: { p: Decision['predictor'] }) {
  const basis = p.basis ?? (p.kind === 'model' ? 'model' : 'legacy');
  return (
    <div className={`predict predict-${basis}`}>
      <span className="predict-badge">
        {basis === 'model' ? `Trained model ${p.modelVersion}` : basis === 'baseline' ? 'Transparent baseline' : basis === 'rule' ? 'Rule' : basis === 'unknown' ? 'No evidence yet' : 'Older record'}
      </span>
      <p>
        {basis === 'model' && <>Predicted you would fight mostly ranged: <b>{pct(p.probabilityRanged)}</b> (baseline: {pct(p.baselineProbability)}).</>}
        {basis === 'baseline' && <>Predicted you would fight mostly ranged: <b>{pct(p.probabilityRanged)}</b>.</>}
        {basis === 'rule' && <>You couldn’t field a ranged weapon, so it only prepared against melee.</>}
        {basis === 'unknown' && <>It hadn’t seen your style yet, so it weighed every style you could use equally.</>}
        {basis === 'legacy' && <>P(ranged) = {pct(p.probabilityRanged)} (a round-1 50% in older records was a placeholder, not an estimate).</>}
      </p>
      {p.fallbackReason && basis !== 'model' && <p className="predict-why">{p.fallbackReason}</p>}
    </div>
  );
}

/** The signature: the boss's hand — the equally strong plans fanned, the played one face up. */
export function BossHand({ d }: { d: Decision }) {
  const plan = d.selected.plan;
  const band = d.selected.band && d.selected.band.length ? d.selected.band : [{ label: plan.label, archetype: plan.archetype ?? 'bruiser', weighted: plan.weighted, cost: plan.cost, probability: 1 }];
  const playedIdx = Math.max(0, band.findIndex((b) => b.label === plan.label));
  const n = band.length;
  return (
    <figure className="boss-hand" aria-label={`The boss drew from ${n} equally strong plan${n > 1 ? 's' : ''} and played ${plan.archetype ?? 'its plan'}`}>
      <div className="fan" style={{ ['--n' as string]: n }}>
        {band.map((b, i) => (
          <div key={i} className={`fan-card ${i === playedIdx ? 'is-played' : ''}`} style={{ ['--i' as string]: i - (n - 1) / 2 }}>
            <span className="fan-index">{Math.round(b.probability * 100)}<small>%</small></span>
            <span className="fan-arch">{b.archetype}</span>
            <span className="fan-label">{b.label}</span>
            <span className="fan-margin">margin {signed(b.weighted)}</span>
          </div>
        ))}
      </div>
      <figcaption>
        {n > 1
          ? <>Drew from <b>{n}</b> equally strong plans and played the <b>{plan.archetype}</b> ({pct(band[playedIdx].probability)} chance). A seeded draw, never a weaker plan.</>
          : <>One plan was clearly best{plan.archetype ? <>: <b>{plan.archetype}</b></> : null}.</>}
      </figcaption>
    </figure>
  );
}

export function DecisionDetail({ d }: { d: Decision }) {
  const catalog = useCatalog();
  const plan = d.selected.plan;
  const v2 = d.selected.policyVersion === 'v2-diverse';
  return (
    <div className="decision">
      <PredictionLine p={d.predictor} />
      <p className="decision-actions">
        <b>It did:</b>{' '}
        {d.actions.length ? d.actions.map((a, i) => (
          <span key={i} className="tag tag-ink">{a.kind === 'stat_allocation' ? `+${a.detail.points} ${a.detail.stat.toUpperCase()}` : a.kind === 'purchase' ? `bought ${itemName(catalog, a.detail.itemId)} (${a.detail.cost}g)` : `equipped ${loadoutText(catalog, a.detail.loadout)}`}</span>
        )) : 'kept its build'}
        <span className="muted-ink"> · spent {d.gold_spent} of {d.evidence.constraints.goldAvailable} gold</span>
      </p>
      {d.evidence.weaknesses.length > 0 && (
        <ul className="answers">
          {d.evidence.weaknesses.map((w) => <li key={w.code}><span className="tag tag-red">{WEAKNESS_LABEL[w.code] ?? w.code}</span> {w.addressed ? `answered with ${w.addressedBy.map(metricText).join(', ')}` : 'not directly answered by this plan'}</li>)}
        </ul>
      )}
      <details className="more">
        <summary>How it decided ({d.options.candidatesEvaluated} legal plans; the best verified in simulated fights)</summary>
        <ul className="rationale">{d.selected.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Plan</th>{v2 && <th>Style</th>}<th>Cost</th><th>Win vs ranged</th><th>Win vs melee</th><th>{v2 ? 'HP margin' : 'Weighted'}</th></tr></thead>
            <tbody>
              {[plan, ...d.options.alternatives, d.options.current].map((o, i) => (
                <tr key={i} className={i === 0 ? 'is-current' : ''}>
                  <td>{i === 0 ? 'Played: ' : i === d.options.alternatives.length + 1 ? 'Unchanged build: ' : ''}{o.label}</td>
                  {v2 && <td>{o.archetype ?? '—'}</td>}
                  <td>{o.cost}g</td><td>{pct(o.winRate?.ranged)}</td><td>{pct(o.winRate?.melee)}</td>
                  <td>{v2 ? signed(o.weighted) : pct(o.weighted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted-ink">Ways you could prepare that it considered: {d.evidence.scenarios.map((s) => `${s.label ?? s.kind}${s.weight !== undefined ? ` (${pct(s.weight)})` : ''}`).join('; ')}.</p>
      </details>
    </div>
  );
}

export function Aftermath({ detail }: { detail: RoundDetail }) {
  const a = detail.analysis;
  const d = detail.decision;
  return (
    <div className="aftermath">
      {detail.round.status === 'completed' && <Result detail={detail} />}
      <section className="memory stock" aria-labelledby="memory-h">
        <header className="panel-head"><h3 id="memory-h">The Boss Remembers</h3><span className="panel-meta">round {detail.round.round_number}</span></header>
        <div className="memory-grid">
          <div className="memory-col">
            <h4>What it saw this round</h4>
            {a ? (
              <>
                <p className="memory-facts">
                  Took <b>{n2(a.damageTaken.total)}</b> damage ({n2(a.damageTaken.byMode.ranged ?? 0)} ranged, {n2((a.damageTaken.byMode.melee ?? 0) + (a.damageTaken.byMode.unarmed ?? 0))} melee{a.damageTaken.pierces ? `, ${a.damageTaken.pierces} pierces` : ''}) · dealt <b>{n2(a.damageDealt.total)}</b> · DEX you {n2(a.initiative.playerEffDex)} vs {n2(a.initiative.bossEffDex)}
                </p>
                {a.weaknesses.length ? (
                  <ul className="evidence">
                    {a.weaknesses.map((w) => (
                      <li key={w.code}>
                        <span className="evidence-head"><SuitIcon suit="diamond" size={12} /><b>{WEAKNESS_LABEL[w.code] ?? w.code}</b><span className="evidence-sev" aria-label={`severity ${n2(w.severity)}`}><span style={{ width: `${Math.min(1, w.severity) * 100}%` }} /></span></span>
                        <span>{w.evidence}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted-ink">No clear weakness exposed this round.</p>}
              </>
            ) : <p className="muted-ink">The analysis appears when the round ends.</p>}
            <p className="memory-next">It answers this when round {detail.round.round_number + 1} begins.</p>
          </div>
          <div className="memory-col">
            <h4>The hand it played before this round</h4>
            {d ? <><BossHand d={d} /><DecisionDetail d={d} /></> : <p className="muted-ink">No decision recorded.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
