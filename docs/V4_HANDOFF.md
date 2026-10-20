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

## Phase 4: in progress (uncommitted)

New files:
- `boss/build-heads.ts`: heads hands/family/armour/alloc.
- `boss/candidates.ts`: legal next builds.
- `boss/forecast.ts`: uniform, persistence, profile and oracle forecasters.
- `ml/build-features.ts`: schema `v4b1`.
- `ml/build-examples.ts`: `build_examples` rows and the CSV export.
- `ml/build-predictor.ts`: head models through the Python worker (`load_named`/`predict_named`).
- `ml/train_build.py`.
- `sim/agents-v4.ts`: five new families (sim-4.0.0).
- `sim/v4-oracle-cli.ts` (`npm run ml:v4-oracle`).
- `sim/v4-data-cli.ts` (`npm run ml:v4-data -- build|export|train|eval`).
- `sim/stats.ts`.
- `tests/unit/v4-forecast.test.ts`.

Changed:
- `policy.ts`:
  - `forecastScenarios`;
  - `opponents` input;
  - weight-proportional Monte-Carlo fights for forecast scenarios;
  - `reweightReachable`.
- `balance.ts`: the predictor may answer `{heads}`; it gets `historyHeads`; `oracle.heads`; `scenarioBase`.

### Oracle run 1 (`artifacts/ml/v4/oracle-v4-oracle.json`, 16 agents + mirror)

Planning against legal V4 candidates lost to the V3 planner, even with the true heads:

| Condition | Δ vs V3 planner [95% CI] |
|---|---|
| uniform | −0.039 [−0.072, −0.006] |
| persistence | −0.054 |
| oracle-heads | −0.063 |
| oracle-build | +0.037 [−0.009, +0.082] |

- Suspected cause: the equal Monte-Carlo split over 18 scenarios. A fix was added (weight-proportional fights, pruning by probability mass).
- Run 2 is in progress → `scratchpad/v4-oracle2.log`. It now covers 21 agents and adds the `v3w-*` variants, which reweight the V3 builds by head probabilities.
- Forecast quality on the V3-planner games: the true build is a legal candidate in 94.9% of rounds. Joint log loss is 1.905 for persistence vs 2.889 for uniform.

### Data
- `build_examples` holds 10,467 rows from 1,163 runs.
- The DB sim batch `v4-build-1` (5 new families × 64 runs) is running. When it finishes, re-run `ml:v4-data -- build`, then `train`.

## Next
1. Read oracle run 2. Pick the scenario base (v4 or v3w) on the evidence.
2. Run `ml:v4-data -- train`, then `ml:v4-oracle -- --model <dir>`.
3. Commit.
4. Phase 5: the Learning Boss profile forecaster in `boss/prepare.ts`. It needs `services/learning.ts` `loadObservations` → `profileHeads` → `forecastScenarios`. Then campaign evaluation on synthetic fixtures.
5. Phase 7 docs and the final report.
