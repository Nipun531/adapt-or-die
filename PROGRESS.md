# Project Progress — The Boss Remembers (Adaptive Boss Duel, Version 2)

> Living handoff document. **Verify claims against the repo before relying on them.**
> Mechanics source of truth: `context/adaptive_boss_duel_v1_game_plan_updated.docx` (faithfully transcribed in `docs/GAME_MECHANICS.md`).
> Requirements/acceptance: `context/antigravity_build_prompt_the_boss_remembers.md`. Architecture/ML guidance: `context/the_boss_remembers_project_walkthrough.md`.
> Last updated: 2026-10-17 (Version 2 complete: Phase 8 final verification). Older sections below are history.

## V3 — planning (2026-10-19)

V3 plan written: `docs/V3_IMPLEMENTATION_PLAN.md` (audit, requirements matrix, boss fairness, UI audit, roadmap A–F). The owner's answers are recorded in `docs/V3_DEMANDS.md`.

**Phase A DONE (2026-10-19):** `docs/V3_BASELINE.md`.
- DB backup `artifacts/backups/pre-v3-2026-10-19.sql`, verified by restore.
- Chooser redaction (`ChooserView`), proven behaviour-identical.
- `npm run v3:baseline`.
- Findings:
  - round 1 is a coin flip (equal-DEX fights are deterministic, first mover wins 100%);
  - the round-1 winner wins the run 100% in the mirror;
  - the boss plays hybrid in 94–100% of late rounds.
- Tests: 167 server + 5 client.

**Phase B DONE (2026-10-19):** the V3 engine runs behind RuleSet v3 (`game/rules.ts`, `combat.ts` `advanceV3`, `catalogs/v3.ts`).
- 22 V3 unit tests.
- The v2 path is byte-identical (240-run diff).
- Not live: no DB/API yet.
- First look: shields work; the DEX dodger fails; stun almost never triggers.

**Phase C1 part 1 DONE (2026-10-19):** stun and dodge tuned (`docs/V3_BALANCE.md`), using `npm run v3:lab` on random builds × random play styles, with paired fights and 3 populations.
- Dodge = 10% base + 2% per DEX point of lead.
- Stun gain = 17.5–35 per hit.
- Stun now changes the holder's win rate by +3–4 pp, with chains under 5%.
- Open: D-19 (round stall rule).
- Tests: 164 unit pass.

**Phase C1 DONE (2026-10-20):** see `docs/V3_BALANCE.md` §7–§9.
- Turn limit: D-19 decided, 30 turns.
- The boss and the agents play V3: expected-value defence, defence personas.
- Paired V2/V3 runs:
  - the boss stays at 95–98% vs scripted agents;
  - the duelist reaches 39% wins;
  - round 1 is no longer a coin flip.
- Symmetric mirror (`mirror_sym`):
  - no structural boss edge (about 47%, 200 runs);
  - comebacks 0.3% → about 20%;
  - the round-1 winner takes the run 77–82% instead of 100%.
- DEX ablation: no single DEX benefit drives dominance; recommend keeping all (D-8).
- Still open: the boss plays hybrid 96–100% of late rounds.

**Phase C2 DONE (2026-10-20):** engine 3.0.0 is live.
- V3 catalogue (the Warhammer at 45), 10 starting gold, stims and upgrades (`buySupply`, `POST /runs/:id/supplies`).
- Migration 003 (additive). Dev DB backed up, the migration tested on a restored copy, then applied.
- Rounds pause for Block/Dodge and stims (`POST /rounds/:id/choice`).
- The boss and the agents buy stims (heuristic).
- `sim-3.0.0`.
- DB sim = in-memory harness: identical events (test).
- Minimal client support: Block/Dodge prompt with odds (B/D), stim prompt, supplies panel, counter/stun/defence tags, notes in the log. Browser-checked on the test DB.
- Tests: 203 server + 5 client.

**Phase D evaluation DONE (2026-10-20):** `docs/V3_BALANCE.md` §11.
- 5 V3 champion agents (`sim-3.1.0`); `npm run v3:eval` (acceptance criteria, χ²/JS adaptation test).
- Results:
  - fair vs searching players (mirror about 49%, round 1 49%);
  - boss 86–99.5% vs every fixed-plan agent;
  - hybrid 91% of late boss picks;
  - exploits clean.
- Root cause: gear DEX stacking (the bow as an agility accessory). Lab tests show single-item tweaks don't help; "ranged DEX for shots only" fixes hybrid but needs a ranged buff.
- Harness switch `v3.dex.rangedModShotsOnly` (off).
- **Phase D2 DONE (engine 3.1.0):** a bow's DEX counts 50% toward agility; dedicated archers ×1.3 (owner D-20; V3_BALANCE §12).
- **Phase E DONE (client UI):** Cathedral Lead-Light redesign. The fight is a stage: your window, the incoming decision pane (Block / Dodge with exact odds, stim and shoot/strike prompts, keyboard B/D/U/K/R/M), the boss's window; HP and stun as leaded pane meters, gear as roundels, stims as vials; one animation per outcome (hit, block, dodge, counter, stun, heal, turn lost, KO) with a held still state under reduced motion; round-by-round history at the bottom. Armory shows each item's traits in words and a "Your build" column plus "The boss now". Rules drawer (`?`), first-run hints. Design system recorded in `client/DESIGN.md`.
- **V3 ML check DONE (schema v4):** 976 V3 sim runs (8,640 rows), 19 new defence/counter/stun/stim features, decision check now on live V3 rules. Model `m20261020-133625-s7` is **not eligible** (better on only 4/16 unseen styles; ensemble weight 0), and boss decisions do not change (Δ −0.001, CI [−0.005, +0.004]). Oracle bound (`npm run ml:oracle`): even the true style (+0.002, CI spans 0) or the true defence habit (−0.013) does not help the boss; only the exact build does (+0.044). The boss keeps the baseline; nothing activated (ML_WALKTHROUGH §11).
- **V4 DONE (2026-10-20, `docs/V4_REPORT.md`):** three modes: Prepared Boss (unchanged V3 planner), Learning Boss (per-browser profile learning from your own rounds) and local PvP (hot-seat, server-validated). Migration 004. Next-build prediction pipeline: build heads, legal candidates, head models, 11,664 rows, five new agent families. The model is **not eligible** (fails on unseen hybrid). Oracle: even perfect build-type knowledge does not help the planner (−0.003), so the bottleneck is the planner and mechanics. The Learning Boss's prediction learns (2.83 → 1.55 joint log loss), but its decisions are not measurably better (tempered 0.3: −0.016, CI spans 0). Online PvP is deferred. Tests: server 228, client 8.
  - The boss's hybrid share 91% → 77%; mirror still about 50%; the stun/dodge sweet spot holds.
  - Open: D-13, D-17, and a possible stronger hybrid setting.
- Tests: 207 server + 5 client.

## 0. Version 2 — Phase 8 final verification DONE (2026-10-17) — start here

Handoff: `docs/HANDOFF.md`. Detailed V2 log: §1a below.

**Acceptance (`docs/V2_DEMANDS.md` §13), with evidence:**

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Catalogue + rewards | ✓ | `catalogs/v2.ts` (24 items); `catalog-guard.test.ts` (no item ids outside the catalogue); dev DB engine 2.0.0: win 50 XP/10 g, loss 30 XP/5 g, level-up +20 g |
| 2 | Opening shot | ✓ | Dev DB: opening events per round never > 1 (2156 rounds 0, 6444 rounds 1); rules none 2138 / tie_none 18 / dex_advantage 2122 / single 4322 |
| 3 | Round-zero p | ✓ | Every engine-2.0.0 round-1 decision has basis `rule` (860/860); semantics in `ML_WALKTHROUGH.md` (round-zero note); AC-P0 tests pass |
| 4 | Boss diversity | ✓ | Policy v2-diverse (V2_BALANCE §6); v1 kept for rollback |
| 5 | Armor penetration | ✓ | Melee pierce 308/4373 attempts, ranged 2411/7593; logged per attack (`calc.pierce`), in features (schema v3); ML impact in ML_WALKTHROUGH §10b–10c |
| 6 | UI redesign | ✓ | Court Deck; finish reviewer verdict SHIP (round 3); `client/DESIGN.md`; token text contrast ≥ 4.69:1. Workshop views were not visually reviewed by the reviewer |
| 7 | Sim / data / models | ✓ (honest) | sim-2.2.0, 11 agents; schema v3 dataset; model and 30/70 ensemble trained, **neither eligible → baseline** (rules not relaxed) |
| 8 | Tests / types / build | ✓ | `npm test` 160 server + 5 client pass; `npm run typecheck` clean; `npm run build` OK |
| 9 | Docs | ✓ | README updated to V2 in Phase 8; GAME_MECHANICS, ARCHITECTURE, SIMULATIONS, ML_WALKTHROUGH, FILE_GUIDE, V2_BALANCE, DESIGN.md |
| 10 | PROGRESS.md | ✓ | this section + §1a |

**V1 (engine 1.1.0) → V2 (engine 2.0.0):**

| Measure | V1 | V2 |
|---|---|---|
| Catalogue | 16 items | 24 items (V1 frozen for history) |
| Opening shots | every bow holder shot | at most one per round |
| Round-1 boss build | +2 STR in 243/243 runs, p = 0.5 placeholder | rule-based, basis `rule`, feasibility-aware |
| Pierce | approved placeholders, ~1–3% of damage | tuned by simulation, melee and ranged both pierce |
| Boss vs scripted agents | 80–100% | ~97–100% (agents do not adapt) |
| Boss vs mirror player | 13% (policy v1) | 58% (inside the 55–70% Q-3 band) |
| ML | old model active (1.1.0) | no eligible model; baseline used |
| UI | tabbed V1 screens | Court Deck, three-phase duel |

**Phase 8 smoke checks:** test-DB sim 12 runs / 48 rounds / 0 failures (`--seed phase8-smoke`); browser keyboard check of the Ranged+Melee choice (Enter on Begin, M, checkbox + R) → fixed a bug where R/M ignored keys while the checkbox had focus.

**Remaining limitations / decisions for the user:**
- No eligible ML model; the boss uses the transparent baseline. The hybrid build answering both styles (#9) leaves ML little leverage.
- Stale active-model flag `m20261010-200001-s2` (engine 1.1.0); it falls back automatically. Clearing it (`npm run ml:activate -- --none`) waits for user OK.
- Deferred balance fixes `V2_BALANCE.md` §4 #1–#9 (DEX dominance first) — next version, per the user.
- Boss vs scripted agents ~100%: an agent intelligence gap, not a rules gap.
- Workshop views (Runs, Simulations, ML Lab) were rebuilt but not visually reviewed by the reviewer.

**Reproduce:** `npm run db:up`; `npm test`; `npm run typecheck`; `npm run build`; `DATABASE_URL=$TEST_DATABASE_URL npm run sim -- --runs 12 --rounds 4 --seed phase8-smoke`; `npm run balance`; `npm run ml:status`.

## 1. Status summary (V1, 2026-10-10 — history)

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
- **Phase 7 UI redesign: DONE (2026-10-17).**
  - **Look:** "Court Deck": baize table, card stock, court inks, SVG suit pips ♥HP ♠STR ♦DEF ♣DEX, one framed card form. Contract: `client/.impeccable/surfaces/src-app-tsx.md`, seed:d9614f1b4440c060. The design system is recorded in `client/DESIGN.md` + `client/.impeccable/design.json` (written by the Impeccable documenter from the shipped build).
  - **Screens:**
    - Duel with a Versus bar and Prepare / Fight / Aftermath phases.
    - Armory: item cards with filters; the live server preview opens under the picked card; buy & equip in one step.
    - Two-sided fight log with HP bars and a math drawer; R/M keys for the attack choice.
    - The boss's hand (signature): equal plans with their draw chance, passed plans dimmed. Shown in Prepare and Aftermath, with the honest prediction basis.
    - Workshop menu (Runs, Simulations, ML Lab).
    - Error, empty and loading states. Mobile: compact side-by-side fighters and a fixed Begin bar.
  - **Server additions:** `POST /api/runs/:id/preview` (pure, writes nothing) and `POST /buy` with `loadout` (buy and equip in one transaction).
  - **Review:** fresh finish reviewer, three rounds:
    - Round 1: fix (8 items), all resolved.
    - Round 2: fix (3 regressions), resolved.
    - Round 3: **ship**. The ship covers the scored fixes; the Workshop views and the mobile inline preview were not captured.
    - The documenter flagged the yellow focus ring as too faint on card stock; that is now fixed (court blue there).
  - **Evidence:** `client/.impeccable/review/*.png` (1440x900 and 390x844 @2x), regenerated by `python client/scripts/capture-review.py client/.impeccable/review` (needs the API on the test DB with a played run #2, plus the client).
  - **Verification:** `npm test` = **159 server + 5 client passing**; typecheck clean; build OK; `impeccable detect` clean.
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
2. `npm test` should report 159 server + 5 client passing; `npm run typecheck` clean. `npm run balance` re-runs the balance study (no DB).
3. `npm run dev` → http://localhost:5173. `npm run ml:status` for ML state.
4. Read `docs/FILE_GUIDE.md` to locate code. Never change mechanics without updating tests + `docs/GAME_MECHANICS.md`.
