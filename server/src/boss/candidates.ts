/**
 * LEGAL NEXT-BUILD CANDIDATES (V4, docs/V4_IMPLEMENTATION_PLAN.md §4).
 *
 * From the player's last OBSERVED state (decision-time information only), every build they could legally bring next
 * round, one per head combination (boss/build-heads.ts):
 *   hands × melee family × armour × where the unspent points go.
 * The concrete items are the strongest the player owns or can afford, chosen in a fixed order (ranged → melee →
 * shield → armour), all within one gold budget. Every candidate is produced by the REAL rules (equipment.ts:
 * allocateStat / purchase / equip), so an impossible build can never be predicted. Its heads are re-derived with
 * `headsOf`, so a candidate is labelled exactly like real data.
 */
import { catalogFor } from '../game/catalog.js';
import { ENGINE_VERSION } from '../game/constants.js';
import { snapshotOf } from '../game/derive.js';
import { allocateStat, equip, purchase } from '../game/equipment.js';
import type { CombatantState, FighterSnapshot, Item, Loadout, StatKey } from '../game/types.js';
import { headsOf, type Heads } from './build-heads.js';

export interface Candidate {
  heads: Heads;
  /** Unique key of the head tuple. */
  key: string;
  state: CombatantState;
  snapshot: FighterSnapshot;
  purchases: string[];
  label: string;
}

export const headKey = (h: Heads) => `${h.hands}|${h.family}|${h.armour}|${h.alloc}`;

type HandsPlan = { ranged: boolean; melee: boolean; shield: boolean };
const HANDS: Record<Heads['hands'], HandsPlan> = {
  ranged: { ranged: true, melee: false, shield: false },
  ranged_melee: { ranged: true, melee: true, shield: false },
  ranged_shield: { ranged: true, melee: false, shield: true },
  melee: { ranged: false, melee: true, shield: false },
  melee_shield: { ranged: false, melee: true, shield: true },
  shield: { ranged: false, melee: false, shield: true },
  empty: { ranged: false, melee: false, shield: false },
};

export function legalCandidates(observed: CombatantState, engineVersion?: string | null): Candidate[] {
  const ev = engineVersion ?? ENGINE_VERSION; // the live catalogue unless a historical run says otherwise
  const items = catalogFor(ev);
  const out = new Map<string, Candidate>();
  const allocs: (StatKey | null)[] = observed.statPoints > 0 ? ['str', 'def', 'dex', 'hp'] : [null];
  /** Strongest item of `pick` that is owned or affordable with `budget`; owned items cost nothing. */
  const best = (pick: (i: Item) => boolean, budget: number, owned: string[]) =>
    items.filter((i) => pick(i) && (owned.includes(i.id) || i.cost <= budget)).sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id))[0];

  for (const [hands, plan] of Object.entries(HANDS) as [Heads['hands'], HandsPlan][]) {
    const families: (Item['family'] | null)[] = plan.melee ? ['blade', 'blunt', 'polearm'] : [null];
    for (const fam of families) {
      for (const armourOpt of ['none', 'keep', 'upgrade'] as const) {
        if (armourOpt === 'keep' && !observed.loadout.armour) continue;
        for (const stat of allocs) {
          let budget = observed.gold;
          const owned = observed.inventory;
          const buys: string[] = [];
          const take = (i: Item | undefined) => {
            if (!i) return null;
            if (!owned.includes(i.id)) { budget -= i.cost; buys.push(i.id); }
            return i.id;
          };
          const ranged = plan.ranged ? take(best((i) => i.category === 'ranged', budget, owned)) : null;
          const melee = plan.melee ? take(best((i) => i.category === 'melee' && i.family === fam, budget, owned)) : null;
          const shield = plan.shield ? take(best((i) => i.category === 'shield', budget, owned)) : null;
          if ((plan.ranged && !ranged) || (plan.melee && !melee) || (plan.shield && !shield)) continue;
          let armour: string | null = null;
          if (armourOpt === 'keep') armour = observed.loadout.armour;
          if (armourOpt === 'upgrade') {
            const curCost = observed.loadout.armour ? (items.find((i) => i.id === observed.loadout.armour)?.cost ?? 0) : -1;
            const a = best((i) => i.category === 'armour' && i.id !== observed.loadout.armour && i.cost >= curCost, budget, owned);
            if (!a) continue;
            armour = take(a);
          }
          const hs = [ranged, melee, shield].filter((x): x is string => !!x);
          const loadout: Loadout = { hand1: hs[0] ?? null, hand2: hs[1] ?? null, armour };
          let s = observed;
          try {
            if (stat) s = allocateStat(s, stat, observed.statPoints);
            for (const id of buys) s = purchase(s, id);
            s = equip(s, loadout);
          } catch {
            continue; // the real rules said no (e.g. unaffordable together)
          }
          const snap = snapshotOf(s);
          const heads = headsOf(observed, snap, ev);
          const key = headKey(heads);
          if (out.has(key)) continue;
          const names = hs.map((id) => items.find((i) => i.id === id)!.name);
          out.set(key, {
            heads, key, state: s, snapshot: snap, purchases: buys,
            label: `${names.join(' + ') || 'empty hands'}${armour ? `, ${items.find((i) => i.id === armour)!.name}` : ''}${stat ? `, +${observed.statPoints} ${stat.toUpperCase()}` : ''}`,
          });
        }
      }
    }
  }
  return [...out.values()];
}
