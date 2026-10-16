# Architecture — The Boss Remembers

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| Web UI | React 18 + Vite 5 + plain CSS (`client/`) | Simple SPA, fast dev server, no UI framework to learn. |
| API + game engine | Node.js + Express 4 + TypeScript, run with `tsx` (`server/`) | One language for rules, API, boss and simulations; types catch rule mistakes. No build step on the server. |
| Database | PostgreSQL 16 in Docker (`docker-compose.yml`) | Run → round → combat-event history is relational; constraints (gold ≥ 0, one in-progress round per run, one active model) enforce invariants; JSONB keeps snapshots/calculations flexible. The plan explicitly allows PostgreSQL instead of MongoDB. |
| ML | Python 3.10+ with XGBoost / scikit-learn / pandas (`ml/`) | The plan suggests a lightweight tabular classifier like XGBoost. Python is used only for training and scoring; it never touches game rules or the database. |
| Tests | Vitest + supertest (`server/tests/`) | Unit tests for rules; integration tests against a real Postgres test database. |

Trade-offs: a single Node process runs both the API and background simulation batches (one batch at a time) — simple, but a
very large batch shares CPU with play. The CLI (`npm run sim`) can run batches in a separate process instead.

## Components

```
client (React)  ──HTTP /api──►  server/src/api/app.ts (Express, zod validation, error mapping)
                                   │
          ┌────────────────────────┼─────────────────────────────┬──────────────────────┐
          ▼                        ▼                             ▼                      ▼
 services/runs.ts         services/rounds.ts              sim/runner.ts           ml/training.ts
 (create/resume run,      (authoritative round            (batches of agent        (dataset → snapshot →
  allocate/buy/equip,      lifecycle, one transaction)      runs via the same        python train → model
  progression ledger)            │                          services)                versions, activation)
          │                      ├─► boss/prepare.ts ──► ml/features.ts ──► ml/predictor.ts ──► ml/infer_worker.py
          │                      │        └──► boss/policy.ts (constrained decision layer)
          │                      ├─► game/combat.ts (engine) ◄── game/derive.ts, formulas.ts, catalog.ts
          │                      ├─► game/progression.ts (rewards, level-ups)
          │                      ├─► boss/analysis.ts (post-round evidence)
          │                      └─► ml/examples.ts (append derived training row)
          ▼                      ▼
                      db/pool.ts → PostgreSQL
```

Responsibility map:

| Responsibility | Where |
|---|---|
| Game rules / combat | `server/src/game/*` (pure functions, no I/O) |
| Progression / economy / equipment validation | `game/progression.ts`, `game/equipment.ts` |
| Round orchestration + event logging | `services/rounds.ts` |
| Run lifecycle + player actions | `services/runs.ts` |
| Boss analysis | `boss/analysis.ts` |
| Boss decision policy | `boss/policy.ts` (chooses), `boss/prepare.ts` (applies + persists) |
| Simulation runner | `sim/agents.ts`, `sim/runner.ts`, `sim/cli.ts` |
| Data access | `db/pool.ts`, `services/history.ts` (row → domain) |
| ML features / dataset / training / inference | `ml/features.ts`, `ml/examples.ts`, `ml/dataset.ts`, `ml/training.ts`, `ml/predictor.ts`, `ml/train.py`, `ml/infer_worker.py` |
| API | `api/app.ts`, `index.ts` |
| Web UI | `client/src/*` |

The client is never authoritative: it sends intents (allocate, buy, equip, begin round, choose mode) and renders what the server returns.

## Run creation (`services/runs.ts → createRun`)

One transaction (API and simulator both wrap it): insert `runs` (engine version, seed, `config.initialStatPoints = 2`) → insert both
`combatants` from `initialCombatant()` (base stats, 0 gold, **2 unallocated stat points**) → one `progression_events` row per side
(`kind = 'initial_points'`, actor `rules`). This is the only place initial points are granted, so refresh/resume/restart can never re-grant them;
allocation requests lock the combatant row (`FOR UPDATE`) and decrement atomically, so concurrent or repeated requests cannot overspend.

## Round lifecycle (`services/rounds.ts`)

`POST /api/runs/:id/rounds` → `startRound()` inside **one transaction**:

1. Lock the run row (`FOR UPDATE`), check it is active, no round in progress, round number ≤ max rounds.
2. Validate the player's loadout. **Round 1 only:** refuse to start while the player still holds unspent initial stat points (engine 1.1.0).
3. **Boss preparation** (`boss/prepare.ts`) — in round 1 this is where the boss spends its 2 initial stat points (a guard asserts none remain): load completed rounds 1..N → build features → predictor (trained model or baseline) → `choosePlan()` enumerates legal plans and scores them → `applyPlan()` re-validates through `equipment.ts` → save boss state → progression ledger rows (actor `boss_policy`) → `boss_decisions` row with prediction, evidence, options, rationale, cost, state before/after.
4. Snapshot both fighters (stats + loadout + derived numbers); derive the round seed from the run seed.
5. Insert the `rounds` row (`in_progress`), run the combat engine until it finishes or the player must choose.
6. Persist combat events. If paused: store the serialisable engine state + `pending_choice` and commit. `POST /api/rounds/:id/choice` resumes it later (even after a server restart).
7. When a winner exists (`completeRound`): rewards + level-ups for both sides (ledger actor `rules`), post-states, `boss_analyses` row, append the ML training example for this round, close the run if max rounds reached.

A failure anywhere rolls the whole transaction back — no half-written rounds.

## Boss: after and before a round

- **After** (`boss/analysis.ts`): summarises the combat events (`game/summary.ts`) into damage by mode/phase/weapon, pierces, DEX/initiative comparison and outcome, then flags weaknesses (`ranged_pressure`, `pierce_exposure`, `heavy_melee_pressure`, `dex_deficit`, `low_defense`, `low_damage_output`, `outmatched`, `narrow_loss`) — each with the evidence sentence and metric values that triggered it. Thresholds are heuristics in `WEAKNESS_THRESHOLDS`.
- **Before** (`boss/policy.ts`): enumerates every legal (stat allocation × loadout reachable with owned + affordable items) plan; builds two opponent scenarios from the player's last observed build (ranged / melee, hypothetically assuming a Bow or Sword if the player lacks one); pre-scores all plans analytically (expected time-to-kill using the real formulas), verifies the top 6 with 16 seeded simulated fights per scenario using the real engine; weights the scenarios by the predictor's P(player mostly ranged); among plans within 0.02 of the best picks the cheapest. `prepare.ts` records which weaknesses the chosen plan addresses (which derived metric moved).

So the ML prediction changes *which* legal plan wins; it never buys or allocates anything itself.

## Simulation ↔ ML interaction

```
sim agents ─► same services ─► raw records (runs, rounds, combat_events, progression_events, boss_*)
                                   │
                                   └─► ml/examples.ts → training_examples (derived, schema-versioned)
                                                 │
            npm run ml:train / ML Lab ──► ml/dataset.ts export (CSV+JSON, dataset_snapshots)
                                                 │
                                       ml/train.py (group split, XGBoost, metrics vs baseline, eligibility)
                                                 │
                                       artifacts/models/<version>/ + model_versions row
                                                 │
                     activate (eligible only) ──► ml/predictor.ts uses it in boss/prepare.ts
```

## Database design (summary — full detail in `docs/DATABASE_WALKTHROUGH.md`)

- `runs` 1—n `rounds` 1—n `combat_events`; `runs` 1—2 `combatants` (current mutable state of player/boss).
- `progression_events`: append-only ledger of xp/gold/level-ups/allocations/purchases/equips with actor.
- `boss_analyses` (1 per completed round), `boss_decisions` (1 per round, before combat).
- `simulation_batches` 1—n `runs`.
- `training_examples` (derived) → `dataset_snapshots` → `model_versions`.

## API endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | DB connectivity + versions |
| GET | `/api/catalog` | Items and rule constants for display (incl. `initialStatPoints`) |
| GET/POST | `/api/runs` | List (filter `source`, paginate) / create a manual run (`{maxRounds?, seed?}`) |
| GET | `/api/runs/:id` | Run view: both combatants (+ derived), rounds, record, last analysis/decision |
| POST | `/api/runs/:id/allocate` `/buy` `/loadout` `/end` | Player preparation actions |
| GET | `/api/runs/:id/progression` | Progression ledger |
| POST | `/api/runs/:id/rounds` | Start the next round (boss prepares, combat runs); 400 for round 1 while initial points are unspent |
| GET | `/api/rounds/:id` | Round detail: snapshots, initiative, events, analysis, decision, rewards |
| POST | `/api/rounds/:id/choice` | `{mode, repeat?}` for a paused Ranged+Melee choice |
| GET/POST | `/api/simulations` | List / launch a batch (202, runs in background) |
| GET | `/api/simulations/strategies`, `/api/simulations/:id` | Agent list / batch progress + summary |
| GET | `/api/ml/status` (`?ping=1`), `/api/ml/models` | Dataset counts, active model, latest decision model-vs-fallback |
| POST | `/api/ml/build-dataset`, `/api/ml/export`, `/api/ml/train`, `/api/ml/activate` | ML lifecycle (`activate` with `{version:null}` = use baseline) |

Errors: 400 (validation / illegal by the rules), 404, 409 (a batch is running), 500 (unexpected; DB errors explained without credentials).

## Reproducibility

Rules version: `ENGINE_VERSION` (currently 1.1.0) is stored on runs, rounds, training rows, dataset snapshots and model versions; ML only
trains on and uses models built from current-engine data (`docs/ML_WALKTHROUGH.md` §9).

Every run has a root seed; round combat seeds, boss Monte-Carlo seeds and agent seeds are derived from it (`game/rng.ts`). The full
pre-round snapshots, the initiative roll and every random draw are stored with each round/event, so any fight can be audited and
replayed. Simulation batches are reproducible for the same seed, settings and predictor (the predictor used is stored on each decision).
