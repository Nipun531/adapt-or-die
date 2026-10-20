/**
 * V3 in-fight play styles for simulated fighters (mechanics lab, run agents, mirror). Not game rules.
 * Defence: smart (expected value), always block, always dodge, random, greedy (higher chance).
 * Healing: auto (use when the whole heal is useful), low (only below 50% HP), never.
 * Ranged vs melee (hybrids): best expected damage, prefer one, or random.
 */
import { autoDefense, autoStim, type Chooser, type DefenseChooser, type StimChooser } from '../game/combat.js';
import { bestMode, smartDefense } from '../game/expected.js';
import type { Rng } from '../game/rng.js';
import type { RuleSet } from '../game/rules.js';
import { SIM_SAVINGS_RESERVE } from '../game/supply-plan.js';

export type DefenseStyle = 'smart' | 'block' | 'dodge' | 'random' | 'greedy';
export type StimStyle = 'auto' | 'low' | 'never';
export type ModeStyle = 'best' | 'melee' | 'ranged' | 'random';
export const DEFENSE_STYLES: DefenseStyle[] = ['smart', 'block', 'dodge', 'random', 'greedy'];

export function defenseChooserFor(style: DefenseStyle, rng: Rng, rules: RuleSet): DefenseChooser {
  switch (style) {
    case 'block': return () => ({ action: 'block', source: 'agent' });
    case 'dodge': return () => ({ action: 'dodge', source: 'agent' });
    case 'random': return () => ({ action: rng.next() < 0.5 ? 'block' : 'dodge', source: 'agent' });
    case 'greedy': return autoDefense;
    case 'smart': return smartDefense(rules);
  }
}

export function stimChooserFor(style: StimStyle): StimChooser {
  if (style === 'auto') return autoStim;
  if (style === 'never') return () => ({ use: false, source: 'agent' });
  return ({ view, side }) => ({ use: view.hp[side] < 0.5 * view.fighters[side].derived.maxHp, source: 'agent' });
}

export function modeChooserFor(style: ModeStyle, rng: Rng): Chooser {
  return (ctx) => {
    const att = ctx.view.fighters[ctx.side];
    const def = ctx.view.fighters[ctx.side === 'player' ? 'boss' : 'player'];
    if (style === 'best') return { mode: bestMode(att, def, ctx.options).mode, source: 'agent' };
    if (style === 'random') return { mode: rng.pick(ctx.options), source: 'agent' };
    return { mode: ctx.options.includes(style) ? style : ctx.options[0], source: 'agent' };
  };
}

/**
 * How each run agent defends under V3 (its persona; the run agents' build logic is unchanged).
 * Unknown names (and the mirror) defend 'smart'.
 */
export const AGENT_DEFENSE: Record<string, DefenseStyle> = {
  melee_bruiser: 'greedy',
  archer: 'dodge',
  shield_turtle: 'block',
  hybrid: 'smart',
  adaptive: 'smart',
  piercer: 'greedy',
  duelist: 'dodge',
  opportunist: 'smart',
  switcher: 'random',
  reactive: 'smart',
  random: 'random',
  blocker: 'block',
  dodger: 'dodge',
  stunner: 'smart',
  healer: 'smart',
  counter_puncher: 'block',
  saver: 'smart',
  armourer: 'block',
  counter_builder: 'smart',
  explorer: 'random',
  splitter: 'greedy',
};

/** Gold a simulated player never spends on stims (its savings for gear). The healer spends everything on supplies. */
export function agentSupplyReserve(strategy: string): number {
  return strategy === 'healer' ? 0 : SIM_SAVINGS_RESERVE;
}
