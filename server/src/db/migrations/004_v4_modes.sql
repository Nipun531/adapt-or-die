-- 004 — Version 4 game modes and next-build learning (docs/V4_IMPLEMENTATION_PLAN.md §5). ADDITIVE ONLY:
-- new tables and columns with safe defaults. No existing row is updated or deleted; every existing run becomes a
-- Prepared Boss run through the column default.

-- Learning Boss profiles. There is no account system: a profile is reached only through its random key, which the
-- browser keeps. "Start fresh" archives a profile (status) instead of deleting it.
CREATE TABLE learning_profiles (
  id           BIGSERIAL PRIMARY KEY,
  key          UUID NOT NULL UNIQUE,
  name         TEXT NOT NULL DEFAULT 'Challenger',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at  TIMESTAMPTZ
);

-- Which mode a run is: prepared = the simulation-informed boss (all pre-V4 runs), learning = the boss that learns
-- one profile, pvp = two humans on one device (side 'player' = Player 1, side 'boss' = Player 2).
ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'prepared' CHECK (mode IN ('prepared', 'learning', 'pvp'));
ALTER TABLE runs ADD COLUMN profile_id BIGINT REFERENCES learning_profiles(id) ON DELETE SET NULL;
ALTER TABLE runs ADD CONSTRAINT runs_profile_only_learning CHECK (profile_id IS NULL OR mode = 'learning');
CREATE INDEX runs_mode_created_idx ON runs (mode, created_at DESC);
CREATE INDEX runs_profile_idx ON runs (profile_id);

-- What a Learning Boss profile observed: one row per COMPLETED learning round whose preparation was seen.
-- context = what was known before the round (previous result, state); heads = the build the player actually brought.
-- source = 'manual' (a human) or 'synthetic' (test fixtures / evaluation agents, never mixed silently).
CREATE TABLE profile_observations (
  id            BIGSERIAL PRIMARY KEY,
  profile_id    BIGINT NOT NULL REFERENCES learning_profiles(id) ON DELETE CASCADE,
  run_id        BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  round_id      BIGINT NOT NULL UNIQUE REFERENCES rounds(id) ON DELETE CASCADE,
  round_number  INT NOT NULL,
  context       JSONB NOT NULL,
  heads         JSONB NOT NULL,
  outcome       JSONB NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('manual', 'synthetic')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX profile_observations_profile_idx ON profile_observations (profile_id, created_at);

-- Next-build training rows (Prepared Boss global data only): features from rounds 1..N, head labels from N+1.
CREATE TABLE build_examples (
  id                      BIGSERIAL PRIMARY KEY,
  run_id                  BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  feature_round_id        BIGINT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  label_round_id          BIGINT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  feature_schema_version  TEXT NOT NULL,
  target_version          TEXT NOT NULL,
  source                  TEXT NOT NULL,
  engine_version          TEXT NOT NULL,
  simulator_version       TEXT,
  features                JSONB NOT NULL,
  heads                   JSONB NOT NULL,
  is_valid                BOOLEAN NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (label_round_id, feature_schema_version, target_version)
);
CREATE INDEX build_examples_version_idx ON build_examples (feature_schema_version, target_version, engine_version);
