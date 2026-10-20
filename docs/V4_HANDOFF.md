# V4 handoff (live notes — update at the end of every phase)

Read `docs/V4_IMPLEMENTATION_PLAN.md` first.

Owner rules:
- never delete data;
- no Co-Authored-By trailer on commits;
- ask before pushing;
- never activate an ineligible model;
- use the test DB for UI smoke tests;
- talk to the owner in caveman style.

## Done (committed on main, not pushed)

| Commit | What |
|---|---|
| 4686f63 | Phases 1–2: migration 004 (`runs.mode`, `profile_id`, `learning_profiles`, `profile_observations`, `build_examples`); `services/profiles.ts`, `services/learning.ts`; mode guards; PvP service flow; `tests/integration/modes.test.ts` (8 tests) |
| a190615 | Phase 3 + PvP UI: `views/ModeSelect`, `LearningView`, `PvpView`; `routes.ts` + its tests; Fight `names` prop; Armory `side`/`pvp` props |

- Migration 004 is applied to the dev DB. Backup: `artifacts/backups/pre-v4-migration-2026-10-20.sql`.
- Earlier unpushed commits: 4d38e3c (Phase E UI) and 22232b0 (V3 ML check).

## V4 complete
- See `docs/V4_REPORT.md`.
- The live Learning Boss uses the profile forecast tempered at 0.3 (`LEARNING_TEMPER`, `LEARNING_SCENARIO_BASE = 'v3'` in `boss/prepare.ts`).
- The build model `artifacts/models/build-2026-10-20T09-00-41` is ineligible and not wired live.
- Nothing has been pushed. Ask the owner first.

## Next ideas
- A planner that can act on build knowledge: richer scenario builds, or an exact-build target.
- Collect human Learning Boss data and re-run `ml:v4-learning` on it.
- Online PvP (deferred).
