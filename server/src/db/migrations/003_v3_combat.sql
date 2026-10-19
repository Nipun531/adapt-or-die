-- 003 — Version 3 combat (engine 3.0.0, docs/V3_IMPLEMENTATION_PLAN.md §F.2). ADDITIVE ONLY:
-- new nullable columns and widened CHECK lists. No existing row is updated or deleted; NULL in a new column means
-- "pre-V3 record" (V1/V2 attacks always hit, combatants had no stims).

-- Healing stims a combatant carries: {"stims": n, "slots": n, "effectiveness": n}. NULL = pre-V3 combatant (none).
ALTER TABLE combatants ADD COLUMN supplies JSONB;

-- V3 attack events: counters are their own events (kind 'counter', phase 'counter', parent_seq = the attack they
-- answer). defense = how the defender answered (block/dodge/none, chance, roll, counter roll); stun = meter changes.
ALTER TABLE combat_events ADD COLUMN kind TEXT CHECK (kind IN ('attack', 'counter'));
ALTER TABLE combat_events ADD COLUMN parent_seq INT;
ALTER TABLE combat_events ADD COLUMN defense JSONB;
ALTER TABLE combat_events ADD COLUMN stun JSONB;
ALTER TABLE combat_events DROP CONSTRAINT combat_events_phase_check;
ALTER TABLE combat_events ADD CONSTRAINT combat_events_phase_check
  CHECK (phase IN ('opening', 'regular', 'dex_bonus', 'counter'));

-- Things that happen between attacks (lost turns, stims used, the turn limit), in order, sharing the events' seq.
ALTER TABLE rounds ADD COLUMN combat_notes JSONB;
-- How a round ended: NULL = KO; 'turn_limit' = decided by the V3 turn limit (owner decision D-19).
ALTER TABLE rounds ADD COLUMN end_reason TEXT CHECK (end_reason IN ('turn_limit'));

-- Stim purchases and upgrades in the progression ledger.
ALTER TABLE progression_events DROP CONSTRAINT progression_events_kind_check;
ALTER TABLE progression_events ADD CONSTRAINT progression_events_kind_check
  CHECK (kind IN ('xp', 'gold', 'level_up', 'stat_allocation', 'purchase', 'equip', 'initial_points',
                  'stim_purchase', 'stim_slot_upgrade', 'stim_effectiveness_upgrade'));
