# V2 Baseline — V1 Reference Numbers (engine 1.1.0)

Recorded on 2026-10-16, before any V2 code change (commit `d034d0e`). It is the reference point for comparing V1 with V2.

## Safety

| Item | Value |
|---|---|
| Git | `d034d0e` on `main`, pushed to `github.com/Nipun531/adapt-or-die` |
| DB backup | `artifacts/backups/pre-v2-2026-10-16.sql` (git-ignored), 83,953,426 bytes, sha256 `a12cba1b4ec40bf1a8b73bd046500c621ae188923a1c350994f0a32615380248` |
| Restore | `docker exec -i boss-remembers-db psql -U boss boss_remembers < artifacts/backups/pre-v2-2026-10-16.sql` (into an empty DB) |
| Tests | `npm test` → **88/88 passed** (7 files, 81 s). The "80 passing" in `PROGRESS.md` §8 was stale. |
| Typecheck | `npm run typecheck` clean |

## Dev DB contents

| Engine | Source | Status | Runs |
|---|---|---|---:|
| 1.0.0 | manual | active (#253) | 1 |
| 1.0.0 | manual | completed | 1 |
| 1.0.0 | simulation | completed | 258 |
| 1.1.0 | manual | active (#389) | 1 |
| 1.1.0 | manual | completed | 2 |
| 1.1.0 | simulation | completed | 240 |

Active model: `m20261010-200001-s2` (engine 1.1.0).

## Engine 1.1.0 behaviour (read-only SQL)

**Boss win rate by agent:**

| Agent | Boss win rate |
|---|---:|
| archer | 100% |
| shield_turtle | 100% |
| random | 97.3% |
| hybrid | 91.8% |
| adaptive | 83.5% |
| melee_bruiser | 80.0% |

**Round 1:** the boss won 239 of 243 fights.

**Boss round-1 allocation:** +2 STR in 243 of 243 runs. The predictor gave p = 0.5 every time, because there is no history before round 1.

**Boss allocations over all rounds:**

| Allocation | Count |
|---|---:|
| none (no points to spend) | 1,461 |
| +1 DEX | 400 |
| +2 STR | 243 |
| +1 STR | 243 |
| +1 DEF | 71 |

**Boss loadout in round 10:**

| Loadout | Count |
|---|---:|
| Rapier + Crossbow + Leather | 121 |
| Greatsword + Crossbow + Leather | 93 |
| Other | 26 |

**Opening shots per round:**

| Opening shots | Rounds |
|---|---:|
| 0 | 765 |
| 1 | 1,070 |
| 2 | 583 (24%) |

**Pierce:**
- Player: 208 of 822 attempts succeeded.
- Boss: 461 of 1,604 attempts succeeded.
- Ranged attacks only.

**Training snapshot** (1,476 valid rows):
- 528 rows (36%) were ones where the player could not field a ranged weapon. All of them are labelled 0.
- 146 rows had `last_attacks = 0`.
- Invalid rows: about 32%.

## Economy (V1 rules: win 50 XP / 10 gold, loss 20 XP / 4 gold, level-up +25 gold)

| Pattern | Round 3 (level / gold) | Round 5 | Round 10 |
|---|---|---|---|
| Always win | 2 / 55 | 3 / 100 | 5 / 200 |
| Always lose | 1 / 12 | 2 / 45 | 2 / 65 |
| Alternate | 2 / 49 | 2 / 63 | 4 / 145 |
