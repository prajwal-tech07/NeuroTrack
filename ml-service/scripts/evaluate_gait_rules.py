"""
evaluate_gait_rules.py -- measure the app's gait rules on real walking data
============================================================================

Data: PhysioNet "Gait in Parkinson's Disease" (gaitpdb 1.0.0, ODC-By):
93 people with Parkinson's, 73 controls, ~2 min of self-paced walking with
8 force sensors under each foot at 100 Hz. Download:
    python scripts/evaluate_gait_rules.py --download

From the vertical ground-reaction force this computes the four gait timing
features the app's gait scorer consumes (cadenceStepsMin, stepTimeCv,
stepSymmetry, doubleSupportRatio), then:

  1. scores every walk with the app's real JavaScript rules
     (server/src/services/scoring/gait.js, run through node), and
  2. trains a model on the same features with subject-grouped CV,

and reports subject-level AUC / balanced accuracy for both.

Caveat: the app estimates these features from a webcam, not force plates.
These numbers say how much signal the features carry and how well the
rule thresholds are placed -- an upper bound for the camera version.
"""

import argparse
import glob
import json
import os
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(ROOT)
DATA = os.path.join(ROOT, "data", "raw", "gaitpdb")
BASE_URL = "https://physionet.org/files/gaitpdb/1.0.0/"
FS = 100.0
FEATURES = ["cadenceStepsMin", "stepTimeCv", "stepSymmetry", "doubleSupportRatio"]


def download():
    os.makedirs(DATA, exist_ok=True)
    sums = urllib.request.urlopen(BASE_URL + "SHA256SUMS.txt").read().decode().split("\n")
    names = [l.split()[1] for l in sums if l.strip().endswith(".txt") and "SHA256" not in l]

    def get(name):
        dest = os.path.join(DATA, name)
        if not os.path.exists(dest):
            urllib.request.urlretrieve(BASE_URL + name, dest)

    with ThreadPoolExecutor(8) as pool:
        list(pool.map(get, names))
    print(f"[+] {len(names)} files in {DATA}")


def contact_events(force, threshold):
    """Indices of initial contacts and toe-offs for one foot."""
    on = force > threshold
    edges = np.diff(on.astype(int))
    return np.where(edges == 1)[0] + 1, np.where(edges == -1)[0] + 1, on


def walk_features(path):
    d = np.loadtxt(path)
    left, right = d[:, 17], d[:, 18]  # total force under each foot (N)
    # Skip the first and last 10 s (gait initiation / termination).
    trim = slice(int(10 * FS), len(d) - int(10 * FS))
    left, right = left[trim], right[trim]
    thr = 0.05 * np.median(np.r_[left[left > 0], right[right > 0]])
    l_hs, _, l_on = contact_events(left, thr)
    r_hs, _, r_on = contact_events(right, thr)
    if len(l_hs) < 10 or len(r_hs) < 10:
        return None

    def strides(hs):
        s = np.diff(hs) / FS
        return s[(s > 0.6) & (s < 2.5)]  # drop turns / artefacts

    ls, rs = strides(l_hs), strides(r_hs)
    all_strides = np.r_[ls, rs]
    if len(all_strides) < 10:
        return None
    # Step times: consecutive contacts of opposite feet, split by direction.
    events = sorted([(i, "L") for i in l_hs] + [(i, "R") for i in r_hs])
    lr, rl = [], []
    for (t0, f0), (t1, f1) in zip(events, events[1:]):
        dt = (t1 - t0) / FS
        if f0 != f1 and 0.25 < dt < 1.25:
            (lr if f0 == "L" else rl).append(dt)
    if len(lr) < 5 or len(rl) < 5:
        return None
    steps = np.r_[lr, rl]
    walking = l_on | r_on
    return {
        "cadenceStepsMin": 60.0 / np.mean(steps),
        "stepTimeCv": float(np.std(steps) / np.mean(steps)),
        # |L->R step - R->L step| / mean step: 0 = symmetric.
        "stepSymmetry": float(abs(np.mean(lr) - np.mean(rl)) / np.mean(steps)),
        "doubleSupportRatio": float(np.sum(l_on & r_on) / max(1, np.sum(walking))),
    }


def load():
    rows = []
    # File names: Ga/Ju/Si study, Pt = Parkinson's / Co = control, _NN = trial.
    for path in sorted(glob.glob(os.path.join(DATA, "*_*.txt"))):
        name = os.path.basename(path)[:-4]
        subject, trial = name.split("_")
        if trial == "10":  # dual-task walking: different condition, excluded
            continue
        f = walk_features(path)
        if f is None:
            continue
        f.update(subject=subject, y=int("Pt" in subject))
        rows.append(f)
    return pd.DataFrame(rows)


def js_rule_scores(df):
    """Score each walk with the app's actual gait rules (gait.js)."""
    script = (
        "import fs from 'node:fs';"
        "import { scoreGait } from './server/src/services/scoring/gait.js';"
        "const rows = JSON.parse(fs.readFileSync(0, 'utf8'));"
        "console.log(JSON.stringify(rows.map((f) => scoreGait({ features: f, quality: 1 }).score)));"
    )
    out = subprocess.run(["node", "--input-type=module", "-e", script], cwd=REPO,
                         input=json.dumps(df[FEATURES].to_dict("records")),
                         capture_output=True, text=True, check=True)
    return np.array(json.loads(out.stdout), dtype=float)


def subject_level(df, col):
    g = df.groupby("subject")
    return g["y"].first().to_numpy(), g[col].mean().to_numpy()


def youden(y, p):
    best, thr = -1, 0.5
    for t in np.unique(p):
        pred = p >= t
        j = pred[y == 1].mean() + (~pred[y == 0]).mean() - 1
        if j > best:
            best, thr = j, t
    return thr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true")
    args = ap.parse_args()
    if args.download or not os.path.exists(os.path.join(DATA, "demographics.txt")):
        download()

    df = load()
    ys = df.groupby("subject")["y"].first()
    print(f"[*] {len(df)} walks, {len(ys)} subjects ({int(ys.sum())} PD, {int((1 - ys).sum())} controls)")
    print(df.groupby("y")[FEATURES].median().rename(index={0: "control", 1: "PD"}).round(3).T)

    # 1. The app's rules, as they are. Lower score = more impaired.
    df["rule_risk"] = 100 - js_rule_scores(df)
    y, p = subject_level(df, "rule_risk")
    rule_auc = roc_auc_score(y, p)
    # At the app's own "below 80 = some risk" band edge:
    app_pred = p > 20
    print("\n  App gait rules (gait.js, unchanged)")
    print(f"    AUC                       {rule_auc:.3f}")
    print(f"    flagged at score < 80     PD {app_pred[y == 1].mean():.0%}, controls {app_pred[y == 0].mean():.0%}")
    print(f"    balanced acc @ score < 80 {balanced_accuracy_score(y, app_pred):.3f}")

    # 2. A model on the same 4 features, subject-grouped CV (one row per subject).
    S = df.groupby("subject").agg({**{f: "mean" for f in FEATURES}, "y": "first"})
    X, yy = S[FEATURES].to_numpy(), S["y"].to_numpy()
    aucs, bals = [], []
    for seed in range(10):
        pr = np.zeros(len(yy))
        for tr, te in StratifiedKFold(5, shuffle=True, random_state=seed).split(X, yy):
            m = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced"))
            pr[te] = m.fit(X[tr], yy[tr]).predict_proba(X[te])[:, 1]
        aucs.append(roc_auc_score(yy, pr))
        bals.append(balanced_accuracy_score(yy, pr >= 0.5))
    print("\n  Logistic regression on the same features (5-fold CV x 10, one row per subject)")
    print(f"    AUC               {np.mean(aucs):.3f} ± {np.std(aucs):.3f}")
    print(f"    balanced accuracy {np.mean(bals):.3f} ± {np.std(bals):.3f}")

    print("\n  Per-feature AUC (subject level)")
    for f in FEATURES:
        a = roc_auc_score(yy, S[f])
        print(f"    {f:20s} {max(a, 1 - a):.3f} ({'higher' if a >= 0.5 else 'lower'} in PD)")


if __name__ == "__main__":
    main()
