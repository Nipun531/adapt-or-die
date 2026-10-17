# The Boss Remembers (Adaptive Boss Duel, Version 2)

A browser-playable, text-focused medieval duel. You and the boss start from the same base — level 1, unarmed, no gold, base stats plus
**2 stat points each to allocate before round 1** — and fight over many rounds.
After each round both earn XP and gold, level up, buy physical medieval gear and change loadouts. The boss analyses every fight, records
evidence-backed weaknesses, predicts how you will attack next (trained XGBoost model when an eligible one is active, otherwise a transparent
baseline) and picks legal, affordable adaptations under exactly the same rules as you.

## Features

- Full game loop from the game plan: stats, XP curve (×1.12), rewards (win 50 XP / 10 gold, loss 30 XP / 5 gold, level-up +20 gold), stat points, versioned 24-item catalogue (V2; V1 frozen for history), 2 hand slots + armour, damage formula, DEX mitigation (clamped at 0), DEX bonus attacks, one First Shot per round (only bow holder, or higher effective DEX; tie = none), melee and ranged pierce.
- Authoritative, seeded, resumable combat engine; every attack's formula inputs and random rolls are stored and shown in the combat log.
- Boss post-round analysis (evidence + weaknesses) and pre-round decisions (prediction, options, simulated win rates, rationale, cost, state change).
- PostgreSQL persistence of runs, rounds, events, progression ledger, analyses, decisions, simulations, training rows, dataset snapshots and model versions.
- Simulation runner (11 agent strategies, seeded, reproducible, append-only) via CLI or UI, plus a balance harness (`npm run balance`).
- ML pipeline: leakage-safe features, dataset export (CSV/JSON), group-split training, held-out metrics vs baseline, documented eligibility rule, versioned artifacts, explicit activation, honest model-vs-fallback reporting on every decision.
- Web UI ("Court Deck", see `client/DESIGN.md`): the Duel in three phases (Prepare / Fight / Aftermath) with the boss's hand of plans; Runs, Simulations and ML Lab under the Workshop menu.

## Stack

React 18 + Vite (client) · Node.js + Express + TypeScript via tsx (server) · PostgreSQL 16 in Docker · Python 3.10+ with XGBoost/scikit-learn (ML) · Vitest + supertest.
Why: see `docs/ARCHITECTURE.md`.

## Prerequisites

Required for local development:
- **Node.js 20+** and npm
- **Docker Desktop** (runs PostgreSQL; or point `DATABASE_URL` at your own Postgres 14+)
- **Python 3.10+** with `pip install -r ml/requirements.txt` — needed for training and for the boss to *use* a trained model. Without it the game works and the boss uses the baseline (and says so).

No paid services, no API keys. Deployment is not configured.

## Quick start

```bash
npm install                      # installs server + client workspaces
cp .env.example .env             # then edit POSTGRES_PASSWORD and DATABASE_URL/TEST_DATABASE_URL to match
pip install -r ml/requirements.txt   # set PYTHON_BIN in .env if `python` is not that interpreter
npm run db:up                    # start PostgreSQL (Docker Desktop must be running)
npm run db:migrate               # create database + tables
npm run dev                      # API on http://localhost:4000, web app on http://localhost:5173
```

Open **http://localhost:5173** → *Start new run*.

Production-style single process: `npm run build` then `npm start` → everything on http://localhost:4000.

## Environment (`.env`)

| Variable | Meaning |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | Docker Postgres credentials and host port (default 5433) |
| `DATABASE_URL` | Main DB connection string (must match the above) |
| `TEST_DATABASE_URL` | Separate DB for `npm test` (created automatically, **wiped by tests**) |
| `PORT` | API port (default 4000); the Vite proxy reads it from `.env` |
| `CLIENT_ORIGIN` | Allowed CORS origin (default `http://localhost:5173`) |
| `PYTHON_BIN` | Python interpreter with the ML packages (full path on Windows if needed) |
| `ARTIFACTS_DIR` | Where datasets/models are written (default `artifacts/`, git-ignored) |
| `DEFAULT_MAX_ROUNDS` | Default rounds per new run (default 10) |

Never commit `.env`.

## Playing

1. **Duel** → choose rounds → *Start new run* (or resume an active run). Runs from older engine versions open view-only.
2. Before round 1 you must spend your 2 initial stat points (the boss spends its own 2 when the round begins — see its round-1 decision).
   Before each round: spend stat points (+5 HP / +3 STR / +2 DEF / +2 DEX), buy items, set your loadout, then *Begin round*.
3. The boss prepares (you can inspect its decision and its hand of plans), combat resolves on the server. With Ranged + Melee equipped you choose the mode per attack (keys R / M; tick "use for the rest of this round" to repeat).
4. Read the combat log (click a line for the full calculation), rewards, level-ups and the boss's analysis. Repeat.

## Simulations

```bash
npm run sim -- --runs 100 --rounds 10 --seed my-seed
npm run sim -- --list
```
Or **Workshop → Simulations**. Details: `docs/SIMULATIONS.md`.

## Train / evaluate the ML model

```bash
npm run ml:status                  # data counts, active model, latest decision model-vs-fallback
npm run ml:train                   # build rows → export snapshot → train → evaluate vs baseline → record version
npm run ml:train -- --activate     # …and activate if eligible
npm run ml:activate -- <version>   # activate an eligible model; `-- --none` returns to the baseline
npm run ml:build-dataset           # rebuild missing training rows from raw rounds
npm run ml:export                  # CSV + JSON snapshot in artifacts/datasets/
```
Or **Workshop → ML Lab**. Eligibility needs ≥ 200 valid rows from ≥ 20 runs and a held-out improvement over the baseline. `ml:train` also evaluates a model+baseline ensemble candidate with its own rule; nothing is activated automatically. In V2 no model is eligible yet, so the boss uses the baseline (ML walkthrough §10c). Details: `docs/ML_WALKTHROUGH.md`.

## Tests

```bash
npm test            # unit (rules, combat) + integration (lifecycle, initial points, simulations, ML, API) — needs the DB running
npm run test:unit   # unit tests only (no DB)
npm run typecheck   # server + client
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot reach PostgreSQL … Is Docker running?` | Start Docker Desktop, then `npm run db:up`. |
| `rejected the credentials` | `DATABASE_URL` must match `POSTGRES_USER`/`POSTGRES_PASSWORD`. If you changed the password after the volume was created, either revert it or `docker compose down -v` (deletes data). |
| `Tables are missing` / `database does not exist` / `column "engine_version" does not exist` | `npm run db:migrate`. |
| "Allocate your 2 initial stat point(s) before round 1" | Spend the points in the Stat points section, then begin the round. |
| ML Lab: active model "trained on engine 1.0.0 data" | Old-rules model; boss uses the baseline. Run simulations, then `npm run ml:train -- --activate`. |
| Web app says "Cannot reach the server" | Run `npm run dev` (or `npm run dev:server`); check `PORT` in `.env`. |
| ML Lab shows Python ✖ / boss always "fallback" | Set `PYTHON_BIN` to an interpreter with `ml/requirements.txt` installed; train and activate an eligible model. |
| `NOT trained: Dataset too small` | Run more simulations (`npm run sim -- --runs 50`). |
| Port 5433 in use | Change `POSTGRES_PORT` and the port in both DB URLs. |

## Documentation

- `docs/GAME_MECHANICS.md` — rules, tables, formulas, developer decisions, unresolved items
- `docs/ARCHITECTURE.md` — components, data flow, round lifecycle, API
- `docs/ML_WALKTHROUGH.md` — ML task, features, training, evaluation, inference, limitations
- `docs/DATABASE_WALKTHROUGH.md` — schema, lifecycle, backup, inspection queries
- `docs/SIMULATIONS.md` — batches, agents, seeds, outputs
- `docs/FILE_GUIDE.md` — every file and where to change things
- `docs/V2_DEMANDS.md`, `docs/V2_IMPLEMENTATION_PLAN.md`, `docs/V2_BALANCE.md`, `docs/HANDOFF.md` — Version 2 spec, plan, balance report, handoff
- `client/DESIGN.md` — the UI design system

## Known limitations

- Game-rules version is `ENGINE_VERSION` 2.0.0. Data and models from 1.x are kept as history but not used for training or inference; 1.x runs are view-only — run `npm run db:migrate` after updating.
- Known balance issues (DEX dominance and others) are measured in `docs/V2_BALANCE.md` §4 and deferred to the next version.
- Skills and item upgrades are mentioned in the plan but not specified, so they are not implemented. Pierce values were tuned by simulation (`docs/V2_BALANCE.md`).
- Training data is mostly simulated by scripted agents; model metrics on it overstate accuracy on human players (see ML walkthrough §10).
- One simulation batch at a time per server process; long batches share CPU with play (use the CLI for big batches).
