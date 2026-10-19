# File Guide — The Boss Remembers

Purpose of every project file, and where to make common changes. Keep this in sync when adding/removing files.
(Generated/ignored: `node_modules/`, `client/dist/`, `artifacts/`, `.env`.)

## Where to change common things

| I want to… | Edit |
|---|---|
| Change the initial stat points | `INITIAL_STAT_POINTS` in `server/src/game/constants.ts` (bump `ENGINE_VERSION`, retrain) |
| Change a stat, reward, XP curve, damage factor, DEX threshold | `server/src/game/constants.ts` (+ `tests/unit/rules.test.ts`, `docs/GAME_MECHANICS.md`, bump `ENGINE_VERSION`) |
| Change an item's cost/modifiers or pierce values | `server/src/game/catalogs/v2.ts` (never edit `catalogs/v1.ts`, it is frozen history), then `npm run balance` |
| Change a formula | `server/src/game/formulas.ts` |
| Change slot legality | `server/src/game/equipment.ts` (`LEGAL_HAND_SETS`) |
| Change turn order / opening / bonus attacks | `server/src/game/combat.ts` |
| Tune boss weakness detection | `server/src/boss/analysis.ts` (`WEAKNESS_THRESHOLDS`) |
| Tune boss decision search | `server/src/boss/policy.ts` (`POLICY_CONFIG`) |
| Add a simulation strategy | `server/src/sim/agents.ts` |
| Check game balance (no DB) | `npm run balance` → `server/src/sim/balance.ts`, `balance-cli.ts`, output in `artifacts/balance/` |
| Change ML features/label | `server/src/ml/features.ts` (bump `FEATURE_SCHEMA_VERSION`) |
| Change model, split, eligibility | `ml/train.py` |
| Add an API endpoint | `server/src/api/app.ts` (+ `client/src/api.ts`) |
| Change the UI | `client/src/duel/*` (duel screen), `client/src/views/*`, `client/src/ui/*`, `client/src/styles/{tokens,base,app}.css`; design contract in `client/.impeccable/surfaces/src-app-tsx.md` |
| Change the schema | new `server/src/db/migrations/00N_*.sql` |
| Default rounds per run, ports, Python path | `.env` (template `.env.example`) |

## Root

| File | Purpose |
|---|---|
| `package.json` | npm workspaces (`server`, `client`) and every documented command (`db:*`, `dev`, `sim`, `ml:*`, `test`, `build`, `start`, `typecheck`). |
| `package-lock.json` | Locked dependency versions. |
| `docker-compose.yml` | PostgreSQL 16 container (`boss-remembers-db`, port 5433, volume `boss_pgdata`, health check). |
| `.env.example` | Template for `.env` with safe placeholders (DB, ports, Python, artifacts dir, default rounds). |
| `.gitignore` | Ignores secrets, dependencies, builds, Python caches, `artifacts/`. |
| `README.md` | Overview, setup, commands, troubleshooting. |
| `PROGRESS.md` | Development handoff log (status, decisions, next steps). |
| `.claude/launch.json` | Dev-server launch config for the Claude desktop preview (api :4000, client :5173). |
| `context/*` | Original game plan (authoritative mechanics), build prompt and walkthrough. Read-only references. |

## docs/

| File | Purpose |
|---|---|
| `GAME_MECHANICS.md` | Faithful rules, tables, formulas, developer decisions, unresolved items. |
| `ARCHITECTURE.md` | Components, data flow, round lifecycle, boss, API list. |
| `ML_WALKTHROUGH.md` | ML task, rows, features, leakage boundary, training, eligibility, inference, limits, tweaking. |
| `DATABASE_WALKTHROUGH.md` | Tables, fields, relations, env vars, migrations, lifecycle, backup, queries. |
| `SIMULATIONS.md` | Batch commands, agents, seeds, outputs, failures, retraining. |
| `FILE_GUIDE.md` | This file. |

## ml/ (Python)

| File | Purpose |
|---|---|
| `train.py` | Loads a dataset snapshot CSV, group-split by run, trains XGBoost, evaluates vs baseline, applies the eligibility rule, writes `model.json` + `metadata.json`, prints JSON result. |
| `infer_worker.py` | Persistent JSON-lines scoring worker spawned by the server (ping / load / predict). |
| `requirements.txt` | Pinned Python packages (numpy, pandas, scikit-learn, xgboost). |

## server/ (Node + TypeScript)

| File | Purpose |
|---|---|
| `package.json` | Server scripts (dev, start, migrate, sim, ml:*, test, typecheck) and dependencies. |
| `tsconfig.json` | Type-check config (tsx runs sources directly). |
| `vitest.config.ts` | Test config (sequential files — shared test DB). |
| `src/index.ts` | Entry point: DB check, mark interrupted batches, start Express. |
| `src/config/env.ts` | Loads `.env`, typed settings, `REPO_ROOT`, password-masking helper. |
| `src/api/app.ts` | Express app: all REST endpoints, zod validation, error mapping, background sim batches, serves `client/dist` when built. |
| `src/db/pool.ts` | pg pool, `withTransaction`, actionable DB error messages. |
| `src/db/migrate.ts` | Creates DB if missing, applies SQL migrations (`npm run db:migrate`). |
| `src/db/check.ts` | Connectivity + per-table row counts (`npm run db:check`). |
| `src/db/migrations/001_init.sql` | Full schema with constraints and indexes. |
| `src/db/migrations/002_initial_stat_points.sql` | Engine 1.1.0: `initial_points` ledger kind, `engine_version` on dataset snapshots and model versions. |
| `src/game/types.ts` | Domain types (stats, items, loadout, combatant, snapshots). |
| `src/game/constants.ts` | All rule numbers + engine version. |
| `src/game/catalog.ts` | Catalogue access: live V2 items, `catalogFor`/`itemForHistory` for older engines. |
| `src/game/catalogs/v1.ts` | Frozen V1 catalogue (engine 1.x history, incl. Axe). |
| `src/game/catalogs/v2.ts` | Live V2 catalogue (24 items, tuned pierce values). |
| `src/game/formulas.ts` | One pure function per formula. |
| `src/game/derive.ts` | Net ATK/DEF/DEX, effective DEX, attack modes from stats + gear. |
| `src/game/equipment.ts` | Slot legality, purchases, stat allocation (`RuleError`). |
| `src/game/progression.ts` | Initial state, round rewards, level-ups. |
| `src/game/rng.ts` | Seeded serialisable RNG + seed derivation. |
| `src/game/combat.ts` | Resumable combat engine producing auditable events. |
| `src/game/expected.ts` | Expected-damage estimates (used by boss/agents, not rules). |
| `src/game/summary.ts` | Aggregates combat events per side (analysis + features). |
| `src/boss/analysis.ts` | Post-round evidence and weaknesses. |
| `src/boss/policy.ts` | Constrained pre-round decision layer (legal plan enumeration, scoring, MC verification) + boss in-fight mode choice. |
| `src/boss/prepare.ts` | Boss preparation pipeline: history → features → predictor → policy → validated apply → persisted decision. |
| `src/services/runs.ts` | Run create/load/list/view, player allocate/buy/equip/end, progression ledger. |
| `src/services/rounds.ts` | Authoritative round lifecycle, choice resume, rewards, analysis, training-row append. |
| `src/services/history.ts` | Raw DB rows → domain objects (combatants, events, completed rounds). |
| `src/sim/agents.ts` | Simulated player strategies + `SIMULATOR_VERSION`. |
| `src/sim/runner.ts` | Batch create/execute, per-run failure handling, counters, summaries, interrupted-batch cleanup. |
| `src/sim/cli.ts` | `npm run sim` command. |
| `src/ml/decision-check.ts` | Boss decision outcomes for model candidates: identical seeded in-memory games with baseline / model / ensemble predictors, plus the pass rule. |
| `src/boss/bench.ts` | `npm run boss:bench`: policy v1 vs v2, covering round-1 diversity, boss win rates and ms per decision (no DB). |
| `src/dev-testdb.ts` | `npm run dev:testdb` (launch config `api-testdb`): the API on the **test** DB, for click-testing without touching dev data. |
| `src/sim/balance.ts` | Balance harness: in-memory runs vs the real boss, weapon matrix, pierce tuning, item-override experiments. |
| `src/sim/balance-cli.ts` | `npm run balance` — full balance study → `artifacts/balance/report.{md,json}`. |
| `src/game/rules.ts` | RuleSets: `v2` (engine 2.0.0 control) and `v3` (block/dodge/counter/stun/stims). All V3 numbers in `V3_COMBAT`; `withRules` for harness ablations/sweeps. |
| `src/game/catalogs/v3.ts` | V3 catalogue: V2 items + Warhammer 45 + block/stun/dodge-counter properties (not live until Phase C2). |
| `src/sim/v3-baseline.ts` | V3 Phase A: V2 control-baseline metrics (per agent/stage, run-level bootstrap and Wilson CIs, comeback, snowball, build entropy, mirror round-1 check). |
| `src/sim/v3-baseline-cli.ts` | `npm run v3:baseline` → `artifacts/balance/v3-baseline-*.json` (no DB). |
| `src/ml/features.ts` | Feature schema v1, label definition, transparent baseline. |
| `src/ml/examples.ts` | Append / rebuild derived training rows. |
| `src/ml/dataset.ts` | Dataset statistics and CSV/JSON snapshot export. |
| `src/ml/training.ts` | Train orchestration (Python), model registration, activation, ML status. |
| `src/ml/predictor.ts` | Model-or-fallback inference with explicit reasons; Python worker management. |
| `src/ml/cli.ts` | `npm run ml:*` commands. |
| `tests/helpers/db.ts` | Points tests at `TEST_DATABASE_URL`, migrates, truncates between tests; `createReadyRun()` creates a run and spends the initial points. |
| `tests/unit/rules.test.ts` | Stats, catalogue, formulas, clamp, bonus thresholds, XP, rewards, slots, purchases. |
| `tests/unit/combat.test.ts` | Opening-shot rule (engine 2.0.0), turn order, bonus attacks, piercing on any weapon, reproducibility, pause/resume. |
| `tests/unit/balance.test.ts` | Balance harness determinism and catalogue restoration. |
| `tests/unit/ensemble.test.ts` | Blend arithmetic, decision-outcome verdict, reactive agent persona/observability, paired-run reproducibility. |
| `tests/unit/features.test.ts` | Label v2, schema v3 features, nulls for missing values. |
| `tests/unit/policy.test.ts` | Feasibility, prediction basis, baseline semantics, reachable scenarios, policy legality/band/reproducibility, archetypes. |
| `tests/integration/legacy-compat.test.ts` | Engine 1.x runs still load (V1 catalogue) and are view-only under 2.0.0. |
| `tests/integration/lifecycle.test.ts` | Round lifecycle, persistence across pool restart, boss legality over a run, ML fallback honesty. |
| `tests/integration/sim.test.ts` | Batches, provenance, reproducibility, append-only, config validation, adaptive agent. |
| `tests/integration/ml.test.ts` | Feature leakage boundary, export, training, eligibility gate, model actually used. |
| `tests/integration/initial-points.test.ts` | 2 initial stat points: grant, round-1 gate, boss spending, no re-grant, concurrency, simulations, ML engine versioning. |
| `tests/integration/api.test.ts` | HTTP validation/errors, full manual run, choice prompt, sim + ML endpoints. |

## client/ (React + Vite)

| File | Purpose |
|---|---|
| `package.json` | Client scripts (dev, build, typecheck) and dependencies. |
| `vite.config.ts` | Dev server :5173 and `/api` proxy to the API port from `.env`. |
| `tsconfig.json` | Client type-check config. |
| `index.html` | HTML entry. |
| `src/main.tsx` | Mounts the app; self-hosted fonts (@fontsource) and the three stylesheets. |
| `src/App.tsx` | Baize top bar (Duel + Workshop menu), hash routing, catalogue context, toasts. |
| `src/api.ts` | Typed API client; `ApiError.kind` tells "server unreachable" from a rule refusal. |
| `src/util.tsx` | Formatting, item lookups, data-loading/action hooks. |
| `src/styles/tokens.css` | Court Deck design tokens: baize, card stock, court inks, type, spacing, motion. |
| `src/styles/base.css` | Element defaults and browser surfaces (selection, focus, scrollbars, tabular numerals). |
| `src/styles/app.css` | All components and the responsive rules (one card form at three sizes). |
| `src/ui/Icon.tsx` | Authored SVG suits (♥ HP ♠ STR ♦ DEF ♣ DEX) and UI icons. |
| `src/ui/states.tsx` | Skeleton, ErrorBox (network vs rule), Empty, Notice, Meter (progressbar), confirm dialog, toasts. |
| `src/duel/Versus.tsx` | The two fighters as court cards (level index, HP, Net numbers, XP, gold, points). |
| `src/duel/Armory.tsx` | Prepare: item cards + filters, live server preview, buy & equip, hand slots, stat points, the boss's last hand, Begin round. |
| `src/duel/loadout.ts` (+ `.test.ts`) | Where a picked item goes in the hand (UX only; the server re-validates). |
| `src/duel/Fight.tsx` | Fight: First Shot line, two-sided turn-by-turn exchange with HP bars, calculation drawer, Ranged/Melee choice (R/M keys). |
| `src/duel/Aftermath.tsx` | Aftermath: result + rewards, the boss's hand (signature), what it saw, how it chose, honest prediction basis. |
| `src/duel/actions.ts` | The one primary action per phase. |
| `src/views/DuelView.tsx` | Start/resume screen; run screen with the Prepare / Fight / Aftermath phases. |
| `src/views/RunsView.tsx` | Workshop: paginated run history (manual/simulation, engine). |
| `src/views/SimView.tsx` | Workshop: launch batches, live progress, batch summaries. |
| `src/views/MlView.tsx` | Workshop: ML status, train / export / activate, model metrics (pure model and ensemble). |
| `scripts/capture-review.py` | Native-resolution review screenshots via headless Chrome (needs the API + client running). |
