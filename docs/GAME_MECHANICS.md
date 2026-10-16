# Game Mechanics — The Boss Remembers (V1)

Source of truth: `context/adaptive_boss_duel_v1_game_plan_updated.docx` ("Game Mechanics — Current V1 Specification").
This file copies those rules faithfully and lists every **developer decision** made where the plan is silent.
Nothing here is a new mechanic. Player and boss use exactly the same rules.

Where the rules live in code:

| Rule | File |
|---|---|
| Numbers (stats, rewards, factors, thresholds) | `server/src/game/constants.ts` |
| Equipment catalogue | `server/src/game/catalog.ts` |
| Formulas (one function each) | `server/src/game/formulas.ts` |
| Derived combat numbers from stats + gear | `server/src/game/derive.ts` |
| Slots, purchases, stat allocation | `server/src/game/equipment.ts` |
| Rewards, XP, level-ups | `server/src/game/progression.ts` |
| Turn order, opening shots, bonus attacks, piercing | `server/src/game/combat.ts` |
| Tests pinning all of the above | `server/tests/unit/rules.test.ts`, `server/tests/unit/combat.test.ts` |

When you change a rule: change the constant/function, update the unit test, update this document, and bump
`ENGINE_VERSION` in `constants.ts` (stored on every run/round so old data stays attributable).

Engine versions: **1.0.0** original V1 rules · **1.1.0** (current) adds the 2 initial stat points per combatant (§1). Nothing else differs.

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
- Round rewards: **winner 50 XP + 10 gold, loser 20 XP + 4 gold.**
- Each level-up: **+25 gold**, the automatic attribute increase above, and the stat point.
- Gold buys items. **DECISION:** item *upgrades* are mentioned by the plan but not specified, so they are not implemented in V1. Items cannot be sold.
- Gold can never go negative (enforced in code and by a database CHECK constraint).

## 3. Combat and damage formulas (plan §3, §5)

Modifier sums (Σ) are taken over the equipped gear.
**DECISION (approved):** all equipped items count — both hand slots and armour — and each modifier column feeds its own stat:
STR mods → Net ATK, DEF mods → Net DEF, DEX mods → Net DEX. (So e.g. Small Shield's +1 STR raises Net ATK.)

```
Net ATK  = STR + 0.25 × (STR × ΣSTR mods)
Net DEF  = DEF + 0.5  × (DEF × ΣDEF mods)
Net DEX  = DEX + 0.25 × (DEX × ΣDEX mods)
Effective DEX = max(1, Net DEX)                         ← DECISION (prevents division by zero / negative DEX)

Attack value = Net ATK for melee/unarmed attacks, Effective DEX for ranged attacks
DEF used     = defender Net DEF × (1 − pierce ignore %)  (ignore % = 0 unless a ranged attack pierces)
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

## 5. Ranged weapons, opening attack, piercing (plan §5)

- Ranged weapons use Effective DEX as the attack value.
- Any fighter with a ranged weapon equipped makes **one opening ranged attack** before turn 1. If both have one, the higher Effective DEX shoots first (DEX tie → the seeded coin flip below).
- Each bow/crossbow has a pierce chance; on success it ignores a percentage of the defender's DEF for that attack.
  - **DECISION / PLACEHOLDER (approved, the plan gives no numbers):** Bow 20% chance → ignore 25% DEF; Crossbow 30% chance → ignore 50% DEF. Flagged `placeholder: true` in `catalog.ts` and labelled in the UI and combat log.
- **DECISION:** a fighter holding Ranged + Melee chooses ranged (DEX) or melee (STR) for every regular/bonus attack. The opening attack is always ranged. The human player is prompted (with an optional "use for the rest of this round"); the boss picks the mode with the higher expected damage; simulation agents use their strategy.

## 6. Turn order (plan silent → DECISIONS)

1. A tie-break coin flip is drawn from the round's seeded RNG at the start of every round (always drawn, so the random sequence is stable).
2. Opening phase (ranged holders only, see §5).
3. Each turn: the fighter with the higher Effective DEX acts first (tie → coin flip winner). Acting = 1 regular attack + DEX bonus attacks.
4. The round ends immediately when a fighter's HP reaches 0 or below.
5. Random draws per attack, in order: pierce roll (ranged only), then mitigation roll. All draws come from a seeded `mulberry32` RNG whose seed is derived from the run seed and round number, so every fight is reproducible from its stored seed and snapshots.

## 7. Equipment slots (plan §6)

Two hand slots plus a separate body-armour slot.

- Legal hand combinations: **Shield + Melee, Shield + Ranged, Ranged + Melee**, a single item, or empty hands.
- **DECISION:** the plan's "Sword" category means *any melee weapon*; "Bow" means any ranged weapon (Bow or Crossbow).
- Not legal: two melee weapons, two ranged weapons, two shields, the same item twice, armour in a hand slot, non-armour in the armour slot, unowned items.
- **DECISION:** armour is a separate slot (the plan lists armour items but only two hand slots).

## 8. Equipment catalogue (plan §7, §8) — exact values

| Item | Category | Cost | STR | DEF | DEX | Pierce |
|---|---|---|---|---|---|---|
| Knife | melee | 5 | +3 | — | +2 | |
| Knuckle | melee | 3 | +1 | — | +2 | |
| Sword | melee | 10 | +6 | +2 | — | |
| Rapier | melee | 20 | +5 | +2 | +2 | |
| Greatsword | melee | 30 | +10 | +4 | −2 | |
| Wooden Club | melee | 7 | +4 | +2 | −1 | |
| Iron Club | melee | 15 | +8 | +4 | −3 | |
| Axe | melee | 10 | +5 | +1 | +1 | |
| Bow | ranged | 12 | — | — | +2 | 20% / 25% DEF (placeholder) |
| Crossbow | ranged | 25 | — | — | +4 | 30% / 50% DEF (placeholder) |
| Leather Armour | armour | 10 | — | +2 | — | |
| Light Armour | armour | 25 | — | +4 | −1 | |
| Heavy Armour | armour | 50 | — | +8 | −4 | |
| Wood Shield | shield | 8 | — | +3 | −1 | |
| Small Shield | shield | 18 | +1 | +6 | −3 | |
| Great Shield | shield | 36 | +2 | +10 | −5 | |

Bow and Crossbow STR modifiers were removed by the plan. "—" is stored as 0.

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

## 11. Unresolved / deferred (not invented)

| Topic | Status |
|---|---|
| Skills / skill points | Plan names them but defines none → not implemented; architecture leaves room (`STAT_POINTS_PER_LEVEL` and the progression ledger). |
| Item upgrades | Mentioned, not specified → not implemented. |
| Pierce chance / DEF-ignore values | Approved placeholders (see §5); change in `catalog.ts`. |
| Rounds per run | Not in plan → default 10 (`DEFAULT_MAX_ROUNDS` env), player may end early. |
| Selling items | Not in plan → not implemented. |
| Initial stat points | Not in plan → user-requested developer rule (engine 1.1.0): 2 per combatant, spent before round 1 (§1). |
