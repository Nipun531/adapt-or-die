-- 002_initial_stat_points.sql — engine 1.1.0: both combatants start a run with 2 unallocated stat points.
-- Additive, non-destructive:
--  1. progression_events may record the one-time grant ('initial_points', actor 'rules') written at run creation.
--  2. dataset_snapshots / model_versions record the ENGINE VERSION of the data they contain, so data produced under
--     different rules is never mixed silently and a model trained on old-rule data is not used for new-rule runs.
--     Every snapshot/model that existed before this migration was built from engine 1.0.0 data (1.1.0 did not exist),
--     so NULLs are backfilled with '1.0.0'. No rows are deleted or rewritten otherwise.

ALTER TABLE progression_events DROP CONSTRAINT progression_events_kind_check;
ALTER TABLE progression_events ADD CONSTRAINT progression_events_kind_check
  CHECK (kind IN ('xp','gold','level_up','stat_allocation','purchase','equip','initial_points'));

ALTER TABLE dataset_snapshots ADD COLUMN engine_version TEXT;
UPDATE dataset_snapshots SET engine_version = '1.0.0' WHERE engine_version IS NULL;
ALTER TABLE dataset_snapshots ALTER COLUMN engine_version SET NOT NULL;

ALTER TABLE model_versions ADD COLUMN engine_version TEXT;
UPDATE model_versions SET engine_version = '1.0.0' WHERE engine_version IS NULL;
ALTER TABLE model_versions ALTER COLUMN engine_version SET NOT NULL;

CREATE INDEX training_examples_engine_idx ON training_examples (feature_schema_version, engine_version, is_valid);
