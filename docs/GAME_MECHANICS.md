# Game Mechanics — The Boss Remembers (engine 2.0.0)

Source of truth: `context/adaptive_boss_duel_v1_game_plan_updated.docx` ("Game Mechanics — Current V1 Specification").
This file copies those rules faithfully and lists every **developer decision** made where the plan is silent.
Nothing here is a new mechanic. Player and boss use exactly the same rules.

Where the rules live in code:

| Rule | File |
|---|---|
| Numbers (stats, rewards, factors, thresholds) | `server/src/game/constants.ts` |
| Equipment catalogue | `server/src/game/catalogs/v2.ts` (live), `catalogs/v1.ts` (frozen, engine 1.x history), access via `server/src/game/catalog.ts` |
| Formulas (one function each) | `server/src/game/formulas.ts` |
| Derived combat numbers from stats + gear | `server/src/game/derive.ts` |
| Slots, purchases, stat allocation | `server/src/game/equipment.ts` |
| Rewards, XP, level-ups | `server/src/game/progression.ts` |
| Turn order, opening shots, bonus attacks, piercing | `server/src/game/combat.ts` |
| Tests pinning all of the above | `server/tests/unit/rules.test.ts`, `server/tests/unit/combat.test.ts` |

When you change a rule: change the constant/function, update the unit test, update this document, and bump
`ENGINE_VERSION` in `constants.ts` (stored on every run/round so old data stays attributable).

Engine versions:
- **1.0.0**: the original V1 rules.
- **1.1.0**: adds the 2 initial stat points per combatant (§1).
- **2.0.0** (current, Version 2, see `docs/V2_DEMANDS.md`), which changes four things:
  - the V2 catalogue (§8);
  - loss rewards of 30 XP / 5 gold and a level-up reward of +20 gold (§2);
  - pierce on any weapon that has a pierce spec (§5);
  - only the DEX-advantaged ranged fighter gets the opening shot (§5).

Runs created under 1.x are **view-only** under 2.0.0. They display with their own (V1) catalogue, but they cannot be continued, because their rules and items differ. Ending them is still allowed.

## 1. Core attributes (plan §1)

| Attribute | Starting value | Level-up increase (automatic) | Stat-allocation increase (per point) |
|---|---|---|---|
| HP | 100 | +5 | +5 |
| STR / ATK | 20 | +2 | +3 |
| DEF | 10 | +1 | +2 |
| DEX / AGI | 10 | +1 | +2 |

STR is used for melee attacks. DEX is used for ranged attacks, DEX mitigation and bonus attacks. DEF absorbs damage. HP determines survivability.

- **DECISION:** both combatants start at Level 1 with 0 gold, no items, empty slots.
- **DECISION (user-requested, engine 1.1.0):** both combatants also start every run with **2 unallocated stat points** (`INITIAL_STAT_POINTS`).
  They are spent with the normal allocation increments above, before round 1:
  - the player allocates them in the preparation screen; the server refuses to start round 1 while any are unspent;
  - the boss allocates them in its round-1 preparation through its normal decision policy (it enumerates every split of its points; it cannot see the player's allocation);
  - they are granted exactly once, when the run is created (ledger entry `initial_points`), never on resume or in later rounds.
  They are not a level, XP, gold or any other reward. Runs created under engine 1.0.0 (before this rule) started with 0 points and keep their original rules.
- **DECISION:** 1 stat point per level-up (`STAT_POINTS_PER_LEVEL`). The plan mentions skill points but defines no skills, so **skills are not implemented in V1** (no skill points are awarded).
- **DECISION:** HP is fully restored at the start of every round (each round is a fresh duel; HP = max HP = the HP stat).

## 2. Leveling, XP and gold (plan §2)

- XP required to reach level L = `100 × 1.12^(L − 2)`; reaching Level 2 needs 100 XP.
  - **DECISION:** rounded to the nearest integer → 100, 112, 125, 140, 157, 176, 197, 221, 248, …
  - Surplus XP carries over; several level-ups can happen at once.
- Round rewards (engine 2.0.0): **winner 50 XP + 10 gold, loser 30 XP + 5 gold.** (V1: loser 20 XP + 4 gold.)
- Each level-up: **+20 gold** (V1: +25), the automatic attribute increase above, and the stat point.
- A loss can now trigger a level-up (for example 70 XP + 30 = 100). Winning is still strictly better per round (+20 XP, +5 gold), so there is no incentive to lose on purpose.
- Gold buys items. **DECISION:** item *upgrades* are mentioned by the plan but not specified, so they are not implemented in V1. Items cannot be sold.
- Gold can never go negative (enforced in code and by a database CHECK constraint).

## 3. Combat and damage formulas (plan §3, §5)

Modifier sums (Σ) are taken over the equipped gear.
**DECISION (approved):** all equipped items count — both hand slots and armour — and each modifier column feeds its own stat:
STR mods → Net ATK, DEF mods → Net DEF, DEX mods → Net DEX. (So e.g. Great Shield's +1 STR raises Net ATK.)

```
Net ATK  = STR + 0.25 × (STR × ΣSTR mods)
Net DEF  = DEF + 0.5  × (DEF × ΣDEF mods)
Net DEX  = DEX + 0.25 × (DEX × ΣDEX mods)
Effective DEX = max(1, Net DEX)                         ← DECISION (prevents division by zero / negative DEX)

Attack value = Net ATK for melee/unarmed attacks, Effective DEX for ranged attacks
DEF used     = defender Net DEF × (1 − pierce ignore %)  (ignore % = 0 unless the attack pierces)
Net damage before DEX mitigation = A × (A / (A + DEF used))      with A = attack value
DEX ratio      = defender Effective DEX / attacker Effective DEX
DEX mitigation = max(0, roll × (1 − 1 / DEX ratio)),  roll uniform in [0.20, 0.50)
Final damage   = Net damage × (1 − DEX mitigation)
```

- If the defender has no DEX advantage (ratio ≤ 1) the raw mitigation is ≤ 0 and is **clamped to 0** (negative mitigation is discarded, as the plan states). The combat log shows the raw value and whether it was clamped.
- **Unarmed:** with no melee or ranged weapon equipped, the fighter attacks "unarmed" using Net ATK (only gear modifiers that are equipped, e.g. a shield or armour, apply).
- Damage is not rounded; HP may go below 0 on the final blow (displayed as 0).

## 4. Turn advantage from DEX (plan §4)

- DEX advantage = attacker Effective DEX − defender Effective DEX.
- Advantage **≥ 15 → +1 attack**, **≥ 30 → +2 attacks**.
- **DECISION:** "15 points" is treated as inclusive (≥ 15); the bonus applies **every turn** to the faster side (the slower side cannot have a positive advantage). Bonus attacks follow the fighter's regular attack in the same action.

## 5. Ranged weapons, opening attack, piercing (engine 2.0.0)

- Ranged weapons (Bow, Crossbow, Longbow) use Effective DEX as the attack value. Every other weapon is melee and uses Net ATK.
- **Opening shot ("First Shot")**, decided by `combat.ts → openingShooters`. Eligible = a ranged weapon in a hand (Ranged+Melee holders included).
  - Nobody eligible → no opening phase.
  - **Exactly one eligible → it makes one opening ranged attack**, whatever its DEX.
  - **Both eligible → only the fighter with strictly higher Effective DEX shoots.** (V1: both shot, the faster one first.)
  - **Both eligible with equal Effective DEX → nobody gets the opening shot**, because neither has the advantage. This rule was user-approved (V2_DEMANDS Q-1). The turn-order coin flip is still drawn first, so the RNG sequence of later draws does not depend on this rule.
  - The round's initiative records `openingEligible` and `openingRule` (`none` / `single` / `dex_advantage` / `tie_none`), and the round view explains them.
- **Piercing**: every attack made *with* a weapon that has a pierce spec rolls pierce. That covers melee (Rapier, Flail, Spear, Lance, Pike) as well as ranged (all bows, including the opening shot). On success the attack ignores the weapon's DEF-ignore % of the defender's Net DEF. Unarmed attacks, and weapons without a spec, draw no pierce roll.
  - The combat log stores the roll, the chance, the ignore %, the weapon and `extraDamage`: the net damage the pierce added, before mitigation.
  - Pierce values: see §8. The user delegated tuning them (V2_DEMANDS Q-5). They were buffed using the balance harness, with evidence in `docs/V2_BALANCE.md`.
- **DECISION:** a fighter holding Ranged + Melee chooses ranged (DEX) or melee (STR) for every regular/bonus attack. The opening attack is always ranged.
  - The human player is prompted, with an optional "use for the rest of this round".
  - The boss picks the mode with the higher expected damage (pierce EV of the weapon used included).
  - Simulation agents use their strategy.

## 6. Turn order (plan silent → DECISIONS)

1. A tie-break coin flip is drawn from the round's seeded RNG at the start of every round (always drawn, so the random sequence is stable).
2. Opening phase (at most one opening shot, see §5).
3. Each turn: the fighter with the higher Effective DEX acts first (tie → coin flip winner). Acting = 1 regular attack + DEX bonus attacks.
4. The round ends immediately when a fighter's HP reaches 0 or below.
5. Random draws per attack, in order: pierce roll (only if the weapon used has a pierce spec), then mitigation roll. All draws come from a seeded `mulberry32` RNG whose seed is derived from the run seed and round number, so every fight is reproducible from its stored seed and snapshots.

## 7. Equipment slots (plan §6)

Two hand slots plus a separate body-armour slot.

- Legal hand combinations: **Shield + Melee, Shield + Ranged, Ranged + Melee**, a single item, or empty hands.
- **DECISION:** the plan's "Sword" category means *any melee weapon* (blades, blunt weapons and polearms); "Bow" means any ranged weapon (Bow, Crossbow, Longbow).
- Not legal: two melee weapons, two ranged weapons, two shields, the same item twice, armour in a hand slot, non-armour in the armour slot, unowned items.
- **DECISION:** armour is a separate slot (the plan lists armour items but only two hand slots).

## 8. Equipment catalogue (engine 2.0.0) — exact values

Costs and STR/DEF/DEX modifiers are the user's V2 values. Pierce values were tuned by Claude on the user's instruction (buff only). The user's original pierce values are shown in brackets.

| Item | Family | Category | Cost | STR | DEF | DEX | Pierce chance / DEF ignored |
|---|---|---|---:|---:|---:|---:|---|
| Knuckle | blunt | melee | 3 | +1 | 0 | +2 | |
| Knife | blade | melee | 5 | +2 | 0 | +2 | |
| Sword | blade | melee | 10 | +4 | +1 | 0 | |
| LongSword | blade | melee | 20 | +7 | +2 | 0 | |
| Sabre | blade | melee | 20 | +5 | +1 | +2 | |
| GreatSword | blade | melee | 40 | +10 | +3 | −2 | |
| Rapier | blade | melee | 40 | +6 | +1 | +3 | 5% / 70% (unchanged) |
| Wooden Club | blunt | melee | 7 | +3 | +1 | 0 | |
| Iron Club | blunt | melee | 15 | +5 | +2 | −1 | |
| Mace | blunt | melee | 25 | +8 | +2 | −1 | |
| Flail | blunt | melee | 30 | +4 | +1 | 0 | **45% / 90%** (was 20% / 50%) |
| Warhammer | blunt | melee | 40 | +12 | +2 | −3 | |
| Bow | bow | ranged | 15 | 0 | 0 | +2 | **55% / 90%** (was 30% / 30%) |
| Crossbow | bow | ranged | 28 | 0 | 0 | +4 | 25% / 45% (unchanged) |
| Longbow | bow | ranged | 42 | 0 | 0 | +3 | **45% / 60%** (was 40% / 55%) |
| Spear | polearm | melee | 15 | +3 | 0 | +1 | **35% / 35%** (was 10% / 25%) |
| Lance | polearm | melee | 28 | +5 | 0 | 0 | **60% / 75%** (was 20% / 35%) |
| Pike | polearm | melee | 42 | +7 | 0 | −1 | **60% / 90%** (was 35% / 60%) |
| Leather Armor | armour | armour | 10 | 0 | +2 | 0 | |
| Light Armor | armour | armour | 25 | 0 | +4 | −1 | |
| Heavy Armor | armour | armour | 45 | 0 | +8 | −4 | |
| Wood Shield | shield | shield | 8 | 0 | +3 | −1 | |
| Small Shield | shield | shield | 20 | 0 | +5 | −2 | |
| Great Shield | shield | shield | 42 | +1 | +8 | −5 | |

Notes:
- `family` is display/analysis only and has no rule effect.
- Crossbow and Rapier were not buffed: they already top their price brackets (`docs/V2_BALANCE.md`).
- The V1 catalogue (16 items, including the Axe) is frozen in `catalogs/v1.ts` for history.

## 9. Worked example

Unarmed vs unarmed at base stats (before spending the initial points): Net ATK 20, Net DEF 10, Effective DEX 10 each.
Net damage = 20 × 20 / (20 + 10) = 13.33. DEX ratio = 10/10 = 1 → raw mitigation 0 → final damage 13.33.
Each fighter needs 8 hits (8 × 13.33 > 100), so whoever acts first (coin flip) wins — the first-attacker advantage the
2 initial stat points (engine 1.1.0) are meant to break: e.g. +2 DEX (DEX 14 vs 10) makes that fighter act first and mitigate hits.

With a Knuckle (+1 STR, +2 DEX): Net ATK = 20 + 0.25 × 20 × 1 = 25; Net DEX = 10 + 0.25 × 10 × 2 = 15.

## 10. Boss adaptation inputs (plan §9)

After every round the boss analyses: the weapon types/modes that hit it (ranged vs heavy melee), the player's attributes and equipped items, damage taken by source, and the result.
It then chooses stat allocations and purchases/equipment **through the same rules as the player** (`boss/policy.ts` → `game/equipment.ts`).
See `docs/ARCHITECTURE.md` (boss) and `docs/ML_WALKTHROUGH.md` (prediction → decision).
The boss only knows the player's **last observed** build (round N plus automatic level-up increases); it never sees the player's current-round preparation.
- From engine 2.0.0 the boss considers every way the player *could* prepare with what they have: their unspent points, owned items and affordable items. A ranged style is considered only if the player can actually field a ranged weapon.
- When several plans are equally strong, the boss picks one with a seeded draw, so its builds vary. It never picks a weaker plan to be different.

**Round 1 finding.** Before round 1 nobody owns anything. Against every way the player can spend their 2 initial points, +2 STR is the boss's best allocation in every case (measured: it has the highest expected HP margin against all four opponent allocations). So the boss still picks +2 STR in round 1. This is a consequence of the rules, not a fixed default: an unarmed duel rewards STR most. See `docs/V2_BALANCE.md` §6.

## 11. Unresolved / deferred (not invented)

| Topic | Status |
|---|---|
| Skills / skill points | Plan names them but defines none → not implemented; architecture leaves room (`STAT_POINTS_PER_LEVEL` and the progression ledger). |
| Item upgrades | Mentioned, not specified → not implemented. |
| Pierce chance / DEF-ignore values | Tuned for V2 (user-delegated); change in `catalogs/v2.ts`, re-run `npm run balance`. |
| Rounds per run | Not in plan → default 10 (`DEFAULT_MAX_ROUNDS` env), player may end early. |
| Selling items | Not in plan → not implemented. |
| Initial stat points | Not in plan → user-requested developer rule (engine 1.1.0): 2 per combatant, spent before round 1 (§1). |
