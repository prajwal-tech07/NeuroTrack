"""
evaluate_research_data.py -- real-world accuracy from opted-in app users
=========================================================================

Reads the samples exported by `npm run research:export` (server/) and, for
each test (voice, face, hand), measures how well its features separate a
condition from self-reported healthy users, with participant-grouped CV.
For voice it also measures the deployed voice model on browser recordings.

    python scripts/evaluate_research_data.py [--file data/research/samples.jsonl]

It refuses to report a number until there are at least MIN_PER_CLASS
participants in each class: below that the estimate is noise.

Labels are self-reported, so treat results as indicative until confirmed
against clinician diagnoses.
"""

import argparse
import json
import os

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = os.path.join(ROOT, "data", "research", "samples.jsonl")
MIN_PER_CLASS = 20
CONDITIONS = {"parkinsons": "Parkinson's", "stroke": "stroke"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def per_participant(rows, module, condition):
    """Mean numeric features per participant for one module and one condition vs healthy."""
    recs = []
    for r in rows:
        if r["diagnosis"] not in (condition, "none") or module not in r.get("modules", {}):
            continue
        feats = {k: v for k, v in r["modules"][module]["features"].items()
                 if isinstance(v, (int, float)) and not isinstance(v, bool)}
        recs.append({"pid": r["participantId"], "y": int(r["diagnosis"] == condition), **feats})
    if not recs:
        return None
    df = pd.DataFrame(recs).groupby("pid").mean(numeric_only=True)
    df["y"] = df["y"].round().astype(int)
    return df


def cv_auc(X, y):
    aucs, bals = [], []
    k = min(5, int(min(np.bincount(y))))
    for seed in range(10):
        p = np.zeros(len(y))
        for tr, te in StratifiedKFold(k, shuffle=True, random_state=seed).split(X, y):
            m = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                              LogisticRegression(C=0.3, class_weight="balanced", max_iter=5000))
            p[te] = m.fit(X[tr], y[tr]).predict_proba(X[te])[:, 1]
        aucs.append(roc_auc_score(y, p))
        bals.append(balanced_accuracy_score(y, p >= 0.5))
    return np.mean(aucs), np.std(aucs), np.mean(bals)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=DEFAULT)
    args = ap.parse_args()
    if not os.path.exists(args.file):
        raise SystemExit(f"{args.file} not found. Run `npm run research:export` in server/ first.")
    rows = load(args.file)
    people = pd.DataFrame([{"pid": r["participantId"], "dx": r["diagnosis"]} for r in rows]).drop_duplicates("pid")
    print(f"[*] {len(rows)} samples, {len(people)} participants")
    print("    participants by self-reported diagnosis:", people["dx"].value_counts().to_dict())

    for cond, label in CONDITIONS.items():
        print(f"\n=== {label} vs healthy ===")
        for module in ("voice", "face", "hand", "gait"):
            df = per_participant(rows, module, cond)
            n_pos = 0 if df is None else int(df["y"].sum())
            n_neg = 0 if df is None else int((1 - df["y"]).sum())
            if min(n_pos, n_neg) < MIN_PER_CLASS:
                print(f"  {module:5s} not enough data ({n_pos} {label}, {n_neg} healthy; need {MIN_PER_CLASS} each)")
                continue
            feats = [c for c in df.columns if c != "y" and df[c].notna().mean() > 0.8]
            auc, sd, bal = cv_auc(df[feats].to_numpy(float), df["y"].to_numpy())
            print(f"  {module:5s} features -> AUC {auc:.3f} ± {sd:.3f}, balanced acc {bal:.3f} "
                  f"({n_pos} vs {n_neg} participants, {len(feats)} features)")

    # Deployed voice model, on browser microphones (its own threshold, no refit).
    vm = [(r["participantId"], r["diagnosis"], r["voiceModel"]) for r in rows
          if r.get("voiceModel") and r["voiceModel"].get("reliable") and r["diagnosis"] in ("parkinsons", "none")]
    if vm:
        v = pd.DataFrame([{"pid": p, "y": int(d == "parkinsons"), "p": m["pdLikeness"]} for p, d, m in vm])
        v = v.groupby("pid").mean()
        n_pos, n_neg = int(v["y"].sum()), int((1 - v["y"]).sum())
        print("\n=== Deployed voice model on browser recordings ===")
        if min(n_pos, n_neg) < MIN_PER_CLASS:
            print(f"  not enough data ({n_pos} Parkinson's, {n_neg} healthy; need {MIN_PER_CLASS} each)")
        else:
            print(f"  AUC {roc_auc_score(v['y'], v['p']):.3f} ({n_pos} vs {n_neg} participants)")
        total = sum(1 for r in rows if r.get("voiceModel"))
        print(f"  out-of-distribution rate: {1 - len(vm) / max(1, total):.0%} of voice samples rejected by the gate")


if __name__ == "__main__":
    main()
