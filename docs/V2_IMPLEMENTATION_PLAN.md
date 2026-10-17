# The Boss Remembers — Version 2 Implementation Plan

**Status (2026-10-17):** Phases 0–8 done (engine 2.0.0, policy v2, schema v3, Court Deck UI). The V2 model and ensemble were trained but are not eligible, so the boss uses the transparent baseline (docs/ML_WALKTHROUGH.md §10c). Phase 8 final verification done 2026-10-17: see `PROGRESS.md` §0.
**Spec:** [`V2_DEMANDS.md`](V2_DEMANDS.md). Requirement, decision and acceptance IDs (R/D/AC/Q) refer to that document.
**Prepared:** 2026-10-16 from the working tree on `master`, which has **no commits**: every file is untracked.

## Overview

```
Phase 0  Safety baseline (commit, DB backup, V1 reference report)
   │
Phase 1  Versioned catalogue + V2 items + economy  ─┐  one engine bump → 2.0.0
Phase 2  Combat: generalised pierce + opening shot ─┘
   │
   ├── Phase 3  Balance harness + catalogue/economy report (pure engine, no DB)
   │        │ (tuning input for ε, Q-3, Q-5)
   ├── Phase 4  Prediction semantics (feasibility, basis) + boss policy diversity
   │        │
   │   Phase 5  Simulation agents sim-2.0.0   (code can start in parallel with 4)
   │        │
   │   Phase 6  ML schema v2 → data generation → train → evaluate → (activate)
   │
Phase 7  UI redesign — 7a/7b can start right after Phase 0; 7c needs 1; 7d needs 2; 7e needs 4; 7f needs 6
   │
Phase 8  Final verification, docs, PROGRESS.md
```

**Ordering rules.** Shared rules and data definitions (Phases 1–2) come before anything that generates or interprets data. The boss policy (Phase 4) must be final before any V2 training data is generated: the active model's top feature is the boss's own previous DEX (P-PEN-4), so a policy change invalidates the data. UI foundation work does not depend on game rules and can run in parallel.

**Independent tracks:**
- Track A, rules → policy → sims → ML: Phases 1 → 2 → 4 → 5 → 6.
- Track B, analysis: Phase 3, after Phase 2, alongside Phase 4.
- Track C, UI: 7a/7b immediately, then 7c–7f as each dependency lands.

Two writers must never edit the same files at the same time. Track C touches `client/` (and one new server endpoint in 7c). Track A touches `server/` and `ml/`.

---

## Phase 0 — Safety baseline

**Objective:** make every later change reversible and measurable against V1.

**Files / components:** repository root; dev DB `boss-remembers-db`; `artifacts/`.

**Proposed changes:**
1. **(Needs user approval)** Create a branch and an initial commit of the current V1 tree. Today there is no commit at all, so there is nothing to roll back to. `.env` and `artifacts/` are git-ignored already (verify `.gitignore` before committing).
2. Back up the dev database: `docker exec boss-remembers-db pg_dump -U boss boss_remembers > artifacts/backups/pre-v2-<date>.sql`. This is a read of the DB written to a git-ignored folder. Record its sha256.
3. Copy `artifacts/models/*` and `artifacts/datasets/*` checksums into a manifest (`artifacts/MANIFEST-pre-v2.json`). Files are not moved.
4. Run the full test suite on the **test** DB and record the result (it is currently unverified: `PROGRESS.md` gives both 88 and 80).
5. Write `docs/V2_BASELINE.md` with the V1 reference numbers from read-only SQL:
   - boss win rate per agent;
   - round-1 allocation distribution (243/243 = +2 STR);
   - double-opening rate (24%);
   - round-10 loadout distribution;
   - invalid-row rate (32%);
   - rule-determined training rows (36%).

**Dependencies:** none.

**Tests / verification:** `npm test`, `npm run typecheck`, `npm run build` all recorded; the backup restores into a scratch database (`createdb … && psql < backup`), and the row counts match.

**Risks / rollback:** none to data. If the tests fail at baseline, record the failures and fix them first or carry them as known issues. Do not start V2 on an unknown baseline.

**Done when:** a commit exists, the backup is verified, the baseline report is written, and the test status is known.

---

## Phase 1 — Versioned catalogue, V2 items, economy (engine 2.0.0, part 1)

**Objective:** implement §2 and §3 exactly, without breaking history.

**Files (verified):**
- `server/src/game/catalog.ts` → split into `server/src/game/catalog/v1.ts` (frozen copy of today's 16 items, read-only), `catalog/v2.ts` (the 24 items in V2_DEMANDS §2.1), and `catalog/index.ts`.
  - `index.ts` exports `ITEMS` (live = v2), `getItem`, `requireItem` (live), `catalogFor(engineVersion)`, `itemForHistory(id, engineVersion)`, `cheapestCost(category)`.
- `server/src/game/types.ts`: add `family` to `Item`; `PierceSpec.placeholder` becomes `false` for V2.
- `server/src/game/constants.ts`: `XP_LOSS 30`, `GOLD_LOSS 5`, `GOLD_LEVEL_UP 20`, `ENGINE_VERSION '2.0.0'` plus a history comment.
- `server/src/game/progression.ts`: docblock only (logic already reads constants).
- History readers that must use the record's engine catalogue:
  - `server/src/boss/analysis.ts` (`names`, heavy-weapon check);
  - `server/src/boss/prepare.ts` (evidence names);
  - `server/src/ml/features.ts` (`last_armour_def`, affordability; Phase 6 replaces the latter);
  - `server/src/services/history.ts` / `services/runs.ts` views wherever item names or costs are resolved;
  - `server/src/api/app.ts` (`/api/catalog` also returns `legacyItems` so the client can name old ids).
- `server/src/services/rounds.ts`: legacy-run guard per **Q-2** (default: refuse new rounds when `runs.engine_version` ≠ `ENGINE_VERSION`, with a clear 400 message; no DB writes).
- `server/src/boss/policy.ts`: replace the hard-coded `'bow'`/`'sword'` hypotheticals with a catalogue query (the cheapest or strongest affordable item of the family). The full scenario redesign comes in Phase 4.
- `server/src/sim/agents.ts`: minimal edit so it compiles and runs (remove `axe`). The real agent work is Phase 5.
- `client/src/util.tsx`: `itemName` falls back to `legacyItems`.
- `client/src/components/PrepPanel.tsx`: group by family (minimal, ahead of the 7c redesign); pierce text without "placeholder".
- Tests: `server/tests/unit/rules.test.ts` (catalogue table → V2, rewards → V2); new `server/tests/integration/legacy-compat.test.ts`.
- Docs: `docs/GAME_MECHANICS.md` §2, §5, §8.

**Proposed changes:** as listed. Item ids follow D-CAT-2. Display names follow the user's spelling.

**Dependencies:** Phase 0.

**Tests / verification:**
- AC-CAT-1: table-driven test of all 24 items, generated from the same table as the docs.
- AC-CAT-2: a grep test (in the unit suite) asserting no item id literals outside `catalog/` and tests.
- AC-CAT-3: legacy-compat test seeds 1.0.0/1.1.0 runs with `axe` and old `greatsword` values and loads them through the API.
- AC-CAT-4: legality tests for the new combinations.
- AC-ECO-1/2: reward and multi-level-up tests; `/api/catalog` returns the new values.

**Risks / rollback:**
- A missed history lookup crashes old pages. Mitigation: the legacy-compat test plus a grep of every `getItem(`/`requireItem(` call site (43 references today).
- Rollback: revert the commit. No data is written in this phase.

**Done when:** the unit and integration suites pass, the legacy runs render in the browser (read-only view), and GAME_MECHANICS is updated.

---

## Phase 2 — Combat: generalised pierce + opening-shot rule (engine 2.0.0, part 2)

**Objective:** implement D-CAT-4, D-OPEN-1..5 and D-PEN-1/2. Phases 1 and 2 ship as the **same** engine version, 2.0.0; no data is generated between them.

**Files (verified):**
- `server/src/game/combat.ts`:
  - `resolveAttack` looks up the pierce spec of the weapon used by the chosen mode (`rangedWeaponId` for ranged, `meleeWeaponId` for melee), rolls only if a spec exists, and records `pierce.weaponId` and `pierce.extraDamage`;
  - `startCombat` computes `openingEligible` and an opening order of 0 or 1 entries by the new rule, plus `openingRule` and a reason;
  - the tie-break draw stays first.
- `server/src/game/expected.ts`: pierce EV for the weapon of the mode, for melee as well as ranged.
- `server/src/game/summary.ts`: pierce attempts by mode; `extraDamageFromPierce`.
- `server/src/boss/analysis.ts`: mode-neutral `pierce_exposure` text and metrics (adds the weapon and extra damage); review `heavyWeaponStrMod: 8` against V2 (Mace 8, LongSword 7, Pike 7, Warhammer 12, GreatSword 10) and document the result.
- `server/src/boss/policy.ts → analyticScore`: opening damage only for the fighter who actually shoots under the new rule.
- `client/src/api.ts` types; `client/src/components/RoundView.tsx` (`InitiativeLine` shows eligibility, the winner and the reason; old rounds without the fields use the legacy wording; pierce tags on melee).
- Tests: `server/tests/unit/combat.test.ts` (replace "both ranged → higher DEX shoots first"; add AC-OPEN-1/2 and AC-CAT-5).
- Docs: `docs/GAME_MECHANICS.md` §5, §6, §9.

**Dependencies:** Phase 1 (pierce specs live in the V2 catalogue).

**Tests / verification:**
- AC-OPEN-1..2 and AC-CAT-5.
- AC-PEN-1, plus AC-PEN-2 (the analytic pre-score agrees with the MC mean within a tolerance for a pierce-melee matchup).
- A replay test: a stored seed and snapshots reproduce identical events.
- Lifecycle integration tests still pass, with fixtures updated to V2.

**Risks / rollback:**
- RNG sequence changes for pierce-melee attacks, which is expected and versioned.
- Q-1 unanswered: implement the recommended default behind a single named function (`openingShooter()`) so switching to the coin flip is a one-line change plus tests.
- Rollback: revert Phases 1–2 together.

**Done when:** all combat tests pass, a manual browser round shows the correct opening line and melee pierce, and the docs are updated.

---

## Phase 3 — Balance harness and catalogue/economy report

**Objective:** produce evidence for AC-CAT-6, AC-ECO-3, P-CAT-3..6, the ε tuning in Phase 4 and the user's Q-3/Q-5 decisions. **No DB writes.**

**Files:** new `server/src/sim/balance.ts` + `server/src/sim/balance-cli.ts` (`npm run balance`); output `docs/V2_BALANCE.md`, with raw CSVs in `artifacts/balance/`.

**Proposed changes:** pure-engine Monte-Carlo built on `runFullCombat`:
1. Item-vs-item matrix at three level tiers (L1 with 2 points, L3, L5), with stat-point archetypes (STR/DEF/DEX/HP-heavy) and affordable loadouts per tier (gold curve from §3.3).
2. Cost-efficiency per item: Δ expected HP margin per gold vs the next-cheapest option in the same family.
3. Strict and near-dominance list.
4. "Best response" table: for each player archetype, the best boss build and its margin. Feeds the Phase 4 scenario set and the archetypes.
5. Economy timeline: earliest round each item is affordable for always-win, always-lose and alternating patterns, under V1 and V2 rewards.

**Dependencies:** Phase 2.

**Tests:** a unit test that the harness is deterministic for a seed; spot-check one matrix cell against a hand calculation.

**Risks / rollback:** none (read-only analysis). The main risk is over-interpreting a scripted matrix, so the report states its assumptions.

**Done when:** `V2_BALANCE.md` exists with tables and conclusions. Any tuning proposals are listed **separately** for user approval (D-CAT-6, D-ECO-1). No values are changed.

---

## Phase 4 — Prediction semantics and boss build diversity

**Objective:** implement D-P0-1..5 and D-DIV-1..6.

**Files (verified):**
- `server/src/ml/predictor.ts`: `Prediction.basis`; `probabilityRanged: number | null`; a feasibility short-circuit before the model; `unknown` handling.
- `server/src/ml/features.ts`: `rangedFeasible(state, catalogue)` helper; `baselineProbability` uses the feasibility mask and skips no-attack rounds (the feature-vector changes themselves are Phase 6).
- `server/src/boss/policy.ts`:
  - reachable-opponent scenarios (D-DIV-1);
  - expected-HP-margin score (D-DIV-2);
  - archetype labelling and seeded near-equivalent sampling (D-DIV-3);
  - allocation enumeration up to 6 points, greedy beyond (D-DIV-6);
  - persist the candidate band and draw.
- `server/src/boss/prepare.ts`: pass the run seed for the pick; store `basis`, the scenario set, the band and the archetype in `boss_decisions` JSONB. **No migration**: the columns are JSONB, and old rows lack the keys, which readers treat as "legacy".
- `server/src/ml/training.ts → mlStatus`: usage counts filtered to the current engine and split by basis.
- `client/src/components/RoundView.tsx → DecisionPanel`: interim honest wording ("Rule: you can't field a ranged weapon yet", "No evidence yet", archetype and "chosen from N equal plans"), until 7e replaces it.
- Tests: new `server/tests/unit/policy.test.ts` (pure, no DB); updates to `server/tests/integration/lifecycle.test.ts` and `ml.test.ts` (leakage test still passes).
- New `server/src/boss/bench.ts` for the AC-DIV-5 timing measurement.
- Docs: `ARCHITECTURE.md` (boss section), `ML_WALKTHROUGH.md` §5/§8.

**Dependencies:** Phases 1–2. Phase 3 output is used to tune ε and the temperature, and to define the archetypes. The code can start before Phase 3 finishes, but the constants are finalised after it.

**Tests / verification:** AC-P0-1/2/4 and AC-DIV-1..5. AC-DIV-2 is measured with a pure script: 200 seeded round-1 decisions → allocation and archetype histogram plus entropy. A strength check compares the new policy with the V1 policy (kept under a flag `POLICY_VERSION`) on the same V2 engine, using the balance harness: 100 seeded fights per agent archetype.

**Risks / rollback:**
- *Policy slower:* the scenario cap and the analytic pre-screen bound the cost; the bench gate is ≤ 2×.
- *Diversity weakens the boss:* the band is limited to within ε of the best plan, and the invariant is tested.
- *Behaviour harder to explain:* the full band and the draw are persisted and shown in the UI.
- Rollback: `POLICY_VERSION` flag (`v1-deterministic` | `v2-diverse`), stored in each decision. Reverting is a config change, and decisions remain attributable.

**Done when:**
- every acceptance criterion passes;
- the round-1 decision is no longer constant;
- a browser check shows the new decision panel text;
- `POLICY_VERSION` is stored on every decision.

---

## Phase 5 — Simulation agents (sim-2.0.0)

**Objective:** implement D-SIM-1, so that V2 data covers every weapon family, pierce play and varied openings.

**Files (verified):** `server/src/sim/agents.ts` (wishlists from catalogue families, not ids; new `piercer` and `duelist` agents; seeded variants; three-style `adaptive`), `SIMULATOR_VERSION = 'sim-2.0.0'`; `server/tests/integration/sim.test.ts`; `docs/SIMULATIONS.md`.

**Dependencies:** Phase 1 (catalogue). The code can be written alongside Phase 4. Batches that produce training data wait for Phase 4 to be final.

**Tests:**
- Each agent produces legal decisions for 10 rounds against a stub boss (unit).
- Every V2 item is bought by at least one agent in a 60-run smoke batch on the **test** DB.
- Reproducibility for the same seed.
- Engine 2.0.0 vs 1.1.0 batches are not comparable (existing test, updated).

**Risks / rollback:** agents that are too weak keep the invalid-row rate high, and the balance report flags this. Rollback: revert agents. Data is tagged `sim-2.0.0`.

**Done when:** a smoke batch on the test DB shows item coverage and zero failed runs.

---

## Phase 6 — ML schema v2, data generation, training, evaluation

**Objective:** implement D-P0-3/4 and D-PEN-3..6, then decide on retraining from evidence.

**Files (verified):**
- `server/src/ml/features.ts`: `FEATURE_SCHEMA_VERSION 'v2'`; v2 features (D-PEN-3); `NaN` for missing shares; label v2 `intendedStyle(labelRound)` (D-PEN-4) with `invalid_reason` and a `ranged_feasible` flag in `label_detail`.
- `server/src/ml/examples.ts`: write v2 rows; `buildMissingExamples` builds v2 only for engine-2.0.0 runs, plus an explicit opt-in `--analysis-engine 1.1.0` for offline comparison rows (D-PEN-6).
- `server/src/ml/dataset.ts`: export `ranged_feasible`; snapshot stats split by feasibility.
- `ml/train.py`:
  - remove `fillna(0)` for features (keep NaN);
  - train and evaluate on feasible rows;
  - also report all-row metrics;
  - add leave-one-strategy-out metrics (needs `player_strategy` exported as provenance, not as a feature) and a calibration (Brier/reliability) table;
  - the eligibility rule stays, applied to feasible rows, plus "LOSO log loss not worse than baseline on a majority of strategies" (documented change to the rule).
- `ml/infer_worker.py`: accept NaN/null.
- `server/src/ml/training.ts`: store the new metric blocks; `activateModel` unchanged except the new schema check.
- Tests: `server/tests/integration/ml.test.ts` (leakage with v2, label v2, NaN path, feasibility exclusion); a Python smoke test via an existing test fixture.
- Docs: `ML_WALKTHROUGH.md`, `DATABASE_WALKTHROUGH.md` (no migration expected; if one becomes necessary it is an additive `003_*.sql`).

**Data actions (each needs explicit user approval at the time):**
1. `npm run sim -- --runs 300 --rounds 10 --seed v2-train-1`: engine 2.0.0 / sim-2.0.0. It appends; nothing is overwritten.
2. `npm run ml:train`: snapshot v2/e2.0.0 → model. **Do not** pass `--activate`.
3. Review the report (ablation per D-PEN-3, feasible vs all rows, LOSO, manual-only if ≥ 40 rows).
4. If eligible and the review is acceptable: `npm run ml:activate -- <version>` (approval). Otherwise stay on the baseline, which is already the automatic behaviour.

**Dependencies:** Phases 1, 2, 4, 5 complete and committed.

**Tests / verification:** AC-P0-3, AC-PEN-3..5, plus a live check that a round-2+ decision on a new manual run reports `basis: model` with the new version, or the baseline with an honest reason.

**Risks / rollback:**
- *Metrics look worse than v1:* expected, because v1 metrics were inflated by the 36% rule-determined rows and by labels that included forced shots. The report states this explicitly and never compares v1 and v2 numbers without that caveat.
- *Model not eligible:* the boss uses the baseline and says so. That is acceptable.
- Rollback: `ml:activate --none`. The v1 models remain as rows and artifacts but cannot be activated under 2.0.0, by design.

**Done when:** a model decision is made from evidence, documented in `ML_WALKTHROUGH.md` §9/§10 with numbers, and the ML Lab shows the correct current-engine status.

---

## Phase 7 — UI audit and redesign (staged)

**Objective:** implement D-UI-1..10 according to `client/PRODUCT.md` and satisfy AC-UI-1..5. Use the repo's Impeccable skill (`/impeccable` shape → craft → critique → polish) for the visual system decisions. Keep React + plain CSS (product constraint).

**Audit → solution map** (the findings come from V2_DEMANDS §8.3):

| Finding | Solution | Sub-phase |
|---|---|---|
| U1/U2 long scroll, no phases | Versus bar + phase stepper + sticky action bar | 7b |
| U3 flat fighter stats | `StatCompare` paired bars, base vs net layered, boss pending points de-emphasised | 7b |
| U4 shop/loadout friction (worse with 24 items) | Armory: slot picker, family-grouped item cards, filters, stat-delta preview, buy & equip | 7c |
| U5 flat log | Turn-grouped replay, opening banner, HP track, exchange summary, calc drawer kept | 7d |
| U6 weak result moment | Result banner, reward and level-up callouts | 7d |
| U7 buried boss reasoning, misleading 50% | Evidence → Weakness → Response chain, honest `PredictionBadge`, docked panel | 7e |
| U8 poor error/empty states | `StatusBanner` (API/DB unreachable), skeletons, reasoned disabled states, toasts, `ConfirmDialog` | 7a |
| U9 mobile header/tap targets | Opaque ≤ 64 px bar, bottom action bar, ≥ 44 px targets, stacked tables | 7a/7b |
| U10 dev tools as primary nav; emoji icons | Workshop group; SVG icons with text labels | 7a |
| U11 colour-only identity, a11y | Icons + labels per side, progressbar semantics, focus rings, AA tokens | 7a + 7g |
| U12 ML/Sim clarity | Current-engine status strip, unusable-model state, feasible/all metrics | 7f |

**Sub-phases:**

- **7a Foundations** (depends on Phase 0 only).
  - Files: `client/src/styles.css` → `client/src/styles/{tokens,base,components}.css`; `client/src/App.tsx` (shell, Workshop group); `client/src/util.tsx` (split into `components/ui/*`: `StatusBanner`, `Skeleton`, `Toast`, `ConfirmDialog`, `Bar` with ARIA, `Icon`); `client/src/api.ts` (classify network vs HTTP errors so ECONNREFUSED is not shown as "500").
  - Add Vitest + React Testing Library to `client/package.json` (D-TEST-1).
- **7b Run screen IA** (depends on 7a).
  - Files: `client/src/views/DuelView.tsx` (phase state machine: prepare / fight / aftermath derived from the run view), new `components/VersusBar.tsx`, `StatCompare.tsx`, `PhaseStepper.tsx`, `ActionBar.tsx`; `FighterCard.tsx` is retired or reduced.
- **7c Armory** (depends on Phase 1 for families and V2 items).
  - Files: `components/PrepPanel.tsx` → `components/armory/{Armory,ItemCard,SlotPicker,StatAllocator}.tsx`.
  - Server: new pure endpoint `POST /api/runs/:id/preview` (`server/src/api/app.ts`, `services/runs.ts`; validates and returns derived stats for a hypothetical allocation/loadout and writes nothing), plus an optional `equip` field on `POST /buy` that buys and equips in one transaction.
  - Tests: API test for preview (no writes: compare row counts before and after) and for buy+equip atomicity.
- **7d Fight replay** (depends on Phase 2 initiative fields).
  - Files: `components/RoundView.tsx` → `components/fight/{FightReplay,TurnGroup,AttackRow,CalcDrawer,ChoicePrompt,ResultBanner,Rewards}.tsx`.
- **7e Boss mind** (depends on Phase 4 decision fields).
  - Files: `components/boss/{BossMind,EvidenceChain,PredictionBadge,OptionsTable}.tsx`; handles legacy decisions without `basis` (shown as "legacy record").
- **7f Workshop** (depends on Phase 6 status fields).
  - Files: `views/SimView.tsx`, `views/MlView.tsx`, `views/RunsView.tsx`, using the shared `DataTable`.
- **7g Accessibility, responsive and polish pass** (after 7b–7f).
  - Keyboard walk-through, contrast check, reduced motion, 375/768/1280 screenshots into `docs/ui/` and `PROGRESS.md`.

**Tests / verification (every sub-phase):**
- `npm run typecheck`, `npm run build`, client unit tests.
- Browser verification with the preview tools: the AC-UI-1 capability checklist (start/resume, allocate, buy, equip, begin, choice + repeat, end run, history, calc drawer, boss panels, runs list, sim launch/progress, ML build/export/train/activate) at 375 and 1280 px.
- Backend-down states shown with the API stopped.
- Browser checks that create runs write to the **dev** DB. The manual-run test data is tagged `source='manual'`. Get approval, or use a separate DB via `DATABASE_URL`.

**Risks / rollback:**
- *Scope creep in visuals:* each sub-phase has a capability checklist and ships independently.
- *Regressions in rarely used flows (choice prompt):* add an RTL test for it and click-test it in the browser (it was never browser-tested in V1, per `PROGRESS.md`).
- Rollback: each sub-phase is its own commit. The old components are deleted only after their replacement passes the checklist.

**Done when:** AC-UI-1..5 pass, the before/after screenshots are recorded, and `client/PRODUCT.md` is updated if product facts change (catalogue size, Workshop).

---

## Phase 8 — Final verification and documentation

**Objective:** acceptance criteria 1–10 of V2_DEMANDS §13.

**Steps:**
1. Full `npm test` on the test DB, `npm run typecheck`, `npm run build`, client tests.
2. Smoke: a fresh manual run of 3 rounds in the browser (approval for dev DB writes), and a 20-run sim batch on the test DB.
3. Docs updated: `GAME_MECHANICS.md`, `ARCHITECTURE.md`, `SIMULATIONS.md`, `ML_WALKTHROUGH.md`, `DATABASE_WALKTHROUGH.md`, `FILE_GUIDE.md`, `README.md`, `client/PRODUCT.md`, and `PROGRESS.md` (verified status, outstanding issues, reproducible commands, data actions taken).
4. A comparison report V1 → V2 against `docs/V2_BASELINE.md`.

**Done when:** every AC is checked off with evidence in `PROGRESS.md`.

---

## Historical data and model artifact strategy

Principle: **nothing existing is deleted, overwritten or re-labelled.** V2 data is new, tagged data. Every action below that writes to the dev DB needs explicit approval when it happens.

| Asset (verified 2026-10-16) | Action | Why |
|---|---|---|
| Raw gameplay records, engine 1.0.0 (258 sim + 2 manual runs) and 1.1.0 (240 sim + 3 manual runs): `runs`, `rounds`, `combat_events`, `progression_events`, `boss_analyses`, `boss_decisions` | **Retain, untouched.** Readable via the frozen V1 catalogue (Phase 1). | Audit trail; V1 baseline; replayable from the stored seeds and snapshots. |
| Active legacy runs #253 (1.0.0) and #389 (1.1.0) | **Retain. Closed to new rounds in code** (Q-2 default), viewable. No status write unless the user approves marking them `completed`/`engine_retired`. | Continuing under V2 would mix rules in one run and mislabel training rows (P-CAT-2). |
| `training_examples` schema v1 (all engines) | **Retain, untouched.** Not used for v2 training. | Different features, label and rules. Kept for comparison. |
| v2 rows rebuilt from 1.1.0 raw records | **Optional, analysis only** (`--analysis-engine 1.1.0`), tagged engine 1.1.0, never exported into a 2.0.0 snapshot (`dataset.ts` filter). | Measures label-v2 recovery and feature behaviour without contaminating training. |
| Round-1 `boss_decisions.predictor.probabilityRanged = 0.5` (503 rows) | **Retain, untouched.** Labelled "legacy placeholder" in docs/UI; excluded from usage statistics. | Correcting history in place would falsify what the boss actually used. |
| `dataset_snapshots` rows + `artifacts/datasets/*.csv/json` (11 snapshots, including tiny 1–6-row dev exports) | **Retain.** Checksum manifest in Phase 0. | Reproducibility of models s1/s2. |
| Model `m20261010-184500-s1` (engine 1.0.0) | **Retain**, inactive. | Historical. |
| Model `m20261010-200001-s2` (engine 1.1.0, **active**) | **Retain.** After 2.0.0 it automatically falls back (engine mismatch guard, `predictor.ts:123`). Optionally `ml:activate --none` with approval so the UI stops showing an "active but unusable" model. | Existing safety guard already prevents misuse; no need to delete. |
| V2 simulated data | **Generate** under engine 2.0.0 / sim-2.0.0 after Phases 1–5 are final. Appended. | Rules, catalogue, policy and agents all changed, so no older data is valid for training. |
| V2 model | **Train** on v2 / e2.0.0 feasible rows; **activate only if** eligible plus the extra checks pass (Phase 6). | Avoid replacing a safe baseline with a model whose metrics reflect easier data. |
| `ml/train.py` eligibility rule | **Version** the rule text in model metadata (it already stores `eligibility_rule`); document the change (feasible rows + LOSO). | Comparability across model generations. |

**Why retraining is justified (not assumed):** the v1 model is invalid under V2 for four independent reasons, each verified:
1. the engine changed (catalogue, rewards, opening shot), which the existing guard blocks;
2. the boss policy changed, and the top feature `boss_eff_dex_last` is a policy output;
3. the label definition changes (forced opening shots removed);
4. the features change (catalogue-specific affordability columns).

Retraining is therefore required for the model to be used at all. Whether the *new* model is activated depends on evidence.

---

## Decisions that need approval before or during implementation

| When | Decision | Status |
|---|---|---|
| Before Phase 0 | Initial commit of the V1 tree | **Done**: pushed to GitHub `Nipun531/adapt-or-die` (2026-10-16) |
| Phase 1 | **Q-2** legacy active runs | **Approved**: closed to new rounds in code; no DB write |
| Phase 2 | **Q-1** opening-shot tie | **Approved**: no opening shot |
| Phase 2 | **Q-4** polearms as plain melee | **Approved** |
| Phase 3 | **Q-3** balance target | **Approved**: aim for a boss win rate of 55–70% per agent |
| Phase 3 | **Q-5** pierce values | **Delegated to Claude**: buff pierce chance and DEF-ignore by simulation until every pierce weapon is viable (AC-BAL-1). Other balance problems are reported with proposals and are not changed without approval. |

**Phase 3 addition (from Q-5):** the balance harness gets a pierce-tuning loop.
1. Sweep chance and ignore % per weapon.
2. Keep the smallest buff that makes the weapon a best response in at least one tier without making it dominant.
3. Re-check against the boss policy (Phase 4) and the sim agents (Phase 5).
4. Write the final values into `catalog/v2.ts`, with tests and docs.
5. Report every other imbalance found (Warhammer/STR scaling, Longbow vs Crossbow, the boss snowball) in `docs/V2_BALANCE.md` with a proposed fix for the user.
| Phase 6 | Running the V2 sim batch, training, activation | Ask each time |
| Phase 7 | Dev-DB writes from browser testing | Ask, or use a separate DB |

## Effort and sequencing estimate (rough, relative)

| Phase | Relative size | Can run in parallel with |
|---|---|---|
| 0 | S | — |
| 1 | M | 7a, 7b |
| 2 | M | 7a, 7b |
| 3 | S–M | 4 (code), 5 (code) |
| 4 | L | 3, 5 (code), 7c |
| 5 | M | 4 |
| 6 | M–L (plus batch runtime ≈ 5 min per 300 runs, *estimate*) | 7d, 7e |
| 7a–7g | L total | Track A throughout |
| 8 | S | — |
