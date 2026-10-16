"""
Persistent inference worker for The Boss Remembers.

The Node server spawns this once and talks to it over stdin/stdout with one JSON object per line:
  {"cmd": "load", "model_path": ".../model.json", "features": ["f1", ...]}  -> {"ok": true}
  {"cmd": "predict", "features": {"f1": 1.0, ...}}                        -> {"ok": true, "probability": 0.73}
  {"cmd": "ping"}                                                          -> {"ok": true, "xgboost": "2.0.3"}
Any failure is returned as {"ok": false, "error": "..."}; Node then falls back to the baseline.
The worker never touches the database or game rules — it only scores feature vectors.
"""
import json
import sys

import numpy as np
import xgboost as xgb

booster = None
feature_names = None


def handle(msg):
    global booster, feature_names
    cmd = msg.get("cmd")
    if cmd == "ping":
        return {"ok": True, "xgboost": xgb.__version__}
    if cmd == "load":
        b = xgb.Booster()
        b.load_model(msg["model_path"])
        booster = b
        feature_names = list(msg["features"])
        return {"ok": True}
    if cmd == "predict":
        if booster is None:
            return {"ok": False, "error": "no model loaded"}
        feats = msg["features"]
        missing = [f for f in feature_names if f not in feats]
        if missing:
            return {"ok": False, "error": f"missing features: {missing[:5]}"}
        # null = missing (schema v2) → NaN, which XGBoost treats as a missing value, exactly as in training.
        row = np.array([[np.nan if feats[f] is None else float(feats[f]) for f in feature_names]], dtype=np.float32)
        prob = float(booster.predict(xgb.DMatrix(row, feature_names=feature_names))[0])
        return {"ok": True, "probability": prob}
    return {"ok": False, "error": f"unknown cmd {cmd!r}"}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            out = handle(json.loads(line))
        except Exception as e:  # report, never crash the worker
            out = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
