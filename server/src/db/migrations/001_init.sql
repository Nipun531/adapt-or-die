-- 001_init.sql — initial schema for The Boss Remembers.
-- Hierarchy (game plan §5): runs → rounds → combat_events, plus progression ledger, boss analyses/decisions,
-- simulation batches, ML training examples, dataset snapshots and model versions.
-- Raw gameplay records (runs/rounds/combat_events/progression_events) are append-only history;
-- training_examples are DERIVED rows that can be rebuilt from raw records for any feature-schema version.

CREATE TABLE simulation_batches (
  id                 BIGSERIAL PRIMARY KEY,
  seed               TEXT NOT NULL,
  config             JSONB NOT NULL,           -- runs requested, max rounds, strategies, ...
  simulator_version  TEXT NOT NULL,
  engine_version     TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  runs_requested     INT NOT NULL CHECK (runs_requested > 0),
  runs_completed     INT NOT NULL DEFAULT 0,
  runs_failed        INT NOT NULL DEFAULT 0,
  rounds_completed   INT NOT NULL DEFAULT 0,
  examples_created   INT NOT NULL DEFAULT 0,
  summary            JSONB NOT NULL DEFAULT '{}'::jsonb,   -- win rates per strategy, etc.
  errors             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{runIndex, seed, message}]
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ
);

CREATE TABLE runs (
  id                   BIGSERIAL PRIMARY KEY,
  source               TEXT NOT NULL CHECK (source IN ('manual','simulation')),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','failed')),
  end_reason           TEXT,                     -- 'max_rounds' | 'ended_by_player' | error text
  max_rounds           INT NOT NULL CHECK (max_rounds BETWEEN 1 AND 100),
  seed                 TEXT NOT NULL,            -- root seed; round seeds derive from it
  engine_version       TEXT NOT NULL,
  simulator_version    TEXT,
  simulation_batch_id  BIGINT REFERENCES simulation_batches(id) ON DELETE SET NULL,
  player_strategy      TEXT,                     -- simulation agent name (NULL for manual play)
  config               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at             TIMESTAMPTZ
);
CREATE INDEX runs_source_created_idx ON runs (source, created_at DESC);
CREATE INDEX runs_batch_idx ON runs (simulation_batch_id);

-- Current (mutable) progression state of each side. History lives in rounds snapshots + progression_events.
CREATE TABLE combatants (
  run_id       BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  side         TEXT NOT NULL CHECK (side IN ('player','boss')),
  level        INT NOT NULL CHECK (level >= 1),
  xp           INT NOT NULL CHECK (xp >= 0),
  gold         INT NOT NULL CHECK (gold >= 0),      -- gold can never go negative
  stat_points  INT NOT NULL CHECK (stat_points >= 0),
  stats        JSONB NOT NULL,                      -- {hp,str,def,dex}
  inventory    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- owned item ids
  loadout      JSONB NOT NULL,                      -- {hand1,hand2,armour}
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, side)
);

CREATE TABLE rounds (
  id              BIGSERIAL PRIMARY KEY,
  run_id          BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_number    INT NOT NULL CHECK (round_number >= 1),
  status          TEXT NOT NULL CHECK (status IN ('in_progress','completed','failed')),
  seed            BIGINT NOT NULL,                  -- uint32 combat seed derived from run seed
  engine_version  TEXT NOT NULL,
  player_pre      JSONB NOT NULL,                   -- full CombatantState at round start
  boss_pre        JSONB NOT NULL,
  player_snapshot JSONB NOT NULL,                   -- FighterSnapshot incl. derived combat numbers
  boss_snapshot   JSONB NOT NULL,
  initiative      JSONB NOT NULL,                   -- tie-break roll, opening/turn order, bonus attacks
  combat_state    JSONB,                            -- resumable engine state while in progress (NULL after)
  pending_choice  JSONB,                            -- what the player must choose next (NULL if none)
  winner          TEXT CHECK (winner IN ('player','boss')),
  player_hp_end   DOUBLE PRECISION,
  boss_hp_end     DOUBLE PRECISION,
  attack_count    INT NOT NULL DEFAULT 0,
  player_rewards  JSONB,                            -- progression ledger entries applied after the round
  boss_rewards    JSONB,
  player_post     JSONB,                            -- CombatantState after rewards/level-ups
  boss_post       JSONB,
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  UNIQUE (run_id, round_number)
);
-- At most one in-progress round per run.
CREATE UNIQUE INDEX rounds_one_in_progress_idx ON rounds (run_id) WHERE status = 'in_progress';

CREATE TABLE combat_events (
  id                 BIGSERIAL PRIMARY KEY,
  round_id           BIGINT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  seq                INT NOT NULL,
  turn               INT NOT NULL,
  phase              TEXT NOT NULL CHECK (phase IN ('opening','regular','dex_bonus')),
  attacker           TEXT NOT NULL CHECK (attacker IN ('player','boss')),
  defender           TEXT NOT NULL CHECK (defender IN ('player','boss')),
  mode               TEXT NOT NULL CHECK (mode IN ('melee','ranged','unarmed')),
  weapon_id          TEXT,
  choice_source      TEXT NOT NULL,
  choice_reason      TEXT,
  calc               JSONB NOT NULL,               -- every formula input/intermediate + random rolls
  damage             DOUBLE PRECISION NOT NULL,
  defender_hp_before DOUBLE PRECISION NOT NULL,
  defender_hp_after  DOUBLE PRECISION NOT NULL,
  attacker_hp        DOUBLE PRECISION NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, seq)
);

-- Append-only economy/progression ledger: rewards, level-ups, allocations, purchases, equips.
CREATE TABLE progression_events (
  id          BIGSERIAL PRIMARY KEY,
  run_id      BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_id    BIGINT REFERENCES rounds(id) ON DELETE CASCADE,
  side        TEXT NOT NULL CHECK (side IN ('player','boss')),
  kind        TEXT NOT NULL CHECK (kind IN ('xp','gold','level_up','stat_allocation','purchase','equip')),
  actor       TEXT NOT NULL CHECK (actor IN ('rules','player','boss_policy','agent')),
  payload     JSONB NOT NULL,
  state_after JSONB,                               -- CombatantState after this change (for player/boss actions)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX progression_events_run_idx ON progression_events (run_id, id);

-- Boss's post-round analysis (evidence + conclusions). One per completed round.
CREATE TABLE boss_analyses (
  id          BIGSERIAL PRIMARY KEY,
  run_id      BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_id    BIGINT NOT NULL UNIQUE REFERENCES rounds(id) ON DELETE CASCADE,
  analysis    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Boss's pre-round decision: prediction used (model or fallback), options considered, chosen plan, cost, state change.
CREATE TABLE boss_decisions (
  id                BIGSERIAL PRIMARY KEY,
  run_id            BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  for_round_number  INT NOT NULL,
  round_id          BIGINT REFERENCES rounds(id) ON DELETE CASCADE,
  predictor         JSONB NOT NULL,   -- {kind:'model'|'fallback', modelVersion, probabilityRanged, fallbackReason, features}
  evidence          JSONB NOT NULL,   -- weaknesses from the last analysis + observed player profile
  options           JSONB NOT NULL,   -- top candidate plans with scores
  selected          JSONB NOT NULL,   -- chosen plan + rationale
  actions           JSONB NOT NULL,   -- concrete allocations/purchases/equip applied
  gold_spent        INT NOT NULL CHECK (gold_spent >= 0),
  state_before      JSONB NOT NULL,
  state_after       JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, for_round_number)
);

-- DERIVED ML rows. One row = "after round N, predict player's style in round N+1".
CREATE TABLE training_examples (
  id                      BIGSERIAL PRIMARY KEY,
  run_id                  BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  feature_round_id        BIGINT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,  -- last round visible to features (N)
  label_round_id          BIGINT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,  -- round providing the label (N+1)
  feature_schema_version  TEXT NOT NULL,
  source                  TEXT NOT NULL CHECK (source IN ('manual','simulation')),
  engine_version          TEXT NOT NULL,
  simulator_version       TEXT,
  seed                    TEXT,
  features                JSONB NOT NULL,
  label                   SMALLINT,                 -- 1 = mostly ranged, 0 = mostly melee/unarmed, NULL if invalid
  label_detail            JSONB NOT NULL,
  baseline_probability    DOUBLE PRECISION NOT NULL, -- transparent baseline's prediction (for evaluation only, never a feature)
  is_valid                BOOLEAN NOT NULL,
  invalid_reason          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (label_round_id, feature_schema_version)
);
CREATE INDEX training_examples_schema_idx ON training_examples (feature_schema_version, is_valid);

CREATE TABLE dataset_snapshots (
  id                      BIGSERIAL PRIMARY KEY,
  feature_schema_version  TEXT NOT NULL,
  row_count               INT NOT NULL,
  invalid_excluded        INT NOT NULL,
  distinct_runs           INT NOT NULL,
  label_distribution      JSONB NOT NULL,
  source_distribution     JSONB NOT NULL,
  file_path               TEXT NOT NULL,
  sha256                  TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE model_versions (
  id                      BIGSERIAL PRIMARY KEY,
  version                 TEXT NOT NULL UNIQUE,
  model_type              TEXT NOT NULL,
  task                    TEXT NOT NULL,
  feature_schema_version  TEXT NOT NULL,
  dataset_snapshot_id     BIGINT REFERENCES dataset_snapshots(id),
  artifact_path           TEXT NOT NULL,
  params                  JSONB NOT NULL,
  metrics                 JSONB NOT NULL,           -- held-out model metrics
  baseline_metrics        JSONB NOT NULL,           -- same split, transparent baseline
  data_stats              JSONB NOT NULL,           -- train/test sizes, class balance, groups
  eligible                BOOLEAN NOT NULL,
  eligibility_reasons     JSONB NOT NULL,
  is_active               BOOLEAN NOT NULL DEFAULT false,
  training_seconds        DOUBLE PRECISION NOT NULL,
  trained_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at            TIMESTAMPTZ
);
-- Only one active model at a time.
CREATE UNIQUE INDEX model_versions_one_active_idx ON model_versions (is_active) WHERE is_active;
