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

## 11. Debugging

- `npm run ml:status` — dataset counts, active model, Python availability, latest decision model-vs-fallback with reason.
- Round detail → "Boss pre-round decision" shows the prediction source, probability and fallback reason.
- `SELECT predictor FROM boss_decisions ORDER BY id DESC LIMIT 5;`
- `artifacts/models/<version>/metadata.json` — metrics, eligibility reasons, split sizes, feature importance.
- Python problems: set `PYTHON_BIN` in `.env` to an interpreter with `pip install -r ml/requirements.txt`.

## 12. Where to tweak

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
