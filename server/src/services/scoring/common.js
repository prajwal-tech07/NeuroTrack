/**
 * Shared scoring primitives.
 *
 * Every module converts a raw signal feature into a 0-100 sub-score using one of
 * three monotone mappings. A feature is described by a "good" threshold (full
 * marks) and a "bad" threshold (zero marks); values in between interpolate.
 *
 * The thresholds below are drawn from published reference ranges for acoustic
 * and kinematic measures (Praat voice-report norms, MDS-UPDRS motor task
 * descriptions, and gait-lab cadence/variability norms). They are screening
 * heuristics for wellness tracking — not a diagnostic instrument.
 */

export const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const lerp = (t) => clamp(t * 100, 0, 100);

/** Lower is better: full marks at or below `good`, zero at or above `bad`. */
export function scoreLowerIsBetter(value, good, bad) {
  if (!isNum(value)) return null;
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return lerp((bad - value) / (bad - good));
}

/** Higher is better: full marks at or above `good`, zero at or below `bad`. */
export function scoreHigherIsBetter(value, good, bad) {
  if (!isNum(value)) return null;
  if (value >= good) return 100;
  if (value <= bad) return 0;
  return lerp((value - bad) / (good - bad));
}

/**
 * Best inside [goodLo, goodHi]; falls off to zero at `bad` distance outside it.
 */
export function scoreInRange(value, goodLo, goodHi, badLo, badHi) {
  if (!isNum(value)) return null;
  if (value >= goodLo && value <= goodHi) return 100;
  if (value < goodLo) return scoreHigherIsBetter(value, goodLo, badLo);
  return scoreLowerIsBetter(value, goodHi, badHi);
}

/** Weighted mean of {score, weight} entries, ignoring null scores. */
export function weightedMean(parts) {
  let sum = 0;
  let wsum = 0;
  for (const p of parts) {
    if (!isNum(p.score)) continue;
    sum += p.score * p.weight;
    wsum += p.weight;
  }
  return wsum === 0 ? null : sum / wsum;
}

export function statusFor(score) {
  if (!isNum(score)) return 'unknown';
  if (score >= 75) return 'normal';
  if (score >= 55) return 'borderline';
  return 'atypical';
}

/**
 * Builds one indicator row for the UI/report.
 * `value` is the raw measurement, `score` the 0-100 mapping of it.
 */
export function indicator({ key, label, value, unit, score, normal, note }) {
  return {
    key,
    label,
    value: isNum(value) ? Number(value.toFixed(2)) : null,
    unit: unit || '',
    score: isNum(score) ? Math.round(score) : null,
    status: statusFor(score),
    normal: normal || '',
    note: note || '',
  };
}

/**
 * Data-quality gate. Modules report their own 0-1 quality; anything under
 * `min` means the recording was too short/noisy to trust and the module is
 * marked incomplete rather than scored badly.
 */
export const MIN_QUALITY = 0.35;

/**
 * Mild age normalisation. Several of these measures drift naturally with age
 * (voice jitter rises, cadence falls), so we relax the penalty slightly for
 * older users instead of flagging normal ageing as risk.
 */
export function ageAdjust(score, age) {
  if (!isNum(score) || !isNum(age)) return score;
  if (age <= 45) return score;
  const bonus = Math.min(6, ((age - 45) / 10) * 1.6);
  return clamp(score + (score < 90 ? bonus : 0));
}

export const ENGINE_VERSION = '1.0.0';
