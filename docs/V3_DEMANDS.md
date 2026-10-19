# V3 Demands — owner decisions (spec of record)

Source design: `context/The_Boss_Remembers_V3_Combat_Redesign_Plan_1.3.docx`. Plan: `docs/V3_IMPLEMENTATION_PLAN.md` (§I lists every decision).
This file records **what the owner decided** (2026-10-19), how it maps to formulas, and what is still open.

Labels:
- **[OWNER]** — the owner's words, near-verbatim.
- **[SPEC]** — the exact implementation reading of that answer.
- **[DEFAULT]** — Claude's recommendation, used until the owner objects.
- **[OPEN]** — not decided yet.

Every number lives in one config (`game/rules/v3.ts`). Numbers marked *provisional* are tuned by simulation, only with owner approval.

---

## 1. Definitions used everywhere

Combat values:
- `A` — the attacker's attack value: Net ATK for melee or unarmed, effective DEX for ranged. Unchanged from V2.
- `DEF` — the defender's Net DEF.
- `rawHit = A × A / (A + DEF)` — the "1st damage" **[OWNER]**.
- `mitRoll` — the DEX-mitigation random roll, uniform in 0.20–0.50.
- `mitigation = max(0, mitRoll × (1 − 1/ratio))`, where `ratio = defender effDex / attacker effDex`. Unchanged from V2.
- `wouldBeFinal = rawHit × (1 − mitigation)` — the hit the defender would have taken.

**Attack shaved off** **[OWNER]**. Picture the defender being hit. Shaved off is the percentage difference between the 1st damage (`ATK × ATK/(ATK+DEF)`) and the final damage after DEF and DEX are taken off. It is computed for every attack, including blocked and dodged ones, as if the attack had hit.

- **[OWNER Q-1]** The base is the attack value: `shaved = (A − wouldBeFinal) / A`.
  - It counts both what DEF removed (`DEF/(A+DEF)`) and what DEX removed.
  - Typical range 15–50%. Example: A 56, DEF 27.5, final 34 → 39%.
- **Dodge delta [OWNER]:** compare the defender's net DEX with the attacker's, the same DEX the First Shot uses.
  - **[SPEC]** `dodgeDelta = max(0, defender effDex − attacker effDex)`, in DEX points. effDex = Net DEX floored at 1.

## 2. Block

- **[OWNER]** Check both readings (raw DEF and Net DEF). Cap at 70%.
- **[SPEC]** `blockChance = min(0.70, 0.005 × D + Σ gear blockBonus)`. Ranged weapons add 0.
- `D` is a RuleSet switch, `raw` or `net`. Phase C1 simulates both; the owner picks with data:
  - **raw** = the DEF stat (base + level-ups + points);
  - **net** = Net DEF.
- Gear block bonuses come from the catalogue:
  - Light Armor 2%, Heavy Armor 5%;
  - Wood Shield 10%, Small Shield 20%, Great Shield 30%.
- Block is all-or-nothing: on success the defender takes 0 damage.

## 3. Dodge

- **[SPEC]** `dodgeChance = min(0.70, 0.02 × dodgeDelta)`. The 70% cap is the owner's answer to Q-3.

## 4. Counters

- **[OWNER]** A counter is a **mini move**: it is calculated with the normal attack formula.
- **[SPEC]** The counterer attacks the original attacker with their own melee weapon (or unarmed) through the full V2 pipeline:
  - Net ATK, pierce roll if the weapon has pierce, `A²/(A+DEF)`, DEX mitigation;
  - then × **1.5** after a block, or × **0.75** after a dodge.
- **[OWNER]** Counters can't be blocked, dodged or countered.
- Ranged attacks are never countered; this includes the First Shot.
- **Block counter:**
  - chance = `attack shaved off %` (per Q-1), capped at **[DEFAULT]** 70%;
  - adds **+20 stun** to the countered attacker.
- **Dodge counter:**
  - only with a weapon that has a Dodge Counter modifier: Flail +5%, Spear +10%, Lance +20%, Pike +30%;
  - chance = `(dodgeDelta + weapon mod)%`, capped at **[DEFAULT]** 70%;
  - rolled only after a successful dodge; adds no stun.
- **[DEFAULT]** Who can block-counter:
  - a defender with a melee weapon, or with no weapon at all (unarmed);
  - a bow-only defender cannot counter, because a counter is a melee mini move;
  - Bow + melee holders counter with the melee weapon.
- **[DEFAULT]** A counter does not use up the defender's own turn. It sits inside the attacker's sequence, as the doc says. It can KO.

## 5. Stun

**Stun gain per attack [OWNER]:**
```
gain = attack shaved off % + DEX-mitigation roll % + weapon Stun Boost %
```
- The DEX-mitigation roll is the 0.20–0.50 value.
- Stun Boost per weapon: Wooden Club 4, Iron Club 8, Mace 12, Warhammer 20.

- **[OWNER Q-2]** The sum is scaled into the doc's 10–20 range: `gain = 10 + 10 × min(1, shaved + mitRoll + boost)`.
  - Example: 0.39 + 0.35 + 0.12 = 0.86 → 18.6 stun.

What else is decided about stun:
- **Thresholds:** meter capacity 100. A counter adds +20; a dodge counter adds 0.
- **Heavy block:** blocking a "very heavy" hit still adds the stun gain to the blocker.
  - **[DEFAULT]** "Very heavy" = `wouldBeFinal ≥ 25% of the blocker's max HP`. The threshold is *provisional*.
- **[DEFAULT]** Which hits add stun:
  - **every** landed hit adds stun, by any weapon;
  - a dodged hit adds 0;
  - a blocked hit adds stun only if it is very heavy.
- **[DEFAULT]** Only weapons marked "can cause stun" (Iron Club, Mace, Flail, Warhammer) **trigger** a stun.
  - The trigger happens when that weapon's hit brings the meter to 100 or more.
  - With another weapon, the meter stops at 100 and waits for a trigger hit.
- **[DEFAULT]** On a stun:
  - **extra damage = +25% of that hit's damage** (*provisional*);
  - the stunned fighter **automatically fails the defence of the next incoming attack** and **loses its next whole action** (regular attack + DEX bonus attacks);
  - the meter then resets to 0.
- **[DEFAULT]** The meter resets to 0 at the start of every round.
- **[DEFAULT]** Stun chains are measured, not prevented. A guard is only added with owner approval if fights show chains.

## 6. Healing stims and economy

What the owner decided:
- **[OWNER] Buying:** 10 gold buys one stim.
- **[OWNER] Heal:** 20% of max HP by default.
- **[OWNER] Slots:** one stim slot to start. A used stim does not refill its slot until a new stim is bought.
  - **[SPEC]** Stims you hold carry over between rounds. You can buy only while you have an empty slot.
- **[OWNER] Starting gold: 10, up from 0.** The engine constant `STARTING_GOLD` = 10, for both player and boss.
  - Effect: round-1 buying becomes real. Affordable at 10 gold: Knuckle, Knife, Wooden Club, Wood Shield, Sword, Leather Armor, or a stim.
  - The boss's round-1 decision now includes purchases. No ranged weapon is affordable in round 1: the cheapest, the Bow, costs 15.

Upgrades — the owner left the design to Claude **[DEFAULT]**, values *provisional*:
- **Slot upgrade:** 25, 30, 35 gold (+5 each). Each upgrade adds 1 slot. Maximum 4 slots.
- **Effectiveness upgrade:** 25, 30, 35, 40 gold (+5 each). Each adds +5 percentage points of max-HP heal. 20% → 25 → 30 → 35 → 40%; maximum 40%.

Rules for using stims **[DEFAULT]**:
- A stim can be used before the fighter's own action each turn. At most 1 per turn.
- Healing never goes above max HP.
- **Not** usable while stunned, because the stunned fighter loses that action.
- The boss buys and uses stims under the same rules.

## 7. Catalogue

- **[OWNER]** Pierce values = the **tuned V2 values** in `catalogs/v2.ts`, not the doc's original values.
- Costs and STR/DEF/DEX modifiers follow the doc. These are identical to V2, except the **Warhammer, which costs 45** (owner, Q-4; it was 40 in V2).
- New fields from the doc:
  - block bonuses (armour and shields);
  - Stun Boost (clubs, mace, warhammer);
  - can cause stun (Iron Club, Mace, Flail, Warhammer);
  - Dodge Counter (Flail, Spear, Lance, Pike).
- These stay *provisional, tune with approval*.

## 8. Defence prompts

- **[OWNER]** The player chooses Block or Dodge for **every** incoming attack. There is no stance or auto mode.
- **[SPEC]** The engine pauses on the defender for every boss attack, including DEX bonus attacks and the First Shot. Keys: B / D.
- The boss and simulation agents answer automatically. The boss sees only the announced attack and public state.

## 9. UI direction

- **[OWNER]** Design is delegated to Claude, following the owner's considerations. Those considerations are:
  - restrained dark fantasy;
  - clarity and discoverability first;
  - no flashy animation;
  - not a dashboard.
- Plan §E.3 is the brief. The Court Deck world is replaced; the structure is kept.

## 10. Status

- Q-1 to Q-4 were answered on 2026-10-19 (all as recommended). No blocking decision is open.
- **[DEFAULT]** items stand unless the owner objects.
- Measured by simulation in Phase C1, not decided up front:
  - raw vs Net DEF for block (§2);
  - D-8 (which DEX benefits stay; ablation).
- Still open:
  - D-13 (boss difficulty bands);
  - D-17 (rewards);
  - D-18 (UI test dev dependency).

## 11. Phase B engine notes (2026-10-19) — how the rules are implemented

Code:
- `server/src/game/rules.ts`: RuleSet v2/v3; every V3 number lives in `V3_COMBAT`.
- `game/formulas.ts`: the V3 section.
- `game/combat.ts`: `advanceV3` / `resolveExchange`.
- `game/catalogs/v3.ts`: not live until Phase C2.
- Tests: `tests/unit/v3-combat.test.ts`.

Details fixed while building. Each is consistent with the decisions above; they are **[DEFAULT]** until the owner objects.

- **Order inside one attack:**
  1. Announce the attack.
  2. Defence: block or dodge, or none if the defender is stunned.
  3. Compute the would-be hit (V2 pipeline).
  4. Land the hit, or block/dodge it.
  5. Stun gain and trigger.
  6. KO check.
  7. Counter mini move: its damage, its stun, KO check.
- **Fixed random draws:** six per attack, always in this order: defence, counter, pierce, mitigation, counter pierce, counter mitigation. The defence choice never shifts later rolls (tested).
- **Counters:**
  - The counter uses the defender's melee weapon, or fists when it holds no weapon at all.
  - Bow-only and bow + shield defenders cannot block-counter.
  - A counter has its own pierce and mitigation rolls.
  - The +20 block-counter stun can trigger a stun only if the counter weapon can stun.
- **Lost attack turn (exactly one):**
  - Stunned during its own action with attacks left → the rest of that action is lost.
  - Otherwise → its next action is skipped (a `skip` note).
  - The lost defence applies to the next incoming attack.
- **Heavy block:**
  - The stun gain uses the same formula as a hit.
  - If it triggers a stun, the extra damage is 25% of the blocked hit's would-be damage.
- **Stims:**
  - Offered at the start of the fighter's regular action, before the attack.
  - Only offered if it holds a stim and is below max HP.
  - Not offered on a skipped (stunned) action.
- **Automatic choices** (boss and agents until Phase C2/D refine them):
  - Defence: the higher success chance; a tie goes to block.
  - Stim: used when the HP lost ≥ the heal amount.
  - The human's choices pause the engine (`pending.kind` = `attack_mode` / `defense` / `stim`).
- **Chance caps:** block and dodge are capped at 70%. The caps also prevent stalls. With a 100% defence on both sides a round could never end; the harness tests use one-sided 100% only.
- **First look** (scratch run, untuned, mid-game builds; not evidence yet):
  - Block turtle vs the hybrid boss build: boss 100% → 46%.
  - DEX dodger (Pike) vs hybrid: still 100%, because gear DEX mods multiply and the hybrid reaches about 60 DEX.
  - **Stun triggered 0.00 times per round** in all three matchups.
  - Phase C1 measures all of this properly.
