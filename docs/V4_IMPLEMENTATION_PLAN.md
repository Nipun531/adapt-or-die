# The Boss Remembers — V4 Implementation Plan

Status (2026-10-20): **all phases done.** The results are in `docs/V4_REPORT.md` and `docs/ML_WALKTHROUGH.md` §14. Every claim in §1 was verified against the working tree (commit `22232b0`). Online PvP is **deferred** (scope amendment) and is not part of V4.

## 1. Verified current architecture

| Area | Verified state |
|---|---|
| Combat | Engine 3.1.0 (`game/combat.ts`, RuleSet v3). It is side-generic: `PendingChoice.side` and `provided.side` already let either side pause for a human. The v2 path is byte-identical. |
| Progression / economy | `game/progression.ts` and `game/equipment.ts` (allocate, buy, equip, supplies; all validated). Starting gold is 10. Stims cost 10. |
| Boss planner | `boss/policy.ts` `choosePlan`: it enumerates every legal boss plan, then pre-scores them analytically. The top plans and the best plan of each archetype are verified by Monte-Carlo against **reachable player scenarios**. Score = weighted expected HP margin, followed by a diversity draw inside a 0.03 band. |
| Opponent scenarios | `reachableScenarios(observed, pRanged)`: the player's last observed post-round state, × all unspent points into one stat, × the strongest affordable weapon per family (plus one bow). **Shield and armour are kept as observed; no armour/shield purchases, no split allocations.** The only learned input is `pRanged`, which is split evenly within each style. |
| Prediction | `ml/features.ts` (schema v4, 63 features), with the label "mostly ranged next round". The baseline is `0.5·last + 0.5·(k+1)/(n+2)`, 0 when ranged is infeasible, and null with no evidence (the boss then uses 50/50). XGBoost is trained in `ml/train.py` and run by the Python worker `ml/infer_worker.py`. Eligibility rule: held-out runs + leave-one-strategy-out (LOSO) + the ensemble rule + the paired decision check. |
| Model status | `m20261020-133625-s7` is **not eligible**: it beats the baseline on 4/16 unseen styles. The active row points at an engine-1.1.0 model, which is unusable, so the boss uses the baseline fallback. |
| Oracle (V3) | True style: +0.002 [−0.019, +0.023]. True defence habit: −0.013 [−0.030, +0.005]. **True exact build: +0.044 [+0.005, +0.082]** (`artifacts/ml/oracle-oracle-v3.json`). |
| Data | 976 V3 sim runs (batches 8 and 9) give 8,640 v4 rows; 5,693 remain after the rule-determined rows are excluded. The 16 agents are listed in `sim/agents.ts`. The DB runner is `sim/runner.ts`; the in-memory harness is `sim/balance.ts`. |
| Identity | **None.** There are no users, accounts or auth. `runs.source` is `manual`/`simulation`. All manual runs are anonymous. |
| Persistence | PostgreSQL migrations 001–003: `runs`, `combatants(side ∈ player/boss)`, `rounds`, `combat_events`, `progression_events`, `boss_analyses`, `boss_decisions`, `training_examples`, `dataset_snapshots`, `model_versions`. |
| Client | React 18 + Vite with hash routing: `#/duel`, `#/duel/:id`, `#/runs`, `#/sim`, `#/ml`. The duel UI is Lead-Light (Phase E). |
| Multiplayer | None. There are no sockets and no second human side. |

### Phase 1 baseline (recorded before V4 edits)

| Check | Result |
|---|---|
| Server tests | 209/209 pass (`npx vitest run`, after the glyph-name fix in 22232b0) |
| Client tests / typecheck / build | 5/5 pass; `tsc` clean; `vite build` OK |
| Boss win rate by agent (batch 9, 60 runs × 10 rounds each) | duelist 68.3%, healer 80.7%, counter_puncher 85.7%, adaptive 93.7%, melee_bruiser 94.3%, opportunist 94.8%, stunner 95.2%, piercer 95.5%, switcher 96.5%, reactive 96.7%, dodger 98.0%, archer 98.2%, blocker 98.7%, hybrid 98.7%, shield_turtle 98.8%, random 99.0% |
| P(ranged) held-out (rows of unseen runs) | model log loss 0.215 vs baseline 0.312 |
| P(ranged), unseen styles pooled | model 0.453 vs baseline 0.294 (the model generalises worse) |
| Planner + baseline vs oracles | as in the "Oracle (V3)" row above |

## 2. Limitations of the current learning system

1. **Wrong target.** Perfect P(ranged) knowledge does not change outcomes (oracle +0.002).
2. **The planner cannot use better information.** Scenarios never include armour or shield purchases, mixed stat splits or a melee-family switch, so even a perfect build predictor would have no candidate to put weight on.
3. **The model memorises personas.** The 16 agents are near-deterministic per persona, so held-out-run metrics flatter the model and unseen-style metrics expose it.
4. **One global prior for everybody.** Nothing is learned about an individual human across runs, and runs are anonymous.

## 3. Mode architecture

`runs.mode ∈ {prepared, learning, pvp}` (migration 004, default `prepared` → every existing run stays Prepared Boss).

| Mode | Opponent controller | Knowledge it may use | Writes |
|---|---|---|---|
| Prepared | `bossPrepare` → `choosePlan` with the **global forecaster** (eligible model, else the persistence baseline) | Rules, the catalogue and simulation-derived models | `boss_decisions`, `training_examples` / `build_examples` (global data) |
| Learning | `bossPrepare` → `choosePlan` with the **profile forecaster** (rules-only uniform prior + this profile's Dirichlet counts) | Rules, the catalogue and **this profile's observations only**. No model weights, no simulation data | `boss_decisions`, `profile_observations` (never the global tables) |
| PvP (local) | none: both sides are human (P1 = engine side `player`, P2 = side `boss`) | — | rounds/events only; no boss decision, analysis, examples or profile |

- One combat engine and one validation layer (`equipment.ts`).
- Mode checks live in the services:
  - `bossPrepare` refuses PvP;
  - `appendExample` writes only for Prepared runs;
  - profile updates happen only for completed Learning rounds whose source is `manual` or explicitly synthetic.

**Identity for Learning profiles.** Without auth, a profile is a server row with a random 128-bit `key`. The client keeps the key in `localStorage`, and every profile call must present it, so two browsers never merge. "Start fresh" archives the old profile (nothing is deleted) and issues a new key. Limitation (documented in the UI): clearing the browser storage loses access to the profile.

## 4. Prediction targets and pipeline (Part 3)

The target is **the next build**, decomposed along the player's real decisions. Each part (a "head") is a categorical label taken from round N+1's actual snapshot:

| Head | Classes |
|---|---|
| `hands` | `ranged`, `ranged_melee`, `ranged_shield`, `melee`, `melee_shield`, `shield`, `empty` (the legal hand combinations) |
| `family` | melee family of the main weapon: `blade`, `blunt`, `polearm`, `none` |
| `armour` | `none`, `keep` (same as last round), `upgrade` (new or better armour) |
| `alloc` | the stat that got most of this round's points: `str`, `def`, `dex`, `hp`, `none` |

How the pieces fit:
- **Legal candidates.** `boss/candidates.ts` builds every legal next build reachable from the observed state through the real rules (`equipment.ts`, the catalogue, gold, inventory). That is one candidate per (hands × family × armour × alloc) combination that is affordable. The concrete items are the strongest affordable ones jointly within the budget. An impossible build can never be predicted.
- **Forecast.** Each candidate's probability is the product of its head probabilities, renormalised over the legal candidates. The top-K by probability become the planner's scenarios.
- **Planner objective (documented and tested).** The objective is unchanged: the expected HP margin Σ p(c)·margin(plan, c) over the weighted candidates. Uncertainty enters through the spread of p, so a plan that is good only against the single most likely build loses expected value.
- **Forecasters:**
  - `uniform`: rules only; this is the Learning Boss cold start;
  - `persistence`: the baseline, per-head `0.5·[same as last] + 0.5·Laplace frequency`;
  - `model`: XGBoost `multi:softprob` per head on the schema-v4 features;
  - `profile`: a Dirichlet over each head, per context (after a win or a loss), with recency decay 0.8;
  - `oracle`: evaluation only.
- **Data.** New agent families make the data more varied: `saver`, `armourer`, `counter_builder`, `explorer` and `splitter`. All are seeded, and the simulator version is bumped. The new table `build_examples` holds features from rounds 1..N and head labels from round N+1. It is built from Prepared runs only, and the old tables stay untouched.
- **Evaluation.**
  - Splits: held-out runs, plus leave-one-agent-family-out.
  - Metrics: per-head log loss, Brier, ECE and top-1; joint log loss over legal candidates; exact-build hit@1/@3; partial match (hands + alloc).
  - Breakdowns: by round, with 95% CIs over runs.
- **Mandatory oracle experiment.** Paired seeds under the live rules, for all agents including the new ones and the mirror. Conditions:
  - C0: the current planner with the P(ranged) baseline;
  - C1: candidates + uniform (the ablation);
  - C2: candidates + persistence;
  - C3: candidates + model;
  - C4: candidates + oracle heads;
  - C5: oracle exact build (the V3 bound).
- **Eligibility of a build model (declared before the results).** All four must hold:
  - joint log loss below persistence on held-out runs **and** pooled unseen families;
  - no unseen family worse than persistence by more than +0.10;
  - on paired games, C3 is not worse than C2 by more than 0.01 margin;
  - activating it as the live forecaster also needs C3 vs C0 with a CI above 0, or the owner's explicit OK.
  An ineligible model is never activated, and there is no force flag.

## 5. Schema changes (migration 004, additive)

- `runs.mode TEXT NOT NULL DEFAULT 'prepared'` with a check, plus `runs.profile_id BIGINT NULL`.
- `combatants.side` keeps its values (P2 = `boss` in PvP; the UI labels it).
- New `learning_profiles(id, key UUID UNIQUE, name, status active/archived, created_at, archived_at)`.
- New `profile_observations(id, profile_id, run_id, round_id UNIQUE, round_number, context JSONB, heads JSONB, source, created_at)`.
- New `build_examples(id, run_id, feature_round_id, label_round_id UNIQUE per schema, feature_schema_version, target_version, features, heads, is_valid, source, engine_version, created_at)`.
- `boss_decisions.detail` gains `forecaster` and `forecast`; it already holds a JSONB rationale.

## 6. UI changes

- `#/` → **mode selection**: three cards (Prepared Boss, Learning Boss, PvP Arena (local)).
- `#/prepared` → today's start screen (the `#/duel` alias is kept).
- `#/learning` → profile setup: continue, start fresh (with its consequence explained), and "what the boss has learned", built from the stored counts.
- `#/pvp` → local match setup (player names, number of rounds).
- `#/duel/:id` serves Prepared and Learning runs. The mode chip and the learning insights come from the run's own mode.
- `#/pvp/:id` is the hot-seat match: a per-player Prepare with a **handoff screen** between players and before every pending decision of the other player, then the shared Fight stage and a result screen.

## 7. Phases and dependencies

1. Audit and baseline. **Done.**
2. Mode architecture: migration 004, mode guards, profile tables, isolation tests.
3. Mode-select UI and routing; Prepared Boss regression.
4. Candidates and forecasters, new agents, build_examples, `train_build.py`, oracle experiment, eligibility. Planner integration only as far as the evidence supports.
5. Learning Boss: observation capture, the profile forecaster, persistence, insights, synthetic-fixture campaign evaluation.
6. Local PvP: the service flow (both sides human), API side parameter, hot-seat UI, lifecycle tests.
7. Full verification, docs, PROGRESS, final report.

## 8. Acceptance criteria

- All existing tests stay green. New tests cover:
  - mode isolation, i.e. PvP never calls `bossPrepare`/`choosePlan`, writes no examples and no profile rows; Learning writes no `training_examples`/`build_examples`;
  - cold-start Learning profiles are empty;
  - profile resume and fresh start;
  - no merging across keys;
  - temporal alignment of build examples;
  - candidate legality;
  - forecaster fallbacks;
  - the PvP lifecycle (turn ownership, wrong-side answers rejected, completion).
- The oracle experiment is reported with CIs. A gameplay improvement is claimed only if a CI excludes 0.
- Learning Boss evaluation, on synthetic fixtures and labelled as such:
  - the profile forecaster's joint log loss falls with rounds observed;
  - it adapts after a strategy switch (recency);
  - paired boss margin of profile vs uniform is reported per agent family.

## 9. Risks and open decisions

- **Planner cost.** A richer candidate set means more Monte-Carlo fights. The fight budget per plan is kept, and only the top-K candidates by probability are simulated.
- **No real human data yet.** Learning is verified on synthetic fixtures only, and the UI never claims more.
- **PvP hidden information is client-side only** (local hot-seat). The server still validates every action and resolves combat.
- **Deferred:** online PvP; any difficulty knob (none was added: difficulty comes only from what the boss knows).
