/**
 * The rules reference: an optional drawer, grouped by topic, in plain words. Every number comes from the server
 * (`/api/catalog` → rules), so the text cannot drift from the game. Opened from the top bar ("Rules") or with "?".
 */
import { useEffect, useRef, useState } from 'react';
import { useCatalog } from '../util';
import { GlyphIcon, Icon } from './Icon';

const P = (x: number) => `${Math.round(x * 100)}%`;

export function RulesButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) ref.current?.showModal(); else ref.current?.close(); }, [open]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === '?' && !(t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) setOpen(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <>
      <button className="nav-link" onClick={() => setOpen(true)} aria-haspopup="dialog"><Icon name="book" size={16} /> Rules</button>
      {open && <RulesDrawer dref={ref} onClose={() => setOpen(false)} />}
    </>
  );
}

function RulesDrawer({ dref, onClose }: { dref: React.RefObject<HTMLDialogElement>; onClose: () => void }) {
  const catalog = useCatalog();
  const r = catalog?.rules;
  const c = r?.combat;
  return (
    <dialog ref={dref} className="drawer" aria-labelledby="rules-h" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <header className="drawer-head">
        <h2 id="rules-h">How the duel works</h2>
        <button className="btn btn-quiet btn-small" onClick={onClose} aria-label="Close rules"><Icon name="close" size={16} /></button>
      </header>
      <div className="drawer-body">
        <section>
          <h3>The run</h3>
          <p>You and the boss start equal: level 1, {r?.startingGold ?? 10} gold, two stat points each. Every round both of you earn XP and gold (win {r?.rewards.xpWin} XP / {r?.rewards.goldWin} gold, loss {r?.rewards.xpLoss} XP / {r?.rewards.goldLoss} gold), level up and re-arm. The boss only sees how you fought last round, never your new build.</p>
        </section>
        <section>
          <h3><GlyphIcon glyph="sword" size={16} /> Attacking</h3>
          <p>Each turn the faster fighter acts first. A strike uses your <b>attack</b> (strength plus weapon bonuses); a shot uses your <b>speed</b>. With a bow and a melee weapon you choose each time (R / M). A big speed lead gives extra attacks. Bows also get a First Shot before the first turn. Damage falls with the defender's <b>defence</b>; pierce weapons sometimes ignore part of it.</p>
        </section>
        <section>
          <h3><GlyphIcon glyph="shield" size={16} /> Defending</h3>
          <p>You answer every attack aimed at you with <b>Block</b> (B) or <b>Dodge</b> (D). Either one, if it works, stops all the damage.</p>
          {c && <ul>
            <li><b>Block</b>: {P(c.block.defFactor)} per point of your DEF stat, plus shields and armour (Wood Shield +10% … Great Shield +30%), at most {P(c.block.cap)}.</li>
            <li><b>Dodge</b>: {P(c.dodge.base)} plus {P(c.dodge.perDexPoint)} for every point of speed you have over the attacker, at most {P(c.dodge.cap)}.</li>
          </ul>}
        </section>
        <section>
          <h3>Counters</h3>
          {c && <p>A successful block can <b>counter</b> at once for ×{c.counter.blockMultiplier} damage and +{c.counter.blockCounterStun} stun to the attacker. A dodge can counter for ×{c.counter.dodgeMultiplier} only with a long weapon (Spear, Lance, Pike, Flail). Ranged attacks are never countered, and a counter cannot itself be blocked or countered.</p>}
        </section>
        <section>
          <h3><GlyphIcon glyph="star" size={16} /> Stun</h3>
          {c && <p>Every hit that lands fills the target's stun meter. At {c.stun.threshold}, a hit from a weapon that <b>can stun</b> (Iron Club, Mace, Flail, Warhammer) stuns: +{P(c.stun.extraDamageFraction)} damage, the target cannot defend the next attack and loses an attack turn, and the meter empties. Meters start empty each round.</p>}
        </section>
        <section>
          <h3><GlyphIcon glyph="vial" size={16} /> Healing stims</h3>
          <p>A stim costs 10 gold and fills one empty slot; you start with one slot. Before one of your turns you can drink it (U) to heal part of your health. A used stim is gone until you buy another. Upgrades add slots or heal more.</p>
        </section>
        <section>
          <h3>Ending a round</h3>
          <p>The round ends when a fighter falls{c ? `, or after turn ${c.round.turnLimit}: then the fighter with the larger share of health left wins` : ''}.</p>
        </section>
      </div>
    </dialog>
  );
}
