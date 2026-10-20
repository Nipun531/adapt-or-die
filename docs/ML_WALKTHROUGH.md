# ML Walkthrough — The Boss Remembers

This explains, for a beginner, what the machine-learning part does, what it does **not** do, and where to change it.

## 1. The task

**Predict whether the player will attack mostly with ranged attacks in the next round** (`ML_TASK = predict_next_round_player_mostly_ranged`).

Why this task: the plan asks for player-behaviour prediction with a lightweight tabular classifier (e.g. XGBoost) whose output actually
influences boss decisions. The most decision-relevant behaviour in this game is *how* the player will attack — ranged (DEX, opening shot,
piercing) or melee/unarmed (STR) — because the best counter-build differs sharply. A binary target is learnable from small data and
easy to evaluate honestly.

## 2. What is one training row?

One row = one **prediction moment**: "round N has just finished; round N+1 is about to start".

- **Features**: computed only from completed rounds 1..N (`server/src/ml/features.ts`, `buildFeatures(history)`).
- **Label (schema v2: the player's intended style)**: taken from round N+1 by `labelStyle`.
  - `1` if ranged attacks are ≥ 50% of the player's **non-opening** attacks. The opening shot is forced, and since engine 2.0.0 whether it happens depends on the boss's DEX, so it is not counted.
  - With no such attacks (killed before acting), a single-style loadout decides (ranged-only → 1, melee/unarmed-only → 0).
  - A Ranged+Melee player who never chose makes the row **invalid**.
  - Schema v1 counted all attacks, including the opening shot, and marked every no-attack round invalid.
- **Rule-determined rows**: `label_detail.rangedFeasible = false`, meaning the player could not field a ranged weapon at the prediction point. They are stored, but excluded from training and evaluation. The boss never asks the model in that case, and their label is always 0.
- **Provenance**: run id, feature round id, label round id, source (`manual` / `simulation`), engine version (game-rules version), simulator version, seed, feature schema version, timestamp.
- **baseline_probability**: what the transparent baseline predicted for this row — used only to compare against the model, never as a feature.

Rows are created automatically when a round completes (`ml/examples.ts → appendExample`) and are append-only
(`UNIQUE(label_round_id, feature_schema_version)`, `ON CONFLICT DO NOTHING`).

## 3. Prediction-time boundary (no leakage)

At prediction time the boss knows rounds 1..N only — including the player's **post-round** state of round N (level, stats after automatic
level-up increases, gold, inventory) but **not** what the player buys, allocates or equips before round N+1, and nothing about round N+1's fight.

- `buildFeatures` is a pure function that receives only the rounds-1..N array.
- `appendExample` explicitly slices `prior = rounds < labelRound`.
- Test `tests/integration/ml.test.ts › feature leakage boundary` plays two runs with the same seed where the player switches to a bow
  before round 2 in one of them: labels differ (0 vs 1) but the stored features **and** the boss's decision are identical.

## 4. Features (schema `v2`, 39 features)

| Group | Features |
|---|---|
| Timing | `next_round_number` |
| Player state after round N | `p_level`, `p_hp`, `p_str`, `p_def`, `p_dex`, `p_stat_points`, `p_gold`, `p_ranged_feasible`, `p_gold_minus_cheapest_ranged`, `p_owns_ranged`, `p_owns_melee`, `p_owns_shield` |
| Player loadout in round N | `last_has_ranged`, `last_has_melee`, `last_has_shield`, `last_armour_def`, `last_weapon_blade`, `last_weapon_blunt`, `last_weapon_polearm`, `last_weapon_bow`, `last_weapon_pierce_ev` |
| Behaviour history | `last_ranged_share`, `last_attacks`, `hist_mean_ranged_share`, `hist_ranged_round_frac` |
| Outcomes | `last_player_won`, `player_wins_total`, `player_loss_streak`, `last_player_hp_end_frac`, `last_boss_hp_end_frac` |
| Boss in round N | `last_boss_dmg_ranged_share`, `boss_eff_dex_last`, `boss_net_def_last`, `boss_net_atk_last`, `boss_has_ranged_last`, `boss_has_shield_last` |
| Player derived combat numbers | `p_eff_dex_last`, `p_net_atk_last` |

Changes from v1:
- The bow/crossbow affordability flags are replaced by catalogue-agnostic `p_ranged_feasible` and `p_gold_minus_cheapest_ranged`.
- The weapon family one-hot and `last_weapon_pierce_ev` (chance × DEF ignored) are added. They describe the player's *choice*, not luck.
- **Missing ≠ zero.** Shares are `null` when there is no evidence (no attacks / no known style). They are exported as empty CSV cells, and `train.py` and `infer_worker.py` keep them as NaN for XGBoost's native missing-value handling. v1 filled them with 0, which made "no attacks" look like "0% ranged".
- Pierce *outcome* features (success counts) are deliberately not included. Pierce success is a weighted coin flip that does not predict the player's next style, and the policy already prices pierce exactly through the combat engine.

## 5. Baseline / fallback

`baselineProbability(history)` in `features.ts`:

```
p = 0.5 × [last known round mostly ranged] + 0.5 × (known ranged rounds + 1) / (known rounds + 2)
```

Half "the player repeats what they just did", half a Laplace-smoothed historical frequency. The boss uses this whenever no eligible trained model is active or anything goes wrong, and **says why** (`fallbackReason`).

Engine 2.0.0 semantics (V2_DEMANDS §5):

| Situation | Before (V1) | Now |
|---|---|---|
| Round with no player attacks | counted as "0% ranged" | the loadout decides when it allows only one style; a Ranged+Melee player who never attacked is *unknown* and skipped (`roundStyle`) |
| No history | returned 0.5 | returns `null` (no evidence) |
| Player cannot field a ranged weapon next round (owns none, gold < 15) | ignored | returns 0, and the predictor short-circuits to `basis: 'rule'` (`rangedFeasibility`) |

**About the old "round-zero p = 0.5".** It was the value before round 1, when no round had been played. It was a placeholder, not an estimate: the player had 0 gold, so a ranged round was impossible. It never entered training, because examples start at label round 2. The 503 stored pre-2.0 round-1 decisions keep their 0.5. The UI labels them "older record — placeholder", and ML status counts only current-engine decisions.

## 6. Pipeline

`npm run ml:train` (or **Train + evaluate** in the ML Lab) runs `server/src/ml/training.ts → trainModel()`:

1. `buildMissingExamples()` — create any missing rows for the current schema from raw rounds (safe to re-run).
2. `exportDataset()` (`ml/dataset.ts`) — write valid rows **of the current feature schema and current engine version** to `artifacts/datasets/v1_e<engine>_<timestamp>.csv` + `.json`; record a `dataset_snapshots` row with engine version, counts, label/source distribution and the CSV's sha256. (`exportDataset(db, { engineVersion: '1.0.0' })` exports a historical rule set explicitly.)
3. Spawn `python ml/train.py --dataset <csv> --out-dir artifacts/models/<version> --version <version>`:
   - data checks (rows, runs, class balance, count of missing values, which are kept as NaN);
   - **group-aware split**: `GroupShuffleSplit(test_size=0.25, groups=run_id, seed=42)` — all rows of a run go to train *or* test (`group_overlap` must be 0);
   - `XGBClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.9, colsample_bytree=0.9, min_child_weight=2)`;
   - held-out metrics for the model **and** the baseline on the same rows: accuracy, log loss, ROC AUC, Brier. A `null` baseline (no evidence) is scored as 0.5 for metrics only;
   - **leave-one-strategy-out** (schema v2): for every player strategy with ≥ 20 rows, train on the others and evaluate on it, for model and baseline (`data_stats.loso`);
   - eligibility rule (below); saves `model.json` (XGBoost native) + `metadata.json` (params, metrics, data stats, feature importance).
4. Insert a `model_versions` row (version, engine version of its data, params, metrics, baseline metrics, data stats, eligibility, artifact path, training time).
5. Optional `--activate` (only if eligible).

Version names: `m<YYYYMMDD-HHMMSS>-s<snapshotId>`. Old versions and artifacts are never deleted automatically.

## 7. Model eligibility rule (`ELIGIBILITY` in `ml/train.py`)

A model can be activated only if **all** hold:

- ≥ 200 valid rows and ≥ 20 distinct runs in the snapshot;
- minority class ≥ 5% of rows;
- ≥ 40 held-out rows, and the held-out set contains both classes;
- held-out **log loss strictly lower than the baseline's**, and accuracy **not lower** than the baseline's;
- (schema v2) when ≥ 3 strategies qualify, leave-one-strategy-out log loss is **not worse than the baseline's on a majority** of them, so the model must generalise to a play style it never saw.

Metrics are computed on **feasible rows only** (rule-determined rows excluded), so they are not comparable with v1 numbers, which were inflated by those rows.

`activateModel()` refuses ineligible models, models of a different feature schema, and models trained on data from a different engine version. Tiny datasets (< 10 rows, < 4 runs or one class) are not trained at all.

## 8. Inference and the decision layer

```
history (rounds 1..N) → buildFeatures → predictPlayerStyle → choosePlan (policy) → applyPlan (rules) → boss_decisions row
```

- `ml/predictor.ts → predictPlayerStyle()` checks: features exist → an active model exists → it is eligible → its schema matches → its engine version matches →
  `model.json` exists → the Python worker loads it → scores the 34 features. Any failure → baseline with the reason. Timeout 15 s.
- The worker (`ml/infer_worker.py`) is a persistent process speaking JSON lines; it only scores feature vectors.
- `boss/policy.ts → choosePlan()` uses `pRanged` to weight the reachable-opponent scenarios (P over the ranged ones, 1 − P over the melee ones). `null` means styles are weighted equally.
  The model therefore changes which legal plan the boss picks, but every plan is enumerated from legal, affordable options and
  re-validated by `game/equipment.ts`. The model can never buy or allocate anything directly.
- Every `boss_decisions.predictor` stores `kind` (`model` / `fallback`), `basis` (`rule` / `unknown` / `model` / `baseline`, engine ≥ 2.0.0), `feasibility`, `modelVersion`, `probabilityRanged` (`null` = no evidence), `baselineProbability`,
  `fallbackReason` and the feature vector. The UI shows a green "Trained ML model vX" or amber "Transparent baseline (fallback)" badge per decision,
  and the ML Lab shows counts of model vs fallback decisions and the latest one.

There is **no online learning**: the model changes only when you train and activate a new version.

## 9. Data growth, retraining and versions

- Every completed manual round and every simulated round appends raw records and (from round 2) one training row.
- `npm run sim -- --runs 100` adds data; `npm run ml:status` shows counts; `npm run ml:train -- --activate` retrains.
- New data never changes the active model by itself.
- Changing game rules: bump `ENGINE_VERSION` (`game/constants.ts`); new rows carry it, old rows become historical, and you must retrain on new data.
- Changing features or labels: edit `features.ts`, **bump `FEATURE_SCHEMA_VERSION`**, run `npm run ml:build-dataset` (rebuilds rows for the new
  schema from raw records — old-schema rows stay), retrain. Models of an old schema automatically fall back (schema mismatch).
- Do not compare metrics across schema versions without noting the change.

### Engine 2.0.0 (Version 2)

Engine 2.0.0 changes the catalogue, the rewards, piercing and the opening shot. The data distribution therefore changes, and the existing guards apply:
- The active model `m20261010-200001-s2` was trained on engine 1.1.0 data, so it now **automatically falls back** to the transparent baseline, giving the reason "trained on engine 1.1.0 data".
- `ml:activate` refuses it.

The feature schema is still `v1`. Feature values for older runs resolve item ids against their own engine's catalogue (`buildFeatures(history, engineVersion)`), so rebuilding rows never crashes on removed items (Axe).

Schema v2 (Phase 6) is implemented: features (§4), label (§2), rule-determined rows excluded, NaN kept, and LOSO evaluation (§6–7).
- v1 rows and models are kept unchanged. Models of schema v1 fall back automatically (schema mismatch).
- `buildMissingExamples` builds v2 rows only for engine-2.0.0 runs. `{ allEngines: true }` builds them for older runs too, for analysis only: those rows keep their engine version and never enter a 2.0.0 snapshot.
- Training data and results: §10b.

### Game-rules (engine) versions and the initial stat points

Engine **1.1.0** gives both combatants 2 initial stat points before round 1 (`docs/GAME_MECHANICS.md` §1). Traced impact:

- **Feature and label definitions are unchanged** — same 34 features computed the same way from rounds 1..N, same label. The baseline formula is unchanged.
  So `FEATURE_SCHEMA_VERSION` stays `v1`.
- **The data distribution changes**: every player/boss attribute feature (`p_hp`, `p_str`, `p_def`, `p_dex`, `p_eff_dex_last`, `p_net_atk_last`,
  `boss_*`) now includes 2 extra allocation increments; round-1 fights are no longer mirror matches (first-attacker advantage no longer decides them),
  which changes win/loss streak features, gold timing, and when agents can afford a bow — i.e. the relationship between features and labels.
- Therefore rows are versioned by **engine version** (already stored on every training row): rows from engine 1.0.0 are kept as history but
  excluded from new snapshots; snapshots and models record the engine version of their data (migration 002); a model trained on 1.0.0 data
  automatically falls back ("trained on engine 1.0.0 data; current rules are engine 1.1.0") and cannot be activated.
- Model `m20261010-184500-s1` (snapshot 1, batches 1–3, engine 1.0.0) is retained, not deleted; it is historical. The replacement
  `m20261010-200001-s2` was trained on snapshot 2 (engine 1.1.0 only, batch 4), passed the eligibility rule and is active.
- Round-1 boss allocation is effectively deterministic: with no history the boss always faces the same assumed base player, so its policy
  picks the same split (currently +2 STR). It adapts from round 2 on, as before.

## 10. Honest limitations

- Current data is almost entirely **simulated**. Agents follow fixed strategies (`sim/agents.ts`), so a model trained on them mostly learns
  those strategies (e.g. "owns a bow and DEX was allocated → ranged"). High held-out scores on simulated data (e.g. engine 1.1.0 model `m20261010-200001-s2`:
  log loss 0.064 vs baseline 0.358, accuracy 96.8% vs 92.2%) do **not** mean it predicts humans that well. Manual rounds are tracked separately (`source = manual`).
- Rows where the player never attacked in the label round (killed before acting) are invalid and excluded: ~15% under engine 1.0.0,
  ~32% under engine 1.1.0 (the boss spends its initial points to strike first/harder, and boss win rates in simulations rose to 80–100%).
- The boss's decision quality also depends on the policy's scenario assumptions (hypothetical Bow/Sword) and its Monte-Carlo sample size.

## 10b. Engine 2.0.0 / schema v2 training run (2026-10-16)

**Data:** batch 5 `v2-train-1` on the dev DB, 320 runs × 10 rounds across all 8 agents (sim-2.0.0, boss policy v2, baseline predictor), with 0 failures. That gave 2,880 v2 rows:

| Rows | Count | Share |
|---|---:|---:|
| Invalid (Ranged+Melee player never chose) | 97 | 3.4% (V1 label: about 32% invalid) |
| Rule-determined (ranged impossible), excluded | 1,192 | 41% |
| **Feasible, valid → training snapshot `v2_e2.0.0_…`** (snapshot 3) | **1,591** | 55% |

Of the 1,591 training rows, 750 are labelled from attacks and 841 from the loadout (the player was killed before acting). 23% are ranged.

**Model `m20261016-220122-s3`** (XGBoost, same hyper-parameters):

| Held-out (GroupShuffleSplit by run) | Model | Baseline |
|---|---:|---:|
| Accuracy | 0.990 | 0.932 |
| Log loss | 0.027 | 0.288 |
| ROC AUC | 1.000 | 0.891 |

**Leave-one-strategy-out** (train on 7 agents, test on the 8th):

| Unseen strategy | Model log loss / acc | Baseline log loss / acc |
|---|---|---|
| adaptive | 1.31 / 0.79 | **0.63 / 0.83** |
| archer | 1.37 / 0.39 | **0.57 / 0.86** |
| duelist | **0.06** / 1.00 | 0.07 / 1.00 |
| hybrid | 0.28 / 0.85 | **0.08 / 0.99** |
| melee_bruiser | 0.76 / 0.75 | **0.07 / 1.00** |
| piercer | 0.57 / 0.67 | **0.07 / 1.00** |
| random | 1.02 / 0.74 | **0.23 / 0.91** |
| shield_turtle | **0.003** / 1.00 | 0.07 / 1.00 |

**Verdict: NOT eligible** (the new LOSO rule fails: the model beats the baseline on only 2 of 8 unseen strategies).
- The random split *looked* excellent because every agent appears in both train and test. The model mostly learns *which agent this is* (top gain features: `last_has_melee`, `hist_ranged_round_frac`, `p_level`, `p_str`), not *how a player decides*. On a style it has never seen it is worse than the transparent baseline.
- This is exactly the "metrics that reflect easy simulated data" risk from V2_DEMANDS §9. The LOSO rule now catches it.
- **No model was activated.** The boss keeps using the baseline. The old model `…-s2` is still marked active, but it falls back automatically (engine 1.1.0 data) and cannot be re-activated.

**What would make a model worthwhile:**
1. More varied play: seeded agent variants, more mixed/adaptive strategies, and above all **manual rounds**. Manual rows are tracked separately.
2. Agents that survive long enough to act. Today 53% of labels come from the loadout because the boss wins about 100% (V2_BALANCE §3/§6).
3. Retrain and re-check LOSO before any activation.

## 10c. Ensemble candidate and richer data (schema v3, 2026-10-16)

The user asked for an active model, but only through genuine adaptive performance: no weakened rules and no activation just to have one active. This section records everything tried.

### Data: from fixed personalities to conditional, randomised agents

| Batch | Runs | Agents | Why |
|---|---:|---|---|
| 5 `v2-train-1` (sim-2.0.0) | 320 | all 8 fixed-style agents | first V2 data |
| 6 `v2-train-2` (sim-2.1.0) | 240 | `opportunist` (goes ranged after a loss when a bow is affordable), `switcher` (35% seeded flip), adaptive, random | real style switches |
| 7 `v2-train-3` (sim-2.2.0) | 300 | **`reactive`** ×3, opportunist, switcher, adaptive | per-run randomised persona; style evolves from what it saw |

`reactive` draws its persona once per run from the run seed:
- the style it starts with;
- how many losses it takes before switching (1, 2, 3 or never);
- how often it counters the boss's **visible** gear from last round (boss had a bow → melee; boss had a shield or Heavy Armor → ranged);
- a noise rate;
- its melee weapon family;
- a third allocation stat.

Agents now also see the boss's last loadout and their own HP left. A human sees both in the round view.

**Decision-time only.** Features are still built from rounds 1..N (leakage test passes). Agents only use their own state and past round outcomes.

### Features, schema v3

Schema v3 adds persistence features: `hist_style_switches`, `last_style_streak`, `hist_feasible_rounds`, `hist_feasible_melee_rounds` and `hist_ranged_when_feasible`. They capture what a player did when a bow was within reach.

**Measured ceiling.** At the first round a player *can* afford a ranged weapon, whether they take it is 0% or 100% per agent (switcher 35%). No decision-time feature predicts that for a style never seen before.

### Evaluation (identical rows for every predictor)

| Predictor (snapshot 6: 4,646 feasible rows, 860 runs) | Held-out runs: log loss / acc | Unseen styles (LOSO) pooled: log loss / acc |
|---|---|---|
| Baseline only (w = 0) | 0.568 / 0.807 | 0.560 / 0.806 |
| Ensemble w = 0.3 (weight chosen on training runs) | **0.425** / 0.807 | 0.539 / 0.807 (nested, weight re-chosen per held-out style: 0.5601 vs 0.5603) |
| Ensemble w = 0.5 | 0.377 / 0.812 | 0.545 / 0.799 |
| Model only (w = 1) | **0.315 / 0.845** | 0.631 / 0.717 |

Full sweep: `artifacts/models/m20261016-223043-s6/ensemble.json` and the `ml:train` output.

### Boss decision outcomes (same seeded games; only the P(ranged) source differs)

| Predictor | Pooled boss HP margin per round | Boss win rate |
|---|---:|---:|
| Baseline | 0.661 | 91.5% |
| Model | 0.660 | 91.5% |
| Ensemble 0.3 | 0.659 | 91.5% |

Why the boss performs the same (480 paired rounds):
- 44% of rounds are rule-determined (P = 0 whatever the predictor).
- The model's P differs from the baseline's by more than 0.3 in only 7% of rounds.
- The boss's plan changes in 18% of rounds with the model and 4% with the ensemble, and those plans end with the same outcome.
- Under the V2 balance the hybrid Crossbow + melee build is the best answer to *both* styles (V2_BALANCE §2–4), so knowing the player's style barely changes the best plan.

### Eligibility of the ensemble candidate (its own rule, declared before the results)

| Rule | Result |
|---|---|
| Data rules (as for the pure model) | PASS |
| Weight ≥ 0.1, chosen on the training runs only | PASS (0.3) |
| Held-out runs: log loss < baseline, accuracy ≥ baseline | PASS (0.425 < 0.568; 0.807 = 0.807) |
| Unseen styles pooled (nested): log loss ≤ baseline | PASS (0.5601 ≤ 0.5603, a tie in practice) |
| No unseen style worse than baseline by more than +0.10 log loss | **FAIL** (melee_bruiser +0.150) |
| Boss decisions: pooled HP margin ≥ baseline − 0.01; unseen mirror style ≥ baseline − 0.02 | PASS (no measurable difference) |

**Verdict:**
- Pure model `m20261016-223043-s6`: **not eligible** (beats the baseline on only 3 of 11 unseen styles).
- Ensemble `m20261016-223043-s6-ens`: **not eligible** (one style regresses beyond the limit).
- **Nothing was activated, and no rule was changed after seeing the results.** Even a passing candidate would not have made the boss measurably better in these games.

The safeguards are unchanged and keep rollback:
- `activateModel` refuses ineligible models.
- `npm run ml:activate -- <version>` and `npm run ml:activate -- --none` switch models.
- Every decision stores its predictor and blend weight.

### What would make a model genuinely useful

1. **Balance first** (deferred list in V2_BALANCE): while one hybrid build answers both styles, predicting the style has nothing to act on. Once melee and ranged need different counters, the gap between the model and the baseline on held-out runs (0.315 vs 0.568) can turn into better boss decisions.
2. **Human play data.** Manual rounds are tracked separately (`source = 'manual'`). Unseen-style evaluation on real players is the real test.
3. Re-run `npm run ml:train`, which gives both candidates, the weight sweep and the decision outcomes. Activate only an eligible candidate.

## 11. V3 (engine 3.1.0, schema v4, 2026-10-20)

Question from the owner: under V2 the model proved nothing and the boss used the baseline. Is that fixed under V3? Answer: **no, and the evidence says no model of this task can fix it under the current rules.** Nothing was activated and no rule was changed.

### Data

| Batch | Runs | Agents | Rows (schema v4) |
|---|---:|---|---:|
| 8 `v3-ml-0` (sim-3.1.0) | 16 | all 16 agents | 144 |
| 9 `v3-ml-1` (sim-3.1.0) | 960 | all 16 agents, 60 runs each (incl. blocker, dodger, stunner, healer, counter_puncher) | 8,640 |

8,640 valid rows from 976 runs (labels: 1,362 ranged / 7,278 melee). After rule-determined rows are excluded, snapshot 7 has **5,693 rows**. The dev DB was backed up first (`artifacts/backups/pre-v3-ml-2026-10-20.sql`). Older-engine rows are untouched.

### Schema v4 (19 new features, 63 in total)

- The combat summary now records each side **as defender** under V3 (`SideCombatSummary.v3`):
  - blocks and dodges, and their successes;
  - undefended (stunned) attacks;
  - counters dealt and received;
  - stun gained and stuns suffered;
  - stims used and HP healed (from the round's notes).
- Features:
  - defence choices and their success: `last_block_share`, `hist_block_share`, `last_block_success`, `last_dodge_success`, `hist_block_success`, `hist_dodge_success`, `last_undefended`;
  - counters: `last_counters_dealt`, `last_counters_received`, `hist_counters_dealt_per_round`;
  - stun: `last_stun_gained`, `last_stuns_suffered`, `last_boss_stuns_suffered`;
  - stims: `last_stims_used`, `hist_stims_used`, `last_heal_frac`, `p_stims`, `p_stim_slots`, `p_stim_effectiveness`.
- All of them are `null` on v2 rounds (missing ≠ zero). The leakage boundary is unchanged: features come only from rounds 1..N.

### Fix to the decision check

`decisionOutcomes` used to play its seeded games under the default **V2** rules. It now plays the **live** rules (`LIVE_RULES`, engine 3.1.0). The verdict also prints a paired per-run Δ margin with a 95% CI. This line is informational; the pass/fail rule is unchanged.

### Results (`m20261020-133625-s7`, unchanged eligibility rules)

| Check | Model | Baseline | Result |
|---|---|---|---|
| Held-out runs: log loss / accuracy | **0.215** / 0.899 | 0.312 / 0.898 | PASS |
| Leave-one-strategy-out (unseen styles) | better on 4 / 16 | — | **FAIL** |
| Ensemble weight chosen on training runs | 0.0 (the model adds nothing on unseen styles) | — | **FAIL** (needs ≥ 0.1) |
| Unseen styles pooled, model only | 0.453 log loss | 0.294 | worse |
| Boss decisions, paired seeded games (102 runs) | margin 0.632, Δ −0.001 [−0.005, +0.004] | 0.632 | no measurable change |

Verdict:
- **Pure model:** not eligible.
- **Ensemble:** not eligible (its weight is 0, so it is the baseline).
- The model again learns the training personalities (strong on held-out runs) but does not generalise to unseen styles. Its plan changes alter the outcome in 26 of 102 runs, which net out to zero.

### Oracle upper bound (`npm run ml:oracle`, `artifacts/ml/oracle-oracle-v3.json`)

The oracle answers *could any predictor help?* The boss is told the truth before it prepares, on the same seeds (8 runs × 17 strategies × 10 rounds; the 95% CI is over runs):

| What the boss is told | Pooled margin | Δ vs baseline [95% CI] |
|---|---:|---|
| nothing (baseline) | 0.636 | — |
| the player's real **style** (exact P(ranged); the bound of this model) | 0.638 | +0.002 [−0.019, +0.023] |
| the player's real **defence habit** (in the boss's Monte-Carlo) | 0.623 | −0.013 [−0.030, +0.005] |
| the player's whole real **build** (stats, gear, style) | 0.679 | +0.044 [+0.005, +0.082] |

What this shows:
- **Even perfect knowledge of the player's style does not measurably help the boss.** The boss's plan is already robust to style: its builds answer both melee and ranged, so V2_BALANCE #9 still holds under V3.
- **A defence-style task (block-leaning vs dodge-leaning) has nothing to act on either.** Telling the boss the true defence habit does not improve it. The plan's suggested second task was therefore not built.
- **Only knowing the exact build helps,** and most of that gain is the mirror player (+0.43) and counter_puncher (+0.26). Those players' *stats and gear*, not their style, decide the fight.

### What would make a model genuinely useful

1. **A different target:** the player's next *build*, i.e. stat allocation and key gear (shield vs no shield, armour), not their style. The oracle shows this is where the leverage is (+0.044). It is a much harder, multi-output prediction. Any candidate faces the same strict rules plus the paired decision check with a CI above 0.
2. **Human play data.** All rows so far are simulated. Agents' styles are near-deterministic per persona, which is why held-out runs look good and unseen styles do not.
3. Until then the boss correctly uses the transparent baseline. `ml:status` reports this, and every decision records its fallback reason.

## 12. Debugging

- `npm run ml:status` — dataset counts, active model, Python availability, latest decision model-vs-fallback with reason.
- Round detail → "Boss pre-round decision" shows the prediction source, probability and fallback reason.
- `SELECT predictor FROM boss_decisions ORDER BY id DESC LIMIT 5;`
- `artifacts/models/<version>/metadata.json` — metrics, eligibility reasons, split sizes, feature importance.
- Python problems: set `PYTHON_BIN` in `.env` to an interpreter with `pip install -r ml/requirements.txt`.

## 13. Where to tweak

| What | Where |
|---|---|
| Features / schema version | `server/src/ml/features.ts` (`FEATURE_NAMES`, `buildFeatures`, `FEATURE_SCHEMA_VERSION`) |
| Label definition / threshold | `features.ts` (`isMostlyRanged`, `RANGED_LABEL_THRESHOLD`) |
| Dataset filters (schema + engine version) / leakage boundary | `server/src/ml/examples.ts`, `server/src/ml/dataset.ts` |
| Model + hyper-parameters | `ml/train.py` (`PARAMS`) |
| Train/test split | `ml/train.py` (`TEST_FRACTION`, `GroupShuffleSplit`) |
| Metrics / baseline | `ml/train.py` (`metrics`), `features.ts` (`baselineProbability`) |
| Eligibility rule | `ml/train.py` (`ELIGIBILITY`) |
| Inference / fallback | `server/src/ml/predictor.ts`, `ml/infer_worker.py` |
| Decision policy / legality | `server/src/boss/policy.ts` (`POLICY_CONFIG`), `server/src/game/equipment.ts` |
| Versions / artifacts / activation | `server/src/ml/training.ts`, `model_versions` table, `artifacts/models/` |

## 14. V4: next-build prediction (2026-10-20)

V3 showed that predicting *style* cannot help: the oracle gave +0.002. V4 changes the target to the player's **next build** and tests whether the planner can use it, before trusting any model. All numbers come from simulated agents.

### Target, data, pipeline

- **Heads.** `boss/build-heads.ts` splits a build into four parts:
  - `hands`: 7 legal hand combinations;
  - `family`: melee family;
  - `armour`: none / keep / upgrade;
  - `alloc`: the dominant stat of the round's points.
  Labels come from round N+1's actual snapshot; features only from rounds 1..N (`ml/build-features.ts`, schema `v4b1` = the 63 v4 features plus last-round and frequency columns per head).
- **Legal candidates.** `boss/candidates.ts` builds every legal next build through the real rules (`equipment.ts`), so impossible builds are never predicted. The true build is a legal candidate in 92–95% of rounds; the rest are split stat points or weaker-than-strongest purchases.
- **New agent families** (sim-4.0.0, `sim/agents-v4.ts`): `saver`, `armourer`, `counter_builder`, `explorer`, `splitter`. They are seeded per-run personas and react to results and to the boss's gear.
- **Data.** DB batch 10 `v4-build-1` (320 runs) and the 976 V3 runs feed `build_examples`: **11,664 rows from 1,296 runs**, Prepared runs only. Snapshot: `artifacts/datasets/build-v4b1-b1_2026-10-20T09-00-41-933Z.csv`. Old datasets are untouched.
- **Model.** `ml/train_build.py` trains one XGBoost multi-class model per head. It evaluates on held-out runs and leave-one-agent-out, never on random row splits, and writes out-of-fold predictions. `npm run ml:v4-data -- eval` scores whole builds among the legal candidates (joint log loss).

### Prediction quality (joint log loss of the true build among legal candidates; lower is better)

| Predictor | Held-out runs | Unseen agent families, pooled |
|---|---:|---:|
| uniform (rules only) | 2.822 | 2.828 |
| persistence baseline (per head: 0.5·last + 0.5·Laplace frequency) | 1.750 | 1.741 |
| XGBoost heads `build-2026-10-20T09-00-41` | **0.581** | 1.726 |

- On unseen families the model beats persistence on 13 of 21. It is much worse on hybrid (+1.71), random (+0.99), splitter (+0.84) and armourer (+0.71).
- **Eligibility** (declared in `sim/v4-data-cli.ts`; nothing was changed after seeing the results):
  - rows: PASS;
  - held-out runs: PASS;
  - unseen families pooled: PASS;
  - worst unseen family ≤ +0.10: **FAIL**.
- **Not eligible, not activated.** Same story as V3: it is strong on familiar personas and does not generalise.

### Mandatory oracle experiment (`npm run ml:v4-oracle`, `artifacts/ml/v4/oracle-v4-oracle*.json`)

Paired seeds: 8 runs × 22 strategies (21 agents + mirror) × 10 rounds. Δ is the boss's mean HP margin vs today's planner, with a 95% CI over runs.

| Condition | Δ margin [95% CI] |
|---|---|
| C0 V3 planner + P(ranged) baseline | — (margin 0.662, boss wins 90.0%) |
| C1 V4 candidates, uniform (ablation) | −0.040 [−0.065, −0.014] |
| C2 V4 candidates + persistence | −0.042 [−0.073, −0.010] |
| C3 V4 candidates + model | −0.038 [−0.068, −0.009] |
| C3′ V3 builds reweighted by model heads | −0.008 [−0.030, +0.014] |
| V3 builds reweighted by persistence | −0.003 [−0.025, +0.020] |
| **C4 oracle heads (true heads, evaluation only)** | −0.003 [−0.032, +0.026] |
| V3 builds reweighted by oracle heads | −0.003 [−0.035, +0.028] |
| C5 oracle exact build | +0.025 [−0.010, +0.061] (mirror +0.18) |

The first run, with the equal Monte-Carlo split, starved the likely build. It gave oracle heads −0.063. Fights are now proportional to weight for forecast scenarios.

**Reading.** Even *perfect* head knowledge does not change the boss's results, and exact-build knowledge helps only within noise, mainly against the mirror player. Per the brief, the bottleneck is **the planner and the mechanics**, not the predictor: the boss's builds already answer most builds, so knowing the next build has little to act on. The model improves the metrics but not the decisions, so **no gameplay improvement is claimed for the Prepared Boss.** It keeps the V3 planner. The fallback and the eligibility rule are unchanged.

### Learning Boss on synthetic campaigns (`npm run ml:v4-learning`, `artifacts/ml/v4/learning-*.json`)

Setup:
- 21 agents, each in a 4-run campaign against one profile (observations carry over), on paired seeds against a boss that never learns (uniform).
- **Synthetic fixtures, not humans.**
- `profileHeads` is a Dirichlet with a uniform prior, decay 0.8, ×2 for observations after the same result, and a learned repeat rate.

| | Full forecast | Tempered 0.3 (live) |
|---|---|---|
| Profile joint log loss by campaign run (cold ≈ 2.83–2.89) | 1.841 → 1.552 → 1.571 → 1.624 | 1.842 → 1.540 → 1.568 → 1.567 |
| Δ margin learning − cold | **−0.041 [−0.070, −0.011]** | −0.016 [−0.035, +0.004] |

What this shows:
- The prediction really learns. It is better than persistence (1.85) and improves after the first run.
- Acting on the full forecast narrowed the plan onto proxy builds and cost margin.
- The live Learning Boss therefore plans with 30% of its forecast and 70% uniform (`LEARNING_TEMPER` in `boss/prepare.ts`). Its decisions are then no worse than a non-learning boss within noise, but **not measurably better either**. The UI says only what is recorded (insights with counts) and never claims that the boss is winning more because it learned.
- **What would change this:**
  - a planner that can exploit build knowledge, i.e. richer scenario builds that match real purchases, or an exact-build target;
  - real human data, where personas are less rigid.
