/**
 * AFTERMATH — the result and rewards, then "The Boss Remembers": what it saw in this round (evidence → weakness),
 * the hand it played before this round (the equally strong plans it drew from, the one it played face up, with the
 * draw probability), and an honest statement of where its read of your style came from.
 */
import type { Decision, ProgressionRow, RoundDetail, Side } from '../api';
import { GlyphIcon, Icon } from '../ui/Icon';
import type { PhaseAction } from './actions';
import { itemName, loadoutText, n2, pct, signed, useCatalog } from '../util';

const METRIC_LABEL: Record<string, string> = { netAtk: 'Attack', netDef: 'Defence', effDex: 'Speed', maxHp: 'HP' };
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

function Result({ detail, next }: { detail: RoundDetail; next?: PhaseAction }) {
  const r = detail.round;
  const won = r.winner === 'player';
  const rows = detail.progression.filter((p) => p.actor === 'rules');
  const side = (s: Side) => rows.filter((p) => p.side === s);
  const hpLeft = won ? r.player_hp_end : r.boss_hp_end;
  return (
    <section className={`result ${won ? 'is-win' : 'is-loss'}`} aria-live="polite">
      <div className="result-main">
        <h2>{won ? 'Victory' : 'Defeat'}</h2>
        <p>Round {r.round_number} · {won ? 'you' : 'the boss'} finished with {Math.round(Math.max(0, hpLeft ?? 0))} HP · {r.attack_count} attacks</p>
        {next && <button className="btn btn-on-color" onClick={next.onClick} disabled={next.disabled}>{next.label} <Icon name="arrow" /></button>}
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

interface HandCard { label: string; archetype: string; weighted: number; probability: number | null; kind: 'played' | 'equal' | 'weaker' }

/**
 * The signature: the boss's hand. The equally strong plans it drew from stand face up with their draw chance;
 * the stronger-than-the-rest plan it played is lifted; the weaker verified plans it passed on are dealt dimmed, so
 * even a one-plan decision reads as a hand that was chosen from.
 */
export function BossHand({ d, compact = false, onMore }: { d: Decision; compact?: boolean; onMore?: () => void }) {
  const plan = d.selected.plan;
  const band = d.selected.band && d.selected.band.length ? d.selected.band : [{ label: plan.label, archetype: plan.archetype ?? 'bruiser', weighted: plan.weighted, cost: plan.cost, probability: 1 }];
  const equal: HandCard[] = band.map((b) => ({ ...b, kind: b.label === plan.label ? 'played' : 'equal' }));
  const inBand = new Set(band.map((b) => b.label));
  const weaker: HandCard[] = d.options.alternatives
    .filter((a) => !inBand.has(a.label))
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, Math.max(0, (compact ? 4 : 5) - equal.length))
    .map((a) => ({ label: a.label, archetype: a.archetype ?? '—', weighted: a.weighted, probability: null, kind: 'weaker' }));
  // Weaker plans to the sides, the played card in the middle.
  const left = weaker.filter((_, i) => i % 2 === 1).reverse();
  const right = weaker.filter((_, i) => i % 2 === 0);
  const cards = [...left, ...equal.filter((c) => c.kind === 'equal').slice(0, 1), equal.find((c) => c.kind === 'played')!, ...equal.filter((c) => c.kind === 'equal').slice(1), ...right];
  const n = cards.length;
  const nEqual = equal.length;
  const played = equal.find((c) => c.kind === 'played')!;
  return (
    <figure className={`boss-hand ${compact ? 'is-compact' : ''}`}
      aria-label={`The boss compared ${n} plans; ${nEqual} were equally strong and it played ${plan.archetype ?? 'its plan'}`}>
      <div className="fan" style={{ ['--n' as string]: n }}>
        {cards.map((c, i) => (
          <div key={`${c.label}-${i}`} className={`card-face fan-card is-${c.kind}`} style={{ ['--i' as string]: i - (n - 1) / 2 }}>
            <span className="fan-index">{c.probability !== null ? <>{Math.round(c.probability * 100)}<small>%</small></> : <small>passed</small>}</span>
            <span className="fan-arch">{c.archetype}</span>
            {!compact && <span className="fan-label">{c.label}</span>}
            <span className="fan-margin">margin {signed(c.weighted)}</span>
          </div>
        ))}
      </div>
      <figcaption>
        {nEqual > 1
          ? <>Drew from <b>{nEqual}</b> equally strong plans and played the <b>{plan.archetype}</b> ({pct(played.probability)} chance). A seeded draw, never a weaker plan.</>
          : <>Played the <b>{plan.archetype ?? 'plan'}</b>: clearly ahead of the {weaker.length} other plan{weaker.length === 1 ? '' : 's'} it verified.</>}
        {onMore && <> <button className="link link-on-baize" onClick={onMore}>Why</button></>}
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

export function Aftermath({ detail, next }: { detail: RoundDetail; next?: PhaseAction }) {
  const a = detail.analysis;
  const d = detail.decision;
  return (
    <div className="aftermath">
      {detail.round.status === 'completed' && <Result detail={detail} next={next} />}
      <section className="memory stock" aria-labelledby="memory-h">
        <header className="panel-head"><h3 id="memory-h">The Boss Remembers</h3><span className="panel-meta">round {detail.round.round_number}</span></header>
        {d && <BossHand d={d} />}
        <div className="memory-grid">
          <div className="memory-col">
            <h4>What it saw this round</h4>
            {a ? (
              <>
                <p className="memory-facts">
                  Took <b>{Math.round(a.damageTaken.total)}</b> damage ({Math.round(a.damageTaken.byMode.ranged ?? 0)} ranged, {Math.round((a.damageTaken.byMode.melee ?? 0) + (a.damageTaken.byMode.unarmed ?? 0))} melee{a.damageTaken.pierces ? `, ${a.damageTaken.pierces} pierces` : ''}) · dealt <b>{Math.round(a.damageDealt.total)}</b> · speed you {Math.round(a.initiative.playerEffDex)} vs boss {Math.round(a.initiative.bossEffDex)}
                </p>
                {a.weaknesses.length ? (
                  <ul className="evidence">
                    {a.weaknesses.map((w) => (
                      <li key={w.code}>
                        <span className="evidence-head"><GlyphIcon glyph="star" size={12} /><b>{WEAKNESS_LABEL[w.code] ?? w.code}</b><span className="evidence-sev" aria-label={`severity ${n2(w.severity)}`}><span style={{ width: `${Math.min(1, w.severity) * 100}%` }} /></span></span>
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
            <h4>How it chose the hand above</h4>
            {d ? <DecisionDetail d={d} /> : <p className="muted-ink">No decision recorded.</p>}
          </div>
        </div>
      </section>
      {next && <div className="phase-end"><button className="btn btn-primary btn-big" onClick={next.onClick} disabled={next.disabled}>{next.label} <Icon name="arrow" /></button></div>}
    </div>
  );
}
