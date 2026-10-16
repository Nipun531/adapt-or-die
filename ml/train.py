"""
Training + evaluation script for The Boss Remembers (task: predict_next_round_player_mostly_ranged).

Called by the Node orchestrator (server/src/ml/training.ts, `npm run ml:train`), but it can also be run
by hand:
    python ml/train.py --dataset artifacts/datasets/v1_<stamp>.csv --out-dir artifacts/models/<version> --version <version>

Steps
 1. Load the exported CSV snapshot (only VALID, non-rule-determined rows of one feature-schema version are exported).
    Missing feature values (empty cells, e.g. "no attacks yet") stay NaN — XGBoost handles them natively (schema v2).
 2. Data checks: row count, distinct runs, class balance, missing values.
 3. GROUP-AWARE split by run_id (GroupShuffleSplit): every row of a run lands in train OR test, never both,
    so rounds of the same run cannot leak information across the split.
 4. Train an XGBoost binary classifier (gradient-boosted trees; small, fast, handles mixed-scale features
    without preprocessing).
 5. Evaluate on the held-out runs: accuracy, log loss, ROC AUC, Brier score — for the model AND for the
    transparent baseline probability stored on each row (same test rows, so the comparison is fair).
 5b. Leave-one-strategy-out (LOSO): train on all other player strategies, evaluate on the held-out one, for model and
    baseline — measures whether the model generalises beyond the scripted agents it saw (schema v2 / engine 2.0.0).
 6. Eligibility rule (see ELIGIBILITY below / docs/ML_WALKTHROUGH.md). A model that fails it is still saved
    for inspection but the server refuses to activate it.
 7. Save model.json (XGBoost native format) + metadata.json, print a JSON summary as the LAST stdout line.

This script never touches the database or game rules.
"""
import argparse
import json
import os
import sys
import time

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

# Columns written by server/src/ml/dataset.ts that are NOT model features.
PROVENANCE_COLS = ["example_id", "run_id", "feature_round_id", "label_round_id", "source", "player_strategy", "label", "baseline_probability"]

# Documented model-eligibility rule. Change here AND in docs/ML_WALKTHROUGH.md.
ELIGIBILITY = {
    "min_rows": 200,             # valid training rows in the snapshot
    "min_runs": 20,              # distinct runs (groups) in the snapshot
    "min_class_fraction": 0.05,  # each label must be at least 5% of rows
    "min_test_rows": 40,         # held-out rows needed for a meaningful evaluation
    # On the held-out runs the model must beat the baseline on log loss and not lose on accuracy.
    # Schema v2: when ≥ 3 strategies have ≥ loso_min_rows rows, the model's LOSO log loss must not be worse than the
    # baseline's on a majority of them (generalisation to an unseen play style).
    "loso_min_rows": 20,
}
# Baseline probability is null when the baseline had no evidence ("unknown"); for METRICS only it is scored as 0.5.
BASELINE_UNKNOWN = 0.5

PARAMS = {
    "n_estimators": 200,
    "max_depth": 3,
    "learning_rate": 0.05,
    "subsample": 0.9,
    "colsample_bytree": 0.9,
    "min_child_weight": 2,
    "objective": "binary:logistic",
    "eval_metric": "logloss",
}
TEST_FRACTION = 0.25
EPS = 1e-6


def metrics(y, p):
    p = np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)
    out = {
        "accuracy": float(accuracy_score(y, (p >= 0.5).astype(int))),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "brier": float(brier_score_loss(y, p)),
        "roc_auc": None,
    }
    if len(set(y)) == 2:
        out["roc_auc"] = float(roc_auc_score(y, p))
    return out


def emit(result):
    sys.stdout.write(json.dumps(result) + "\n")
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--engine-version", default="unknown", help="game-rules version of the rows in the dataset (provenance only)")
    args = ap.parse_args()

    df = pd.read_csv(args.dataset)
    if "player_strategy" not in df.columns:  # v1 snapshots
        df["player_strategy"] = ""
    df["player_strategy"] = df["player_strategy"].fillna("").astype(str).replace("", "unknown")
    df["baseline_probability"] = df["baseline_probability"].fillna(BASELINE_UNKNOWN)
    features = [c for c in df.columns if c not in PROVENANCE_COLS]
    n = len(df)
    runs = df["run_id"].nunique() if n else 0
    missing_values = int(df[features].isna().sum().sum()) if n else 0
    pos = int((df["label"] == 1).sum()) if n else 0
    neg = n - pos
    data_stats = {
        "rows": n, "distinct_runs": int(runs), "label_ranged": pos, "label_melee": neg,
        "missing_values": missing_values, "features": len(features),
        "source_distribution": df["source"].value_counts().to_dict() if n else {},
    }

    # Hard stop: training needs both classes and enough groups to split at all.
    if n < 10 or runs < 4 or pos == 0 or neg == 0:
        emit({"ok": False, "error": "Dataset too small or single-class — run more simulations before training", "data_stats": data_stats})
        return
    df[features] = df[features].astype(float)  # NaN = missing, kept (XGBoost native missing-value handling)

    gss = GroupShuffleSplit(n_splits=1, test_size=TEST_FRACTION, random_state=args.seed)
    train_idx, test_idx = next(gss.split(df, df["label"], groups=df["run_id"]))
    train, test = df.iloc[train_idx], df.iloc[test_idx]
    data_stats.update({
        "train_rows": int(len(train)), "test_rows": int(len(test)),
        "train_runs": int(train["run_id"].nunique()), "test_runs": int(test["run_id"].nunique()),
        "train_label_ranged": int(train["label"].sum()), "test_label_ranged": int(test["label"].sum()),
        "group_overlap": int(len(set(train["run_id"]) & set(test["run_id"]))),  # must be 0
        "split": f"GroupShuffleSplit(test_size={TEST_FRACTION}, groups=run_id, seed={args.seed})",
    })
    if train["label"].nunique() < 2:
        emit({"ok": False, "error": "Training split has a single class — run more varied simulations", "data_stats": data_stats})
        return

    t0 = time.time()
    model = xgb.XGBClassifier(**PARAMS, random_state=args.seed)
    model.fit(train[features], train["label"])
    training_seconds = time.time() - t0

    y = test["label"].to_numpy()
    p_model = model.predict_proba(test[features])[:, 1]
    m = metrics(y, p_model)
    b = metrics(y, test["baseline_probability"].to_numpy())

    # Leave-one-strategy-out generalisation check.
    loso = {}
    for strat, part in df.groupby("player_strategy"):
        rest = df[df["player_strategy"] != strat]
        if len(part) < ELIGIBILITY["loso_min_rows"] or rest["label"].nunique() < 2:
            continue
        lm = xgb.XGBClassifier(**PARAMS, random_state=args.seed)
        lm.fit(rest[features], rest["label"])
        yl = part["label"].to_numpy()
        loso[strat] = {
            "rows": int(len(part)),
            "ranged_share": float(yl.mean()),
            "model": metrics(yl, lm.predict_proba(part[features])[:, 1]),
            "baseline": metrics(yl, part["baseline_probability"].to_numpy()),
        }
    data_stats["loso"] = loso

    reasons = []
    ok = True

    def check(cond, good, bad):
        nonlocal ok
        reasons.append(("PASS: " + good) if cond else ("FAIL: " + bad))
        ok = ok and cond

    check(n >= ELIGIBILITY["min_rows"], f"{n} rows ≥ {ELIGIBILITY['min_rows']}", f"only {n} rows (< {ELIGIBILITY['min_rows']})")
    check(runs >= ELIGIBILITY["min_runs"], f"{runs} runs ≥ {ELIGIBILITY['min_runs']}", f"only {runs} runs (< {ELIGIBILITY['min_runs']})")
    minority = min(pos, neg) / n
    check(minority >= ELIGIBILITY["min_class_fraction"], f"minority class {minority:.1%} ≥ {ELIGIBILITY['min_class_fraction']:.0%}",
          f"minority class only {minority:.1%}")
    check(len(test) >= ELIGIBILITY["min_test_rows"], f"{len(test)} held-out rows ≥ {ELIGIBILITY['min_test_rows']}",
          f"only {len(test)} held-out rows")
    check(len(set(y)) == 2, "held-out set contains both classes", "held-out set has a single class")
    check(m["log_loss"] < b["log_loss"], f"log loss {m['log_loss']:.4f} < baseline {b['log_loss']:.4f}",
          f"log loss {m['log_loss']:.4f} not better than baseline {b['log_loss']:.4f}")
    check(m["accuracy"] >= b["accuracy"], f"accuracy {m['accuracy']:.3f} ≥ baseline {b['accuracy']:.3f}",
          f"accuracy {m['accuracy']:.3f} below baseline {b['accuracy']:.3f}")
    if len(loso) >= 3:
        wins = [s for s, v in loso.items() if v["model"]["log_loss"] <= v["baseline"]["log_loss"]]
        check(len(wins) * 2 > len(loso), f"leave-one-strategy-out: model ≤ baseline log loss on {len(wins)}/{len(loso)} unseen strategies",
              f"leave-one-strategy-out: model ≤ baseline on only {len(wins)}/{len(loso)} unseen strategies")
    else:
        reasons.append(f"SKIP: leave-one-strategy-out needs ≥ 3 strategies with ≥ {ELIGIBILITY['loso_min_rows']} rows (have {len(loso)})")

    os.makedirs(args.out_dir, exist_ok=True)
    model.get_booster().save_model(os.path.join(args.out_dir, "model.json"))
    importance = model.get_booster().get_score(importance_type="gain")
    top = sorted(importance.items(), key=lambda kv: -kv[1])[:15]
    result = {
        "ok": True,
        "version": args.version,
        "model_type": "xgboost.XGBClassifier",
        "xgboost_version": xgb.__version__,
        "params": {**PARAMS, "random_state": args.seed},
        "features": features,
        "metrics": m,
        "baseline_metrics": b,
        "data_stats": data_stats,
        "eligible": ok,
        "eligibility_rule": ELIGIBILITY,
        "eligibility_reasons": reasons,
        "feature_importance_gain": {k: float(v) for k, v in top},
        "training_seconds": training_seconds,
        "dataset": os.path.basename(args.dataset),
        "engine_version": args.engine_version,
    }
    with open(os.path.join(args.out_dir, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    emit(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # always answer with JSON so Node can report the error
        emit({"ok": False, "error": f"{type(e).__name__}: {e}"})
        sys.exit(1)
