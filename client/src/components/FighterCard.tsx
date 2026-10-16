/**
 * Shows one combatant: level, XP progress, gold, stat points, base stats and the derived combat numbers
 * (Net ATK / Net DEF / effective DEX) exactly as computed by the server.
 */
import type { Combatant } from '../api';
import { Bar, itemName, loadoutText, n2, useCatalog } from '../util';

export function FighterCard({ c, title, note }: { c: Combatant; title: string; note?: string }) {
  const catalog = useCatalog();
  const d = c.derived;
  return (
    <section className={`card fighter fighter-${c.side}`}>
      <header className="fighter-head">
        <h2>{title}</h2>
        <span className="pill">Level {c.level}</span>
      </header>
      <div className="xp-line">
        <span>XP {c.xp} / {c.xpToNext}</span>
        <Bar value={c.xp} max={c.xpToNext} kind="xp" />
      </div>
      <div className="kv-grid">
        <div><label>Gold</label><b>{c.gold}</b></div>
        <div><label>Stat points</label><b className={c.statPoints ? 'hl' : ''}>{c.statPoints}</b></div>
        <div><label>HP</label><b>{c.stats.hp}</b></div>
        <div><label>STR</label><b>{c.stats.str}</b></div>
        <div><label>DEF</label><b>{c.stats.def}</b></div>
        <div><label>DEX</label><b>{c.stats.dex}</b></div>
      </div>
      <div className="derived">
        <div title={`STR + 0.25 × STR × ΣSTR mods (${d.strModSum})`}><label>Net ATK</label><b>{n2(d.netAtk)}</b></div>
        <div title={`DEF + 0.5 × DEF × ΣDEF mods (${d.defModSum})`}><label>Net DEF</label><b>{n2(d.netDef)}</b></div>
        <div title={`max(1, DEX + 0.25 × DEX × ΣDEX mods (${d.dexModSum}))`}><label>Eff. DEX</label><b>{n2(d.effDex)}</b></div>
      </div>
      <p className="loadout"><label>Equipped</label> {loadoutText(catalog, c.loadout)}</p>
      {note && <p className="warn-text small">{note}</p>}
      <p className="muted small">Attack modes: {d.attackModes.join(' / ')} · Inventory: {c.inventory.length ? c.inventory.map((id) => itemName(catalog, id)).join(', ') : 'empty'}</p>
    </section>
  );
}
