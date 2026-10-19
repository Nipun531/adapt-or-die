/**
 * PREPARE — the Armory. Item cards grouped by family with filters; picking a card previews its effect on your
 * Net numbers (server-computed, nothing written), then "Buy & equip" does both in one step. The hand (two hands +
 * body) and stat points sit beside it. The server re-validates every action; its message is shown if refused.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, type BuildPreview, type Item, type RunView, type StatKey } from '../api';
import { StatPip } from '../ui/Icon';
import { ErrorBox, useToast } from '../ui/states';
import { findItem, n2, useAction, useCatalog } from '../util';
import type { PhaseAction } from './actions';
import { BossHand } from './Aftermath';
import { proposeLoadout, removeFromSlot, type SlotKey } from './loadout';
import { Icon } from '../ui/Icon';

const FAMILIES: { id: Item['family']; label: string }[] = [
  { id: 'blade', label: 'Blades' }, { id: 'blunt', label: 'Blunt' }, { id: 'polearm', label: 'Polearms' },
  { id: 'bow', label: 'Bows' }, { id: 'shield', label: 'Shields' }, { id: 'armour', label: 'Armor' },
];
const SLOT_LABEL: Record<SlotKey, string> = { hand1: 'Hand 1', hand2: 'Hand 2', armour: 'Body' };
const STATS: StatKey[] = ['hp', 'str', 'def', 'dex'];

function Mods({ item }: { item: Item }) {
  const m = item.mods;
  const parts = (['str', 'def', 'dex'] as const).filter((k) => m[k] !== 0);
  return (
    <span className="mods">
      {parts.map((k) => <span key={k} className={m[k] < 0 ? 'mod-neg' : ''}><StatPip stat={k} size={13} hideLabel />{m[k] > 0 ? '+' : '−'}{Math.abs(m[k])}</span>)}
      {!parts.length && <span className="mod-none">no stat change</span>}
    </span>
  );
}

function ItemCard({ item, owned, equipped, gold, selected, onPick }: { item: Item; owned: boolean; equipped: boolean; gold: number; selected: boolean; onPick: () => void }) {
  const short = !owned && item.cost > gold;
  return (
    <button className={`item-card ${selected ? 'is-selected' : ''} ${owned ? 'is-owned' : ''} ${short ? 'is-short' : ''}`} onClick={onPick} aria-pressed={selected}>
      <span className="item-cost" aria-label={owned ? 'owned' : `${item.cost} gold`}>{owned ? (equipped ? 'In hand' : 'Owned') : item.cost}</span>
      <span className="item-name">{item.name}</span>
      <span className="item-family">{FAMILIES.find((f) => f.id === item.family)?.label}{item.category === 'ranged' ? ' · ranged' : item.category === 'melee' ? ' · melee' : ''}</span>
      <span className="item-tags">
        {item.category === 'ranged' && <span className="tag tag-yellow">First Shot</span>}
        {item.pierce && <span className="tag tag-blue">Pierce {Math.round(item.pierce.chance * 100)}% · ignores {Math.round(item.pierce.defIgnore * 100)}% DEF</span>}
        {item.combat?.blockBonus ? <span className="tag tag-ink">Block +{Math.round(item.combat.blockBonus * 100)}%</span> : null}
        {item.combat?.canStun ? <span className="tag tag-red">Can stun</span> : null}
        {item.combat?.stunBoost ? <span className="tag tag-ink">Stun boost +{Math.round(item.combat.stunBoost * 100)}%</span> : null}
        {item.combat?.dodgeCounter ? <span className="tag tag-ink">Dodge counter +{Math.round(item.combat.dodgeCounter * 100)}%</span> : null}
      </span>
      <Mods item={item} />
      {short && <span className="item-short">Need {item.cost - gold} more gold</span>}
    </button>
  );
}

function Delta({ label, from, to }: { label: string; from: number; to: number }) {
  const d = to - from;
  return (
    <div className="delta">
      <span>{label}</span>
      <b>{n2(from)} → {n2(to)}</b>
      <span className={d > 0.005 ? 'delta-up' : d < -0.005 ? 'delta-down' : 'delta-same'}>{d > 0.005 ? `+${n2(d)}` : d < -0.005 ? `−${n2(-d)}` : 'same'}</span>
    </div>
  );
}

export function Armory({ view, onChange, begin, onShowAftermath }: { view: RunView; onChange: (v: RunView) => void; begin?: PhaseAction; onShowAftermath?: () => void }) {
  const catalog = useCatalog();
  const toast = useToast();
  const p = view.player;
  const runId = view.run.id;
  const act = useAction();
  const [filter, setFilter] = useState<'all' | 'affordable' | 'owned' | Item['family']>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotKey | undefined>(undefined);
  const [preview, setPreview] = useState<BuildPreview | null>(null);

  const find = (id: string) => (catalog ? findItem(catalog, id) : undefined);
  const pickedItem = picked ? find(picked) : undefined;
  const proposal = useMemo(() => (pickedItem ? proposeLoadout(p.loadout, pickedItem, find, slot) : null), [pickedItem, slot, p.loadout]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!proposal) { setPreview(null); return; }
    let live = true;
    api.preview(runId, { loadout: proposal.loadout }).then((r) => { if (live) setPreview(r); }).catch(() => { if (live) setPreview(null); });
    return () => { live = false; };
  }, [runId, JSON.stringify(proposal?.loadout)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!catalog) return null;
  const inc = catalog.rules.statAllocationIncrease;
  const items = catalog.items.filter((i) => {
    if (filter === 'all') return true;
    if (filter === 'affordable') return p.inventory.includes(i.id) || i.cost <= p.gold;
    if (filter === 'owned') return p.inventory.includes(i.id);
    return i.family === filter;
  });
  const equippedIds = [p.loadout.hand1, p.loadout.hand2, p.loadout.armour];

  const apply = async (fn: () => Promise<RunView>, msg: string) => {
    const v = await act.run(fn);
    if (v) { onChange(v); toast(msg); setPicked(null); setSlot(undefined); }
  };
  const ownsPicked = !!pickedItem && p.inventory.includes(pickedItem.id);
  const firstRound = view.rounds.length === 0;

  return (
    <div className="prepare">
      <section className="armory stock" aria-labelledby="armory-h">
        <header className="panel-head">
          <h3 id="armory-h">Armory</h3>
          <span className="panel-meta"><b>{p.gold}</b> gold</span>
        </header>
        <div className="filters" role="group" aria-label="Filter items">
          {([['all', 'All'], ['affordable', 'Affordable'], ['owned', 'Owned']] as const).map(([id, label]) => (
            <button key={id} className={`chip ${filter === id ? 'is-on' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
          <span className="filters-sep" aria-hidden="true" />
          {FAMILIES.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? 'is-on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <div className="item-grid">
          {items.map((i) => (
            <Fragment key={i.id}>
              <ItemCard item={i} owned={p.inventory.includes(i.id)} equipped={equippedIds.includes(i.id)} gold={p.gold}
                selected={picked === i.id} onPick={() => { setPicked(picked === i.id ? null : i.id); setSlot(undefined); }} />
              {picked === i.id && pickedItem && proposal && (
                <div className="pick-panel" aria-live="polite" role="region" aria-label={`Preview: ${pickedItem.name}`}>
                  <div className="pick-head">
                    <p className="pick-title"><b>{pickedItem.name}</b> → {SLOT_LABEL[proposal!.slot]}</p>
                    {pickedItem.category !== 'armour' && (
                      <span className="pick-slots" role="group" aria-label="Hand">
                        {(['hand1', 'hand2'] as const).map((h) => (
                          <button key={h} className={`chip ${proposal!.slot === h ? 'is-on' : ''}`} aria-pressed={proposal!.slot === h} onClick={() => setSlot(h)}>{SLOT_LABEL[h]}</button>
                        ))}
                      </span>
                    )}
                  </div>
                  {preview?.problem && <p className="pick-problem">{preview.problem}</p>}
                  {preview?.preview && (
                    <div className="deltas">
                      <Delta label="Net ATK" from={preview.current.netAtk} to={preview.preview.netAtk} />
                      <Delta label="Net DEF" from={preview.current.netDef} to={preview.preview.netDef} />
                      <Delta label="Eff. DEX" from={preview.current.effDex} to={preview.preview.effDex} />
                    </div>
                  )}
                  <div className="pick-actions">
                    {ownsPicked ? (
                      <button className="btn btn-primary" disabled={act.busy || !!preview?.problem} onClick={() => apply(() => api.setLoadout(runId, proposal!.loadout), `${pickedItem.name} equipped`)}>Equip</button>
                    ) : (
                      <>
                        <button className="btn btn-primary" disabled={act.busy || pickedItem.cost > p.gold || !!preview?.problem}
                          title={pickedItem.cost > p.gold ? `Need ${pickedItem.cost - p.gold} more gold` : undefined}
                          onClick={() => apply(() => api.buy(runId, pickedItem.id, proposal!.loadout), `Bought and equipped ${pickedItem.name}`)}>
                          Buy &amp; equip · {pickedItem.cost}g
                        </button>
                        <button className="btn btn-quiet" disabled={act.busy || pickedItem.cost > p.gold} onClick={() => apply(() => api.buy(runId, pickedItem.id), `Bought ${pickedItem.name}`)}>Buy only</button>
                      </>
                    )}
                    <button className="btn btn-quiet" onClick={() => { setPicked(null); setSlot(undefined); }}>Cancel</button>
                  </div>
                  {pickedItem.cost > p.gold && !ownsPicked && <p className="pick-hint">Need {pickedItem.cost - p.gold} more gold.</p>}
                </div>
              )}
            </Fragment>
          ))}
          {!items.length && <p className="muted-ink">Nothing here yet.</p>}
        </div>
      </section>

      <aside className="hand stock" aria-labelledby="hand-h">
        <header className="panel-head"><h3 id="hand-h">Your hand</h3><span className="panel-meta">2 hands + body</span></header>
        <div className="slots">
          {(['hand1', 'hand2', 'armour'] as SlotKey[]).map((s) => {
            const id = p.loadout[s];
            const it = id ? find(id) : undefined;
            const target = proposal?.slot === s;
            return (
              <div key={s} className={`slot ${it ? 'is-filled' : ''} ${target ? 'is-target' : ''}`}>
                <span className="slot-label">{SLOT_LABEL[s]}</span>
                {it ? <><b>{it.name}</b><Mods item={it} /></> : <span className="slot-empty">empty</span>}
                {pickedItem && pickedItem.category !== 'armour' && s !== 'armour' && (
                  <button className="slot-put" onClick={() => setSlot(s)} aria-pressed={target}>Put here</button>
                )}
                {it && !pickedItem && (
                  <button className="slot-put" disabled={act.busy} onClick={() => apply(() => api.setLoadout(runId, removeFromSlot(p.loadout, s)), `${it.name} unequipped`)}>Remove</button>
                )}
              </div>
            );
          })}
        </div>

        <div className="points">
          <header className="points-head">
            <h4>Stat points</h4>
            <span className={`chip ${p.statPoints ? 'chip-points' : ''}`}>{p.statPoints} to spend</span>
          </header>
          {firstRound && p.statPoints > 0 && <p className="points-hint">Spend your {catalog.rules.initialStatPoints} starting points before round 1.</p>}
          <div className="points-grid">
            {STATS.map((s) => (
              <button key={s} className="point-btn" disabled={!p.statPoints || act.busy} onClick={() => apply(() => api.allocate(runId, s, 1), `+${inc[s]} ${s.toUpperCase()}`)}>
                <StatPip stat={s} size={16} /><span className="point-now">{p.stats[s]}</span><span className="point-add">+{inc[s]}</span>
              </button>
            ))}
          </div>
        </div>
        {p.supplies && p.supplyInfo && (
          <div className="supplies">
            <header className="points-head">
              <h4>Healing stims</h4>
              <span className="chip">{p.supplies.stims} / {p.supplies.slots} carried</span>
            </header>
            <p className="points-hint">Each stim heals {Math.round(p.supplyInfo.healFraction * 100)}% of your max HP, used before one of your turns. A used stim is gone until you buy another.</p>
            <div className="supply-actions">
              {([['buy_stim', 'Buy stim'], ['upgrade_slots', '+1 slot'], ['upgrade_effectiveness', '+5% heal']] as const).map(([a, label]) => {
                const info = p.supplyInfo!.actions[a];
                return (
                  <button key={a} className="btn btn-quiet btn-small" disabled={act.busy || !!info.problem} title={info.problem ?? undefined}
                    onClick={() => apply(() => api.supplies(runId, a), `${label} (${info.cost}g)`)}>
                    {label} · {info.cost}g
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {view.lastDecision && (
          <div className="last-hand">
            <h4>The boss’s last hand</h4>
            <BossHand d={view.lastDecision} compact onMore={onShowAftermath} />
          </div>
        )}
        <ErrorBox error={act.error} />
        <p className="rules-note">Legal hands: shield + weapon, bow + melee weapon, one item, or empty. If both fighters hold a bow, only the faster one gets the First Shot (equal DEX: nobody). Pierce works with any weapon that has it. Every incoming attack can be blocked (DEF and shields) or dodged (a DEX lead); a successful block or a dodge with a long weapon can counter, except against ranged attacks.</p>
        {begin && (
          <div className="begin">
            {begin.hint && <p>{begin.hint}</p>}
            <button className="btn btn-primary btn-big" onClick={begin.onClick} disabled={begin.disabled}>{begin.label} <Icon name="arrow" /></button>
          </div>
        )}
      </aside>
    </div>
  );
}
