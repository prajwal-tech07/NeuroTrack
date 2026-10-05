"""
train_face_model.py -- Face Biomarker ML Model Trainer
=======================================================

Trains a 3-class facial neurological screening classifier:
  Class 0: Parkinson's Hypomimia (reduced facial expressivity, low blink rate)
  Class 1: Stroke / Bell's Palsy  (facial asymmetry, droop, eyelid mismatch)
  Class 2: Healthy                (normal expressivity, symmetry, blink rate)

Feature distributions are calibrated from published clinical research:
  - Hypomimia: Bologna et al. (2013), Ricciardi et al. (2020)
  - Stroke facial palsy: Guarin et al. (2020), Pavese et al. (2022)
  - Healthy norms: Ekman AU + population blink studies

Training strategy:
  - Clinically-calibrated synthetic feature generation (1200 samples, 400/class)
  - Gradient Boosting + Random Forest soft Voting Ensemble
  - SelectKBest (top-8 features) inside pipeline
  - GridSearchCV with 5-fold stratified CV
  - Target: >= 90% accuracy
"""

import os
import sys
import numpy as np
import joblib
import warnings

from sklearn.ensemble import (
    GradientBoostingClassifier,
    RandomForestClassifier,
    VotingClassifier,
)
from sklearn.svm import SVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.feature_selection import SelectKBest, f_classif
from sklearn.model_selection import (
    train_test_split,
    GridSearchCV,
    StratifiedKFold,
    cross_val_score,
)
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    classification_report,
)

try:
    from imblearn.pipeline import Pipeline as ImbPipeline
    from imblearn.over_sampling import SMOTE
    USE_IMBLEARN = True
except ImportError:
    from sklearn.pipeline import Pipeline as ImbPipeline
    USE_IMBLEARN = False
    warnings.warn("imbalanced-learn not installed. pip install imbalanced-learn")


# ---------------------------------------------------------------------------
# Class labels
# ---------------------------------------------------------------------------
CLASS_NAMES = ["Hypomimia (PD)", "Facial Palsy (Stroke)", "Healthy"]
LABEL_HYPOMIMIA = 0
LABEL_PALSY     = 1
LABEL_HEALTHY   = 2

# Feature order must match FacePipeline.extract_feature_vector()
FEATURE_NAMES = [
    "asymmetry_index",       # overall L/R asymmetry (0 = perfect symmetry)
    "eye_open_asymmetry",    # palpebral fissure L vs R
    "smile_laterality_ratio",# mouth corner elevation asymmetry
    "brow_laterality_ratio", # eyebrow raise asymmetry
    "expressivity_index",    # overall mobility across muscle groups
    "blink_rate",            # spontaneous blink frequency (/min)
    "smile_amplitude_mean",  # absolute smile height
    "mouth_open_range",      # max jaw opening
    "eye_aperture_left",     # left palpebral fissure height
    "eye_aperture_right",    # right palpebral fissure height
]
N_FEATURES = len(FEATURE_NAMES)


# ---------------------------------------------------------------------------
# Clinically-calibrated synthetic data generator
# ---------------------------------------------------------------------------

def _rng(seed=42):
    return np.random.default_rng(seed)


def generate_healthy_samples(n: int = 400, seed: int = 0) -> np.ndarray:
    """
    Healthy norms:
      - asymmetry_index       ~ N(0.03, 0.015)   clipped [0, 0.08]
      - eye_open_asymmetry    ~ N(0.03, 0.012)   clipped [0, 0.07]
      - smile_laterality      ~ N(0.06, 0.03)    clipped [0, 0.15]
      - brow_laterality       ~ N(0.06, 0.04)    clipped [0, 0.15]
      - expressivity_index    ~ N(0.18, 0.04)    clipped [0.08, 0.35]
      - blink_rate            ~ N(18,   4.5)     clipped [10, 32]
      - smile_amplitude_mean  ~ N(0.22, 0.04)    clipped [0.10, 0.40]
      - mouth_open_range      ~ N(0.16, 0.03)    clipped [0.07, 0.30]
      - eye_aperture_left     ~ N(0.085, 0.010)  clipped [0.05, 0.14]
      - eye_aperture_right    ~ N(0.085, 0.010)  clipped [0.05, 0.14]
    """
    rng = _rng(seed)
    X = np.column_stack([
        np.clip(rng.normal(0.030, 0.015, n), 0.000, 0.08),   # asymmetry_index
        np.clip(rng.normal(0.030, 0.012, n), 0.000, 0.07),   # eye_open_asymmetry
        np.clip(rng.normal(0.060, 0.030, n), 0.000, 0.15),   # smile_laterality
        np.clip(rng.normal(0.060, 0.040, n), 0.000, 0.15),   # brow_laterality
        np.clip(rng.normal(0.180, 0.040, n), 0.080, 0.35),   # expressivity_index
        np.clip(rng.normal(18.00, 4.500, n), 10.00, 32.00),  # blink_rate
        np.clip(rng.normal(0.220, 0.040, n), 0.100, 0.40),   # smile_amplitude_mean
        np.clip(rng.normal(0.160, 0.030, n), 0.070, 0.30),   # mouth_open_range
        np.clip(rng.normal(0.085, 0.010, n), 0.050, 0.14),   # eye_aperture_left
        np.clip(rng.normal(0.085, 0.010, n), 0.050, 0.14),   # eye_aperture_right
    ])
    return X.astype(np.float32)


def generate_hypomimia_samples(n: int = 400, seed: int = 1) -> np.ndarray:
    """
    Parkinson's Hypomimia (masked facies):
      Calibrated from Bologna et al. (2013), Ricciardi et al. (2020):
      - Facial expressivity reduced 40-60% vs healthy
      - Blink rate reduced to 5-12/min (normal 15-20)
      - Smile amplitude ~50% of healthy
      - Asymmetry remains relatively symmetric (unlike stroke)
      - Brow raise reduced
    """
    rng = _rng(seed)
    X = np.column_stack([
        np.clip(rng.normal(0.040, 0.018, n), 0.000, 0.10),   # asymmetry_index (slightly higher)
        np.clip(rng.normal(0.035, 0.015, n), 0.000, 0.08),   # eye_open_asymmetry (bilateral, symmetric)
        np.clip(rng.normal(0.065, 0.035, n), 0.000, 0.18),   # smile_laterality (symmetric reduction)
        np.clip(rng.normal(0.070, 0.040, n), 0.000, 0.18),   # brow_laterality (symmetric)
        np.clip(rng.normal(0.070, 0.025, n), 0.020, 0.13),   # expressivity_index (LOW -- key marker)
        np.clip(rng.normal(8.00,  3.000, n), 2.000, 15.00),  # blink_rate (LOW -- key marker)
        np.clip(rng.normal(0.095, 0.030, n), 0.030, 0.18),   # smile_amplitude_mean (REDUCED)
        np.clip(rng.normal(0.100, 0.025, n), 0.040, 0.18),   # mouth_open_range (slightly reduced)
        np.clip(rng.normal(0.070, 0.012, n), 0.040, 0.11),   # eye_aperture_left (bilaterally reduced)
        np.clip(rng.normal(0.072, 0.012, n), 0.040, 0.11),   # eye_aperture_right (bilateral)
    ])
    return X.astype(np.float32)


def generate_palsy_samples(n: int = 400, seed: int = 2) -> np.ndarray:
    """
    Stroke / Bell's Palsy facial paresis:
      Calibrated from Guarin et al. (2020), Pavese et al. (2022):
      - HIGH facial asymmetry (key marker -- one side droops)
      - HIGH eye open asymmetry (unilateral eyelid ptosis / lagophthalmos)
      - HIGH smile laterality ratio (one mouth corner drops)
      - One eye aperture significantly smaller than other
      - Expressivity may be partially preserved on healthy side
      - Blink rate: variable (may be reduced due to lagophthalmos)
    """
    rng = _rng(seed)

    # Which side is affected (randomly left or right) -- impacts laterality ratios
    affected = rng.choice([0, 1], size=n)  # 0 = left affected, 1 = right affected

    # Paretic eye is smaller; healthy eye is normal
    eye_healthy = np.clip(rng.normal(0.085, 0.010, n), 0.060, 0.130)
    eye_paretic = np.clip(rng.normal(0.045, 0.015, n), 0.015, 0.080)

    eye_left  = np.where(affected == 0, eye_paretic, eye_healthy)
    eye_right = np.where(affected == 1, eye_paretic, eye_healthy)

    X = np.column_stack([
        np.clip(rng.normal(0.180, 0.060, n), 0.06, 0.40),    # asymmetry_index (HIGH -- key marker)
        np.abs(eye_left - eye_right),                          # eye_open_asymmetry (HIGH)
        np.clip(rng.normal(0.350, 0.100, n), 0.10, 0.70),    # smile_laterality (HIGH -- drooping)
        np.clip(rng.normal(0.280, 0.090, n), 0.08, 0.60),    # brow_laterality (HIGH -- one-sided)
        np.clip(rng.normal(0.130, 0.040, n), 0.04, 0.25),    # expressivity_index (reduced on paretic side)
        np.clip(rng.normal(12.00, 5.000, n), 3.000, 22.00),  # blink_rate (variable)
        np.clip(rng.normal(0.160, 0.050, n), 0.04, 0.30),    # smile_amplitude_mean (asymmetric)
        np.clip(rng.normal(0.150, 0.035, n), 0.06, 0.28),    # mouth_open_range
        eye_left,                                              # eye_aperture_left
        eye_right,                                             # eye_aperture_right
    ])
    return X.astype(np.float32)


def generate_dataset(n_per_class: int = 400) -> tuple:
    """Generates balanced 3-class face biomarker dataset."""
    X_healthy   = generate_healthy_samples(n_per_class,    seed=10)
    X_hypomimia = generate_hypomimia_samples(n_per_class,  seed=20)
    X_palsy     = generate_palsy_samples(n_per_class,      seed=30)

    X = np.vstack([X_hypomimia, X_palsy, X_healthy])
    y = np.array(
        [LABEL_HYPOMIMIA] * n_per_class +
        [LABEL_PALSY]     * n_per_class +
        [LABEL_HEALTHY]   * n_per_class
    )
    return X, y


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def train_face_model(n_per_class: int = 500):
    """Trains and saves the face biomarker classification model."""

    print("\n" + "="*60)
    print("  Face Biomarker Model Training")
    print("="*60)
    print(f"\n[*] Generating {n_per_class * 3} clinically-calibrated samples ({n_per_class}/class) ...")

    models_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "models"
    )
    os.makedirs(models_dir, exist_ok=True)

    X, y = generate_dataset(n_per_class)
    print(f"[*] Dataset shape: {X.shape}")
    print(f"[*] Classes: {CLASS_NAMES}")
    for label, name in enumerate(CLASS_NAMES):
        print(f"    Class {label} ({name}): {(y == label).sum()} samples")

    # ------------------------------------------------------------------
    # Train/test split
    # ------------------------------------------------------------------
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )

    # ------------------------------------------------------------------
    # Build pipeline
    # ------------------------------------------------------------------
    gb = GradientBoostingClassifier(
        n_estimators=250, learning_rate=0.08, max_depth=4,
        subsample=0.85, min_samples_leaf=3, random_state=42
    )
    rf = RandomForestClassifier(
        n_estimators=300, max_depth=None, min_samples_split=2,
        random_state=42, n_jobs=-1
    )
    base_svc = SVC(kernel="rbf", C=10.0, gamma="scale")
    cal_svc  = CalibratedClassifierCV(base_svc, ensemble=False)

    voter = VotingClassifier(
        estimators=[("gb", gb), ("rf", rf), ("svc", cal_svc)],
        voting="soft",
        weights=[0.45, 0.30, 0.25],
    )

    steps = [
        ("scaler",   StandardScaler()),
        ("selector", SelectKBest(f_classif, k=8)),
    ]
    if USE_IMBLEARN:
        steps.append(("smote", SMOTE(random_state=42, k_neighbors=5)))
    steps.append(("voter", voter))

    pipeline = ImbPipeline(steps)

    # ------------------------------------------------------------------
    # GridSearchCV (5-fold stratified)
    # ------------------------------------------------------------------
    print("\n[*] Running GridSearchCV (5-fold stratified CV) ...")

    param_grid = {
        "voter__gb__n_estimators":  [200, 300],
        "voter__gb__learning_rate": [0.06, 0.08, 0.10],
        "voter__rf__n_estimators":  [200, 300],
    }

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    grid = GridSearchCV(
        pipeline, param_grid, cv=cv,
        scoring="balanced_accuracy",
        n_jobs=-1, verbose=1, refit=True,
    )
    grid.fit(X_train, y_train)

    best_pipe = grid.best_estimator_
    print(f"\n[+] Best CV balanced_accuracy : {grid.best_score_ * 100:.2f}%")
    print(f"[+] Best params               : {grid.best_params_}")

    # ------------------------------------------------------------------
    # Evaluate on held-out test set
    # ------------------------------------------------------------------
    y_pred = best_pipe.predict(X_test)
    acc      = accuracy_score(y_test, y_pred)
    bal_acc  = balanced_accuracy_score(y_test, y_pred)
    cm       = confusion_matrix(y_test, y_pred)

    print(f"\n  Accuracy         : {acc * 100:.2f}%")
    print(f"  Balanced Accuracy: {bal_acc * 100:.2f}%")
    print(f"\n  Confusion Matrix:\n{cm}")
    print(f"\n  Classification Report:")
    print(classification_report(y_test, y_pred, target_names=CLASS_NAMES))

    if acc >= 0.90:
        print(f"\n[OK] 90% target achieved! ({acc*100:.2f}%)")
    else:
        print(f"\n[!] Test accuracy {acc*100:.2f}% | CV score {grid.best_score_*100:.2f}%")

    # ------------------------------------------------------------------
    # Save model
    # ------------------------------------------------------------------
    fitted_scaler   = best_pipe.named_steps["scaler"]
    fitted_selector = best_pipe.named_steps["selector"]
    fitted_voter    = best_pipe.named_steps["voter"]

    selected_idx   = fitted_selector.get_support(indices=True)
    selected_names = [FEATURE_NAMES[i] for i in selected_idx]
    print(f"\n[*] Selected features: {selected_names}")

    bundle = {
        "model":           fitted_voter,
        "pipeline":        best_pipe,
        "scaler":          fitted_scaler,
        "selector":        fitted_selector,
        "accuracy":        acc,
        "balanced_accuracy": bal_acc,
        "cv_best_score":   float(grid.best_score_),
        "feature_names":   FEATURE_NAMES,
        "class_names":     CLASS_NAMES,
        "selected_features": selected_names,
        "n_classes":       3,
        "engine":          "face-ensemble-v1",
        "label_map": {
            LABEL_HYPOMIMIA: "hypomimia",
            LABEL_PALSY:     "facial_palsy",
            LABEL_HEALTHY:   "healthy",
        },
    }

    out_path = os.path.join(models_dir, "face_model.joblib")
    joblib.dump(bundle, out_path)
    print(f"\n[+] Saved face model -> {out_path}")
    return acc


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Train Face Biomarker Classification Model")
    parser.add_argument("--n-per-class", type=int, default=500,
                        help="Number of samples per class (default: 500)")
    args = parser.parse_args()
    acc = train_face_model(n_per_class=args.n_per_class)
    sys.exit(0 if acc >= 0.90 else 1)
