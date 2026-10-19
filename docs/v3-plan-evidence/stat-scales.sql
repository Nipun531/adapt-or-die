\pset footer off
-- per-fighter derived stats at round start, engine 2.0.0, by round bucket
WITH f AS (
  SELECT r.round_number, s.side,
    (s.snap->'derived'->>'effDex')::float dex, (s.snap->'derived'->>'netDef')::float def,
    (s.snap->'derived'->>'netAtk')::float atk, (s.snap->'derived'->>'maxHp')::float hp,
    (s.snap->'stats'->>'def')::float rawdef, (s.snap->'stats'->>'dex')::float rawdex
  FROM rounds r CROSS JOIN LATERAL (VALUES ('player', r.player_snapshot), ('boss', r.boss_snapshot)) s(side, snap)
  WHERE r.engine_version='2.0.0' AND r.status='completed')
SELECT CASE WHEN round_number<=2 THEN '1-2' WHEN round_number<=5 THEN '3-5' ELSE '6-10' END rb, side,
  round(percentile_cont(0.1) within group (order by dex)::numeric,1) dex_p10, round(percentile_cont(0.5) within group (order by dex)::numeric,1) dex_p50, round(percentile_cont(0.9) within group (order by dex)::numeric,1) dex_p90,
  round(percentile_cont(0.5) within group (order by rawdef)::numeric,1) rawdef_p50,
  round(percentile_cont(0.1) within group (order by def)::numeric,1) netdef_p10, round(percentile_cont(0.5) within group (order by def)::numeric,1) netdef_p50, round(percentile_cont(0.9) within group (order by def)::numeric,1) netdef_p90, round(max(def)::numeric,1) netdef_max,
  round(percentile_cont(0.5) within group (order by atk)::numeric,1) atk_p50, round(percentile_cont(0.9) within group (order by atk)::numeric,1) atk_p90,
  round(percentile_cont(0.5) within group (order by hp)::numeric,0) hp_p50, count(*) n
FROM f GROUP BY 1,2 ORDER BY 1,2;
-- |effDex delta| per round
SELECT round(percentile_cont(0.5) within group (order by d)::numeric,1) d_p50, round(percentile_cont(0.9) within group (order by d)::numeric,1) d_p90, round(max(d)::numeric,1) d_max, count(*) FILTER (WHERE d>=15) ge15, count(*) FILTER (WHERE d>=50) ge50, count(*) n
FROM (SELECT abs((player_snapshot->'derived'->>'effDex')::float-(boss_snapshot->'derived'->>'effDex')::float) d FROM rounds WHERE engine_version='2.0.0' AND status='completed') x;
-- hits per round, damage per hit / defender max hp
SELECT round(avg(attack_count)::numeric,1) attacks_avg, round(percentile_cont(0.5) within group (order by attack_count)::numeric,0) attacks_p50, round(percentile_cont(0.9) within group (order by attack_count)::numeric,0) attacks_p90 FROM rounds WHERE engine_version='2.0.0' AND status='completed';
SELECT round(percentile_cont(0.5) within group (order by e.damage/ NULLIF((CASE e.defender WHEN 'player' THEN r.player_snapshot ELSE r.boss_snapshot END)->'derived'->>'maxHp','')::float)::numeric,3) dmg_frac_p50,
 round(percentile_cont(0.9) within group (order by e.damage/ NULLIF((CASE e.defender WHEN 'player' THEN r.player_snapshot ELSE r.boss_snapshot END)->'derived'->>'maxHp','')::float)::numeric,3) dmg_frac_p90,
 round(avg((e.calc->>'mitigation')::float)::numeric,3) mit_avg, round(avg(((e.calc->>'mitigation')::float>0)::int)::numeric,3) mit_share
FROM combat_events e JOIN rounds r ON r.id=e.round_id WHERE r.engine_version='2.0.0';
-- boss vs player win by source
SELECT r2.source, count(*) rounds, round(avg((r.winner='boss')::int)::numeric,3) boss_win FROM rounds r JOIN runs r2 ON r2.id=r.run_id WHERE r.engine_version='2.0.0' AND r.status='completed' GROUP BY 1;
SELECT r2.player_strategy, count(*) rounds, round(avg((r.winner='boss')::int)::numeric,3) boss_win FROM rounds r JOIN runs r2 ON r2.id=r.run_id WHERE r.engine_version='2.0.0' AND r.status='completed' GROUP BY 1 ORDER BY 3;
