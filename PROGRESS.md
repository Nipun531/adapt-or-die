# Project Progress — The Boss Remembers (Adaptive Boss Duel V1)

> Living handoff document. **Verify claims against the repo before relying on them.**
> Mechanics source of truth: `context/adaptive_boss_duel_v1_game_plan_updated.docx` (faithfully transcribed in `docs/GAME_MECHANICS.md`).
> Requirements/acceptance: `context/antigravity_build_prompt_the_boss_remembers.md`. Architecture/ML guidance: `context/the_boss_remembers_project_walkthrough.md`.
> Last updated: 2026-10-10 (Claude Code session 2: initial stat allocation change, engine 1.1.0).

## 1. Status summary

All milestones A–G are implemented and verified locally. The game is playable in the browser end-to-end; simulations, ML training,
activation and model-vs-fallback reporting work; docs are written. Nothing is committed to git yet (repo has no commits; branch `master`).

| Milestone | Status |
|---|---|
| C Core game (rules, combat, progression, persistence) | Done (Antigravity session), re-verified |
| D Boss analysis/decision + simulation runner | Done (sim added this session) |
| E ML (features, dataset, training, eligibility, inference, fallback) | Done (export/train/CLI added this session) |
| F Web UI + API | Done this session |
| G Tests + docs + smoke tests | Done this session |

## 1a. Version 2 — Phases 0–3 DONE (2026-10-16, engine 2.0.0 / sim-2.0.0)

Spec: `docs/V2_DEMANDS.md` (user answers Q-1..Q-5 in §11.1). Plan: `docs/V2_IMPLEMENTATION_PLAN.md`. Baseline: `docs/V2_BASELINE.md`. Balance: `docs/V2_BALANCE.md`.

- **Phase 0:** pushed initial commit `d034d0e` to GitHub `Nipun531/adapt-or-die` (main). DB backup at `artifacts/backups/pre-v2-2026-10-16.sql` (sha256 in V2_BASELINE). Baseline `npm test` = 88/88.
- **Phase 1:**
  - Versioned catalogue: `game/catalogs/v1.ts` (frozen) and `game/catalogs/v2.ts` (live, 24 items, the user's costs and modifiers). `catalog.ts` exposes `catalogFor` / `itemForHistory`.
  - Rewards: loss 30 XP / 5 gold, level-up +20 gold.
  - `ENGINE_VERSION 2.0.0`.
  - Legacy runs (engine ≠ 2.0.0) are view-only via `assertCurrentEngine` (no DB writes). They display with V1 numbers, and End run is allowed.
  - `/api/catalog` adds `legacyItems` and `rules.engineVersion`.
  - Shop is grouped by family. The UI shows a legacy-run notice.
- **Phase 2:**
  - Pierce works on any weapon with a spec (melee too). Events record `pierce.weaponId` and `pierce.extraDamage`.
  - Only the DEX-advantaged ranged fighter gets the opening shot; an equal-DEX tie gives no shot. Initiative records `openingEligible` and `openingRule`.
  - `expected.ts`, `summary.ts` (`pierceExtraDamage`), the analysis text and the policy's `analyticScore` are updated to match.
- **Phase 3 (+ part of Phase 5):**
  - Agents moved to sim-2.0.0: V2 wishlists, new `piercer` and `duelist` agents, 3-style `adaptive`.
  - Balance harness `npm run balance` (no DB).
  - Pierce values tuned (buff only, user-delegated): see GAME_MECHANICS §8.
  - Report in `docs/V2_BALANCE.md`; raw output in `artifacts/balance/`.
- **Verification:**
  - `npm test` = **122/122** (95 unit + 27 integration); `npm run typecheck` clean.
  - Browser: legacy run #389 shows the view-only notice and the legacy opening-shot wording, with no Begin button and no console errors.
  - The V2 shop UI is **not** browser-verified, because that needs a new run (a dev-DB write). It is covered by typecheck and API tests.
- **Phase 4 (DONE, 2026-10-16):**
  - **Feasibility-first prediction.** `rangedFeasibility`; `Prediction.basis` is `rule` / `unknown` / `model` / `baseline`; `probabilityRanged` can be `null`. The baseline skips rounds of unknown style and returns `null` with no history.
  - **Boss policy v2** (`boss/policy.ts`): reachable-opponent scenarios, expected-HP-margin score, seeded diversity band (0.03) with archetypes. `boss_decisions.selected` now stores `policyVersion`, `band` and `draw`. Policy v1 is kept as `version: 'v1-deterministic'`.
  - **UI:** the decision panel states the basis honestly (Rule / No evidence / Model / Baseline / legacy placeholder) and shows the build style, the band and the scenario weights. ML Lab and `ml:status` count current-engine decisions by basis.
  - **Bench:** `npm run boss:bench`. v2 costs 1.27× v1 per decision, is far stronger (boss vs mirror 58%; v1 loses 87% against a v2 player), and late builds are about twice as varied. Round 1 is still +2 STR, which is provably the best split against every player allocation (`docs/V2_BALANCE.md` §6).
  - **Tests:** `npm test` = **143/143** (new `tests/unit/policy.test.ts`).
  - **Browser check** (API on the test DB via `npm run dev:testdb` / launch `api-testdb`): new run → allocate → round 1 → decision panel shows "Rule", "bruiser", the reasoning and the 4 scenarios. The V2 shop renders grouped by family.
- **Phase 6 (DONE, 2026-10-16):**
  - **Code** (commit `ad8b255`):
    - `FEATURE_SCHEMA_VERSION v2` (39 features, catalogue-agnostic, nulls for missing).
    - Label = intended style: non-opening attacks, else a single-style loadout.
    - Rule-determined rows are flagged (`label_detail.rangedFeasible`) and excluded from export.
    - `player_strategy` is exported as provenance.
    - `train.py` keeps NaN and adds leave-one-strategy-out evaluation plus an eligibility rule. `infer_worker.py` accepts null.
    - `buildMissingExamples` covers the current engine only (`allEngines` opt-in).
  - **Data** (dev DB, appended): batch 5 `v2-train-1`, 320 runs / 3,200 rounds / 2,880 v2 rows, 0 failed, 317 s. Boss win rate 99–100% against every agent.
  - **Model** `m20261016-220122-s3`: held-out acc 0.990 / log loss 0.027 vs baseline 0.932 / 0.288, **but leave-one-strategy-out fails (2/8) → NOT eligible, not activated**. The boss uses the baseline. Details: `docs/ML_WALKTHROUGH.md` §10b.
  - **Tests:** `npm test` = **149/149**.
- **ML follow-up (2026-10-16, user request: an active model only if it genuinely beats the baseline):**
  - **Agents:** `opportunist`, `switcher`, and the randomised conditional `reactive` agent (sim-2.1.0 / 2.2.0).
  - **Features:** schema v3 adds persistence features.
  - **Data:** batches 6–7 (540 more runs, 0 failed).
  - **Ensemble candidate:** `w·model + (1−w)·baseline`, with the weight chosen on training runs only, its own pre-declared gate (`train.py ENSEMBLE_ELIGIBILITY`) and a boss decision-outcome check (`ml/decision-check.ts`). The predictor supports `params.blend_weight`.
  - **Result:**
    - Pure model `m20261016-223043-s6`: held-out log loss 0.315 vs baseline 0.568, but unseen styles fail → not eligible.
    - Ensemble `…-s6-ens`: held-out 0.425 vs 0.568, unseen pooled a tie, melee_bruiser +0.150 (> +0.10) → not eligible.
    - On identical games, the boss decides equally well with all three (HP margin 0.659–0.661).
  - **Not activated; no rule was relaxed.** Root cause: the balance (one hybrid build beats both styles) plus 44% rule-determined rounds. Details: `docs/ML_WALKTHROUGH.md` §10c.
  - **Tests:** `npm test` = **157/157**.
- **Phase 7 UI redesign: IN PROGRESS (checkpoint 2026-10-16).** Resume from here:
  - **Done:**
    - Direction "Court Deck" (baize table, card stock, court inks, suit pips ♥HP ♠STR ♦DEF ♣DEX as SVG). Contract: `client/.impeccable/surfaces/src-app-tsx.md`, seed:d9614f1b4440c060.
    - New client: `styles/{tokens,base,app}.css`; `ui/{Icon,states}.tsx`; `duel/{Versus,Armory,loadout,Fight,Aftermath}.tsx`; `views/*` restyled.
    - Phases Prepare / Fight / Aftermath, an action bar, and the boss-hand signature.
    - Server: `POST /api/runs/:id/preview` (pure) and buy+equip (`/buy` with `loadout`).
    - Fonts self-hosted (@fontsource). Two browser inspection rounds done. Detector clean.
    - Screenshots in `client/.impeccable/review/*.png` (native 1440 / 390 via `client/scripts/capture-review.py`, which drives headless Chrome over CDP).
  - **Next steps, in order:**
    1. Get the finish reviewer's verdict (agent `ad8e9042eef5e90b4`, re-review requested on the PNGs). Apply its fixes in one batch, recapture, and send back for a verdict.
    2. Spawn `impeccable-documenter` to write `client/DESIGN.md` + `client/.impeccable/design.json` from the built world.
    3. Client unit tests (`duel/loadout.ts` slot logic). Run `npm test`, typecheck and build.
    4. Update docs (`V2_IMPLEMENTATION_PLAN.md` status, `FILE_GUIDE.md` for the new client files, `client/PRODUCT.md` with 24 items and the Workshop). Commit and push.
  - Safe UI testing: `npm run dev:testdb` (launch config `api-testdb`) plus `client`. Test run #2 exists in the test DB (wiped by `npm test`).
- **Not done:** Phase 8 (final verification). The old active model `…-s2` is still flagged active but falls back automatically (engine mismatch). Deactivating it (`npm run ml:activate -- --none`) is only cosmetic and needs your OK.

## 1b. Change log — engine 1.1.0: 2 initial stat points (user request, 2026-10-10) — DONE + verified

Rule: both combatants start every run with 2 unallocated stat points, spent with the normal increments before round 1.
- Core: `INITIAL_STAT_POINTS=2`, `ENGINE_VERSION 1.0.0→1.1.0` (`game/constants.ts`); `initialCombatant()` sets `statPoints: 2` (`game/progression.ts`).
- Grant once: `createRun()` (`services/runs.ts`) — the only grant point; writes `progression_events kind='initial_points'` per side and `runs.config.initialStatPoints=2`. API wraps creation in `withTransaction` (sim already did).
- Gate: `startRound()` (`services/rounds.ts`) rejects round 1 while player `statPoints>0` (RuleError 400, whole tx rolled back); asserts boss has 0 left after round-1 prep.
- Boss: unchanged policy already enumerates every split of its points (10 for 2 points) → spends them in round-1 `bossPrepare`; ledger payload now has `forRoundNumber`. Boss cannot see player's allocation. Round-1 choice is deterministic (always +2 STR currently).
- Duplicate prevention: grant only in `createRun`; allocation locks combatant row `FOR UPDATE` (3 concurrent 1-pt requests → exactly 2 succeed, tested).
- Sim: `SIMULATOR_VERSION sim-1.0.0→sim-1.1.0`; agents unchanged (already spend all points through services).
- ML: feature/label definitions unchanged → schema stays `v1`; distribution changed → versioned by engine version. Export/stats filter `engine_version = ENGINE_VERSION` (`ml/dataset.ts`); `dataset_snapshots.engine_version`, `model_versions.engine_version`; predictor falls back + `activateModel` refuses for engine mismatch; `train.py --engine-version` into metadata; CLI/ML Lab show rows per engine version and unusable models.
- DB: migration `002_initial_stat_points.sql` (additive: ledger kind, 2 columns backfilled '1.0.0', index). Applied to dev DB + test DB. No deletions.
- UI: prep heading shows initial points; Begin round 1 disabled until spent; boss card note; round-1 decision labelled "initial stat allocation"; start-screen text; ML Lab engine info.
- Tests: new `tests/integration/initial-points.test.ts` (6 tests); helper `createReadyRun()`; existing tests updated for the gate; rules unit tests (level-up ones use `statPoints: 0` explicitly). **88/88 pass**, typecheck clean, build OK.
- Data actions (additive): pre-change state = batches 1–3 (sim-1.0.0/engine 1.0.0), snapshot 1, model id 1 `m20261010-184500-s1` active, 2279 rows engine 1.0.0. New batch 4 `train-data-e110-1`: 240 runs/2400 rounds/2160 examples, 0 failed; verified all 240 runs engine 1.1.0, 480 grants, 0 unspent points at round 1, every round-1 player/boss stat block = exactly 2 points. Between code change and retrain, all batch-4 decisions correctly fell back ("trained on engine 1.0.0 data"). Snapshot 2 (engine 1.1.0 only, 1476 valid rows) → model `m20261010-200001-s2`: held-out acc 0.968 / logloss 0.064 vs baseline 0.922 / 0.358 → ELIGIBLE → ACTIVATED. Live check: run #389 round 2 decision `kind=model, m20261010-200001-s2`.
- Browser verified: new run shows 2 pts each, Begin disabled, partial allocation persists across reload, round 1 after spending, boss decision shows +2 STR, ML Lab statuses.
- Observed consequence (not changed): boss win rates in sims rose (80–100% per strategy) and invalid rows ~32% (player killed before acting).

## 2. What exists (by area)

- **Game engine** `server/src/game/*` — constants, catalogue, formulas, derive, equipment, progression, seeded RNG, resumable combat, summary, expected-damage helpers.
- **Boss** `server/src/boss/{analysis,policy,prepare}.ts` — evidence-based weaknesses; constrained legal-plan policy weighted by P(player ranged); persisted decisions.
- **Services** `server/src/services/{runs,rounds,history}.ts` — run lifecycle, validated player actions, transactional round orchestration.
- **Simulation** `server/src/sim/{agents,runner,cli}.ts` — 6 agents (melee_bruiser, archer, shield_turtle, hybrid, adaptive, random), `SIMULATOR_VERSION=sim-1.0.0`, per-round transactions, failed-run marking, counters/summary, interrupted-batch cleanup.
- **ML** `server/src/ml/{features,examples,dataset,training,predictor,cli}.ts`, `ml/{train.py,infer_worker.py,requirements.txt}` — schema v1 (34 features), baseline, CSV/JSON snapshots, GroupShuffleSplit by run, XGBoost, metrics vs baseline, eligibility rule, versioned artifacts, activation gate.
- **API** `server/src/api/app.ts`, `server/src/index.ts` — all endpoints (see `docs/ARCHITECTURE.md`), zod validation, error mapping, one background sim batch at a time, serves `client/dist` when built.
- **Client** `client/` — Vite 5.4.21 + React 18.3.1 + plain CSS. Views: Duel (start/resume, fighters, prep: stats/shop/loadout, round view with auditable log, rewards, boss analysis + decision, history), Runs, Simulations, ML Lab.
- **Docs** `README.md`, `docs/{GAME_MECHANICS,ARCHITECTURE,ML_WALKTHROUGH,DATABASE_WALKTHROUGH,SIMULATIONS,FILE_GUIDE}.md`.
- `.claude/launch.json` — preview configs `api` (:4000) and `client` (:5173).

## 3. Key decisions made this session

- Vite proxy targets `127.0.0.1:<PORT read from ../.env file>` — not `process.env.PORT` (the preview launcher sets PORT=5173 for Vite → proxy looped) and not `localhost` (Node dual-stack connect errors on Windows). `API_PORT` env overrides.
- Client `vite` pinned to 5.4.21 to match the copy hoisted by vitest (two copies broke type-checking of `vite.config.ts`).
- Activation is refused for ineligible models (no force flag). Tests use an explicit TEST FIXTURE `UPDATE … eligible=true` to exercise real inference.
- `markInterruptedBatches()` only fails queued/running batches with no run activity in the last 5 minutes (so a CLI batch running while the server restarts is not killed).
- Eligibility rule (in `ml/train.py`): ≥200 rows, ≥20 runs, minority ≥5%, ≥40 held-out rows with both classes, held-out log loss < baseline and accuracy ≥ baseline.
- Bug fixed in pre-existing code: `listRuns` total-count query used `$3` with one parameter (500 on `/api/runs?source=…`).

## 4. Verification (commands run and results, 2026-10-10)

| Check | Result |
|---|---|
| `npm test` (session 2, after engine 1.1.0) | **88/88 passed** (rules 51, combat 13, lifecycle 6, sim 5, ml 2, api 5, initial-points 6) |
| `npm run typecheck` | clean (server + client) |
| `npm run build` | OK (client/dist ~182 kB JS) |
| `npm run sim -- --runs 240 --rounds 10 --seed train-data-1` | batch 2 completed, 2400 rounds, 2160 examples, 0 failures, ~216 s |
| `npm run ml:train` | model `m20261010-184500-s1`, 1911 rows/252 runs; held-out acc 0.984 / logloss 0.043 vs baseline 0.933 / 0.273 → ELIGIBLE |
| `npm run ml:activate -- m20261010-184500-s1` + `ml:status` | active; Python xgboost 2.0.3 OK |
| Browser (in-app, dev servers) | new run → 3 rounds; shop buy + equip; round 2+ decisions show "Trained ML model m20261010-184500-s1"; calc expansion; ML Lab; sim batch launched from UI with live progress; 375 px mobile no horizontal overflow |
| `PORT=4100 npm start` | serves built client at `/` and API (`/api/health` ok, unknown `/api/*` → 404 JSON) |

Not directly exercised: the Ranged+Melee choice prompt was not clicked in the browser (covered by API + lifecycle tests); `npm run dev` (concurrently) was not launched as one command — its two halves (`dev:server`, `dev:client`) were.

## 5. Dev database state (local, not in git)

Engine 1.0.0 (historical, kept): batches 1–3, snapshot 1, model `m20261010-184500-s1` (inactive, unusable with current rules), manual runs incl. #253 (still active under old rules).
Engine 1.1.0 (current): batch 4 `train-data-e110-1` (240 runs), snapshot 2, model `m20261010-200001-s2` **ACTIVE**, manual run #389 (2 rounds).
Artifacts in `artifacts/` (git-ignored); both model directories present.

## 6. Known issues / limitations

- Training data is almost all simulated by scripted agents → model metrics overstate accuracy on humans (documented in ML walkthrough §10).
- Invalid training rows (player never attacked in label round): ~15% engine 1.0.0, ~32% engine 1.1.0.
- Boss round-1 allocation is deterministic (+2 STR) because it has no information about the player before round 1.
- Legacy engine-1.0.0 runs still active continue without initial points (historical treatment, documented).
- Skills and item upgrades not implemented (plan does not specify them). Pierce values are approved placeholders.
- Docker Desktop must be running (it was stopped at session start and had to be launched manually).
- `npm audit` reports advisories in dev dependencies (not investigated).

## 7. Next steps (optional polish — core acceptance criteria met)

1. Ask the user whether to commit (suggest: create a feature branch, single initial commit; `.env` and `artifacts/` are git-ignored).
2. Optional: click-test the Ranged+Melee choice prompt in the browser; run `npm run dev` as one command.
3. Optional: collect manual-play rounds and compare model vs baseline on `source='manual'` rows only.
4. Keep `docs/FILE_GUIDE.md` in sync if files are added.

## 8. Resume instructions

1. `docker ps` (start Docker Desktop if needed) → `npm run db:up`.
2. `npm test` should report 157 passing; `npm run typecheck` clean. `npm run balance` re-runs the balance study (no DB).
3. `npm run dev` → http://localhost:5173. `npm run ml:status` for ML state.
4. Read `docs/FILE_GUIDE.md` to locate code. Never change mechanics without updating tests + `docs/GAME_MECHANICS.md`.
