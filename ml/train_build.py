"""
V4 next-build head models (docs/V4_IMPLEMENTATION_PLAN.md §4) — one XGBoost multi-class model per head.

  python ml/train_build.py --dataset <csv> --out-dir <dir> --classes '<json {head: [classes]}>' [--seed 42]

Evaluation (no random row splits — rows of one run are never on both sides):
  heldout  25% of RUNS held out (seeded); model trained on the rest
  loao     leave-one-agent-out: for every agent family, train on all OTHER families, predict that one
Per head, for model / persistence / uniform: log loss (with the same 0.02 floor the planner uses), multi-class Brier,
top-1 accuracy and expected calibration error (10 bins on the top probability). Out-of-fold probabilities are written
to oof.csv so the Node evaluator can score whole builds among the legal candidates. Final models are fitted on all
rows and listed in heads.json (features, class order, files) for inference.
"""
import argparse
import json
import os
import time

import numpy as np
import pandas as pd
import xgboost as xgb

FLOOR = 0.02
PARAMS = dict(n_estimators=200, max_depth=4, learning_rate=0.08, subsample=0.9, colsample_bytree=0.8, min_child_weight=2,
              reg_lambda=1.0, tree_method="hist")


def norm(p):
    p = np.maximum(p, FLOOR)
    return p / p.sum(axis=1, keepdims=True)


def metrics(y, p):
    """y: int class index (n,), p: (n, K) probabilities (already floored)."""
    n, k = p.shape
    if n == 0:
        return None
    ll = float(-np.mean(np.log(p[np.arange(n), y])))
    onehot = np.zeros_like(p)
    onehot[np.arange(n), y] = 1
    brier = float(np.mean(np.sum((p - onehot) ** 2, axis=1)))
    top = p.argmax(axis=1)
    acc = float(np.mean(top == y))
    conf = p.max(axis=1)
    bins = np.linspace(0, 1, 11)
    ece = 0.0
    for lo, hi in zip(bins[:-1], bins[1:]):
        m = (conf > lo) & (conf <= hi)
        if m.any():
            ece += m.mean() * abs(float(np.mean(top[m] == y[m])) - float(np.mean(conf[m])))
    return {"rows": int(n), "log_loss": ll, "brier": brier, "top1": acc, "ece": float(ece)}


def persistence(df, head, classes):
    cols = []
    for c in classes:
        last = df[f"last_{head}_{c}"].astype(float).fillna(1.0 / len(classes)).to_numpy()
        freq = df[f"freq_{head}_{c}"].astype(float).to_numpy()
        cols.append(0.5 * last + 0.5 * freq)
    return norm(np.vstack(cols).T)


def fit_predict(train, test, feats, y_train, k, seed):
    present = np.unique(y_train)
    if len(present) == 1:  # a single class in training: the model can only say that class
        p = np.zeros((len(test), k))
        p[:, present[0]] = 1
        return norm(p), None
    remap = {c: i for i, c in enumerate(present)}
    m = xgb.XGBClassifier(objective="multi:softprob", num_class=len(present), random_state=seed, **PARAMS)
    m.fit(train[feats], np.array([remap[c] for c in y_train]))
    sub = m.predict_proba(test[feats]) if len(test) else np.zeros((0, len(present)))
    p = np.zeros((len(test), k))
    p[:, present] = sub
    return norm(p), (m, present)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--classes", required=True)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    t0 = time.time()
    classes = json.loads(a.classes)
    df = pd.read_csv(a.dataset)
    prov = ["example_id", "run_id", "feature_round_id", "label_round_id", "source", "simulator_version", "player_strategy", "label_round_number"]
    ycols = [f"y_{h}" for h in classes]
    feats = [c for c in df.columns if c not in prov and c not in ycols]
    df[feats] = df[feats].astype(float)
    os.makedirs(a.out_dir, exist_ok=True)

    rng = np.random.default_rng(a.seed)
    runs = df["run_id"].unique()
    rng.shuffle(runs)
    test_runs = set(runs[: max(1, len(runs) // 4)])
    is_test = df["run_id"].isin(test_runs).to_numpy()
    agents = sorted(df["player_strategy"].unique())

    report = {"rows": int(len(df)), "runs": int(len(runs)), "features": len(feats), "agents": agents, "heads": {}}
    oof = {"heldout": pd.DataFrame({"example_id": df.loc[is_test, "example_id"].to_numpy()}),
           "loao": pd.DataFrame({"example_id": df["example_id"].to_numpy()})}
    manifest = {"features": feats, "heads": {}, "target_version": None}
    for h, cl in classes.items():
        k = len(cl)
        y = df[f"y_{h}"].map({c: i for i, c in enumerate(cl)}).to_numpy()
        hr = {}
        # held-out runs
        pm, _ = fit_predict(df[~is_test], df[is_test], feats, y[~is_test], k, a.seed)
        pp = persistence(df[is_test], h, cl)
        pu = np.full((int(is_test.sum()), k), 1.0 / k)
        hr["heldout"] = {"model": metrics(y[is_test], pm), "persistence": metrics(y[is_test], pp), "uniform": metrics(y[is_test], pu)}
        for i, c in enumerate(cl):
            oof["heldout"][f"p_{h}_{c}"] = pm[:, i]
        # leave-one-agent-out
        loao_p = np.zeros((len(df), k))
        by_agent = {}
        for g in agents:
            te = (df["player_strategy"] == g).to_numpy()
            pm_g, _ = fit_predict(df[~te], df[te], feats, y[~te], k, a.seed)
            loao_p[te] = pm_g
            by_agent[g] = {"model": metrics(y[te], pm_g), "persistence": metrics(y[te], persistence(df[te], h, cl))}
        hr["loao"] = {"pooled": {"model": metrics(y, loao_p), "persistence": metrics(y, persistence(df, h, cl)),
                                 "uniform": metrics(y, np.full((len(df), k), 1.0 / k))}, "byAgent": by_agent}
        for i, c in enumerate(cl):
            oof["loao"][f"p_{h}_{c}"] = loao_p[:, i]
        # final model on all rows
        _, fitted = fit_predict(df, df.iloc[:0], feats, y, k, a.seed)
        if fitted is not None:
            m, present = fitted
            fname = f"head_{h}.json"
            m.save_model(os.path.join(a.out_dir, fname))
            manifest["heads"][h] = {"model": fname, "classes": [cl[i] for i in present]}
            gain = m.get_booster().get_score(importance_type="gain")
            hr["top_features"] = sorted(gain.items(), key=lambda x: -x[1])[:8]
        report["heads"][h] = hr
    oof["heldout"].to_csv(os.path.join(a.out_dir, "oof_heldout.csv"), index=False)
    oof["loao"].to_csv(os.path.join(a.out_dir, "oof_loao.csv"), index=False)
    with open(os.path.join(a.out_dir, "heads.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    report["training_seconds"] = time.time() - t0
    report["params"] = PARAMS
    with open(os.path.join(a.out_dir, "metrics.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps({"ok": True, "out_dir": a.out_dir, "seconds": report["training_seconds"]}))


if __name__ == "__main__":
    main()
