# The Boss Remembers — Version 2 Demands & Specification

**Status:** Planning specification (investigation complete, nothing implemented).
**Scope:** Game mechanics, economy, weapon and equipment catalogue, boss decision-making, ML pipeline, simulations, and complete UI redesign.
**Investigated:** 2026-10-16, against the working tree on branch `master` (no commits yet; every file untracked). Companion plan: [`V2_IMPLEMENTATION_PLAN.md`](V2_IMPLEMENTATION_PLAN.md).

This document started as the user's raw V2 brief. The user's requirements are kept, and each one is now split into the categories below. Nothing marked **R** has been weakened. Where a recommendation conflicts with a requirement, the conflict is stated and flagged for approval instead of being applied.

| Tag | Meaning |
|---|---|
| **R** | Explicit user requirement (from the original brief). Mandatory. |
| **V** | Current behaviour, verified in the repository (file references given) or by a read-only database query on 2026-10-16. |
| **P** | Problem confirmed by investigation. |
| **D** | Design decision / recommendation (Claude's; can be overridden). |
| **Q** | Open question that needs the user's decision. |
| **AC** | Implementation and verification (acceptance) criterion. |
| *(unverified)* | Stated, but not checked against code or data. |

How the evidence was gathered: source reading; `npm run typecheck` (clean); read-only SQL on the dev database (`boss-remembers-db`); analysis of exported CSV snapshots and model metadata in `artifacts/`; formula-based calculations with the real damage formulas; viewing existing run #389 in the browser at 1280 px and 375 px (no runs or rounds created). The test suite was **not** re-run, because it wipes the test database. `PROGRESS.md` reports 88/88 passing on 2026-10-10. Its own resume section says "80 passing", which contradicts that number, so the test count is unverified.

---

## 1. Purpose (R, unchanged)

Version 2 should improve combat variety, economic progression, strategic decision-making, the usefulness of armor penetration, and the overall quality of the user interface.

This is not simply a catalogue update. Changes to weapons, progression, combat rules and boss strategy affect simulations, historical data, ML training examples, model performance and existing tests. All relevant dependencies must be investigated. Working functionality is preserved unless a change is explicitly required or a justified design decision is approved.

## 1b. Verified project state (summary)

- **V** Stack: Express + TypeScript server (`server/src`), PostgreSQL 16 in Docker, React 18 + Vite + plain CSS client (`client/src`), Python XGBoost training (`ml/`). Rules are pure functions in `server/src/game/*`. Manual play and simulations both go through `services/runs.ts` → `services/rounds.ts`.
- **V** `ENGINE_VERSION = '1.1.0'`, `SIMULATOR_VERSION = 'sim-1.1.0'`, `FEATURE_SCHEMA_VERSION = 'v1'`.
- **V** Dev DB (read-only query): engine 1.0.0 has 258 simulated runs and 2 manual runs (1 still **active**, #253). Engine 1.1.0 has 240 simulated runs and 3 manual runs (1 still **active**, #389). Model `m20261010-200001-s2` (engine 1.1.0, eligible) is **active**. Model `…-s1` (engine 1.0.0) is retained.
- **P** Simulated balance is heavily one-sided. Boss win rate per agent (engine 1.1.0): archer 100%, shield_turtle 100%, random 97%, hybrid 92%, adaptive 84%, melee_bruiser 80%. The boss won **239 of 243** round-1 fights.

---

## 2. Weapon and equipment catalogue

### 2.1 Required catalogue (R — exact values, must be preserved)

| Weapon | Cost | STR | DEF | DEX | Special effect |
|---|---:|---:|---:|---:|---|
| Knuckle | 3 | +1 | 0 | +2 | — |
| Knife | 5 | +2 | 0 | +2 | — |
| Sword | 10 | +4 | +1 | 0 | — |
| LongSword | 20 | +7 | +2 | 0 | — |
| Sabre | 20 | +5 | +1 | +2 | — |
| GreatSword | 40 | +10 | +3 | −2 | — |
| Rapier | 40 | +6 | +1 | +3 | 5% chance to ignore 70% DEF |
| Wooden Club | 7 | +3 | +1 | 0 | — |
| Iron Club | 15 | +5 | +2 | −1 | — |
| Mace | 25 | +8 | +2 | −1 | — |
| Flail | 30 | +4 | +1 | 0 | 20% chance to ignore 50% DEF |
| Warhammer | 40 | +12 | +2 | −3 | — |
| Bow | 15 | 0 | 0 | +2 | First Shot; 30% chance to ignore 30% DEF |
| Crossbow | 28 | 0 | 0 | +4 | First Shot; 25% chance to ignore 45% DEF |
| Longbow | 42 | 0 | 0 | +3 | First Shot; 40% chance to ignore 55% DEF |
| Spear | 15 | +3 | 0 | +1 | 10% chance to ignore 25% DEF |
| Lance | 28 | +5 | 0 | 0 | 20% chance to ignore 35% DEF |
| Pike | 42 | +7 | 0 | −1 | 35% chance to ignore 60% DEF |

| Armor / shield | Cost | STR | DEF | DEX |
|---|---:|---:|---:|---:|
| Leather Armor | 10 | 0 | +2 | 0 |
| Light Armor | 25 | 0 | +4 | −1 |
| Heavy Armor | 45 | 0 | +8 | −4 |
| Wood Shield | 8 | 0 | +3 | −1 |
| Small Shield | 20 | 0 | +5 | −2 |
| Great Shield | 42 | +1 | +8 | −5 |

Blank cells in the original catalogue mean zero modifier.

**Catalogue requirements (R):**
- Update the actual source of truth, not just UI labels.
- The shop, inventory, equipment calculations, combat, boss decisions, simulations and tests use the same definitions.
- Purchases, equipment combinations, stat modifiers and special effects are applied correctly.
- Existing equipment-slot rules are preserved unless a change is justified and documented.
- Evaluate item roles, dominated items and excessively powerful combinations.
- Treat the catalogue as the intended starting balance, not proof of balance.

### 2.2 Current behaviour (V)

- **V** Single source of truth: `server/src/game/catalog.ts` (`ITEMS`, `getItem`, `requireItem`), 16 items. It is served to the client by `GET /api/catalog` (`server/src/api/app.ts:79`). The client has **no** hard-coded item data; it reads the catalogue from context (`client/src/App.tsx`, `util.tsx`).
- **V** Categories are `melee | ranged | shield | armour`. There is no "family" concept. Slot legality is in `game/equipment.ts` (`LEGAL_HAND_SETS`): Shield+Melee, Shield+Ranged, Ranged+Melee, a single item, or empty hands, plus a separate armour slot.
- **V** Modifiers feed Net stats through `game/derive.ts` (all equipped items count, each column feeds its own stat).
- **V** Pierce exists **only** on ranged weapons, and `combat.ts → resolveAttack` only rolls pierce when `mode === 'ranged'`. Values are approved placeholders: Bow 20%/25%, Crossbow 30%/50%, with `placeholder: true`.
- **V** Differences between V1 and the required V2 catalogue:
  - **Removed:** Axe.
  - **New:** LongSword, Sabre, Mace, Flail, Warhammer, Longbow, Spear, Lance, Pike.
  - **Changed values:** Knife (STR 3→2), Sword (6/2/0 → 4/1/0, cost unchanged), Rapier (20g 5/2/2 → 40g 6/1/3 + pierce), Greatsword (30g 10/4/−2 → 40g 10/3/−2), Wooden Club, Iron Club, Bow (12→15g, new pierce), Crossbow (25→28g, new pierce), Heavy Armour (50→45g), Small Shield (18g 1/6/−3 → 20g 0/5/−2), Great Shield (36g 2/10/−5 → 42g 1/8/−5).
  - **Renamed for display:** Greatsword→GreatSword, "Armour"→"Armor".
  - **Unchanged:** Knuckle, Leather, Light Armour, Wood Shield.
- **V** Item ids are hard-coded outside the catalogue in:
  - `boss/policy.ts:130,134`: hypothetical `'bow'`/`'sword'` scenarios.
  - `ml/features.ts:82–83`: `p_can_afford_bow`, `p_can_afford_crossbow`.
  - `sim/agents.ts`: wishlists, including `'axe'`.
  - `tests/unit/rules.test.ts`: catalogue pinning table.
- **V** Historical records store item ids: `rounds.*_snapshot.loadout`, `combatants.inventory`, `progression_events.payload.itemId`, `boss_decisions`. `boss/analysis.ts`, `boss/prepare.ts`, `ml/features.ts` and `sim/agents.ts` look ids up with `getItem(id)!` or `requireItem(id)`, which throws on unknown ids.

### 2.3 Confirmed problems (P)

- **P-CAT-1 History breaks if items are simply replaced.** Removing `axe` makes `requireItem('axe')` throw. One engine-1.1.0 boss build finished round 10 holding an Axe (query). Re-deriving data for old runs (`buildMissingExamples`, round/decision views, analysis names) would crash. Reusing ids with new values (for example `sword`) would also silently reinterpret historical features: `last_armour_def` and affordability features read *current* catalogue values.
- **P-CAT-2 Legacy runs continue under the current code's rules.** `services/rounds.ts` stamps new rounds with the code's `ENGINE_VERSION`, while `training_examples.engine_version` comes from `runs.engine_version`. Active runs #253 (1.0.0) and #389 (1.1.0) would continue under V2 rules but be labelled as old-engine data. #389's inventory is valid under V2, but any legacy inventory containing `axe` would crash.
- **P-CAT-3 Piercing is economically weak under the existing formulas** (balance finding; it does not justify changing the values). Net ATK = STR × (1 + 0.25 × ΣSTR mods), so STR modifiers multiply attack, while `A²/(A+D)` makes DEF matter less as A grows. Expected melee damage per hit for an attacker with STR 26:

  | Defender Net DEF | Sword (10g) | LongSword (20g) | Flail (30g) | Lance (28g) | Pike (42g) | Rapier (40g) | Warhammer (40g) |
  |---|---:|---:|---:|---:|---:|---:|---:|
  | 18 | 38.6 | 57.1 | 39.8 | 45.5 | 59.9 | 51.4 | 88.7 |
  | 108 (heavy DEF stack) | 16.9 | 28.5 | 18.6 | 21.8 | 34.1 | 25.4 | 51.0 |

  Even against a heavy-DEF stack, Warhammer out-damages every piercing weapon. Flail barely beats the 10-gold Sword. Pike is roughly LongSword-level at twice the price. Pierce weapons only gain relative value against very high DEF, and they never overtake the high-STR weapons. (Calculations: Net damage with mean pierce expectation; DEX mitigation ignored because it is the same for all weapons at equal DEX, while DEX modifiers differ and are evaluated separately in the plan's balance harness.)
- **P-CAT-4 Longbow is effectively dominated by Crossbow.** No item is *strictly* dominated on (cost, STR, DEF, DEX, pierce EV), but Longbow costs 14 gold more than Crossbow and has 1 less DEX. Its better pierce (EV 0.22 vs 0.11 of DEF) does not make up for that at any tested DEF level (18 → 108): with DEX 20, expected damage is 25.2 vs 28.7 at DEF 18 and 11.0 vs 12.1 at DEF 108. Crossbow's +4 DEX also helps initiative, mitigation and bonus attacks.
- **P-CAT-5 Near-duplicates.** Sabre (20g, 5/1/2) and Iron Club (15g, 5/2/−1) have identical damage. Sabre trades 1 DEF for 3 DEX at 5 more gold, which is a legitimate role split (DEX duelist vs tank) and should be confirmed by simulation.
- **P-CAT-6 V1 convergence evidence.** At round 10, 214 of 240 engine-1.1.0 bosses ended on Rapier/Greatsword + **Crossbow** + Leather. Crossbow is used as a DEX accessory next to a melee weapon. V2 keeps Crossbow at +4 DEX, so the same pattern is likely *(to be confirmed by simulation)*.

### 2.4 Decisions (D)

- **D-CAT-1 Versioned catalogue.** Freeze the V1 catalogue (engine 1.0.0/1.1.0) as a read-only legacy table and add the V2 table as the live catalogue. Item lookups for history (round views, analysis text, feature rebuilds) resolve against the catalogue of the record's engine version. Live rules (shop, equip, combat, boss, sims) use only the V2 table.
  - *Alternatives:* (a) overwrite in place: breaks history (P-CAT-1); (b) new ids for changed items (`sword_v2`): messy ids and broken continuity in analytics.
  - *Why this:* it keeps every historical record readable and attributable at the cost of one lookup indirection.
- **D-CAT-2 Stable ids, user's display names.** Keep the existing ids where the item concept is the same (`sword`, `greatsword`, `leather_armour`, …). New ids: `longsword`, `sabre`, `mace`, `flail`, `warhammer`, `longbow`, `spear`, `lance`, `pike`. `axe` exists only in the legacy table. Display names use the user's spelling exactly: "LongSword", "GreatSword", "Leather Armor", "Light Armor", "Heavy Armor". The internal category name `armour` stays (not user-facing).
- **D-CAT-3 Slot categories.** Spear, Lance and Pike are **melee** (STR attack value, no First Shot, melee slot rules). Rapier and Flail are melee with pierce. Bow, Crossbow and Longbow are **ranged** ("First Shot" = eligibility for the opening shot). Add a display-and-analysis-only `family` field (`blade | blunt | polearm | bow | armour | shield`). It has no rule effect. *This is an inference from the table (polearms have STR modifiers and no First Shot); see Q-4.*
- **D-CAT-4 Pierce is a weapon property, not a ranged property.** Any attack made *with* a weapon that has a pierce spec rolls pierce: melee attacks with Rapier, Flail, Spear, Lance, Pike; ranged attacks (including the opening shot) with bows. Unarmed attacks, and weapons without a spec, draw **no** pierce roll, so their RNG sequence stays unchanged. All V2 pierce values are user-specified, so `placeholder: false`.
- **D-CAT-5 Slot rules unchanged.** The existing legal hand combinations are kept. Great Shield's +1 STR raises Net ATK under the existing approved "all equipped modifiers count" rule (V1 Small/Great Shield already did this).
- **D-CAT-6 Balance findings are reported, values are not changed.** P-CAT-3/4/5 are documented with simulation evidence (plan Phase 3). Any tuning (for example scaling pierce, Longbow DEX, Warhammer cost) is a *separate proposal* for the user to approve.

### 2.5 Acceptance criteria (AC)

- **AC-CAT-1** The live catalogue equals §2.1 exactly: 24 items, every cost/modifier/pierce value pinned by a unit test generated from the table.
- **AC-CAT-2** No item id or cost is hard-coded outside the catalogue modules (grep check), except test fixtures.
- **AC-CAT-3** Every historical run (engine 1.0.0 and 1.1.0) still loads in the API (`GET /api/runs/:id`, `GET /api/rounds/:id`) and shows its original item names. Verified on a test DB seeded with legacy ids including `axe`.
- **AC-CAT-4** Purchase, equip, and every legal/illegal hand combination are tested with V2 items, including polearm + shield, bow + pierce melee, and two ranged (illegal).
- **AC-CAT-5** Pierce on each of the 8 pierce weapons is tested: roll consumed only when a spec exists, success/failure boundary (`roll < chance`), DEF used = Net DEF × (1 − ignore), and damage recomputable from the logged `calc`.
- **AC-CAT-6** A balance report (plan Phase 3) lists each item's role, cost-efficiency and any dominated/dominant cases, with simulation evidence.

---

## 3. Economy and progression

### 3.1 Required values (R)

| Event | Required Version 2 reward |
|---|---:|
| Winning a round | +50 XP |
| Losing a round | +30 XP |
| Winning a round | +10 gold |
| Losing a round | +5 gold |
| Level-up reward | +20 gold |

**R:** Apply the values consistently wherever rewards are calculated or displayed. Do not change the XP curve, stat-point allocation, starting resources or other progression mechanics. Evaluate the economic impact (forgiveness, purchase timing, farming incentives) and recommend any tuning separately.

### 3.2 Current behaviour (V)

- **V** `game/constants.ts`: `XP_WIN 50`, `XP_LOSS 20`, `GOLD_WIN 10`, `GOLD_LOSS 4`, `GOLD_LEVEL_UP 25`. Used only by `game/progression.ts → applyRoundRewards`. Exposed by `/api/catalog → rules.rewards`.
- **V** So the V2 change is: loss XP 20→**30**, loss gold 4→**5**, level-up gold 25→**20**. Win XP and win gold already match the targets.
- **V** Hard-coded reward text exists in comments (`progression.ts` docblock), `docs/GAME_MECHANICS.md §2`, `rules.test.ts:87` ("loss: +20 XP +4 gold") and level-up gold assertions. The client renders reward entries from the ledger, so it has no hard-coded numbers.
- **V** Unchanged: XP curve `100 × 1.12^(L−2)` (rounded), +1 stat point per level, 2 initial points, 0 starting gold.

### 3.3 Impact analysis (deterministic reward model, 10 rounds)

| Pattern | V1 level / gold after R3 · R5 · R10 | V2 level / gold after R3 · R5 · R10 |
|---|---|---|
| Always wins | 2/55 · 3/100 · 5/200 | 2/50 · 3/90 · 5/180 |
| Always loses | 1/12 · 2/45 · 2/65 | 1/15 · 2/45 · **3/90** |
| Alternates | 2/49 · 2/63 · 4/145 | 2/45 · 2/60 · 4/135 |

- More forgiving: the winner/loser gold gap at round 10 shrinks from 3.1× to 2×. A losing player reaches level 2 one round earlier (round 4 instead of 5) and gets a 3rd level by round 10. This directly counters the boss snowball seen in simulations (boss wins 80–100%).
- Purchase timing: V2 prices are higher at the top (Warhammer, GreatSword and Rapier at 40, Longbow and Pike at 42, Heavy Armor at 45, Great Shield at 42), and total gold is slightly lower for winners. Roughly 3–5 items per 10-round run. The cheapest ranged weapon rises from 12 to 15 gold, so **no fighter can field a ranged weapon before round 2**, and a fighter who lost round 1 cannot do so before round 3 (5 + 5 gold). This matters for §5.
- Farming: none per round, because winning still strictly beats losing (+20 XP, +5 gold). The only "lose to gain" path would be multi-run, and runs do not carry progress. No incentive found.
- **D-ECO-1** Apply the three constant changes exactly. No other tuning. Any follow-up (for example a level-up gold re-raise) is proposed separately with simulation evidence.

### 3.4 Acceptance criteria

- **AC-ECO-1** Unit tests pin win 50 XP / 10 gold, loss 30 XP / 5 gold, level-up +20 gold, multi-level-up carry-over, and an unchanged XP curve, stat points and starting state.
- **AC-ECO-2** `/api/catalog` returns the new reward values. The UI reward summary and docs show them. The client grep finds no stale 20/4/25 literals.
- **AC-ECO-3** The plan Phase 3 report includes the economy table above, recomputed from simulation (purchase round per item, gold curve per agent).

---

## 4. Ranged opening-shot rule

### 4.1 Requirement (R)

If both fighters have ranged weapons eligible for the opening shot, **only the fighter with the applicable advantage receives it**. Keep the existing behaviour when only one fighter qualifies. Investigate equal-DEX cases and recommend a deterministic, fair tie rule. Logs, UI, simulations and ML data must represent the attacks that actually occur. Add tests for both-ranged, one-ranged, neither-ranged and equal-advantage cases.

### 4.2 Current behaviour (V) — the user's assumption is **correct**

- **V** Eligibility (`combat.ts → startCombat`): any fighter with a ranged weapon in a hand (`derived.rangedWeaponId !== null`), including Ranged+Melee holders.
- **V** `openingOrder = turnOrder.filter(hasRanged)`. Turn order is by higher Effective DEX, and an exact tie goes to the seeded coin flip `tieWinner` (first RNG draw of the round, always drawn). So **both** ranged fighters shoot, the faster one first. Opening attacks are forced `ranged` (`phase: 'opening'`, `turn: 0`).
- **V** Dependents:
  - `Initiative.openingOrder`, persisted in `rounds.initiative` and shown by `RoundView.InitiativeLine`.
  - `boss/policy.ts → analyticScore` (adds both `openB` and `openP`).
  - `boss/analysis.ts` (`openingDamage` in `ranged_pressure`).
  - `game/summary.ts` phase counts.
  - ML label (`rangedShare` counts opening shots).
  - `tests/unit/combat.test.ts` ("both ranged → higher effective DEX shoots first", tie → coin flip).
- **V** Scale: 583 of 2,418 engine-1.1.0 rounds (24%) had **two** opening shots.

### 4.3 Decisions (D)

- **D-OPEN-1 Eligibility** unchanged: a ranged weapon equipped in a hand.
- **D-OPEN-2 Advantage** = strictly higher Effective DEX, the same quantity that already orders the opening phase and turns. Both eligible: only the higher-DEX fighter shoots. Exactly one eligible: it shoots regardless of DEX (current behaviour preserved). Neither eligible: no opening phase.
- **D-OPEN-3 Equal Effective DEX, both eligible → no opening shot for either fighter** (recommended, see Q-1).
  - *Alternatives:* (a) reuse the seeded coin flip: deterministic given the seed, but hands a full free attack (up to a Longbow pierce hit) to luck; (b) secondary tie-breaks such as base DEX, pierce EV or weapon cost: arbitrary and opaque to players.
  - *Why this:* the rule says the *advantaged* fighter shoots, and at a tie neither has the advantage. It is symmetric, needs no RNG, and is easy to explain in the UI.
  - The turn-order coin flip is unchanged and still drawn first, so the RNG sequence of later draws does not shift because of this rule.
  - Effective DEX values are exact binary fractions (integers × 0.25), so equality comparison is exact.
- **D-OPEN-4 Record the decision.** `Initiative` gains `openingEligible: Side[]` and `openingRule: 'single' | 'dex_advantage' | 'tie_none' | 'none'`, with a human-readable reason. The combat log and round view state who was denied the opening shot and why. Old rounds keep their stored initiative and render with legacy wording.
- **D-OPEN-5 Dependents updated.** `analyticScore` only adds the opening damage of the fighter who will actually shoot. Boss scenarios inherit the rule through the real engine in Monte-Carlo.

### 4.4 Acceptance criteria

- **AC-OPEN-1** Unit tests: both ranged with A faster (only A shoots; exactly one `opening` event); both ranged with B faster; both ranged with a DEX tie (no opening events, `openingRule = 'tie_none'`); one ranged and slower (it still shoots); neither ranged; Ranged+Melee hybrid counts as eligible; the opening shot from a pierce bow rolls pierce.
- **AC-OPEN-2** A seeded fight with no opening phase consumes the same RNG sequence as before for its first regular attack (tie-break draw unchanged).
- **AC-OPEN-3** Simulation report: zero rounds under engine 2.0.0 with more than one opening event.

---

## 5. Round-zero ranged probability and prediction logic

### 5.1 Requirement (R)

Investigate `p = 0.5` on "round zero": what it represents, where it is initialized, persisted and consumed; whether it affects preparation, features, predictions or policy; and whether it is a prior, a placeholder or misleading. Recommend a treatment that is not just another arbitrary number. Document the semantics and add tests.

### 5.2 Current behaviour (V)

- **V** There is **no round 0** in the data model. Rounds start at 1. `turn = 0` exists only as the *opening phase* inside a round's combat events (unrelated to `p`). "Round zero" therefore means the **pre-round-1 decision point**: the boss prepares for round 1 with zero completed rounds of history.
- **V** Definition: `ml/features.ts:118`, `baselineProbability([])` returns `0.5`. `boss/prepare.ts` calls it with an empty history. `buildFeatures` is skipped (features `null`), so `predictor.ts` returns `kind: 'fallback'`, `probabilityRanged: 0.5`, reason "No completed rounds yet".
- **V** Consumption: `boss/policy.ts → choosePlan` weighs `score = p·win(ranged scenario) + (1−p)·win(melee scenario)`. So round-1 boss preparation weights a "player with a Bow" scenario at 50%.
- **V** Persistence: `boss_decisions.predictor.probabilityRanged = 0.5` on **all 503** round-1 decisions (260 engine 1.0.0, 243 engine 1.1.0). Shown in the UI as "predicted P(you mostly ranged) = 50%". Counted in ML Lab's model-vs-fallback usage totals (`ml/training.ts → mlStatus`, which aggregates every decision of every engine).
- **V** Training: **not** affected directly. Examples start at label round 2 (`ml/examples.ts`), and `baseline_probability` on training rows always has history. 0.5 never becomes a feature or label.

### 5.3 Confirmed problems (P)

- **P-P0-1 0.5 is a placeholder dressed as a probability.** At the round-1 decision the player has **0 gold and no items** (verified rules). A ranged attack in round 1 is **impossible**, so the true P(mostly ranged) is exactly 0. The boss nevertheless spends 50% of its scoring weight on a hypothetical Bow the player cannot afford (`policy.ts → buildScenarios` adds `'bow'` without an affordability check). Persisted evidence: round-1 scenarios list `hypotheticalItems: ["bow"]`.
- **P-P0-2 The same infeasibility recurs after round 1.** The cheapest ranged weapon costs 12 gold (V1) or 15 gold (V2). In the engine-1.1.0 training snapshot (1,476 rows), **528 rows (36%)** have a player who owns no ranged weapon and cannot afford a Bow. **All 528 are labelled 0.** These rule-determined rows inflate both the model's and the baseline's held-out accuracy. In the remaining 948 feasible rows the ranged share is 56%, which is a much harder problem than the headline metrics suggest.
- **P-P0-3 "No attacks" is encoded as "0% ranged".** `last_ranged_share` and `hist_*` use `rangedShare ?? 0`, and `baselineProbability` treats a round with no player attacks as melee. 146 of 1,476 rows (10%) have `last_attacks = 0`. Of those, 92 are labelled ranged. `train.py` also runs `fillna(0)`, so a genuinely missing value can never reach XGBoost as missing.
- **P-P0-4 UI and status honesty.** "P(you mostly ranged) = 50%" is shown as a prediction when it is neither a prediction nor correct. ML Lab usage counts mix every engine version and include round-1 decisions that can only ever be fallback.

### 5.4 Decisions (D)

- **D-P0-1 Feasibility first (rule-determined probability).** Before any model or baseline, compute from information the boss legitimately has at decision time (the player's post-round-N state: inventory and gold) whether the player *can* field a ranged weapon next round: owns one, or gold ≥ cheapest ranged cost in the live catalogue.
  - If not, then `P(ranged) = 0` with `basis: 'rule'`. The ranged scenario is dropped from scoring, and no model is called.
  - This covers round 1 (0 gold) and every later infeasible round.
  - It is exact, not a prior, and it uses no future information. The player's unseen preparation cannot change feasibility, because they can only spend the gold they have.
- **D-P0-2 Honest prediction record.** `Prediction` gains `basis: 'rule' | 'model' | 'baseline' | 'unknown'`. `probabilityRanged` is `number | null`, and `null` means "no evidence".
  - If a future rule change makes ranged feasible with no history (for example starting gold ≥ 15), the policy uses `basis: 'unknown'`: it scores scenarios with equal weight **as an explicitly labelled robustness rule**, and the UI says "no evidence yet; weighing both styles equally" instead of "50% predicted".
  - A population prior from earlier runs could replace that later, but only when there is enough current-engine *manual* data. Not now.
- **D-P0-3 Training and evaluation exclude rule-determined rows.** Training rows keep a `ranged_feasible` flag. The model is trained and evaluated only on feasible rows. Metrics on all rows are reported separately and labelled. The eligibility comparison against the baseline uses feasible rows (the baseline also gets the feasibility mask, so the comparison stays fair).
- **D-P0-4 Missing ≠ zero.** In feature schema v2, shares are `NaN` when the player made no attacks, and `train.py`/`infer_worker.py` pass `NaN` through to XGBoost's native missing-value handling instead of `fillna(0)`. The baseline skips rounds with no attacks and falls back to the loadout (a ranged-only loadout counts as ranged intent).
- **D-P0-5 Historical records untouched.** The 503 stored round-1 `probabilityRanged = 0.5` values stay as written. Docs and the ML Lab label them "legacy placeholder (pre-2.0), not an estimate". Usage statistics are filtered to the current engine and exclude rule-determined decisions.

### 5.5 Acceptance criteria

- **AC-P0-1** Unit tests:
  - round-1 decision gives `basis 'rule'`, `p = 0`, no ranged scenario, no model call;
  - a later round with gold < 15 and no ranged weapon gives `rule`/`0`;
  - a player who owns a bow gives `model` or `baseline` (never `rule`);
  - gold exactly 15 counts as feasible;
  - the `unknown` path (forced via a test-only starting-gold override) gives `null` and equal weights, with the UI text verified.
- **AC-P0-2** The leakage test still passes: identical features and decisions when only the player's next-round preparation differs.
- **AC-P0-3** Feature schema v2 tests: no-attack rounds produce `NaN` shares, and the worker scores `NaN` without error.
- **AC-P0-4** ML Lab and `ml:status` show model/baseline/rule counts for the current engine only.

---

## 6. Boss stat allocation and build diversity

### 6.1 Requirement (R)

Verify the claim that the boss puts all its points into STR in round 1, find the cause, and make the boss produce varied, legal, strategically meaningful builds. Possible approaches (not prescriptions): player behaviour and weaknesses, expected value of STR/DEF/DEX, weapon synergies, multiple viable archetypes, controlled diversity among comparable choices, and a transparent fallback. All allocation and resource rules must hold. Diversity must not become arbitrary randomness. Evaluate the effect of the initial-points rule and the new catalogue.

### 6.2 Current behaviour (V) — the claim is **correct for round 1**, and only round 1

- **V** The round-1 boss decision was **+2 STR** in **243 of 243** engine-1.1.0 runs (read-only query). In later rounds, allocations were spread: no points (no level-up) 1,461; +1 DEX 400; +1 STR 243; +1 DEF 71; HP never.
- **V** Decision path (`boss/prepare.ts → policy.choosePlan`):
  1. **Observed player** for round 1 = `initialCombatant('player')`: base stats **with 2 unspent points treated as never spent**.
  2. **Scenarios**: "ranged" adds a hypothetical Bow the player cannot afford (P-P0-1); "melee" = unarmed base player.
  3. **p = 0.5**.
  4. The candidate set is all 10 splits of 2 points × the 1 legal loadout (0 gold, empty) = 10 plans.
  5. An analytic pre-score is computed. The top 6 are verified with 16 Monte-Carlo fights per scenario.
  6. Every verified plan wins **100%** against both scenarios, and even the unchanged build wins 100% vs the "ranged" scenario. The 0.02 tolerance therefore puts all 6 in a tie, all cost 0 gold, so the tie-break is the **analytic margin**, which deterministically favours STR.
- **V** There is no ML involvement (always fallback in round 1) and no randomness in selection. MC seeds vary per run, but saturation at 100% removes any effect.
- **V** `allocationOptions(points > 4)` only considers "all points into one stat". This is rare (it needs more than 4 points at once) but is another rigidity.
- **V** Late-game convergence: round-10 boss loadouts are 89% Rapier/Greatsword + Crossbow + Leather (P-CAT-6).

### 6.3 Confirmed problems (P)

- **P-DIV-1 The round-1 opponent model is wrong.** The boss models an opponent who never spends their initial points and who holds an unaffordable bow, so every plan "wins 100%" and selection collapses to a fixed tie-break.
- **P-DIV-2 Win-rate saturation.** Binary win/loss over 16 fights cannot separate strong plans (granularity 6.25%, all at 100%). The score carries no information about *how comfortably* a plan wins.
- **P-DIV-3 No principled handling of equivalent plans.** "Cheapest, then analytic margin" is deterministic, so identical histories give identical builds every run. In practice that means always the same round-1 build.
- **P-DIV-4 The opponent model ignores the player's unseen spending in every round**, not just round 1. Scenarios use the last observed build, while the player may have unspent points and gold.

### 6.4 Decisions (D)

No new ML model is introduced. The problems are in the opponent model and the scoring, which simpler, transparent changes can fix.

- **D-DIV-1 Reachable-opponent scenarios.** Build the opponent set from the player's last observed state plus what they could legally do before the next round:
  - each allocation of their unspent points (a reduced set: the 4 "dump" splits plus an even split when there are more than 2 points);
  - each feasible style (melee, and ranged only when D-P0-1 says it is feasible);
  - the strongest affordable weapon of each family in each style, using the same catalogue and rules.

  Scenario weights come from `P(ranged)` across styles and equal weights within a style. The set is capped (for example ≤ 12 scenarios) for speed, and recorded in `boss_decisions.evidence.scenarios`.
- **D-DIV-2 Continuous, unsaturated score.** Replace the plain MC win rate with **expected HP margin** (boss HP left minus player HP left, normalised to [−1, 1]) averaged over seeded MC fights, which still uses the real engine. Analytic pre-screening stays. Win rate is still reported for explanation.
- **D-DIV-3 Controlled diversity among near-equivalent plans.** After scoring, take plans within a tolerance of the best expected score (`ε`, for example 0.03 of the normalised margin, tuned in Phase 4). Group them by **archetype**: Bruiser (STR), Bulwark (DEF/HP), Duelist (DEX/melee), Marksman (DEX/ranged), Piercer (pierce weapon). Pick one with a **seeded** draw from `deriveSeed(runSeed, 'boss:N:pick')`, weighted by score (softmax with a low temperature), preferring an archetype the boss has not just used when scores tie.
  - Reproducible for a given seed. Never picks outside the tolerance band, so diversity cannot cost real strength.
  - The candidate band, weights and draw are persisted, so the choice can be audited.
- **D-DIV-4 Evidence-based shaping stays primary.** The existing weakness analysis feeds the scenario set (for example, after `pierce_exposure` the scenarios include the observed pierce weapon). The UI explains "chosen from N equally strong options (archetype X)".
- **D-DIV-5 Transparent fallback.** With or without the model, the policy is the same deterministic scoring plus seeded tie-sampling. The model only changes scenario weights (as today), and `basis` (§5) says which source was used.
- **D-DIV-6 Allocation enumeration.** Enumerate all splits up to 6 points (84 combinations), and use a greedy marginal-value search beyond that. Legality is still enforced by `applyPlan → equipment.ts`.

### 6.5 Acceptance criteria

- **AC-DIV-1** Legality: every chosen plan passes `applyPlan`. The boss never ends prep with unspent points (round-1 invariant kept), and gold never goes negative. Property test over random states.
- **AC-DIV-2** Diversity: over 200 seeded round-1 decisions, at least 3 distinct allocations occur, and none above 60% unless the report shows the others are clearly worse (outside ε). Measured with Shannon entropy of the allocation and the archetype.
- **AC-DIV-3** No strength loss: the selected plan's score is always within ε of the best evaluated plan (unit test plus logged invariant). In simulations, boss win rate per agent is reported against the V1 policy on the same V2 engine. The aim is a less one-sided game (target band discussed in Q-3), not a weaker boss by accident.
- **AC-DIV-4** Reproducibility: same seed, history and predictor give an identical decision (test).
- **AC-DIV-5** Policy runtime ≤ 2× the current runtime per decision (≈0.7–1 s per 10-round run today), measured by a benchmark script.

---

## 7. Armor penetration and combat information

### 7.1 Requirement (R)

Audit how combat events, player information, ML features/labels and boss decisions represent armor penetration. Investigate weapon used, attempt, success, DEF ignored, effective DEF before and after, damage dealt and received, opponent equipment and stats, and the difference between an outcome and its cause. Add only useful, reliable, decision-time-available information. No leakage. Decide whether the schema, labels, examples, datasets, evaluation, artifacts or activation need changes, and preserve history.

### 7.2 Current behaviour (V)

- **V** **Event logging is already complete for piercing.** Each `combat_events.calc` stores: attack value and source, `defenderNetDef`, `pierce {chance, defIgnore, roll, success, placeholder}`, `defUsed`, `netDamage`, both DEX values, ratio, mitigation draws, `finalDamage`. Columns: `weapon_id`, `mode`, `phase`, HP before and after. Every row is recomputable.
- **V** `game/summary.ts` aggregates `pierceAttempts`, `pierces`, `defIgnoredTotal` and damage by weapon per side.
- **V** `boss/analysis.ts` flags `pierce_exposure` if the player pierced at least once. Its text says "ranged attacks" (V2: wrong for melee pierce). The weakness maps to `effDex`/`maxHp` in `prepare.ts` (reasonable: DEF is the stat pierce bypasses).
- **V** The boss policy accounts for piercing **implicitly**: MC fights run the real engine with the scenario's weapon, and `expected.ts → expectedAttackDamage` folds pierce EV into the analytic pre-score, **but only for ranged mode**.
- **V** ML features (schema v1, 34) contain **no** pierce information. The task is "will the player attack mostly ranged next round". Top gain features of the active model: `boss_eff_dex_last`, `last_attacks`, `hist_ranged_round_frac`, `last_ranged_share`, `last_boss_dmg_ranged_share`.

### 7.3 Confirmed problems (P)

- **P-PEN-1 Ranged-only pierce paths.** `combat.ts → resolveAttack`, `expected.ts → expectedAttackDamage` and the analysis text all assume pierce means ranged. V2 melee pierce would be silently ignored in the boss's analytic pre-score, and mis-described in analysis.
- **P-PEN-2 The label counts forced attacks.** `rangedShare` includes the forced opening shot. Under D-OPEN-2 whether that shot happens depends on the **boss's** DEX (its own decision), which contaminates the label with the boss's policy.
- **P-PEN-3 32% invalid rows.** Rows are invalid when the player made no attacks (killed before acting), and the V2 opening-shot rule may increase that count *(unverified until simulated)*. The player's **next-round loadout** (stored in the label round's `player_snapshot`) reveals intent for single-mode loadouts even with zero attacks. Using it for the *label* is legitimate, because labels may use the label round.
- **P-PEN-4 Policy feedback inside features.** The top feature `boss_eff_dex_last` is the boss's own previous reaction. Any policy change (§6) shifts the feature distribution, so a v1 model is not valid after the policy change even with identical rules.
- **P-PEN-5 Catalogue-specific features.** `p_can_afford_bow` and `p_can_afford_crossbow` hard-code item ids, and their meaning changes with V2 prices.

### 7.4 What the model needs (analysis) and decisions (D)

The model answers one question that feeds scenario weights: "melee or ranged next round". The *consequences* of piercing (how much DEF is worth against this player) are computed by the engine-based policy from the player's observed weapon, which is exact and needs no learning. Adding pierce outcomes as features would mostly add noise: pierce success is a weighted coin flip whose result does not predict the player's next *style*. Therefore:

- **D-PEN-1 Engine and policy:** generalise pierce to any weapon with a spec (D-CAT-4). `expectedAttackDamage` uses the pierce spec of the weapon that *mode* uses. Analysis text and metrics become mode-neutral, and analysis adds `extraDamageFromPierce`, computed from `calc` as `netDamage(A, D·(1−i)) − netDamage(A, D)` per success. This separates **cause** (pierce) from **outcome** (damage).
- **D-PEN-2 Event additions (small):**
  - `calc.pierce.weaponId`, so it is unambiguous for hybrids;
  - `calc.pierce.extraDamage`;
  - `phase`-independent `choiceSource`, already present.

  No DB migration is needed (JSONB). Old events without these keys are handled as "not recorded".
- **D-PEN-3 Feature schema v2 (catalogue-agnostic, minimal):**
  - replace the two bow/crossbow affordability features with `p_ranged_feasible` (D-P0-1) and `p_gold_minus_cheapest_ranged`;
  - add `last_weapon_family` (one-hot: none/blade/blunt/polearm/bow) and `last_weapon_pierce_ev` (chance × ignore of the player's last weapon). These are cheap, decision-time features that describe the player's choice, not luck;
  - shares become `NaN` when there are no attacks (D-P0-4).

  Pierce *outcome* features (success counts) are included **only if** an ablation in Phase 6 shows log-loss improvement on feasible held-out rows. The default is to exclude them.
- **D-PEN-4 Label v2: "intended style next round".**
  - Computed from the label round's non-forced attacks: phase ≠ opening, and attacks where the player had a choice or a single mode.
  - If the player made no such attacks: ranged-only loadout → 1; melee/unarmed-only loadout → 0; Ranged+Melee with no attacks → invalid.
  - Rule-determined rows are flagged (D-P0-3).
  - This removes the opening-shot contamination and recovers most invalid rows. The share recovered is measured in Phase 6.
- **D-PEN-5 Versioning:** `ENGINE_VERSION 2.0.0`, `SIMULATOR_VERSION sim-2.0.0`, `FEATURE_SCHEMA_VERSION v2` (features + label). The existing guards already make the v1/1.1.0 active model fall back automatically under 2.0.0 (`predictor.ts`), and `activateModel` refuses it. That is the activation safety net, and it is kept.
- **D-PEN-6 Historical data:** v1 rows and models are kept unchanged. v2 rows are built only from engine-2.0.0 raw records for training. Optionally, v2 rows are built from 1.1.0 raw records **for offline analysis only** (for example measuring label-v2 recovery), resolved with the frozen V1 catalogue, tagged `engine_version 1.1.0`, and never mixed into a 2.0.0 snapshot (the dataset filter already enforces this).

### 7.5 Acceptance criteria

- **AC-PEN-1** Every pierce weapon's events carry the full pierce block, and the round view shows pierce attempts and successes for melee and ranged.
- **AC-PEN-2** The analytic pre-score matches the MC mean within tolerance for a pierce-melee scenario (test).
- **AC-PEN-3** Leakage test extended to v2 features (including the new loadout features from round N only).
- **AC-PEN-4** Label v2 unit tests: opening shot excluded; zero attacks with a ranged-only loadout gives 1; zero attacks with a hybrid gives invalid.
- **AC-PEN-5** Phase 6 report: ablation table (v2 minimal vs v2 + pierce outcome features), feasible-row metrics vs baseline, per-strategy (leave-one-strategy-out) metrics, and manual-only metrics if at least 40 manual rows exist (otherwise "not enough manual data", stated).

---

## 8. UI audit and complete redesign

### 8.1 Requirement (R)

Read `client/PRODUCT.md` first and treat it as a key design input. Audit the current UI and the running app, then propose a coherent redesign rather than cosmetic CSS. Cover:

- hierarchy, typography, spacing, colour and contrast;
- component consistency;
- stats and equipment presentation;
- shop and inventory;
- combat log readability;
- feedback for actions, rewards, level-ups and errors;
- boss explanations;
- simulation and ML Lab usability;
- responsive behaviour;
- loading, empty, success and error states;
- accessibility and keyboard use.

Preserve working functionality.

### 8.2 Product constraints from `client/PRODUCT.md` (V)

Players play for fun; Runs, Simulations and ML Lab are **secondary developer tools**. Principles:

1. **Duel feel first** ("a tense medieval fight, not a spreadsheet").
2. **The boss's memory stays visible next to the fight**.
3. **Fair and honest** (model vs fallback reported truthfully).
4. **Numbers stay traceable** (formula inputs available, not the headline).

React 18 + Vite + plain CSS. All rules on the server. Text-focused, no art assets (whether to add art is undecided).

### 8.3 Audit findings (V = observed in the running app on run #389, or in code)

| # | Finding | Evidence | Principle violated |
|---|---|---|---|
| U1 | One long scroll: fighters → *previous* round → prep → Begin → history. The next action (prep and Begin) sits about 3 screens down on desktop. The mobile page is 4,786 px tall. | Browser, `DuelView.tsx` order | 1, usability |
| U2 | No phase structure. Prepare / Fight / Aftermath are not distinguished, even though PRODUCT.md describes exactly that loop. | `DuelView.tsx` | 1, 2 |
| U3 | Fighter cards give 9 numbers equal weight (gold, points, 4 base, 3 net). Base vs Net is unclear, there is no head-to-head comparison, and the boss's pending stat point is highlighted in gold (it is spent at the next prep, so this misleads). | Screenshot | 1, 4 |
| U4 | Shop: 4 columns of text rows (`+6 STR, +2 DEF`) with no preview of the effect on Net stats. Buy and equip are separate steps, and equip uses native `<select>` + "Equip". Slot legality appears only in a footnote. V2 grows weapons from 10 to 18, which will make this worse. | Screenshot, `PrepPanel.tsx` | 1, usability |
| U5 | Combat log: a flat list in a 480 px scroll box with no turn grouping, no HP-over-time, no summary of the exchange, and no differentiation of the opening phase beyond a tag. The math expansion works well (keep it). | `RoundView.tsx` | 1, 4 |
| U6 | Result moment is weak: a small Victory/Defeat pill, rewards as plain bullets, and level-up as a gold bullet line. | Screenshot | 1 |
| U7 | Boss mind: two prose panels after the log. The rationale bullets restate numbers. "Evidence → response" (the core of Principle 2) is at the very bottom, and the options table is hidden. Round-1 "P = 50%" is shown as a prediction (P-P0-4). | Screenshot, `RoundView.tsx` | 2, 3 |
| U8 | Errors: an unreachable API shows a generic "⚠ 500 Internal Server Error" (actually ECONNREFUSED in the proxy). Error and empty state appear together ("No active manual runs" under a failed load). "Start new run" stays enabled while the backend is down. End run uses native `confirm()`. | Browser with Docker stopped | usability, honesty |
| U9 | Mobile: the translucent sticky header wraps to about 200 px (about 25% of the viewport) and content shows through it. 23 tap targets are under 32 px. Tables (history, options) are cramped. | 375 px emulation, JS measurement | responsive, a11y |
| U10 | Developer tools (Runs, Simulations, ML Lab) have the same nav weight as Duel. Emoji are used as icons in nav and headings (read aloud by screen readers). | `App.tsx` | product focus, a11y |
| U11 | Side identity relies on colour (blue/red borders) alone. Tags are 0.75 rem. HP/XP bars have no progressbar semantics *(to verify in `util.tsx → Bar`)*. | CSS | a11y |
| U12 | Simulation/ML Lab: functional, but status is prose-heavy. Model vs fallback counts mix engine versions (P-P0-4). The ML Lab has no per-engine filter or "unusable model" emphasis beyond text. | `MlView.tsx`, `training.ts` | 3 |

### 8.4 Redesign proposal (D)

**Direction: "the war table".** A dark iron-and-parchment duel board that keeps the existing palette family but formalises it, with the screen organised around the run loop instead of a document.

- **D-UI-1 Information architecture.**
  - Duel is the product.
  - Runs, Simulations and ML Lab move under a secondary "Workshop" group: a compact nav with a visible but subordinate entry.
  - The run screen has:
    - a persistent **Versus bar** (both fighters: level, XP, gold, and Net ATK/DEF/DEX/HP as paired bars that show who leads each stat, with icons + labels, not colour only);
    - a **phase stepper**: *Prepare → Fight → Aftermath*;
    - one primary call to action per phase in a sticky action bar ("Begin round 3", "Continue to aftermath", "Prepare round 4").
- **D-UI-2 Prepare = the Armory.**
  - A three-slot loadout (Hand 1, Hand 2, Body) with slot legality shown as you pick.
  - Item cards grouped by family (Blades, Blunt, Polearms, Bows, Shields, Armor) with role chips ("First Shot", "Pierce 35% → 60% DEF", "−3 DEX").
  - Filters: affordable / owned / family.
  - **Live stat-delta preview** on hover or focus: "Net ATK 26 → 44, Eff. DEX 12 → 9".
  - **Buy & equip** as one action.
  - A stat allocator with +/− steppers and preview.
  - A "What the boss knows" note (it saw your last build only).

  The preview stays server-authoritative through a pure `POST /api/runs/:id/preview` endpoint, because rules must not move to the client.
- **D-UI-3 Fight = the replay.**
  - The log is grouped by turn, with an opening-phase banner that explains who got the First Shot and why (§4), and a dual HP track per attack.
  - Pierce, KO and DEX-bonus callouts, plus an exchange summary ("You: 7 hits, 98 dmg, 2 pierces").
  - The calculation drawer is kept (Principle 4).
  - Optional step-through playback, honouring `prefers-reduced-motion`.
  - The Ranged/Melee choice becomes a prominent in-log prompt with keyboard shortcuts.
- **D-UI-4 Aftermath = "The Boss Remembers".**
  - A result banner with rewards and a level-up moment.
  - Then the boss's memory as a chain: **Evidence → Weakness → Response** cards.
  - A prediction badge that is honest about its source: *Trained model vX* / *Baseline* / *Rule: you cannot field a ranged weapon* / *No evidence yet*.
  - The diversity disclosure ("chosen from N equally strong plans").
  - The options table sits behind a disclosure.
  - On wide screens the boss panel docks beside the fight (Principle 2: next to the fight, not buried).
- **D-UI-5 Design system.**
  - `tokens.css`: surfaces 0–3, text levels, player steel-blue / boss ember-red / gold accent / semantic ok-warn-bad, a type scale, a 4-pt spacing scale, radii, elevation, motion.
  - Components: `VersusBar`, `StatCompare`, `PhaseStepper`, `ActionBar`, `ItemCard`, `SlotPicker`, `StatAllocator`, `TurnGroup`, `AttackRow`, `CalcDrawer`, `ResultBanner`, `EvidenceChain`, `PredictionBadge`, `StatusBanner`, `ConfirmDialog`, `Toast`, `Skeleton`, `DataTable`.
  - The final type, font and colour choices are made through the repo's Impeccable workflow (`.claude/skills/impeccable`) during implementation.
- **D-UI-6 States and feedback.**
  - Skeletons instead of "Loading…".
  - A backend-unreachable banner with the actual cause and remedy ("Can't reach the API at :4000 — is the server running? Is Docker up?"), and actions disabled while it shows.
  - Never show error and empty state together.
  - Disabled controls state why (for example "Need 7 more gold").
  - Toasts for purchase, allocation and equip.
  - An accessible confirm dialog instead of `confirm()`.
- **D-UI-7 Responsive.**
  - Mobile: compact sticky Versus bar (≤ 64 px, opaque), phase tabs, bottom action bar, cards stacked in a single column, tables as stacked rows, tap targets ≥ 44 px.
  - Tablet: two columns.
  - Desktop: fight plus docked boss panel.
- **D-UI-8 Accessibility.**
  - Semantic headings and landmarks; emoji removed from accessible names (use SVG icons with `aria-hidden` plus text).
  - `role="progressbar"` with values; visible focus rings; WCAG AA contrast for all text tokens.
  - Keyboard: R/M for the attack choice, Enter for the primary action.
  - Live region announcing round results.
- **D-UI-9 Workshop views.**
  - Simulations: a launch form with a strategy picker, a progress card, and a per-strategy win-rate table with V1-vs-V2 engine labels.
  - ML Lab: a status strip (data / model / active / used in last decision) **filtered to the current engine**, an explicit "unusable model" state, a metrics table with feasible-row vs all-row columns (§5), and old engines collapsed under "History".
- **D-UI-10 Scope guard.** Every current capability stays reachable: start/resume, allocate, buy, equip, begin round, choice prompt with "repeat", end run, round history and view, calc details, boss analysis/decision/options, runs list, sim launch/progress, ML build/export/train/activate.

### 8.5 Acceptance criteria

- **AC-UI-1** Every capability in D-UI-10 is verified in the browser after the redesign (checklist in the plan).
- **AC-UI-2** At 375 px: no horizontal scroll, sticky header ≤ 64 px, primary action visible without scrolling in each phase, tap targets ≥ 44 px (JS audit). At 1280 px: prep, Begin and the Versus bar are visible in one viewport.
- **AC-UI-3** Keyboard-only run of one full round is possible. Automated contrast check passes AA for the token palette.
- **AC-UI-4** All loading, empty, error, success and backend-down states are demonstrated (Docker stopped / API stopped / empty DB).
- **AC-UI-5** A before/after screenshot set (desktop and mobile, each phase) is attached to `PROGRESS.md`.

---

## 9. Simulations, datasets and model lifecycle

**R (unchanged):**
- Manual and simulated play use the same rules.
- Agents and fixtures are updated for the new mechanics, and new weapons and effects are represented.
- Dataset compatibility is determined.
- Simulation behaviour and schemas are versioned.
- Old datasets, artifacts and metadata are preserved.
- Retrain only when justified.
- The active model is not replaced until it meets the eligibility rules.
- Real model improvement is distinguished from easier data or changed labels.

- **V** Manual and simulated play share services (`sim/runner.ts` → `services/*`). Same rules: confirmed by code.
- **V** Agents (`sim/agents.ts`) have hard-coded V1 wishlists (`axe`, no polearms, no pierce weapons, no Longbow, no Mace or Warhammer). The `random` agent is the only one that can buy everything. Agents spend the initial points with a fixed pattern.
- **P-SIM-1** V2 data generated with V1 agents would contain almost no polearm, flail or longbow play. The model and the balance evaluation would be blind to piercing.
- **D-SIM-1** `sim-2.0.0` agents:
  - update the existing six to V2 items;
  - add **piercer** (polearm/flail line, STR plus DEF-breaking) and **duelist** (Sabre/Rapier, DEX melee);
  - give each agent 2–3 seeded variants of initial allocation and wishlist so runs are not clones;
  - the adaptive agent switches across three styles (melee, ranged, pierce).
- **D-SIM-2** Generate data only after Phases 1–4 (rules + policy) are final, because the policy shapes features (P-PEN-4).
- **D-SIM-3** Lifecycle: see the plan, §"Historical data and model artifact strategy". In short: retain everything, regenerate under 2.0.0, retrain v2, activate only if eligible **and** the extra checks pass (feasible-row metrics, leave-one-strategy-out not worse than baseline).
- **D-SIM-4** A pure-engine **balance harness** (no DB writes): item-vs-item and build-vs-build MC matrices by level tier, for §2 evaluation and boss tuning. Results go to `docs/V2_BALANCE.md`.

---

## 10. Testing and verification (R, refined)

Tests must cover individual mechanics and end-to-end behaviour. Minimum list (R): item definitions; shop/equip validation; combat and piercing; opening-shot eligibility and priority; XP/gold/level-up rewards; round-zero probability semantics; boss allocation and variation; manual/simulation consistency; ML feature correctness and data compatibility; API and persistence; UI functionality and responsiveness. Targeted tests during development; the full suite plus typecheck and build before completion; docs updated (`PROGRESS.md`, `GAME_MECHANICS.md`, `ARCHITECTURE.md`, `SIMULATIONS.md`, `ML_WALKTHROUGH.md`, `DATABASE_WALKTHROUGH.md`, `FILE_GUIDE.md`, `client/PRODUCT.md` if product facts change).

- **V** There are no client tests today (server: Vitest unit and integration only).
- **D-TEST-1** Add a small client test layer: Vitest + React Testing Library for Armory legality messaging, log grouping, prediction badge wording and state components. Browser verification with the preview tools at 375/768/1280 px is required for each UI phase. No new E2E framework unless the user wants one.
- **D-TEST-2** Legacy-compatibility integration test: seed a test DB with engine-1.0.0/1.1.0 rows (including `axe` and the old Greatsword), then load the run, round, decision and analysis through the API.

---

## 11. Open questions (Q) — need the user's decision

| # | Question | Recommendation (default if no answer) |
|---|---|---|
| **Q-1** | When both fighters are ranged and Effective DEX is exactly equal, who gets the opening shot? | **Nobody** (D-OPEN-3). Alternative: the existing seeded coin flip. |
| **Q-2** | Active pre-V2 runs (#253 on engine 1.0.0, #389 on 1.1.0): what happens after the upgrade? | Keep them **viewable but closed to new rounds** with a "created under older rules" notice, enforced in code with no DB write. Alternative: let them continue under V2 rules (mixed-rule data, possible crashes on removed items). |
| **Q-3** | Balance target: should V2 aim for a less one-sided boss? Today the boss wins 80–100% against agents. | Report win rates and keep the boss's *legal* strength intact. Ask before tuning toward any target band (for example 55–70% boss wins). Values in §2/§3 are not changed either way. |
| **Q-4** | Are Spear/Lance/Pike plain melee weapons (inferred), or did you intend a reach rule (for example a First Shot)? | Plain melee with pierce (D-CAT-3). |
| **Q-5** | The balance findings P-CAT-3/4 (pierce weapons out-damaged by Warhammer at every DEF level tested; Longbow worse than Crossbow): do you want a separate tuning proposal after the simulation report? | Yes: implement your values exactly, then present a proposal with evidence. No change without approval. |

Everything else is decided above as **D** items and can be overridden.

### 11.1 User answers (2026-10-16) — these now override the defaults above

| # | Answer | Effect on the spec |
|---|---|---|
| Q-1 | Accept recommendation. | D-OPEN-3 is **approved**: equal Effective DEX with both fighters ranged → no opening shot. |
| Q-2 | Accept recommendation. | Pre-2.0 active runs stay viewable and are closed to new rounds, enforced in code. No DB write. |
| Q-3 | Yes. | V2 aims for a less one-sided boss. Working target: boss win rate **55–70%** per simulated agent (adaptive, legal play only; the boss gets no handicap and no hidden bonus). The band is tuned and reported in Phase 3/4. |
| Q-4 | Yes. | Spear, Lance and Pike are plain melee weapons with pierce (D-CAT-3 approved). |
| Q-5 | Buff pierce. Claude chooses the numbers. | **The user has delegated pierce chance and DEF-ignore % for all 8 pierce weapons** (Rapier, Flail, Spear, Lance, Pike, Bow, Crossbow, Longbow). They are tuned by simulation until each one is a valid weapon and tactic. §2.1 pierce values are the *starting* point, not fixed. Costs and STR/DEF/DEX modifiers stay as in §2.1 unless the user approves a change. Claude must also **report every other balance problem** found (for example Warhammer dominance, Longbow vs Crossbow, the boss snowball) with a proposed fix, and must not change non-pierce values without approval. |

**AC-BAL-1 (from Q-5):** after tuning, every pierce weapon is chosen by at least one sim agent or boss archetype as its best response in at least one level tier, and no pierce weapon is dominated in the balance harness. Final values, with the evidence behind them, are recorded in `docs/V2_BALANCE.md` and `docs/GAME_MECHANICS.md`.

---

## 12. Decision authority (R, unchanged)

**Mandatory:** the specified catalogue, reward targets, opening-shot change, investigation of round-zero probability, improved boss build variation, armor-penetration audit and Impeccable-guided UI redesign must all be addressed. None of them may be dropped to save effort or tokens.

**Delegated to Claude:** implementation details, abstractions, data structures, algorithms, component boundaries, test organisation, visual design, and how to improve build diversity. Claude proposes solutions, compares trade-offs and picks a justified default, and asks only about material ambiguities. A change to a user-specified mechanic, economic value or mandatory requirement is documented and needs the user's approval; it is never applied silently.

## 13. Acceptance criteria (R, with references)

Version 2 is complete only when:

1. The specified catalogue and reward values are implemented consistently (AC-CAT-*, AC-ECO-*).
2. Opening-shot behaviour matches the new rule (AC-OPEN-*).
3. Round-zero probability semantics are understood, documented and tested (AC-P0-*).
4. Boss stat allocation supports meaningful strategic variation and legal builds (AC-DIV-*).
5. Armor penetration is implemented, logged, represented in relevant data and evaluated for ML impact (AC-PEN-*).
6. The UI has been audited and redesigned according to `client/PRODUCT.md` (AC-UI-*).
7. Simulations, datasets and models have been assessed and updated where justified (§9, plan Phase 6).
8. Regression tests and build/type checks pass.
9. Documentation reflects the actual implementation.
10. `PROGRESS.md` records verified status, outstanding issues and reproducible verification steps.

Compiling, or looking different, is not completion.

## 14. Working principle (R)

**Preserve the intended game; improve the implementation.** Investigate first, identify dependencies, make deliberate decisions, implement in coherent stages and verify each one. Prefer maintainable solutions over unnecessary complexity, but never simplify away a requirement.
