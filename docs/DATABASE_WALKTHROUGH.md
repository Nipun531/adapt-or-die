# Database Walkthrough — The Boss Remembers

PostgreSQL 16, run locally in Docker (`docker-compose.yml`, container `boss-remembers-db`, host port **5433**, data in the named volume `boss_pgdata`).
Schema: `server/src/db/migrations/001_init.sql` + `002_initial_stat_points.sql`. Migration runner: `server/src/db/migrate.ts`.

## Environment variables (`.env`, copy from `.env.example`)

| Variable | Used by | Meaning |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | docker-compose | Container credentials / host port |
| `DATABASE_URL` | server | Main database (`postgres://user:pass@localhost:5433/boss_remembers`) |
| `TEST_DATABASE_URL` | tests | Separate database, **wiped** by tests; must differ from `DATABASE_URL` |

Passwords are never logged: `describeDatabaseUrl()` masks them, and DB errors are rewritten into actionable messages by `explainDbError()`.

## Setup and migrations

```bash
npm run db:up        # start Postgres container
npm run db:migrate   # create the database if missing, apply migrations/*.sql in order
npm run db:check     # connectivity + row counts per table
```

Applied files are recorded in `schema_migrations`, so re-running is safe.

| Migration | Change |
|---|---|
| `001_init.sql` | Full initial schema. |
| `002_initial_stat_points.sql` | Engine 1.1.0. Additive: allows `progression_events.kind = 'initial_points'`; adds `engine_version` (NOT NULL) to `dataset_snapshots` and `model_versions`, backfilling pre-existing rows with `'1.0.0'` (they were all built from 1.0.0 data); index on `training_examples (feature_schema_version, engine_version, is_valid)`. No rows deleted. |
 To change the schema add `002_<name>.sql` (never edit an applied file).
Tests call `migrate(TEST_DATABASE_URL)` automatically.

### Migration 003 (engine 3.0.0, additive only)

New nullable columns (NULL = a pre-V3 record):
- `combatants.supplies`: stims, slots, effectiveness.
- `combat_events.kind` / `parent_seq` / `defense` / `stun`.
- `rounds.combat_notes` (lost turns, stims, the turn limit) and `rounds.end_reason` (`turn_limit`).

Widened CHECK lists:
- `combat_events.phase` adds `counter`.
- `progression_events.kind` adds `stim_purchase`, `stim_slot_upgrade` and `stim_effectiveness_upgrade`.

Applied on 2026-10-20:
1. A dev backup was taken: `artifacts/backups/pre-v3-migration-2026-10-20.sql`, sha256 `49aea7ff…`.
2. The migration ran on a restored copy first; every row count was identical and every new column empty.
3. Then it ran on the dev DB.

## Tables

Raw gameplay history (append-only except the mutable `combatants` state and in-progress round fields):

### `runs`
One game. `source` (`manual`/`simulation`), `status` (`active`/`completed`/`failed`), `end_reason` (`max_rounds`, `ended_by_player`, `error: …`),
`max_rounds`, `seed` (root seed), `engine_version` (game-rules version: `1.0.0` = no initial stat points, `1.1.0` = 2 initial points),  `simulator_version`, `simulation_batch_id` → `simulation_batches`, `player_strategy` (agent name), `config` (engine ≥ 1.1.0 runs include `initialStatPoints: 2`).
Index: `(source, created_at DESC)`, `(simulation_batch_id)`.

### `combatants`
Current state of each side, PK `(run_id, side)`: `level`, `xp`, `gold` (CHECK ≥ 0), `stat_points` (CHECK ≥ 0), `stats` `{hp,str,def,dex}`, `inventory` `[itemId]`, `loadout` `{hand1,hand2,armour}`.
History of how it got there lives in `rounds.*_pre/_post` and `progression_events`.

### `rounds`
One duel. `UNIQUE(run_id, round_number)`; partial unique index → at most one `in_progress` round per run.
`seed` (combat RNG seed), `engine_version`, `player_pre`/`boss_pre` (full state at start), `player_snapshot`/`boss_snapshot` (incl. derived combat numbers),
`initiative` (tie-break roll, opening order, turn order, bonus attacks), `combat_state` + `pending_choice` (only while paused for a player choice),
`winner`, `player_hp_end`, `boss_hp_end`, `attack_count`, `player_rewards`/`boss_rewards` (ledger entries), `player_post`/`boss_post`, `error`, timestamps.

### `combat_events`
One attack. `UNIQUE(round_id, seq)`. `turn` (0 = opening), `phase` (`opening`/`regular`/`dex_bonus`), `attacker`/`defender`, `mode` (`melee`/`ranged`/`unarmed`),
`weapon_id`, `choice_source` (`forced`/`player`/`player_auto`/`boss_policy`/`agent`), `choice_reason`,
`calc` (JSONB: attack value + source, defender Net DEF, pierce roll/chance/success, DEF used, net damage, both DEX values, DEX ratio, mitigation uniform draw,
roll, raw and clamped mitigation, final damage), `damage`, `defender_hp_before/after`, `attacker_hp`.

### `progression_events`
Append-only ledger: `kind` (`initial_points` — the one-time grant written at run creation, engine ≥ 1.1.0 — `xp`, `gold`, `level_up`, `stat_allocation`, `purchase`, `equip`), `actor` (`rules`, `player`, `boss_policy`, `agent`),
`payload`, `state_after` (full state after player/boss actions), optional `round_id`. Index `(run_id, id)`.

### `boss_analyses`
Post-round analysis, one per completed round (`round_id` UNIQUE). `analysis` JSONB: outcome, HP, player profile, damage taken/dealt by mode/phase/weapon,
initiative/DEX comparison, `weaknesses[]` (code, severity, evidence, metrics), conclusions, combat summary.

### `boss_decisions`
Pre-round decision, `UNIQUE(run_id, for_round_number)`, `round_id` set once the round row exists.
`predictor` (kind model/fallback, modelVersion, probabilityRanged, baselineProbability, fallbackReason, featureSchemaVersion, features),
`evidence` (weaknesses + how the plan addresses them, observed player, scenarios, derived before/after/deltas, constraints),
`options` (candidates evaluated, current build score, alternatives), `selected` (plan + rationale), `actions`, `gold_spent` (CHECK ≥ 0), `state_before`, `state_after`.

### `simulation_batches`
`seed`, `config` (runs, maxRounds, strategies, seed), `simulator_version`, `engine_version`, `status` (`queued`/`running`/`completed`/`failed`),
counters (`runs_requested`, `runs_completed`, `runs_failed`, `rounds_completed`, `examples_created` — recomputed from raw tables after each run),
`summary` (per-strategy wins, label distribution), `errors[]`, timestamps.

Derived / ML tables:

### `training_examples`
Derived rows (see `docs/ML_WALKTHROUGH.md`). `UNIQUE(label_round_id, feature_schema_version)` → append-only and rebuildable per schema.
`feature_round_id` (last round visible to features), `label_round_id`, `features` JSONB, `label` (1/0/NULL), `label_detail`, `baseline_probability`,
`is_valid`, `invalid_reason`, provenance (`source`, `engine_version`, `simulator_version`, `seed`). Index `(feature_schema_version, is_valid)`.

### `dataset_snapshots`
One per export: schema version, `engine_version` of the exported rows, `row_count`, `invalid_excluded`, `distinct_runs`, label/source distribution, `file_path` (CSV under `artifacts/datasets/`), `sha256`.

### `model_versions`
One per trained model: `version` (UNIQUE), `model_type`, `task`, `feature_schema_version`, `engine_version` (rules version of its training data; must equal the code's to be used), `dataset_snapshot_id`, `artifact_path`, `params`,
`metrics`, `baseline_metrics`, `data_stats` (split sizes, class balance, group overlap, feature importance), `eligible`, `eligibility_reasons`,
`is_active` (partial unique index → only one active), `training_seconds`, `trained_at`, `activated_at`.

## Relations

```
simulation_batches 1─n runs 1─2 combatants
                          1─n rounds 1─n combat_events
                          1─n progression_events (optionally → rounds)
                          1─n boss_analyses (1 per round)
                          1─n boss_decisions (1 per round)
                          1─n training_examples ─(snapshot export)→ dataset_snapshots 1─n model_versions
```

Deleting a run cascades to its rounds, events, ledger, analyses, decisions and training rows.

## Data lifecycle and retention

- Nothing is overwritten: re-running a simulation creates new runs; training rows use `ON CONFLICT DO NOTHING`; new models are new rows.
- Legacy runs (engine 1.0.0) need no migration: they are historical. Their data and models are kept, distinguished by `engine_version`, and
  excluded from current training/inference. A legacy run still in progress continues under its original rules (no points are added retroactively).
- Rows from old feature schemas are kept for comparison; rebuild for a new schema with `npm run ml:build-dataset`.
- Interrupted simulation batches are marked `failed` on the next server start (completed runs inside them are kept).
- Deletion is manual. Example — delete one simulation batch and everything it produced:
  `DELETE FROM runs WHERE simulation_batch_id = <id>; DELETE FROM simulation_batches WHERE id = <id>;`
- `docker compose down` keeps data; `docker compose down -v` **deletes the volume**.

## Backup / export

```bash
docker exec boss-remembers-db pg_dump -U boss boss_remembers > backup.sql
docker exec -i boss-remembers-db psql -U boss boss_remembers < backup.sql
npm run ml:export     # training rows as CSV + JSON in artifacts/datasets/
```

## Inspecting records

```bash
docker exec -it boss-remembers-db psql -U boss boss_remembers
```

```sql
SELECT id, source, status, player_strategy FROM runs ORDER BY id DESC LIMIT 10;
SELECT round_number, winner, player_hp_end, boss_hp_end FROM rounds WHERE run_id = 1 ORDER BY round_number;
SELECT seq, phase, attacker, mode, damage, calc->>'mitigation' FROM combat_events WHERE round_id = 1 ORDER BY seq;
SELECT for_round_number, predictor->>'kind', predictor->>'fallbackReason', selected->'rationale' FROM boss_decisions WHERE run_id = 1;
SELECT analysis->'weaknesses' FROM boss_analyses WHERE round_id = 1;
SELECT engine_version, source, label, count(*) FROM training_examples WHERE is_valid GROUP BY 1, 2, 3;
SELECT run_id, side, payload FROM progression_events WHERE kind = 'initial_points' ORDER BY id DESC LIMIT 4;
SELECT version, engine_version, eligible, is_active, metrics->>'log_loss', baseline_metrics->>'log_loss' FROM model_versions;
```
