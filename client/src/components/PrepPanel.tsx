/**
 * Pre-round preparation for the player: allocate stat points, buy equipment, choose the loadout.
 * Buttons are disabled for obviously impossible actions (UX only) — the server re-validates every
 * request and its error message is shown if something is illegal.
 */
import { useEffect, useState } from 'react';
import { api, type Item, type Loadout, type RunView, type StatKey } from '../api';
import { ErrorBox, modsText, useAction, useCatalog } from '../util';

const STATS: StatKey[] = ['hp', 'str', 'def', 'dex'];
const CAT_LABEL: Record<Item['category'], string> = { melee: 'Melee weapons', ranged: 'Ranged weapons', shield: 'Shields', armour: 'Armour' };

export function PrepPanel({ view, onChange }: { view: RunView; onChange: (v: RunView) => void }) {
  const catalog = useCatalog();
  const p = view.player;
  const runId = view.run.id;
  const act = useAction();
  const [lo, setLo] = useState<Loadout>(p.loadout);
  useEffect(() => setLo(p.loadout), [p.loadout]);

  if (!catalog) return null;
  const inc = catalog.rules.statAllocationIncrease;
  const owned = (cat?: Item['category']) => p.inventory.map((id) => catalog.items.find((i) => i.id === id)!).filter((i) => i && (!cat || i.category === cat));
  const handItems = owned().filter((i) => i.category !== 'armour');
  const dirty = JSON.stringify(lo) !== JSON.stringify(p.loadout);
  const apply = async (fn: () => Promise<RunView>) => {
    const v = await act.run(fn);
    if (v) onChange(v);
  };

  return (
    <section className="card prep">
      <h2>Prepare for round {view.rounds.length + 1}</h2>
      <ErrorBox error={act.error} />

      <h3>Stat points <span className="muted">({p.statPoints} available — {view.rounds.length === 0
        ? `${catalog.rules.initialStatPoints} initial points, spend them before round 1`
        : '1 per level-up'})</span></h3>
      <div className="stat-buttons">
        {STATS.map((s) => (
          <button key={s} className="btn" disabled={!p.statPoints || act.busy} onClick={() => apply(() => api.allocate(runId, s, 1))}>
            +{inc[s]} {s.toUpperCase()}
          </button>
        ))}
      </div>

      <h3>Equipment shop <span className="muted">({p.gold} gold)</span></h3>
      <div className="shop">
        {(['melee', 'ranged', 'shield', 'armour'] as const).map((cat) => (
          <div key={cat} className="shop-col">
            <h4>{CAT_LABEL[cat]}</h4>
            {catalog.items.filter((i) => i.category === cat).map((i) => {
              const have = p.inventory.includes(i.id);
              const short = i.cost > p.gold;
              return (
                <div key={i.id} className={`shop-item ${have ? 'owned' : ''}`}>
                  <div>
                    <b>{i.name}</b> <span className="muted small">{modsText(i.mods)}</span>
                    {i.pierce && <div className="muted small">Pierce {Math.round(i.pierce.chance * 100)}% → ignore {Math.round(i.pierce.defIgnore * 100)}% DEF{i.pierce.placeholder ? ' (approved placeholder)' : ''}</div>}
                  </div>
                  {have ? <span className="pill ok">Owned</span> : (
                    <button className="btn small" disabled={short || act.busy} title={short ? `Need ${i.cost - p.gold} more gold` : ''}
                      onClick={() => apply(() => api.buy(runId, i.id))}>
                      {i.cost}g
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <h3>Loadout <span className="muted">(2 hand slots + 1 armour slot)</span></h3>
      <div className="loadout-picker">
        {(['hand1', 'hand2'] as const).map((slot, idx) => (
          <label key={slot}>Hand {idx + 1}
            <select value={lo[slot] ?? ''} onChange={(e) => setLo({ ...lo, [slot]: e.target.value || null })}>
              <option value="">— empty —</option>
              {handItems.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.category})</option>)}
            </select>
          </label>
        ))}
        <label>Armour
          <select value={lo.armour ?? ''} onChange={(e) => setLo({ ...lo, armour: e.target.value || null })}>
            <option value="">— none —</option>
            {owned('armour').map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <button className="btn" disabled={!dirty || act.busy} onClick={() => apply(() => api.setLoadout(runId, lo))}>Equip</button>
        {dirty && <button className="btn ghost" onClick={() => setLo(p.loadout)}>Reset</button>}
      </div>
      <p className="muted small">Legal hands: Shield + Melee, Shield + Ranged, Ranged + Melee, a single item, or empty. With Ranged + Melee you choose the attack mode during combat; any ranged weapon gives one opening shot.</p>
    </section>
  );
}
