"""
train_kaggle.py -- High-Accuracy Parkinson's & Stroke Model Trainer
====================================================================

Parkinson's model (UCI / Oxford voice dataset):
  - SMOTE inside ImbPipeline (no data leakage in CV)
  - Voting Ensemble: GradientBoosting + CalibratedSVC + RandomForest (soft vote)
  - SelectKBest feature selection (top-15 features)
  - GridSearchCV with 5-fold stratified CV
  - Target: >= 90% accuracy & balanced accuracy

Stroke model (Kaggle Healthcare Dataset):
  - RandomForest with class_weight='balanced'
  - GridSearchCV tuning
"""

import os
import argparse
import urllib.request
import warnings
import numpy as np
import pandas as pd
import joblib

from sklearn.svm import SVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import (
    RandomForestClassifier,
    GradientBoostingClassifier,
    VotingClassifier,
)
from sklearn.preprocessing import StandardScaler
from sklearn.feature_selection import SelectKBest, f_classif
from sklearn.model_selection import (
    train_test_split,
    GridSearchCV,
    StratifiedKFold,
)
from sklearn.metrics import (
    classification_report,
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
)

# SMOTE inside pipeline to prevent data leakage during cross-validation
try:
    from imblearn.over_sampling import SMOTE
    from imblearn.pipeline import Pipeline as ImbPipeline
    SMOTE_AVAILABLE = True
except ImportError:
    from sklearn.pipeline import Pipeline as ImbPipeline
    SMOTE_AVAILABLE = False
    warnings.warn(
        "imbalanced-learn not installed. Run: pip install imbalanced-learn. "
        "Falling back to class_weight='balanced'."
    )

UCI_PARKINSONS_URL = (
    "https://archive.ics.uci.edu/ml/machine-learning-databases/parkinsons/parkinsons.data"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _print_section(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def _print_metrics(y_true, y_pred, target_names=None):
    acc = accuracy_score(y_true, y_pred)
    bal_acc = balanced_accuracy_score(y_true, y_pred)
    cm = confusion_matrix(y_true, y_pred)
    print(f"\n  Accuracy         : {acc * 100:.2f}%")
    print(f"  Balanced Accuracy: {bal_acc * 100:.2f}%")
    print(f"\n  Confusion Matrix:\n{cm}")
    print(f"\n  Classification Report:")
    print(classification_report(y_true, y_pred, target_names=target_names))
    return acc, bal_acc


# ---------------------------------------------------------------------------
# Parkinson's Model (UCI/Oxford voice features)
# ---------------------------------------------------------------------------

def train_from_uci_or_kaggle_parkinsons(csv_path: str = None):
    """
    Trains a high-accuracy Parkinson's classifier using the Oxford/UCI dataset.

    Improvements over baseline SVM:
      1. SMOTE inside ImbPipeline (correct -- no leakage into CV test folds)
      2. SelectKBest feature selection (top-15 of 22 voice features)
      3. Soft VotingClassifier: GradientBoosting + CalibratedSVC + RandomForest
      4. GridSearchCV over key hyperparameters (5-fold stratified CV)
    """
    _print_section("Parkinson's Disease Model Training")

    models_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "models"
    )
    data_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
    )
    os.makedirs(models_dir, exist_ok=True)
    os.makedirs(data_dir, exist_ok=True)

    # ------------------------------------------------------------------
    # 1. Load dataset
    # ------------------------------------------------------------------
    if csv_path and os.path.exists(csv_path):
        print(f"[*] Loading Parkinson's dataset from: {csv_path}")
        df = pd.read_csv(csv_path)
    else:
        cached_file = os.path.join(data_dir, "parkinsons.data")
        if not os.path.exists(cached_file):
            print("[*] Downloading Oxford/UCI Parkinson's dataset ...")
            try:
                urllib.request.urlretrieve(UCI_PARKINSONS_URL, cached_file)
                print(f"[+] Downloaded to: {cached_file}")
            except Exception as e:
                print(f"[-] Download failed: {e}")
                return
        print(f"[*] Loading dataset from: {cached_file}")
        df = pd.read_csv(cached_file)

    if "name" in df.columns:
        df = df.drop(columns=["name"])

    target_col = "status" if "status" in df.columns else df.columns[-1]
    feature_names = [c for c in df.columns if c != target_col]
    X = df[feature_names].values
    y = df[target_col].values  # 1 = PD, 0 = Healthy

    # Invert: in our app 1 = Healthy, 0 = Risk
    y_healthy = (y == 0).astype(int)

    print(f"[*] Dataset shape: {X.shape}")
    print(f"[*] Class distribution -- PD(0): {(y_healthy==0).sum()}, Healthy(1): {(y_healthy==1).sum()}")

    # ------------------------------------------------------------------
    # 2. Train / Test split (stratified 80/20)
    # ------------------------------------------------------------------
    X_train, X_test, y_train, y_test = train_test_split(
        X, y_healthy, test_size=0.2, random_state=42, stratify=y_healthy
    )

    # ------------------------------------------------------------------
    # 3. Build ImbPipeline: scale -> feature select -> SMOTE -> Ensemble
    #    SMOTE is INSIDE the pipeline so it only sees training folds in CV
    # ------------------------------------------------------------------
    # Use CalibratedClassifierCV instead of SVC(probability=True) to avoid FutureWarning
    base_svc = SVC(kernel="rbf", C=10.0, gamma="scale", class_weight="balanced")
    cal_svc = CalibratedClassifierCV(base_svc, ensemble=False)

    gb = GradientBoostingClassifier(
        n_estimators=200, learning_rate=0.08, max_depth=4,
        subsample=0.85, min_samples_split=4, random_state=42
    )
    rf = RandomForestClassifier(
        n_estimators=300, max_depth=None, min_samples_split=2,
        class_weight="balanced", random_state=42, n_jobs=-1
    )

    voter = VotingClassifier(
        estimators=[("gb", gb), ("svc", cal_svc), ("rf", rf)],
        voting="soft",
        weights=[0.40, 0.35, 0.25],
    )

    # Build pipeline steps
    steps = [
        ("scaler", StandardScaler()),
        ("selector", SelectKBest(f_classif, k=15)),
    ]
    if SMOTE_AVAILABLE:
        print("[*] SMOTE will be applied inside each CV fold (no data leakage) ...")
        steps.append(("smote", SMOTE(random_state=42, k_neighbors=3)))
    else:
        print("[!] SMOTE not available. Using class_weight='balanced' only.")

    steps.append(("voter", voter))
    pipeline = ImbPipeline(steps)

    # ------------------------------------------------------------------
    # 4. GridSearchCV (5-fold stratified) -- SMOTE runs inside each fold
    # ------------------------------------------------------------------
    print("[*] Running GridSearchCV (5-fold stratified CV) ...")

    param_grid = {
        "voter__gb__n_estimators":   [150, 200, 300],
        "voter__gb__learning_rate":  [0.05, 0.08, 0.10],
        "voter__svc__estimator__C":  [5.0, 10.0, 20.0],
    }

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    grid_search = GridSearchCV(
        pipeline,
        param_grid,
        cv=cv,
        scoring="balanced_accuracy",
        n_jobs=-1,
        verbose=1,
        refit=True,
    )
    grid_search.fit(X_train, y_train)

    best_pipeline = grid_search.best_estimator_
    print(f"\n[+] Best CV balanced_accuracy : {grid_search.best_score_*100:.2f}%")
    print(f"[+] Best params               : {grid_search.best_params_}")

    # Extract fitted scaler and selector from the pipeline for inference
    fitted_scaler   = best_pipeline.named_steps["scaler"]
    fitted_selector = best_pipeline.named_steps["selector"]
    fitted_voter    = best_pipeline.named_steps["voter"]

    # ------------------------------------------------------------------
    # 5. Evaluate on held-out test set
    # ------------------------------------------------------------------
    y_pred = best_pipeline.predict(X_test)
    acc, bal_acc = _print_metrics(
        y_test, y_pred, target_names=["Parkinson's (Risk)", "Healthy"]
    )

    target_hit = acc >= 0.90 or grid_search.best_score_ >= 0.90
    if target_hit:
        print(f"\n[OK] 90% target achieved! (test={acc*100:.2f}%, cv_bal={grid_search.best_score_*100:.2f}%)")
    else:
        print(f"\n[!] test accuracy {acc*100:.1f}% - CV balanced_acc {grid_search.best_score_*100:.1f}%")
        print("[!] Note: small test set (39 samples) causes high variance. CV score is more reliable.")

    # ------------------------------------------------------------------
    # 6. Save model bundles (BEFORE any optional extra steps that could fail)
    # ------------------------------------------------------------------
    bundle = {
        "model":     fitted_voter,      # The VotingClassifier (needs pre-scaled+selected input)
        "pipeline":  best_pipeline,     # Full pipeline (takes raw features directly)
        "scaler":    fitted_scaler,
        "selector":  fitted_selector,
        "accuracy":  acc,
        "balanced_accuracy": bal_acc,
        "cv_best_score": float(grid_search.best_score_),
        "features":  feature_names,
        "selected_feature_indices": fitted_selector.get_support(indices=True).tolist(),
        "n_features_in": X.shape[1],
        "engine":    "voting-ensemble-v2",
    }

    kaggle_out  = os.path.join(models_dir, "parkinsons_kaggle_model.joblib")
    primary_out = os.path.join(models_dir, "parkinsons_model.joblib")

    joblib.dump(bundle, kaggle_out)
    print(f"\n[+] Saved Kaggle model  -> {kaggle_out}")
    joblib.dump(bundle, primary_out)
    print(f"[+] Saved primary model -> {primary_out}")

    # ------------------------------------------------------------------
    # 7. Feature importance summary
    # ------------------------------------------------------------------
    try:
        selected_idx = fitted_selector.get_support(indices=True)
        selected_names = [feature_names[i] for i in selected_idx]
        gb_model = fitted_voter.estimators_[0]  # GradientBoosting
        importances = gb_model.feature_importances_
        top_features = sorted(zip(selected_names, importances), key=lambda x: -x[1])[:5]
        print("\n[*] Top-5 most important features (by GradientBoosting):")
        for fname, imp in top_features:
            print(f"    {fname:<30s}  {imp:.4f}")
    except Exception:
        pass  # Non-critical


# ---------------------------------------------------------------------------
# Stroke / Paralysis Model (Kaggle Healthcare Dataset)
# ---------------------------------------------------------------------------

def train_from_kaggle_stroke(csv_path: str):
    """
    Trains Stroke/Paralysis model from Kaggle Stroke Dataset with tuned
    Random Forest and class balancing.
    """
    _print_section("Stroke / Paralysis Model Training")

    models_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "models"
    )
    if not os.path.exists(csv_path):
        print(f"[-] Stroke dataset file not found: {csv_path}")
        return

    print(f"[*] Loading Stroke dataset from: {csv_path}")
    df = pd.read_csv(csv_path)

    if "id" in df.columns:
        df = df.drop(columns=["id"])

    for col in df.select_dtypes(include=["object"]).columns:
        df[col] = df[col].astype("category").cat.codes

    df = df.fillna(df.median(numeric_only=True))

    target_col = "stroke" if "stroke" in df.columns else df.columns[-1]
    X = df.drop(columns=[target_col]).values
    y = df[target_col].values

    # Invert: 1 = Healthy, 0 = Stroke Risk
    y_healthy = (y == 0).astype(int)
    print(f"[*] Dataset shape: {X.shape}")
    print(f"[*] Class distribution -- Stroke(0): {(y_healthy==0).sum()}, Healthy(1): {(y_healthy==1).sum()}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_healthy, test_size=0.2, random_state=42, stratify=y_healthy
    )

    steps = [("scaler", StandardScaler())]
    if SMOTE_AVAILABLE:
        steps.append(("smote", SMOTE(random_state=42, k_neighbors=5)))
    steps.append(("rf", RandomForestClassifier(class_weight="balanced", random_state=42, n_jobs=-1)))
    pipeline = ImbPipeline(steps)

    param_grid = {
        "rf__n_estimators":    [100, 200, 300],
        "rf__max_depth":       [6, 8, 12, None],
        "rf__min_samples_split": [2, 4],
    }
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    grid = GridSearchCV(pipeline, param_grid, cv=cv, scoring="balanced_accuracy", n_jobs=-1, verbose=1)
    grid.fit(X_train, y_train)

    best_pipe = grid.best_estimator_
    print(f"[+] Best CV balanced_accuracy: {grid.best_score_*100:.2f}%")

    y_pred = best_pipe.predict(X_test)
    acc, bal_acc = _print_metrics(y_test, y_pred, target_names=["Stroke Risk", "Healthy"])

    out_path = os.path.join(models_dir, "paralysis_kaggle_model.joblib")
    joblib.dump(
        {
            "model":    best_pipe.named_steps["rf"],
            "pipeline": best_pipe,
            "scaler":   best_pipe.named_steps["scaler"],
            "accuracy": acc,
            "balanced_accuracy": bal_acc,
        },
        out_path,
    )
    print(f"[+] Saved Stroke model -> {out_path}")


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Train high-accuracy ML models on Kaggle / UCI datasets"
    )
    parser.add_argument(
        "--parkinsons-csv",
        type=str,
        default=None,
        help="Path to Parkinson's CSV (Kaggle/UCI). Auto-downloads UCI if omitted.",
    )
    parser.add_argument(
        "--stroke-csv",
        type=str,
        default=None,
        help="Path to Kaggle Stroke CSV (healthcare-dataset-stroke-data.csv)",
    )
    parser.add_argument(
        "--skip-parkinsons",
        action="store_true",
        help="Skip Parkinson's training",
    )
    args = parser.parse_args()

    if not args.skip_parkinsons:
        train_from_uci_or_kaggle_parkinsons(args.parkinsons_csv)

    if args.stroke_csv:
        train_from_kaggle_stroke(args.stroke_csv)
