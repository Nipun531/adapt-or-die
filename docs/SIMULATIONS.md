# Simulations — The Boss Remembers

Simulations play complete runs automatically: an **agent** replaces the human player and fights the real adaptive boss.
They go through exactly the same services and rules as manual play, so they produce the same raw records and training rows,
tagged `source = 'simulation'`.

## Running a batch

CLI (separate process, prints progress per run):

```bash
npm run sim -- --runs 100 --rounds 10 --seed my-seed
npm run sim -- --runs 30 --strategies archer,adaptive --seed exp-2
npm run sim -- --list            # available strategies
```

| Option | Default | Limits |
|---|---|---|
| `--runs` | 20 | 1–2000 |
| `--rounds` | 10 | 1–30 (max rounds per run) |
| `--strategies` | all | comma-separated names below; assigned round-robin |
| `--seed` | time-based | 1–100 chars |

Web UI: **Simulations** tab → set runs / rounds / seed / strategies → **Launch batch**. The server runs one batch at a time in the background;
progress is persisted after each run and the page polls it. API: `POST /api/simulations {runs, maxRounds, strategies?, seed?}` → 202.

Speed: roughly 0.7–1 s per 10-round run on a laptop (the boss's Monte-Carlo plan verification dominates). 240 runs × 10 rounds ≈ 3.5 minutes.

## Agents (`server/src/sim/agents.ts`, `SIMULATOR_VERSION = sim-1.1.0`)

Every simulated run is created by the same `createRun()` as manual play, so both sides get the 2 initial stat points (engine 1.1.0).
Agents spend all available points each round — before round 1 that is the 2 initial points, with their normal pattern — through the
validated allocation service; the boss spends its points in round-1 preparation. Round 1 cannot start otherwise.

| Version | Engine | Meaning |
|---|---|---|
| `sim-1.0.0` | 1.0.0 | Original agents; runs started with 0 stat points (batches 1–3 in the dev DB — historical). |
| `sim-1.1.0` | 1.1.0 | Same agent logic; runs start with 2 initial points per side that agents/boss spend before round 1. |


| Name | Behaviour |
|---|---|
| `melee_bruiser` | Allocates STR/STR/HP; buys Knuckle → Sword → Leather Armour → Greatsword → Light → Heavy Armour; always melee. |
| `archer` | Allocates DEX/DEX/HP; buys Bow → Leather Armour → Crossbow; ranged once it owns a bow (unarmed before). |
| `shield_turtle` | Allocates DEF/HP/DEF/STR; buys Knuckle, shields and armour; melee + shield. |
| `hybrid` | Bow + melee weapon; allocates DEX/STR/HP; chooses ranged or melee per attack by higher expected damage. |
| `adaptive` | Starts melee; after two consecutive losses switches style (melee ↔ ranged), re-gears and re-allocates. |
| `random` | Random stat, ≤1 random affordable purchase (60%), random legal loadout, random attack mode. Adds noise/exploration. |

Agents buy wishlist items strictly in order (saving up when the next one is unaffordable) and only use information a human would have:
their own state and previous round outcomes. Every action is applied through `services/runs.ts` (validated, logged with actor `agent`).

Coverage note: these are scripted strategies, not humans. A model trained on them learns these patterns; see `docs/ML_WALKTHROUGH.md` §10.
To add a strategy: implement the `Agent` interface in `agents.ts`, add it to `AGENTS`, bump `SIMULATOR_VERSION`.

## Seeds and reproducibility

```
batch seed "S" → run i seed "S:run:i" → round combat seed  = hash("S:run:i::round:N")
                                      → boss MC seed       = hash("S:run:i::boss:N")
                                      → agent decision rng = hash("S:run:i::agent:N")
                                      → agent choice rng   = hash("S:run:i::agent-choice:N")
```

Same seed + same settings + same boss predictor (same active model, or fallback) + same engine/simulator versions ⇒ identical fights.
Batches from different engine versions are **not** comparable (different starting rules) even with the same seed
(tested in `tests/integration/sim.test.ts`). The predictor used is stored in each `boss_decisions` row. Re-running a batch **appends** new runs; it never overwrites.

## Outputs

- `simulation_batches` row: config, status, counters (runs completed/failed, rounds, training examples), per-strategy summary (rounds, player wins,
  boss wins, boss win rate), label distribution, errors.
- For each run: `runs` (source `simulation`, `player_strategy`, `simulation_batch_id`, `simulator_version`), `rounds`, `combat_events`,
  `progression_events`, `boss_analyses`, `boss_decisions`, and from round 2 one `training_examples` row per round.

## Failures

Each round is its own transaction. If a run throws, its completed rounds stay, the run is marked `failed` with `end_reason = 'error: …'`,
the error (run index, strategy, seed, message) is appended to the batch's `errors`, and the batch continues. A batch is `failed` only if every run failed.
If the server stops mid-batch, the batch is marked `failed` ("Interrupted") on the next start (batches with run activity in the last 5 minutes are left alone).

## Old vs new data

Simulated data from `sim-1.0.0` / engine 1.0.0 is kept (never deleted automatically) but is excluded from training under engine 1.1.0 —
snapshots only include rows whose `engine_version` matches the code. New batches append engine-1.1.0 rows. See `docs/ML_WALKTHROUGH.md` §9 ("Game-rules (engine) versions").

## Export, retrain, evaluate

```bash
npm run ml:status                 # how much data, label balance, active model
npm run ml:export                 # optional: CSV + JSON snapshot in artifacts/datasets/
npm run ml:train                  # build → export → train → evaluate vs baseline → record version
npm run ml:train -- --activate    # same, and activate if eligible
npm run ml:activate -- <version>  # or --none to go back to the baseline
```

Eligibility needs ≥ 200 valid rows from ≥ 20 runs (plus held-out improvement over the baseline) — about 40+ ten-round runs under engine 1.1.0 (≈32% of rows are invalid because the player never attacked).
