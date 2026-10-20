# V4 final report (2026-10-20)

Scope: three game modes, the UI for them, and a redesigned learning and prediction system. Online PvP is **deferred** (scope amendment) and was not implemented.

## Status

### Fully implemented and verified (automated tests + browser check on the test DB)

- **Mode architecture.**
  - Migration 004 is additive: `runs.mode`, `runs.profile_id`, plus the tables `learning_profiles`, `profile_observations` and `build_examples`. Every existing run became `prepared`.
  - Mode guards: PvP never calls `bossPrepare`; only Prepared runs feed `training_examples`/`build_examples`; only Learning runs write `profile_observations`.
- **Mode-select UI and routing.** Routes: `#/`, `#/prepared` (old `#/duel` kept), `#/learning`, `#/duel/:id`, `#/pvp`, `#/pvp/:id`. Covered by `routes.test.ts`.
- **Prepared Boss:** unchanged planner (regression target); all existing tests pass.
- **Learning Boss:**
  - profile with a random key (no accounts), start fresh (archive, nothing deleted), key isolation;
  - an observation after every completed round; a profile forecast used by the planner and stored per decision;
  - evidence-based insights with counts.
- **Local PvP:**
  - Player 2 is engine side `boss`, prepared through the same validated endpoints (`?side=boss`, PvP only);
  - hand-over screens, and the opponent's build hidden during preparation;
  - turn ownership enforced by the server; match result; no boss policy and no ML or profile data.
- **Next-build pipeline:**
  - heads, legal candidates, forecasters, `build_examples`, CSV snapshot, `train_build.py`;
  - whole-build evaluation (held-out runs and leave-one-agent-out);
  - the declared eligibility rule;
  - the oracle experiment and the Learning campaign evaluator.

### Implemented but not verified end to end
- The Learning Boss with **real humans**: only synthetic agents (labelled `synthetic`) and the test fixtures have exercised it.
- The UI on a phone, beyond the 375 px emulation (no overflow; PvP and Learning flows clicked through).

### Partially implemented
- **"Prepared Boss improves on the existing experience":** no V4 variant improved it measurably, so it keeps the V3 planner. See ML §14.

### Blocked
- Nothing.

### Deliberately deferred
- Online PvP (scope amendment).
- Activating the build model: it is ineligible and does not improve decisions.
- A planner that can exploit build knowledge: the next real lever, per the oracle results.

## Key results (all simulated, paired seeds, 95% CI over runs)

| Question | Result |
|---|---|
| Does the new model predict builds better than the baseline? | Held-out runs: joint log loss 0.581 vs persistence 1.750. Unseen families pooled: 1.726 vs 1.741 (≈). |
| Is it eligible? | **No.** Worst unseen family hybrid is +1.71 vs persistence (the limit is +0.10). |
| Can the planner use perfect build-type knowledge? | No: oracle heads −0.003 [−0.032, +0.026]. Exact build +0.025 [−0.010, +0.061]. The planner and mechanics are the bottleneck. |
| Does the model in the planner help? | No: −0.038 (V4 candidates), −0.008 (V3 builds reweighted). |
| Does the Learning Boss learn? | Its **prediction** does: joint log loss 2.83 cold → 1.54–1.57 after one run. Its **decisions** do not improve: tempered 0.3 −0.016 [−0.035, +0.004]; untempered −0.041. |

Full tables: `docs/ML_WALKTHROUGH.md` §14 and `artifacts/ml/v4/*.json`.

## Commands run (final state)

| Command | Result |
|---|---|
| `npx vitest run` (server) | 228/228 pass (21 files) |
| `npm test` (client) | 8/8 pass |
| `npx tsc --noEmit -p .` | clean (server and client) |
| `npm run build` (client) | OK |
| `npm run db:migrate` | applied 004 to dev after the backup `artifacts/backups/pre-v4-migration-2026-10-20.sql` |

Data, model and evaluation runs:
- `npm run sim -- --runs 320 --strategies saver,armourer,counter_builder,explorer,splitter --seed v4-build-1`: 320 runs, 0 failed.
- `npm run ml:v4-data -- build` / `train`: 11,664 rows → `artifacts/models/build-2026-10-20T09-00-41`.
- `npm run ml:v4-oracle -- --runs 8 --rounds 10 --seed v4-oracle [--model …]`.
- `npm run ml:v4-learning -- --campaign 4 --seed v4-learn --base v3 [--temper 0.3]`.

## Risks
- **Hidden information in PvP is hidden only by the local UI**, which is acceptable for hot-seat play. The server still validates every action.
- **Profiles are tied to browser storage.**
- **The Learning Boss's value for real players is unproven.** It needs human data, and the planner needs to be able to act on build knowledge.
