/**
 * V4 (sim-4.0.0) AGENT FAMILIES for next-build data: varied, reactive, partly stochastic players with per-run personas
 * (drawn once from the run seed, so every run is reproducible). They use the same helpers and rules as sim/agents.ts
 * and only information a human sees: their own state, past results and the boss's last visible gear.
 */
import { getItem, requireItem } from '../game/catalog.js';
import { hashSeed, Rng } from '../game/rng.js';
import type { ItemCategory, Loadout, StatKey } from '../game/types.js';
import * as base from './agents.js';
import type { Agent, RoundOutcome } from './agents.js';

// agents.ts registers these agents, so its helpers are read lazily (at decision time) to keep the import cycle safe.
const buyInOrder: typeof base.agentKit.buyInOrder = (...a) => base.agentKit.buyInOrder(...a);
const bestOwned: typeof base.agentKit.bestOwned = (...a) => base.agentKit.bestOwned(...a);
const loadoutFrom: typeof base.agentKit.loadoutFrom = (...a) => base.agentKit.loadoutFrom(...a);
const allocateByPattern: typeof base.agentKit.allocateByPattern = (...a) => base.agentKit.allocateByPattern(...a);
const after: typeof base.agentKit.after = (...a) => base.agentKit.after(...a);
const preferChooser: typeof base.agentKit.preferChooser = (...a) => base.agentKit.preferChooser(...a);
const expectedDamageChooser: base.Chooserish = (ctx) => base.agentKit.expectedDamageChooser(ctx);
const persona = (runSeed: string | undefined, tag: string) => new Rng(hashSeed(`${runSeed ?? 'seed'}:${tag}`));
const lastBoss = (h: RoundOutcome[]) => h[h.length - 1]?.bossLoadout;
const bossHas = (lo: Loadout | undefined, cat: ItemCategory) => !!lo && [lo.hand1, lo.hand2, lo.armour].some((id) => id && getItem(id)?.category === cat);

/** Saves for one expensive target (persona) and fights with a cheap weapon meanwhile. */
export const saver: Agent = {
  name: 'saver',
  description: 'Saves gold for one expensive item drawn per run (Warhammer, Longbow, Pike, Great Shield or Heavy Armor), then builds around it.',
  decide({ state, runSeed }) {
    const target = persona(runSeed, 'saver').pick(['warhammer', 'longbow', 'pike', 'great_shield', 'heavy_armour']);
    const cheap = target === 'longbow' ? 'bow' : 'knuckle';
    const owned = state.inventory.includes(target);
    const purchases = state.inventory.length === 0 && state.gold >= requireItem(cheap).cost
      ? [cheap]
      : buyInOrder(state, owned ? (target === 'longbow' ? ['longsword'] : ['leather_armour', 'light_armour']) : [target]);
    const inv = after(state, purchases);
    const ranged = target === 'longbow' && !!bestOwned(inv, 'ranged');
    const hands: ItemCategory[] = ranged ? ['ranged', 'melee'] : target === 'great_shield' ? ['melee', 'shield'] : ['melee'];
    const pattern: StatKey[] = ranged ? ['dex', 'dex', 'hp'] : target === 'great_shield' || target === 'heavy_armour' ? ['def', 'hp'] : ['str', 'hp'];
    return {
      allocations: allocateByPattern(state, pattern), purchases,
      loadout: loadoutFrom(inv, hands, true, { str: 1, def: 0.5, dex: ranged ? 1 : 0.1, pierce: 10 }),
      note: `saving for ${target}`,
    };
  },
  chooser: () => expectedDamageChooser,
};

/** Defence first; after two losses in a row it drops the shield for STR and a single weapon. */
export const armourer: Agent = {
  name: 'armourer',
  description: 'Buys armour and shields before better weapons, DEF/HP; after two straight losses it drops the shield and adds STR.',
  decide({ state, history }) {
    const purchases = buyInOrder(state, ['knuckle', 'leather_armour', 'wood_shield', 'light_armour', 'small_shield', 'iron_club', 'heavy_armour', 'mace', 'great_shield']);
    const inv = after(state, purchases);
    const twoLosses = history.length >= 2 && history.slice(-2).every((x) => x.winner === 'boss');
    return {
      allocations: allocateByPattern(state, twoLosses ? ['str', 'def', 'hp'] : ['def', 'hp', 'def']), purchases,
      loadout: loadoutFrom(inv, twoLosses ? ['melee'] : ['melee', 'shield'], true, { str: 1, def: 0.8, dex: 0.1, block: 30 }),
      note: twoLosses ? 'armourer: shield dropped' : 'armourer: shield up',
    };
  },
  chooser: () => preferChooser('melee'),
};

type Plan = 'pierce' | 'turtle' | 'ranged' | 'stun';
const COUNTER_WISH: Record<Plan, string[]> = {
  pierce: ['spear', 'lance', 'pike'],
  turtle: ['wooden_club', 'wood_shield', 'leather_armour', 'small_shield', 'light_armour'],
  ranged: ['bow', 'crossbow', 'longbow'],
  stun: ['wooden_club', 'iron_club', 'mace', 'flail'],
};
/** Counters the boss's last visible gear (15% noise). */
export const counterBuilder: Agent = {
  name: 'counter_builder',
  description: 'Reads the boss’s last gear: shields/armour → pierce polearms + STR; a bow → shield + armour + DEF; melee → a bow + DEX when affordable, else blunt stun weapons.',
  decide({ state, history, rng }) {
    const b = lastBoss(history);
    let plan: Plan = 'stun';
    if (bossHas(b, 'shield') || (b?.armour && (getItem(b.armour)?.cost ?? 0) >= 25)) plan = 'pierce';
    else if (bossHas(b, 'ranged')) plan = 'turtle';
    else if (bossHas(b, 'melee')) plan = 'ranged';
    if (rng.next() < 0.15) plan = rng.pick(['pierce', 'turtle', 'ranged', 'stun'] as const);
    let purchases = buyInOrder(state, COUNTER_WISH[plan]);
    let inv = after(state, purchases);
    if (plan === 'ranged' && !bestOwned(inv, 'ranged')) { plan = 'stun'; purchases = buyInOrder(state, COUNTER_WISH.stun); inv = after(state, purchases); }
    const hands: ItemCategory[] = plan === 'ranged' ? ['ranged', 'melee'] : plan === 'turtle' ? ['melee', 'shield'] : ['melee'];
    const pattern: StatKey[] = plan === 'ranged' ? ['dex', 'hp'] : plan === 'turtle' ? ['def', 'hp'] : ['str', 'str', 'hp'];
    return {
      allocations: allocateByPattern(state, pattern), purchases,
      loadout: loadoutFrom(inv, hands, true, { str: 1, def: plan === 'turtle' ? 1 : 0.3, dex: plan === 'ranged' ? 1 : 0.1, pierce: plan === 'pierce' ? 40 : 5 }),
      note: `counter ${plan}`,
    };
  },
  chooser: () => expectedDamageChooser,
};

const ARCH = ['melee', 'ranged', 'hybrid', 'turtle', 'pierce'] as const;
type Arch = (typeof ARCH)[number];
const EXPLORE_WISH: Record<Arch, string[]> = {
  melee: ['sword', 'leather_armour', 'longsword', 'greatsword'],
  ranged: ['bow', 'leather_armour', 'crossbow', 'longbow'],
  hybrid: ['knife', 'bow', 'sabre', 'crossbow'],
  turtle: ['wooden_club', 'wood_shield', 'light_armour', 'small_shield'],
  pierce: ['spear', 'leather_armour', 'lance', 'pike'],
};
/** The archetype the explorer would try in round n (a seeded sequence, so the agent stays stateless). */
const exploreArch = (runSeed: string | undefined, n: number): Arch => ARCH[Math.floor(new Rng(hashSeed(`${runSeed}:explorer:${n}`)).next() * ARCH.length)];
/** Tries archetypes with a per-run curiosity ε; otherwise repeats the one with the best record. */
export const explorer: Agent = {
  name: 'explorer',
  description: 'Tries archetypes (melee, ranged, hybrid, turtle, pierce) with a per-run curiosity of 20–60%; otherwise repeats the one with the best record.',
  decide({ state, history, rng, runSeed }) {
    const eps = 0.2 + 0.4 * persona(runSeed, 'explorer').next();
    const past = history.map((h, i) => ({ a: (h as RoundOutcome & { arch?: Arch }).arch ?? exploreArch(runSeed, i + 1), won: h.winner === 'player' }));
    const score = (a: Arch) => { const r = past.filter((x) => x.a === a); return r.length ? (r.filter((x) => x.won).length + 1) / (r.length + 2) : 0.5; };
    const best = [...ARCH].sort((x, y) => score(y) - score(x))[0];
    const a = history.length === 0 || rng.next() < eps ? exploreArch(runSeed, history.length + 1) : best;
    const purchases = buyInOrder(state, EXPLORE_WISH[a]);
    const inv = after(state, purchases);
    const hands: ItemCategory[] = a === 'ranged' ? ['ranged'] : a === 'hybrid' ? ['ranged', 'melee'] : a === 'turtle' ? ['melee', 'shield'] : ['melee'];
    return {
      allocations: allocateByPattern(state, a === 'ranged' || a === 'hybrid' ? ['dex', 'hp'] : a === 'turtle' ? ['def', 'hp'] : ['str', 'hp']), purchases,
      loadout: loadoutFrom(inv, hands, a !== 'hybrid', { str: 1, def: 0.4, dex: 0.6, pierce: a === 'pierce' ? 40 : 0 }),
      note: `explorer ${a} (ε ${eps.toFixed(2)})`,
    };
  },
  chooser: () => expectedDamageChooser,
};

/** Splits its points between the two stats its current gear rewards most. */
export const splitter: Agent = {
  name: 'splitter',
  description: 'Buys from one of two wishlists (per run), then splits its points between the two stats its gear rewards most.',
  decide({ state, runSeed }) {
    const ranged = persona(runSeed, 'splitter').next() < 0.5;
    const purchases = buyInOrder(state, ranged ? ['bow', 'wood_shield', 'leather_armour', 'crossbow', 'small_shield'] : ['wooden_club', 'leather_armour', 'iron_club', 'light_armour', 'flail']);
    const inv = after(state, purchases);
    const loadout = loadoutFrom(inv, ranged ? ['ranged', 'shield'] : ['melee'], true, { str: 1, def: 0.5, dex: 1 });
    const want: Record<StatKey, number> = { hp: 0.5, str: 0, def: 0, dex: 0 };
    for (const id of [loadout.hand1, loadout.hand2, loadout.armour]) {
      if (!id) continue;
      const g = requireItem(id);
      if (g.category === 'ranged') want.dex += 2;
      if (g.category === 'melee') want.str += 1 + g.mods.str / 5;
      if (g.category === 'shield' || g.category === 'armour') want.def += 1;
    }
    const [a, b] = (Object.entries(want) as [StatKey, number][]).sort((x, y) => y[1] - x[1]).map(([k]) => k);
    const pa = Math.ceil(state.statPoints / 2);
    const allocations = state.statPoints > 0 ? [{ stat: a, points: pa }, ...(state.statPoints - pa > 0 ? [{ stat: b, points: state.statPoints - pa }] : [])] : [];
    return { allocations, purchases, loadout, note: `splitter ${a}/${b}` };
  },
  chooser: () => expectedDamageChooser,
};

export const V4_AGENTS: Agent[] = [saver, armourer, counterBuilder, explorer, splitter];
