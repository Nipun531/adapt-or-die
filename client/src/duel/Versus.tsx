/**
 * The Versus bar: both fighters as face-up court cards. Numbers rank by scale alone: max HP and the three
 * combat numbers the server derived (Net ATK, Net DEF, effective DEX) set large; base stats and economy small.
 */
import type { Combatant, StatKey } from '../api';
import { Icon, StatPip } from '../ui/Icon';
import { Meter } from '../ui/states';
import { loadoutText, n2, useCatalog } from '../util';

const NET: { stat: StatKey; key: 'netAtk' | 'netDef' | 'effDex'; label: string; formula: (c: Combatant) => string }[] = [
  { stat: 'str', key: 'netAtk', label: 'Net ATK', formula: (c) => `STR ${c.stats.str} + 0.25 × STR × gear STR (${c.derived.strModSum})` },
  { stat: 'def', key: 'netDef', label: 'Net DEF', formula: (c) => `DEF ${c.stats.def} + 0.5 × DEF × gear DEF (${c.derived.defModSum})` },
  { stat: 'dex', key: 'effDex', label: 'Eff. DEX', formula: (c) => `max(1, DEX ${c.stats.dex} + 0.25 × DEX × gear DEX (${c.derived.dexModSum}))` },
];

export function CourtCard({ c, title, note }: { c: Combatant; title: string; note?: string }) {
  const catalog = useCatalog();
  const boss = c.side === 'boss';
  return (
    <section className={`court stock court-${c.side}`} aria-label={`${title}, level ${c.level}`}>
      <div className="court-index" aria-hidden="true">
        <span className="court-level">{c.level}</span>
        <span className="court-level-label">LVL</span>
        {boss && <span className="court-crown"><Icon name="crown" size={16} /></span>}
      </div>
      <div className="court-body">
        <div className="court-head">
          <h2>{title}</h2>
          <span className="court-hp" title="Max HP — every round starts at full HP">
            <StatPip stat="hp" size={18} hideLabel /> <b>{c.stats.hp}</b><small>HP</small>
          </span>
        </div>
        <p className="court-gear">{loadoutText(catalog, c.loadout)}</p>
        <dl className="court-nets">
          {NET.map((n) => (
            <div key={n.key} title={n.formula(c)}>
              <dt><StatPip stat={n.stat} size={14} /></dt>
              <dd><b>{n2(c.derived[n.key])}</b><small><span className="net-label">{n.label} · </span>base {c.stats[n.stat]}</small></dd>
            </div>
          ))}
        </dl>
        <div className="court-foot">
          <span className="court-xp"><span>XP {c.xp}/{c.xpToNext}</span><Meter value={c.xp} max={c.xpToNext} label={`${title} XP`} tone="xp" /></span>
          <span className="court-gold"><b>{c.gold}</b> gold</span>
          {c.statPoints > 0 && (boss
            ? <span className="chip chip-pending">{c.statPoints} point{c.statPoints === 1 ? '' : 's'}, spent when the next round begins</span>
            : <span className="chip chip-points">{c.statPoints} stat point{c.statPoints === 1 ? '' : 's'} to spend</span>)}
        </div>
        {note && <p className="court-note">{note}</p>}
      </div>
    </section>
  );
}

export function Versus({ player, boss, record, playerTitle = 'You', bossNote }: {
  player: Combatant; boss: Combatant; record: { wins: number; losses: number }; playerTitle?: string; bossNote?: string;
}) {
  return (
    <div className="versus">
      <CourtCard c={player} title={playerTitle} />
      <div className="versus-mid" aria-label={`Record: you ${record.wins}, boss ${record.losses}`}>
        <span className="versus-vs">VS</span>
        <span className="versus-score"><b className="tone-player">{record.wins}</b><span>–</span><b className="tone-boss">{record.losses}</b></span>
      </div>
      <CourtCard c={boss} title="The Boss" note={bossNote} />
    </div>
  );
}
