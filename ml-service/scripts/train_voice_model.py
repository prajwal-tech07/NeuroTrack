"""
train_voice_model.py -- train and honestly evaluate the Parkinson's voice model
================================================================================

Data (real recordings only; fetch with scripts/download_voice_data.py):
  * Sakar et al. 2018, UCI #470 -- 756 sustained /a/ recordings, 252 subjects
    (188 PD / 64 healthy), Praat voice-report baseline features.     -> training
  * Iyer et al. 2023, figshare 23849127 -- 81 sustained /a/ recordings
    (40 PD / 41 healthy), raw 8 kHz audio, features extracted HERE with the
    same code the API runs.                                            -> external test

Evaluation rules:
  * Every split is by SUBJECT (StratifiedGroupKFold). Random row splits put
    the same person's recordings in train and test and inflate accuracy.
  * Model selection uses repeated CV with seeds not used during exploration.
  * The decision threshold and the probability calibration are fitted on
    out-of-fold predictions only.
  * The figshare set is never used for training or selection.

Output: app/models/voice_pd_model.joblib and app/models/voice_pd_model_report.json

Usage:  python scripts/train_voice_model.py
"""

import glob
import json
import os
import sys
import warnings
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (balanced_accuracy_score, confusion_matrix,
                             roc_auc_score)
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import make_pipeline
from xgboost import XGBClassifier

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
warnings.filterwarnings("ignore")

from app.services.audio.voice_features import (FEATURE_NAMES,  # noqa: E402
                                               VoiceQualityError)
from app.services.ml.voice_audio_model import (MODEL_FILENAME,  # noqa: E402
                                               MODEL_FEATURES,
                                               VoiceAudioClassifier,
                                               VoiceFeatureEngineer,
                                               distribution_distance)

RAW = os.path.join(ROOT, "data", "raw")
SAKAR_CSV = os.path.join(RAW, "sakar", "pd_speech_features.csv")
FIGSHARE_DIR = os.path.join(RAW, "figshare")
MODELS_DIR = os.path.join(ROOT, "app", "models")

EVAL_SEEDS = range(100, 110)  # exploration used seeds 0-4
N_FOLDS = 5
N_BOOT = 2000


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

def load_sakar() -> pd.DataFrame:
    if not os.path.exists(SAKAR_CSV):
        sys.exit(f"Missing {SAKAR_CSV}. Run scripts/download_voice_data.py first.")
    s = pd.read_csv(SAKAR_CSV, header=1)
    df = s[FEATURE_NAMES].copy()
    df["male"] = s["gender"].astype(float)  # 1 = male (longer pitch period)
    df["subject"] = s["id"].astype(str)
    df["y"] = s["class"].astype(int)       # 1 = PD
    return df.dropna().reset_index(drop=True)


def load_figshare(clf_for_rows: bool = True) -> pd.DataFrame:
    """Extract features from the raw figshare audio with the production extractor."""
    import parselmouth
    demo = pd.read_excel(os.path.join(FIGSHARE_DIR, "demo.xlsx")).set_index("Sample ID")
    rows = []
    probe = VoiceAudioClassifier.__new__(VoiceAudioClassifier)  # for _segments only
    from app.services.audio.voice_features import extract_from_sound
    for path in sorted(glob.glob(os.path.join(FIGSHARE_DIR, "*", "*.wav"))):
        sid = os.path.basename(path)[:-4]
        snd = parselmouth.Sound(path)
        try:
            whole = extract_from_sound(snd)
        except VoiceQualityError as exc:
            print(f"    [QC] {sid}: {exc}")
            continue
        segs = []
        for seg in probe._segments(snd):
            try:
                segs.append(extract_from_sound(seg))
            except VoiceQualityError:
                pass
        d = demo.loc[sid]
        rows.append({"subject": sid, "y": int(d["Label"] == "PwPD"),
                     "male": float(d["Sex"] == "M"), "age": float(d["Age"]),
                     "rows": segs or [whole]})
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

def make_lr():
    return make_pipeline(VoiceFeatureEngineer(),
                         LogisticRegression(C=1.0, class_weight="balanced", max_iter=5000))


def make_xgb(pos_weight):
    return make_pipeline(VoiceFeatureEngineer(),
                         XGBClassifier(n_estimators=300, max_depth=3, learning_rate=0.03,
                                       subsample=0.8, colsample_bytree=0.6, min_child_weight=3,
                                       scale_pos_weight=pos_weight, random_state=0, verbosity=0))


class Blend:
    """Mean of LR and XGB probabilities (both equal-prior weighted)."""

    def __init__(self, pos_weight):
        self.members = [make_lr(), make_xgb(pos_weight)]

    def fit(self, X, y):
        for m in self.members:
            m.fit(X, y)
        return self

    def predict_proba(self, X):
        return np.mean([m.predict_proba(X) for m in self.members], axis=0)


# ---------------------------------------------------------------------------
# Evaluation helpers
# ---------------------------------------------------------------------------

def oof_predictions(df, factory, seed):
    X = df[MODEL_FEATURES + ["male"]]
    y, g = df["y"].to_numpy(), df["subject"].to_numpy()
    p = np.zeros(len(df))
    for tr, te in StratifiedGroupKFold(N_FOLDS, shuffle=True, random_state=seed).split(X, y, g):
        p[te] = factory().fit(X.iloc[tr], y[tr]).predict_proba(X.iloc[te])[:, 1]
    return p


def per_subject(df, p):
    t = pd.DataFrame({"s": df["subject"], "y": df["y"], "p": p}).groupby("s")
    return t["y"].first().to_numpy(), t["p"].mean().to_numpy()


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def fit_platt(p, y):
    """Calibration under equal class priors (class-balanced Platt scaling)."""
    lr = LogisticRegression(class_weight="balanced", C=1e6, max_iter=5000)
    lr.fit(logit(p).reshape(-1, 1), y)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


def apply_platt(p, ab):
    a, b = ab
    return 1 / (1 + np.exp(-(a * logit(p) + b)))


def youden_threshold(y, p):
    best, thr = -1, 0.5
    for t in np.unique(np.round(p, 3)):
        pred = p >= t
        sens = pred[y == 1].mean()
        spec = (~pred[y == 0]).mean()
        if sens + spec - 1 > best:
            best, thr = sens + spec - 1, float(t)
    return thr


def summary(y, p, thr):
    pred = (p >= thr).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "auc": float(roc_auc_score(y, p)),
        "balanced_accuracy": float(balanced_accuracy_score(y, pred)),
        "accuracy": float((pred == y).mean()),
        "sensitivity": float(tp / (tp + fn)),
        "specificity": float(tn / (tn + fp)),
        "majority_baseline_accuracy": float(max(y.mean(), 1 - y.mean())),
        "n_subjects": int(len(y)),
        "n_pd": int(y.sum()),
        "n_healthy": int((1 - y).sum()),
    }


def bootstrap_ci(y, p, thr, rng):
    aucs, bals = [], []
    idx = np.arange(len(y))
    for _ in range(N_BOOT):
        b = rng.choice(idx, len(idx), replace=True)
        if len(np.unique(y[b])) < 2:
            continue
        aucs.append(roc_auc_score(y[b], p[b]))
        bals.append(balanced_accuracy_score(y[b], p[b] >= thr))
    q = lambda a: [float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))]
    return {"auc_95ci": q(aucs), "balanced_accuracy_95ci": q(bals)}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 64)
    print("  Parkinson's voice model -- real data, subject-level evaluation")
    print("=" * 64)
    df = load_sakar()
    n_subj = df["subject"].nunique()
    print(f"[*] Sakar: {len(df)} recordings, {n_subj} subjects "
          f"({df.groupby('subject').y.first().sum()} PD)")
    pos_weight = float((df.y == 0).sum() / (df.y == 1).sum())

    candidates = {
        "logreg": make_lr,
        "xgboost": lambda: make_xgb(pos_weight),
        "blend": lambda: Blend(pos_weight),
    }

    # 1. Model selection by repeated subject-grouped CV ----------------------
    results, oof = {}, {}
    for name, factory in candidates.items():
        aucs = []
        oof[name] = []
        for seed in EVAL_SEEDS:
            p = oof_predictions(df, factory, seed)
            ys, ps = per_subject(df, p)
            aucs.append(roc_auc_score(ys, ps))
            oof[name].append(p)
        results[name] = (float(np.mean(aucs)), float(np.std(aucs)))
        print(f"    {name:8s} subject AUC = {results[name][0]:.3f} ± {results[name][1]:.3f}")
    best = max(results, key=lambda k: results[k][0])
    print(f"[+] Selected: {best}")

    # 2. Calibration + threshold from out-of-fold predictions ---------------
    p_rec = np.mean(oof[best], axis=0)  # average over CV repeats, still out-of-fold
    calib = fit_platt(p_rec, df["y"].to_numpy())
    ys, ps = per_subject(df, apply_platt(p_rec, calib))
    thr = round(youden_threshold(ys, ps), 3)

    # Per-repeat metrics at that threshold (spread across CV repetitions)
    reps = [summary(*per_subject(df, apply_platt(p, calib)), thr) for p in oof[best]]
    cv = {k: float(np.mean([r[k] for r in reps])) for k in
          ("auc", "balanced_accuracy", "accuracy", "sensitivity", "specificity")}
    cv["std"] = {k: float(np.std([r[k] for r in reps])) for k in ("auc", "balanced_accuracy")}
    cv.update(bootstrap_ci(ys, ps, thr, np.random.default_rng(0)))
    cv["majority_baseline_accuracy"] = reps[0]["majority_baseline_accuracy"]
    cv["method"] = (f"{N_FOLDS}-fold subject-grouped CV x {len(EVAL_SEEDS)} repeats, "
                    f"{n_subj} subjects (Sakar 2018)")

    # Leaky comparison, to document why grouping matters
    from sklearn.model_selection import StratifiedKFold
    X = df[MODEL_FEATURES + ["male"]]
    p_leaky = np.zeros(len(df))
    for tr, te in StratifiedKFold(N_FOLDS, shuffle=True, random_state=100).split(X, df.y):
        p_leaky[te] = candidates[best]().fit(X.iloc[tr], df.y.iloc[tr]).predict_proba(X.iloc[te])[:, 1]

    print(f"\n  Subject-level CV ({cv['method']})")
    print(f"    AUC               {cv['auc']:.3f}  (95% CI {cv['auc_95ci'][0]:.3f}-{cv['auc_95ci'][1]:.3f})")
    print(f"    Balanced accuracy {cv['balanced_accuracy']:.3f}  (95% CI "
          f"{cv['balanced_accuracy_95ci'][0]:.3f}-{cv['balanced_accuracy_95ci'][1]:.3f})")
    print(f"    Sensitivity       {cv['sensitivity']:.3f}")
    print(f"    Specificity       {cv['specificity']:.3f}")
    print(f"    Accuracy          {cv['accuracy']:.3f}  (always-'PD' baseline {cv['majority_baseline_accuracy']:.3f})")
    print(f"    Threshold         {thr}")
    print(f"    [for reference] leaky row-split AUC: {roc_auc_score(df.y, p_leaky):.3f}")

    # 3. Final model on all subjects ----------------------------------------
    final = candidates[best]().fit(X, df["y"].to_numpy())
    engineer = VoiceFeatureEngineer().fit(X)
    # Out-of-distribution gate: 99th percentile of training-recording distance.
    ood_threshold = round(float(np.percentile(distribution_distance(engineer, X), 99)), 3)
    print(f"    OOD gate          distance <= {ood_threshold}")
    metrics = {"subject_cv": cv, "n_subjects": int(n_subj),
               "n_recordings": int(len(df)), "selection": results}
    bundle = {
        "pipeline": final,
        "calibration": calib,
        "threshold": thr,
        "engineer": engineer,
        "ood_threshold": ood_threshold,
        "feature_names": MODEL_FEATURES + ["male"],
        "engine": f"voice-pd-{best}-sakar2018-v1",
        "metrics": metrics,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    # 4. External test on figshare (never seen in training/selection) -------
    if os.path.isdir(FIGSHARE_DIR):
        print("\n[*] External test: figshare (8 kHz audio, production feature extractor)")
        fig = load_figshare()
        clf = VoiceAudioClassifier.__new__(VoiceAudioClassifier)
        clf.bundle = bundle
        fp = np.array([clf.score_rows(r, bool(m)) for r, m in zip(fig["rows"], fig["male"])])
        fy = fig["y"].to_numpy()
        dist = np.array([distribution_distance(engineer, pd.DataFrame(
            [{**{n: row[n] for n in MODEL_FEATURES}, "male": m} for row in r])).mean()
            for r, m in zip(fig["rows"], fig["male"])])
        flagged = float(np.mean(dist > ood_threshold))
        ext = summary(fy, fp, thr)
        ext.update(bootstrap_ci(fy, fp, thr, np.random.default_rng(1)))
        ext["age_only_auc"] = float(roc_auc_score(fy, fig["age"]))
        ext["fraction_flagged_out_of_distribution"] = flagged
        ext["note"] = ("8 kHz telephone-band audio vs 44.1 kHz training data; controls are much "
                       "younger than patients. A lower bound on transfer, not a clean estimate.")
        metrics["external_figshare"] = ext
        print(f"    AUC {ext['auc']:.3f} (95% CI {ext['auc_95ci'][0]:.3f}-{ext['auc_95ci'][1]:.3f}), "
              f"balanced acc {ext['balanced_accuracy']:.3f}, sens {ext['sensitivity']:.3f}, "
              f"spec {ext['specificity']:.3f}  [n={ext['n_subjects']}]")
        print(f"    OOD gate flags {flagged*100:.0f}% of these recordings as unlike the training data")

    os.makedirs(MODELS_DIR, exist_ok=True)
    out = os.path.join(MODELS_DIR, MODEL_FILENAME)
    joblib.dump(bundle, out)
    report = os.path.join(MODELS_DIR, MODEL_FILENAME.replace(".joblib", "_report.json"))
    with open(report, "w", encoding="utf-8") as f:
        json.dump({k: v for k, v in bundle.items() if k not in ("pipeline", "engineer")}, f, indent=2)
    print(f"\n[+] Saved {out}\n[+] Saved {report}")


if __name__ == "__main__":
    main()
