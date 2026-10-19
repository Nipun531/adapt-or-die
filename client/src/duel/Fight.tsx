/**
 * FIGHT — the round as a replay: who got the First Shot and why, then every turn as a group of attacks, each with
 * its damage, what it did to the defender's HP, and its tags (First Shot, pierce, DEX bonus, KO). Click an attack for
 * the full calculation (every formula input and random roll). A freshly played round deals its attacks one by one;
 * "Show all" (or reduced motion) shows the whole log at once.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AttackMode, CombatEvent, CombatNote, PendingChoice, PlayerAnswer, RoundDetail, Side } from '../api';
import { Icon } from '../ui/Icon';
import { Meter } from '../ui/states';
import type { PhaseAction } from './actions';
import { itemName, n2, pct, sideName, useCatalog } from '../util';

export function openingText(i: RoundDetail['round']['initiative']): string {
  const who = i.openingOrder.map((s) => (s === 'player' ? 'You' : 'The Boss')).join(' → ');
  switch (i.openingRule) {
    case 'none': return 'No First Shot: nobody held a bow.';
    case 'single': return `${who} took the First Shot: the only fighter with a bow.`;
    case 'dex_advantage': return `${who} took the First Shot: both held bows, higher effective DEX shoots.`;
    case 'tie_none': return 'No First Shot: both held bows with equal effective DEX, so neither had the advantage.';
    default: return i.openingOrder.length ? `${who} shot first (older rules: every bow holder shot).` : 'No First Shot: nobody held a bow.';
  }
}

function Calc({ e }: { e: CombatEvent }) {
  const c = e.calc;
  return (
    <div className="calc">
      <div>Attack value = {c.attackValueSource === 'effDex' ? 'effective DEX' : 'Net ATK'} = <b>{n2(c.attackValue)}</b></div>
      <div>Defender Net DEF {n2(c.defenderNetDef)}{c.pierce ? `; pierce roll ${n2(c.pierce.roll)} vs ${c.pierce.chance} → ${c.pierce.success ? `pierced, ignores ${Math.round(c.pierce.defIgnore * 100)}%${c.pierce.extraDamage !== undefined ? ` (+${n2(c.pierce.extraDamage)})` : ''}` : 'no pierce'}` : ''} → DEF used <b>{n2(c.defUsed)}</b></div>
      <div>Net damage = A × A / (A + DEF) = {n2(c.attackValue)} × {n2(c.attackValue)} / ({n2(c.attackValue)} + {n2(c.defUsed)}) = <b>{n2(c.netDamage)}</b></div>
      <div>DEX ratio = {n2(c.defenderDex)} / {n2(c.attackerDex)} = {n2(c.dexRatio)}; mitigation = max(0, {n2(c.mitigationRoll)} × (1 − 1/{n2(c.dexRatio)})) = {n2(c.rawMitigation)}{c.mitigationClamped ? ' → 0 (no DEX advantage)' : ''} → <b>{pct(c.mitigation, 1)}</b></div>
      <div>Final damage = {n2(c.netDamage)} × (1 − {n2(c.mitigation)}) = <b>{n2(c.finalDamage)}</b></div>
      <div className="calc-choice">Mode chosen by {e.choiceSource.replace(/_/g, ' ')}{e.choiceReason ? `: ${e.choiceReason}` : ''}</div>
    </div>
  );
}

function AttackRow({ e, maxHp }: { e: CombatEvent; maxHp: Record<Side, number> }) {
  const catalog = useCatalog();
  const [open, setOpen] = useState(false);
  const weapon = e.weaponId ? itemName(catalog, e.weaponId) : 'fists';
  const ko = e.defenderHpAfter <= 0;
  return (
    <li className={`attack attack-${e.attacker} ${open ? 'is-open' : ''}`}>
      {/* Two-sided exchange: your strikes play on the left of the table, the boss's on the right. */}
      <button className="attack-line" onClick={() => setOpen(!open)} aria-expanded={open}
        aria-label={`${sideName(e.attacker)} ${e.mode === 'ranged' ? 'shoots' : 'strikes'} with ${weapon} for ${n2(e.damage)}; ${sideName(e.defender)} at ${n2(Math.max(0, e.defenderHpAfter))} HP`}>
        <span className="attack-side">
          <span className="attack-dmg">{n2(e.damage)}</span>
          <span className="attack-body">
            <span className="attack-what">
              <b className="attack-who">{sideName(e.attacker)}</b> {e.mode === 'ranged' ? 'shoots' : 'strikes'} with <b>{weapon}</b>
              {e.phase === 'opening' && <span className="tag tag-yellow">First Shot</span>}
              {e.kind === 'counter' && <span className="tag tag-red">Counter</span>}
              {e.defense?.action === 'block' && e.defense.success && <span className="tag tag-blue">Blocked</span>}
              {e.defense?.action === 'dodge' && e.defense.success && <span className="tag tag-blue">Dodged</span>}
              {e.defense?.action === 'none' && <span className="tag tag-ink">No defence (stunned)</span>}
              {e.stun?.triggered && <span className="tag tag-red">Stun! {sideName(e.stun.triggered.target)}</span>}
              {e.phase === 'dex_bonus' && <span className="tag tag-ink">DEX bonus</span>}
              {e.calc.pierce?.success && <span className="tag tag-blue">Pierce −{Math.round(e.calc.pierce.defIgnore * 100)}% DEF</span>}
              {ko && <span className="tag tag-red">KO</span>}
            </span>
            <span className="attack-hp">
              <Meter value={Math.max(0, e.defenderHpAfter)} max={maxHp[e.defender]} label={`${sideName(e.defender)} HP after`} tone={e.defender === 'player' ? 'player' : 'boss'} />
              <small>{sideName(e.defender)} {n2(Math.max(0, e.defenderHpAfter))} HP</small>
            </span>
          </span>
        </span>
      </button>
      {open && <Calc e={e} />}
      {open && e.defense && (
        <div className="calc">
          <div>{sideName(e.defender)} {e.defense.action === 'none' ? 'could not defend (stunned)' : `chose ${e.defense.action}`}: chance {pct(e.defense.chance, 0)}, roll {n2(e.defense.roll)} → {e.defense.success ? 'success' : 'failed'}{e.defense.heavy ? ' (very heavy hit: stun still builds)' : ''}</div>
          <div>Attack shaved off {pct(e.defense.shaved, 0)}{e.defense.counter ? `; ${e.defense.counter.type} counter chance ${pct(e.defense.counter.chance, 0)}, roll ${n2(e.defense.counter.roll)} → ${e.defense.counter.success ? 'counter!' : 'no counter'}` : e.defense.noCounterReason ? `; no counter: ${e.defense.noCounterReason}` : ''}</div>
          {e.stun && <div>Stun meters after: you {Math.round(e.stun.meters.player)} / boss {Math.round(e.stun.meters.boss)}{e.stun.gains.map((g) => ` · ${sideName(g.side)} +${Math.round(g.amount)} (${g.cause.replace('_', ' ')})`).join('')}</div>}
        </div>
      )}
    </li>
  );
}

/** V3: an announced boss attack — Block (B) or Dodge (D), with the odds the server computed. */
function DefensePrompt({ p, onAnswer, busy }: { p: PendingChoice; onAnswer: (a: PlayerAnswer) => void; busy?: boolean }) {
  const catalog = useCatalog();
  const inc = p.incoming!;
  const odds = p.odds!;
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (busy || ev.ctrlKey || ev.metaKey || ev.altKey || (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text')))) return;
      if (ev.key.toLowerCase() === 'b') onAnswer({ defense: 'block' });
      if (ev.key.toLowerCase() === 'd') onAnswer({ defense: 'dodge' });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, onAnswer]);
  const weapon = inc.weaponId ? itemName(catalog, inc.weaponId) : 'bare hands';
  return (
    <div className="choice" role="group" aria-labelledby="defense-h">
      <p id="defense-h"><b>Incoming</b>: the boss {inc.mode === 'ranged' ? 'shoots' : 'strikes'} with <b>{weapon}</b> (about {n2(odds.expectedDamage)} damage if it lands). {inc.mode === 'ranged' ? 'Ranged attacks cannot be countered.' : ''}</p>
      <div className="choice-actions">
        <button className="btn btn-primary btn-big" disabled={busy} onClick={() => onAnswer({ defense: 'block' })}>
          Block {pct(odds.block.chance, 0)}<kbd>B</kbd>
        </button>
        <button className="btn btn-primary btn-big" disabled={busy} onClick={() => onAnswer({ defense: 'dodge' })}>
          Dodge {pct(odds.dodge.chance, 0)}<kbd>D</kbd>
        </button>
      </div>
      <p className="muted-ink">Block: no damage on success{odds.block.counterPossible ? `, may counter ×1.5 (+20 stun to the boss)` : ', no counter possible'}{odds.block.heavy ? '; this hit is very heavy — blocking it still builds your stun' : ''}. Dodge: no damage on success{odds.dodge.counterPossible ? `, ${pct(odds.dodge.counterChance, 0)} dodge-counter chance (×0.75)` : ', no dodge counter with your weapon'}.</p>
    </div>
  );
}

/** V3: use a healing stim before your turn (U) or keep it (S). */
function StimPrompt({ p, onAnswer, busy }: { p: PendingChoice; onAnswer: (a: PlayerAnswer) => void; busy?: boolean }) {
  return (
    <div className="choice" role="group" aria-labelledby="stim-h">
      <p id="stim-h"><b>Your turn</b>: use a healing stim first? It heals {n2(p.heal ?? 0)} HP (never above your max).</p>
      <div className="choice-actions">
        <button className="btn btn-primary btn-big" disabled={busy} onClick={() => onAnswer({ stim: true })}>Use stim</button>
        <button className="btn btn-quiet btn-big" disabled={busy} onClick={() => onAnswer({ stim: false })}>Keep it</button>
      </div>
    </div>
  );
}

function ChoicePrompt({ options, turn, phase, onChoose, busy }: {
  options: AttackMode[]; turn: number; phase: string; onChoose: (m: AttackMode, repeat: boolean) => void; busy?: boolean;
}) {
  const [repeat, setRepeat] = useState(false);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)));
      if (busy || typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key.toLowerCase() === 'r' && options.includes('ranged')) onChoose('ranged', repeat);
      if (ev.key.toLowerCase() === 'm' && options.includes('melee')) onChoose('melee', repeat);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [options, repeat, busy, onChoose]);
  return (
    <div className="choice" role="group" aria-labelledby="choice-h">
      <p id="choice-h"><b>Your move</b>: turn {turn}, {phase === 'dex_bonus' ? 'DEX bonus attack' : 'regular attack'}. Ranged uses effective DEX, melee uses Net ATK; either can pierce if the weapon has it.</p>
      <div className="choice-actions">
        {options.map((m) => (
          <button key={m} className="btn btn-primary btn-big" disabled={busy} onClick={() => onChoose(m, repeat)}>
            {m === 'ranged' ? 'Shoot' : m === 'melee' ? 'Strike' : m}<kbd>{m === 'ranged' ? 'R' : 'M'}</kbd>
          </button>
        ))}
        <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> use for the rest of this round</label>
      </div>
    </div>
  );
}

function NoteRow({ n }: { n: CombatNote }) {
  const you = n.side === 'player';
  const text = n.kind === 'skip' ? (you ? 'You are stunned and lose this turn.' : 'The boss is stunned and loses this turn.')
    : n.kind === 'stim' ? `${you ? 'You use' : 'The boss uses'} a healing stim: +${n2(n.detail.heal ?? 0)} HP (${n2(n.detail.hpAfter ?? 0)} HP).`
    : `Turn limit reached: ${you ? 'you win' : 'the boss wins'} on the higher HP share.`;
  return <li className={`attack attack-${n.side} note`}><span className="attack-line"><span className="attack-side"><span className="attack-body"><span className="attack-what">{text}</span></span></span></span></li>;
}

function Summary({ events, side }: { events: CombatEvent[]; side: Side }) {
  const mine = events.filter((e) => e.attacker === side);
  const dmg = mine.reduce((a, e) => a + e.damage, 0);
  const pierces = mine.filter((e) => e.calc.pierce?.success).length;
  return (
    <div className={`fight-sum fight-sum-${side}`}>
      <span>{sideName(side)}</span><b>{n2(dmg)}</b><small>{mine.length} hits{pierces ? ` · ${pierces} pierce${pierces > 1 ? 's' : ''}` : ''}</small>
    </div>
  );
}

export function Fight({ detail, onChoose, busy, deal, next }: {
  detail: RoundDetail; onChoose?: (a: PlayerAnswer) => void; busy?: boolean; deal?: boolean; next?: PhaseAction;
}) {
  const r = detail.round;
  const events = detail.events;
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(deal && !reduce ? 0 : events.length);
  useEffect(() => { setShown(deal && !reduce ? 0 : events.length); }, [r.id, deal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (shown >= events.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), 260);
    return () => clearTimeout(t);
  }, [shown, events.length]);
  useEffect(() => { if (!deal) setShown(events.length); }, [events.length, deal]);

  const maxHp = { player: r.player_snapshot.derived.maxHp, boss: r.boss_snapshot.derived.maxHp };
  const visible = events.slice(0, shown);
  const notes = detail.notes ?? [];
  const turns = useMemo(() => {
    const lastSeq = visible.length ? visible[visible.length - 1].seq : 0;
    const items: ({ type: 'e'; e: CombatEvent } | { type: 'n'; n: CombatNote })[] = [
      ...visible.map((e) => ({ type: 'e' as const, e })),
      ...notes.filter((n) => n.seq <= lastSeq + 1 || shown >= events.length).map((n) => ({ type: 'n' as const, n })),
    ].sort((a, b) => (a.type === 'e' ? a.e.seq : a.n.seq) - (b.type === 'e' ? b.e.seq : b.n.seq));
    const m = new Map<number, typeof items>();
    for (const it of items) { const t = it.type === 'e' ? it.e.turn : it.n.turn; m.set(t, [...(m.get(t) ?? []), it]); }
    return [...m.entries()];
  }, [visible, notes, shown, events.length]);
  const done = r.status === 'completed';
  const dealing = shown < events.length;

  return (
    <section className="fight stock" aria-labelledby="fight-h">
      <header className="panel-head">
        <h3 id="fight-h">Round {r.round_number}</h3>
        {done && !dealing && <span className={`result-chip ${r.winner === 'player' ? 'is-win' : 'is-loss'}`}>{r.winner === 'player' ? 'Victory' : 'Defeat'}</span>}
        {!done && <span className="result-chip is-live">In progress</span>}
        {dealing && <button className="btn btn-quiet btn-small" onClick={() => setShown(events.length)}>Show all</button>}
        {next && !dealing && <button className="btn btn-primary panel-head-action" onClick={next.onClick}>{next.label} <Icon name="arrow" /></button>}
      </header>
      <div className="fight-top">
        <Summary events={visible} side="player" />
        <p className="fight-opening"><Icon name="arrow" size={16} />{openingText(r.initiative)} Turn order: {r.initiative.turnOrder.map(sideName).join(' → ')}{r.initiative.dexTie ? ` (DEX tie, coin flip ${n2(r.initiative.tieBreakRoll)})` : ''}. DEX bonus per turn: you +{r.initiative.bonusAttacks.player}, boss +{r.initiative.bonusAttacks.boss}.</p>
        <Summary events={visible} side="boss" />
      </div>
      {!events.length && <p className="muted-ink">No attacks yet.</p>}
      <ol className="turns">
        {turns.map(([turn, evs]) => (
          <li key={turn} className="turn">
            <span className="turn-label">{turn === 0 ? 'Opening' : `Turn ${turn}`}</span>
            <ol className="attacks">{evs.map((it) => (it.type === 'e' ? <AttackRow key={`e${it.e.seq}`} e={it.e} maxHp={maxHp} /> : <NoteRow key={`n${it.n.seq}`} n={it.n} />))}</ol>
          </li>
        ))}
      </ol>
      {r.stun && <p className="fight-opening">Stun meters: you {Math.round(r.stun.player)} / boss {Math.round(r.stun.boss)} (100 = stunned){r.stims ? ` · stims left: you ${r.stims.player}, boss ${r.stims.boss}` : ''}.</p>}
      {r.pending_choice && onChoose && !dealing && r.pending_choice.kind === 'defense' && <DefensePrompt p={r.pending_choice} onAnswer={onChoose} busy={busy} />}
      {r.pending_choice && onChoose && !dealing && r.pending_choice.kind === 'stim' && <StimPrompt p={r.pending_choice} onAnswer={onChoose} busy={busy} />}
      {r.pending_choice && onChoose && !dealing && (r.pending_choice.kind ?? 'attack_mode') === 'attack_mode' && <ChoicePrompt options={r.pending_choice.options as AttackMode[]} turn={r.pending_choice.turn} phase={r.pending_choice.phase} onChoose={(mode, repeat) => onChoose({ mode, repeat })} busy={busy} />}
      {next && !dealing && <div className="phase-end"><button className="btn btn-primary btn-big" onClick={next.onClick}>{next.label} <Icon name="arrow" /></button></div>}
      <p className="fight-seed">Round seed {r.seed} · engine {r.engine_version}: the seed plus the stored snapshots reproduce this fight.</p>
    </section>
  );
}
