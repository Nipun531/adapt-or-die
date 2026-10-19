/**
 * A simple, documented SUPPLY HEURISTIC (not a game rule) used by the boss and by simulated players to spend
 * leftover gold on healing stims after their gear plan (V3 Phase C2). Everything goes through equipment.ts
 * `buySupply`, so the same rules as the human player apply. Phase D may replace it with policy search.
 *
 *  1. Keep at least one stim: buy one when none is held.
 *  2. Upgrade only with spare gold (≥ the upgrade price + one stim): effectiveness up to the slot count, then slots.
 *  3. Fill empty slots with stims while gold allows.
 * `reserve` = gold never spent on supplies (simulated players keep SIM_SAVINGS_RESERVE for their next gear purchase,
 * so stims do not starve a saving strategy such as the archer's first bow; the boss keeps 0 — its policy already
 * planned its gear this round).
 */
import { buySupply, supplyCost, supplyProblem, suppliesOf, type SupplyAction } from './equipment.js';
import { STIM_COST } from './constants.js';
import type { CombatantState } from './types.js';

export const SIM_SAVINGS_RESERVE = 15;

export function autoSupplies(state: CombatantState, reserve = 0): { state: CombatantState; actions: { action: SupplyAction; cost: number }[] } {
  let s = state;
  const actions: { action: SupplyAction; cost: number }[] = [];
  const affordable = (action: SupplyAction) => !supplyProblem(s, action) && s.gold - supplyCost(s, action) >= reserve;
  const take = (action: SupplyAction) => {
    actions.push({ action, cost: supplyCost(s, action) });
    s = buySupply(s, action);
  };
  if (suppliesOf(s).stims === 0 && affordable('buy_stim')) take('buy_stim');
  for (let guard = 0; guard < 8; guard++) {
    const sup = suppliesOf(s);
    const up: SupplyAction = sup.effectiveness < sup.slots ? 'upgrade_effectiveness' : 'upgrade_slots';
    if (!affordable(up) || s.gold < supplyCost(s, up) + STIM_COST + reserve) break;
    take(up);
  }
  while (affordable('buy_stim')) take('buy_stim');
  return { state: s, actions };
}
