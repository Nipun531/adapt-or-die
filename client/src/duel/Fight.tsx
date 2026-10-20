/**
 * FIGHT — the combat stage (Cathedral Lead-Light, V3).
 *
 *   [ your window ]   [ the incoming pane: what is coming and your answer ]   [ the boss's window ]
 *   one line: what just happened
 *   rounds, one row each (the open round lists every exchange; a row opens the full calculation)
 *
 * The windows are lead-light: HP and stun are rows of glass panes, gear sits in roundels with its trait in words,
 * stims are vials. Every exchange plays as light in the struck window — a hit cracks the attacker's colour across it,
 * a block flashes clear glass, a dodge slides it aside, a counter sends amber back, a stun floods it violet, a stim
 * glows green. A freshly played round reveals its exchanges one by one; reduced motion (or "Show all") reveals all.
 * Every number comes from the server's events; nothing here is computed as a rule.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AttackMode, CombatEvent, CombatNote, Item, PendingChoice, PlayerAnswer, RoundDetail, RoundRow, Side, Snapshot } from '../api';
import { GlyphIcon, Icon } from '../ui/Icon';
import { Hint } from '../ui/Hint';
import type { PhaseAction } from './actions';
import { findItem, itemName, n2, pct, useCatalog } from '../util';

/**
 * Who the two sides are on screen. Boss modes: "You" and "The boss". PvP (V4): the two player names, set by the Fight
 * at render (one Fight is on screen at a time), so every sentence below names the right human.
 */
let NAMES: { player: string; boss: string } | null = null;
const whoName = (s: Side) => (NAMES ? NAMES[s] : s === 'player' ? 'You' : 'The boss');
const whoObj = (s: Side) => (NAMES ? NAMES[s] : s === 'player' ? 'you' : 'the boss');
const isAre = (s: Side) => (!NAMES && s === 'player' ? 'are' : 'is');
const its = () => (NAMES ? 'their' : 'its');
const int = (x: number) => Math.max(0, Math.round(x));

export function openingText(i: RoundDetail['round']['initiative']): string {
  const who = i.openingOrder.map(whoName).join(' → ');
  switch (i.openingRule) {
    case 'none': return 'No First Shot: nobody held a bow.';
    case 'single': return `${who} took the First Shot as the only fighter with a bow.`;
    case 'dex_advantage': return `${who} took the First Shot: both held bows, the faster one shoots.`;
    case 'tie_none': return 'No First Shot: both held bows at equal speed.';
    default: return i.openingOrder.length ? `${who} shot first (older rules).` : 'No First Shot.';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Timeline: events and notes merged by seq; the live state after the first `n` items.
// ---------------------------------------------------------------------------------------------------------------
type Item_ = { t: 'e'; e: CombatEvent; seq: number } | { t: 'n'; n: CombatNote; seq: number };
export type Fx = 'hit' | 'block' | 'dodge' | 'counter' | 'stun' | 'heal' | 'skip' | 'ko' | 'strike';

interface Live { hp: Record<Side, number>; stun: Record<Side, number>; stimsUsed: Record<Side, number>; fx: Partial<Record<Side, { fx: Fx; key: number; tint?: Side }>> }

function timeline(d: RoundDetail): Item_[] {
  return [...d.events.map((e) => ({ t: 'e' as const, e, seq: e.seq })), ...(d.notes ?? []).map((n) => ({ t: 'n' as const, n, seq: n.seq }))].sort((a, b) => a.seq - b.seq);
}

function liveAt(d: RoundDetail, items: Item_[], n: number): Live {
  const r = d.round;
  const live: Live = { hp: { player: r.player_snapshot.derived.maxHp, boss: r.boss_snapshot.derived.maxHp }, stun: { player: 0, boss: 0 }, stimsUsed: { player: 0, boss: 0 }, fx: {} };
  for (const it of items.slice(0, n)) {
    if (it.t === 'n') {
      if (it.n.kind === 'stim') { live.stimsUsed[it.n.side]++; if (it.n.detail.hpAfter !== undefined) live.hp[it.n.side] = it.n.detail.hpAfter; }
      continue;
    }
    const e = it.e;
    live.hp[e.defender] = e.defenderHpAfter;
    live.hp[e.attacker] = e.attackerHp;
    if (e.stun) live.stun = { ...e.stun.meters };
  }
  // The struck window shows the last item's light.
  const last = items[n - 1];
  if (last?.t === 'n') {
    if (last.n.kind === 'stim') live.fx[last.n.side] = { fx: 'heal', key: last.seq };
    if (last.n.kind === 'skip') live.fx[last.n.side] = { fx: 'skip', key: last.seq };
  } else if (last?.t === 'e') {
    const e = last.e;
    let fx: Fx = e.kind === 'counter' ? 'counter' : e.defense?.success ? (e.defense.action === 'block' ? 'block' : 'dodge') : 'hit';
    if (e.stun?.triggered?.target === e.defender) fx = 'stun';
    if (e.defenderHpAfter <= 0) fx = 'ko';
    live.fx[e.defender] = { fx, key: last.seq, tint: e.attacker };
    live.fx[e.attacker] = { fx: 'strike', key: last.seq };
  }
  return live;
}

/** One exchange in plain words. */
export function exchangeText(e: CombatEvent, catalog: ReturnType<typeof useCatalog>): string {
  const w = e.weaponId ? itemName(catalog, e.weaponId) : 'bare hands';
  if (e.kind === 'counter') return `${whoName(e.attacker)} countered with ${w}: ${int(e.damage)} damage.`;
  const verb = e.mode === 'ranged' ? 'shot' : 'struck';
  const d = e.defense;
  let tail = `${int(e.damage)} damage`;
  if (d?.success) tail = d.action === 'block' ? `${whoObj(e.defender)} blocked it` : `${whoObj(e.defender)} dodged it`;
  else if (d?.action === 'none') tail = `${whoObj(e.defender)} could not defend (stunned): ${int(e.damage)} damage`;
  const stun = e.stun?.triggered ? ` ${whoName(e.stun.triggered.target)} ${isAre(e.stun.triggered.target)} stunned!` : '';
  return `${whoName(e.attacker)} ${verb} with ${w}${e.phase === 'opening' ? ' (First Shot)' : ''}: ${tail}.${stun}`;
}

function noteText(n: CombatNote): string {
  const you = !NAMES && n.side === 'player';
  if (n.kind === 'skip') return `${whoName(n.side)} ${isAre(n.side)} stunned and lose${you ? '' : 's'} this turn.`;
  if (n.kind === 'stim') return `${whoName(n.side)} use${you ? '' : 's'} a healing stim: +${int(n.detail.heal ?? 0)} HP.`;
  return `Turn limit reached: ${whoObj(n.side)} win${you ? '' : 's'} on the higher share of health.`;
}

// ---------------------------------------------------------------------------------------------------------------
// The fighter window
// ---------------------------------------------------------------------------------------------------------------
function Panes({ value, max, kind, label }: { value: number; max: number; kind: 'hp-player' | 'hp-boss' | 'stun'; label: string }) {
  const lit = max > 0 ? Math.ceil((Math.max(0, Math.min(value, max)) / max) * 10 - 1e-9) : 0;
  return (
    <div className={`panes panes-${kind}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(Math.max(0, value))}>
      {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < lit ? 'is-lit' : ''} />)}
    </div>
  );
}

/** What an item does, in words (from the catalogue's own fields). */
export function itemTraits(it: Item): string[] {
  const t: string[] = [];
  if (it.category === 'ranged') t.push('First Shot');
  if (it.pierce) t.push(`Pierce ${Math.round(it.pierce.chance * 100)}%`);
  if (it.combat?.blockBonus) t.push(`Block +${Math.round(it.combat.blockBonus * 100)}%`);
  if (it.combat?.canStun) t.push('Can stun');
  if (it.combat?.stunBoost) t.push(`Stun +${Math.round(it.combat.stunBoost * 100)}%`);
  if (it.combat?.dodgeCounter) t.push(`Dodge counter +${Math.round(it.combat.dodgeCounter * 100)}%`);
  return t;
}

const SLOT_GLYPH = { melee: 'strike', ranged: 'archery', shield: 'shield', armour: 'armour' } as const;

export function Roundel({ id, slot }: { id: string | null; slot: string }) {
  const catalog = useCatalog();
  const it = id ? findItem(catalog, id) : undefined;
  return (
    <li className={`roundel ${it ? 'is-filled' : ''} ${it ? `roundel-${it.category}` : ''}`}>
      <span className="roundel-glass" aria-hidden="true">{it ? <GlyphIcon glyph={SLOT_GLYPH[it.category]} size={20} /> : null}</span>
      <span className="roundel-text">
        <span className="roundel-slot">{slot}</span>
        <b>{it ? it.name : 'empty'}</b>
        {it && itemTraits(it).length > 0 && <small>{itemTraits(it).join(' · ')}</small>}
      </span>
    </li>
  );
}

function Window({ side, snap, live, fx, stimsLeft, slots, turnNote }: {
  side: Side; snap: Snapshot; live: Live; fx?: { fx: Fx; key: number; tint?: Side }; stimsLeft: number; slots: number; turnNote?: string;
}) {
  const max = snap.derived.maxHp;
  const hp = live.hp[side];
  const stun = live.stun[side];
  return (
    <section className={`window window-${side}`} aria-label={`${whoName(side)}: ${int(hp)} of ${max} HP, stun ${int(stun)} of 100`}>
      {fx && <span key={fx.key} className={`fx fx-${fx.fx} ${fx.tint ? `fx-from-${fx.tint}` : ''}`} aria-hidden="true" />}
      <header className="window-head">
        <h2>{NAMES ? NAMES[side] : side === 'player' ? 'You' : 'The Boss'}</h2>
        <span className="window-level">level {snap.level}</span>
      </header>
      {turnNote && <p className="window-turn">{turnNote}</p>}
      <div className="window-row">
        <span className="window-label"><GlyphIcon glyph="heart" size={14} />Health</span>
        <span className="window-num"><b>{int(hp)}</b><small> / {max}</small></span>
      </div>
      <Panes value={hp} max={max} kind={side === 'player' ? 'hp-player' : 'hp-boss'} label={`${whoName(side)} health`} />
      <div className="window-row">
        <span className="window-label"><GlyphIcon glyph="star" size={14} />Stun</span>
        <span className="window-num"><b>{int(stun)}</b><small> / 100</small></span>
      </div>
      <Panes value={stun} max={100} kind="stun" label={`${whoName(side)} stun`} />
      <ul className="roundels" aria-label={`${whoName(side)} gear`}>
        <Roundel id={snap.loadout.hand1} slot="Hand" />
        <Roundel id={snap.loadout.hand2} slot="Hand" />
        <Roundel id={snap.loadout.armour} slot="Body" />
      </ul>
      <div className="vials" aria-label={`${stimsLeft} of ${slots} healing stims left`}>
        <span className="window-label"><GlyphIcon glyph="vial" size={14} />Stims</span>
        {Array.from({ length: Math.max(slots, stimsLeft) }, (_, i) => <i key={i} className={i < stimsLeft ? 'is-full' : ''} />)}
        {slots === 0 && <small>none</small>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The incoming pane: one decision at a time
// ---------------------------------------------------------------------------------------------------------------
function useKeys(map: Record<string, () => void>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const key = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)));
      if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const f = map[ev.key.toLowerCase()];
      if (f) { ev.preventDefault(); f(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
}

function DefenseChoice({ p, onAnswer, busy }: { p: PendingChoice; onAnswer: (a: PlayerAnswer) => void; busy?: boolean }) {
  const catalog = useCatalog();
  const inc = p.incoming!;
  const odds = p.odds!;
  useKeys({ b: () => onAnswer({ defense: 'block' }), d: () => onAnswer({ defense: 'dodge' }) }, !busy);
  const weapon = inc.weaponId ? itemName(catalog, inc.weaponId) : 'bare hands';
  const wItem = inc.weaponId ? findItem(catalog, inc.weaponId) : undefined;
  const tags = [inc.mode === 'ranged' ? 'ranged' : 'melee', odds.block.heavy ? 'heavy' : null, wItem?.combat?.canStun ? 'can stun' : null, inc.mode === 'ranged' ? 'cannot be countered' : null].filter(Boolean) as string[];
  return (
    <div className="incoming is-now" role="group" aria-labelledby="incoming-h">
      <h3 id="incoming-h">{inc.phase === 'opening' ? 'First Shot: ' : ''}{whoName(p.side === 'player' ? 'boss' : 'player')} {inc.mode === 'ranged' ? 'shoots' : 'swings'} {its()} {weapon}{NAMES ? ` at ${NAMES[p.side]}` : ''}</h3>
      <p className="incoming-sub">{inc.phase === 'opening' ? '' : `Turn ${inc.turn} · `}About <b>{int(odds.expectedDamage)}</b> damage if it lands · {tags.join(' · ')}{inc.phase === 'dex_bonus' ? ' · speed bonus attack' : ''}</p>
      <div className="answers">
        <button className="answer" disabled={busy} onClick={() => onAnswer({ defense: 'block' })}>
          <span className="answer-head"><b>Block</b><kbd>B</kbd><em>{pct(odds.block.chance)}</em></span>
          <small>{odds.block.counterPossible ? `If it holds: no damage, and a chance to counter ×1.5 (+20 stun to ${whoObj(p.side === 'player' ? 'boss' : 'player')}).` : 'If it holds: no damage. No counter possible.'}{odds.block.heavy ? ' A hit this heavy still builds your stun.' : ''}</small>
        </button>
        <button className="answer" disabled={busy} onClick={() => onAnswer({ defense: 'dodge' })}>
          <span className="answer-head"><b>Dodge</b><kbd>D</kbd><em>{pct(odds.dodge.chance)}</em></span>
          <small>{odds.dodge.counterPossible ? `If it works: no damage, ${pct(odds.dodge.counterChance)} chance to counter ×0.75.` : 'If it works: no damage. Your weapon cannot counter a dodge.'}</small>
        </button>
      </div>
      <p className="incoming-hint">Block uses your defence, shields and armour. Dodge grows with your speed lead over the attacker.</p>
      <Hint id="defend-1">{NAMES ? 'You are being attacked.' : 'The boss is attacking.'} Pick Block or Dodge (or press B / D). The odds above are exact; a good defence can hit back.</Hint>
    </div>
  );
}

function StimChoice({ p, onAnswer, busy }: { p: PendingChoice; onAnswer: (a: PlayerAnswer) => void; busy?: boolean }) {
  useKeys({ u: () => onAnswer({ stim: true }), k: () => onAnswer({ stim: false }) }, !busy);
  return (
    <div className="incoming is-now" role="group" aria-labelledby="stim-h">
      <h3 id="stim-h">Drink a healing stim first?</h3>
      <p className="incoming-sub">Turn {p.turn} · it heals <b>{int(p.heal ?? 0)}</b> HP, never above your maximum. A used stim is gone until you buy another.</p>
      <div className="answers">
        <button className="answer answer-heal" disabled={busy} onClick={() => onAnswer({ stim: true })}><span className="answer-head"><b>Use stim</b><kbd>U</kbd></span><small>Heal now, then attack.</small></button>
        <button className="answer" disabled={busy} onClick={() => onAnswer({ stim: false })}><span className="answer-head"><b>Keep it</b><kbd>K</kbd></span><small>Save it for a later turn.</small></button>
      </div>
    </div>
  );
}

function ModeChoice({ p, onAnswer, busy }: { p: PendingChoice; onAnswer: (a: PlayerAnswer) => void; busy?: boolean }) {
  const [repeat, setRepeat] = useState(false);
  const options = p.options as AttackMode[];
  useKeys({ r: () => options.includes('ranged') && onAnswer({ mode: 'ranged', repeat }), m: () => options.includes('melee') && onAnswer({ mode: 'melee', repeat }) }, !busy);
  return (
    <div className="incoming is-now" role="group" aria-labelledby="mode-h">
      <h3 id="mode-h">Shoot or strike?</h3>
      <p className="incoming-sub">Turn {p.turn} · {p.phase === 'dex_bonus' ? 'your speed bonus attack. ' : ''}A shot uses your speed and can be blocked or dodged but never countered. A strike uses your strength.</p>
      <div className="answers">
        {options.includes('ranged') && <button className="answer" disabled={busy} onClick={() => onAnswer({ mode: 'ranged', repeat })}><span className="answer-head"><b>Shoot</b><kbd>R</kbd></span><small>Ranged attack.</small></button>}
        {options.includes('melee') && <button className="answer" disabled={busy} onClick={() => onAnswer({ mode: 'melee', repeat })}><span className="answer-head"><b>Strike</b><kbd>M</kbd></span><small>Melee attack.</small></button>}
      </div>
      <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Use the same for the rest of this round</label>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The round log (inside the round history) — one row per exchange, the calculation one click away
// ---------------------------------------------------------------------------------------------------------------
function Calc({ e }: { e: CombatEvent }) {
  const c = e.calc;
  const d = e.defense;
  return (
    <div className="calc">
      {d && <div>{d.action === 'none' ? 'No defence (stunned).' : `${cap(d.action)} chance ${pct(d.chance, 1)}, roll ${n2(d.roll)} → ${d.success ? 'success' : 'failed'}.`} Attack shaved off {pct(d.shaved)}.{d.counter ? ` ${cap(d.counter.type)} counter chance ${pct(d.counter.chance, 1)}, roll ${n2(d.counter.roll)} → ${d.counter.success ? 'counter' : 'no counter'}.` : d.noCounterReason ? ` No counter: ${d.noCounterReason}.` : ''}</div>}
      <div>Attack value ({c.attackValueSource === 'effDex' ? 'speed' : 'attack'}) <b>{n2(c.attackValue)}</b> against defence {n2(c.defenderNetDef)}{c.pierce ? `; pierce roll ${n2(c.pierce.roll)} vs ${pct(c.pierce.chance)} → ${c.pierce.success ? `pierced, ignores ${pct(c.pierce.defIgnore)}` : 'no pierce'}` : ''} → defence used {n2(c.defUsed)}.</div>
      <div>Damage = A × A / (A + DEF) = <b>{n2(c.netDamage)}</b>; speed mitigation {pct(c.mitigation, 1)} (roll {n2(c.mitigationRoll)}) → <b>{n2(c.finalDamage)}</b>{e.kind === 'counter' ? `, × counter multiplier → ${n2(e.damage)}` : ''}.</div>
      {e.stun && <div>Stun after: you {int(e.stun.meters.player)} · boss {int(e.stun.meters.boss)}{e.stun.gains.map((g) => ` · ${whoName(g.side)} +${int(g.amount)} (${g.cause.replace(/_/g, ' ')})`).join('')}{e.stun.triggered ? ` · STUN on ${whoObj(e.stun.triggered.target)} (+${int(e.stun.triggered.extraDamage)} damage)` : ''}.</div>}
    </div>
  );
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function outcomeOf(e: CombatEvent): string {
  if (e.kind === 'counter') return 'counter';
  if (e.stun?.triggered) return 'stun';
  if (e.defense?.success) return e.defense.action;
  return e.attacker === 'player' ? 'hit-player' : 'hit-boss';
}

function ExchangeRow({ e }: { e: CombatEvent }) {
  const catalog = useCatalog();
  const [open, setOpen] = useState(false);
  return (
    <li className={`exchange exchange-${outcomeOf(e)}`}>
      <button className="exchange-line" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="exchange-pane" aria-hidden="true" />
        <span className="exchange-text">{exchangeText(e, catalog)}</span>
        <span className="exchange-hp">{e.defenderHpAfter > 0 ? `${whoName(e.defender)} ${int(e.defenderHpAfter)} HP` : 'KO'}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && <Calc e={e} />}
    </li>
  );
}

function RoundLog({ items }: { items: Item_[] }) {
  if (!items.length) return <p className="muted">No exchanges yet.</p>;
  return (
    <ol className="exchanges">
      {items.map((it) => (it.t === 'e' ? <ExchangeRow key={`e${it.seq}`} e={it.e} /> : (
        <li key={`n${it.seq}`} className={`exchange exchange-note exchange-${it.n.kind}`}><span className="exchange-line"><span className="exchange-pane" aria-hidden="true" /><span className="exchange-text">{noteText(it.n)}</span></span></li>
      )))}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The stage
// ---------------------------------------------------------------------------------------------------------------
export function Fight({ detail, onChoose, busy, deal, next, rounds, onOpenRound, names }: {
  detail: RoundDetail; onChoose?: (a: PlayerAnswer) => void; busy?: boolean; deal?: boolean; next?: PhaseAction;
  rounds?: RoundRow[]; onOpenRound?: (id: number) => void;
  /** V4 PvP: the two players' names (side 'player' = Player 1, 'boss' = Player 2). Absent in boss modes. */
  names?: { player: string; boss: string };
}) {
  NAMES = names ?? null;
  const catalog = useCatalog();
  const r = detail.round;
  const items = useMemo(() => timeline(detail), [detail]);
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(deal && !reduce ? 0 : items.length);
  useEffect(() => { setShown(deal && !reduce ? 0 : items.length); }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (shown >= items.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), 720);
    return () => clearTimeout(t);
  }, [shown, items.length]);
  useEffect(() => { if (!deal) setShown(items.length); }, [items.length, deal]);

  const live = liveAt(detail, items, shown);
  const dealing = shown < items.length;
  const done = r.status === 'completed';
  const p = r.pending_choice;
  const sup = (s: Side) => (s === 'player' ? r.player_snapshot : r.boss_snapshot).supplies;
  const stimsLeft = (s: Side) => Math.max(0, (sup(s)?.stims ?? 0) - live.stimsUsed[s]);
  const last = shown > 0 ? items[shown - 1] : null;
  const lastText = last ? (last.t === 'e' ? exchangeText(last.e, catalog) : noteText(last.n)) : openingText(r.initiative);
  const first = r.initiative.turnOrder[0];

  let centre;
  if (dealing) {
    centre = (
      <div className="incoming is-playing" aria-live="polite">
        <h3>{lastText}</h3>
        <p className="incoming-sub">{last ? (last.t === 'e' ? (last.e.turn === 0 ? 'First Shot' : `Turn ${last.e.turn}`) : `Turn ${last.n.turn}`) : 'The round begins'}</p>
        <button className="btn btn-quiet btn-small" onClick={() => setShown(items.length)}>Show all</button>
      </div>
    );
  } else if (p && onChoose && (p.kind ?? 'attack_mode') === 'defense') centre = <DefenseChoice p={p} onAnswer={onChoose} busy={busy} />;
  else if (p && onChoose && p.kind === 'stim') centre = <StimChoice p={p} onAnswer={onChoose} busy={busy} />;
  else if (p && onChoose) centre = <ModeChoice p={p} onAnswer={onChoose} busy={busy} />;
  else if (done) {
    const won = r.winner === 'player';
    const w = r.winner as Side;
    centre = (
      <div className={`incoming is-result ${won ? 'is-win' : 'is-loss'}`}>
        <h3>{names ? `${names[w]} wins` : won ? 'Victory' : 'Defeat'}</h3>
        <p className="incoming-sub">Round {r.round_number} · {names ? `${names[w]} finished with ${int((w === 'player' ? r.player_hp_end : r.boss_hp_end) ?? 0)} HP` : won ? `you finished with ${int(r.player_hp_end ?? 0)} HP` : `the boss finished with ${int(r.boss_hp_end ?? 0)} HP`}{r.end_reason === 'turn_limit' ? ' · decided by the turn limit' : ''}.</p>
        {next && <button className="btn btn-primary btn-big" onClick={next.onClick}>{next.label} <Icon name="arrow" /></button>}
      </div>
    );
  } else {
    centre = <div className="incoming"><h3>Waiting…</h3></div>;
  }

  const pastRounds = (rounds ?? []).filter((x) => x.id !== r.id).slice().reverse();
  return (
    <div className="fight">
      <div className="stage">
        <Window side="player" snap={r.player_snapshot} live={live} fx={live.fx.player} stimsLeft={stimsLeft('player')} slots={sup('player')?.slots ?? 0} turnNote={first === 'player' ? 'acts first (faster)' : undefined} />
        <div className="stage-centre">
          {centre}
          {!dealing && last && <p className="last-line" aria-live="polite"><span>Last</span>{lastText}</p>}
        </div>
        <Window side="boss" snap={r.boss_snapshot} live={live} fx={live.fx.boss} stimsLeft={stimsLeft('boss')} slots={sup('boss')?.slots ?? 0} turnNote={first === 'boss' ? 'acts first (faster)' : undefined} />
      </div>

      <section className="history" aria-labelledby="history-h">
        <header className="history-head"><h3 id="history-h">Rounds</h3><span className="muted">newest first · open an exchange for the full calculation</span></header>
        <details className="history-round is-current" open>
          <summary><b>Round {r.round_number}</b><span>{done ? (names ? `${names[r.winner as Side]} won` : r.winner === 'player' ? 'won' : 'lost') : 'in progress'}</span><span>{items.slice(0, shown).filter((x) => x.t === 'e').length} exchanges</span><span className="muted">{openingText(r.initiative)}</span></summary>
          <RoundLog items={items.slice(0, shown)} />
          <p className="history-seed">Seed {r.seed} · engine {r.engine_version}: the seed and the stored snapshots reproduce this round.</p>
        </details>
        {pastRounds.map((x) => (
          <div key={x.id} className="history-round is-past">
            <button className="history-open" onClick={() => onOpenRound?.(x.id)} disabled={!onOpenRound}>
              <b>Round {x.round_number}</b>
              <span className={x.winner === 'player' ? 'tone-player' : 'tone-boss'}>{x.status !== 'completed' ? x.status : names && x.winner ? `${names[x.winner]} won` : x.winner === 'player' ? 'won' : 'lost'}</span>
              <span>{whoObj('player')} {int(x.player_hp_end ?? 0)} HP · {names ? names.boss : 'boss'} {int(x.boss_hp_end ?? 0)} HP</span>
              <span className="muted">{x.attack_count} actions</span>
              <Icon name="arrow" size={14} />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
