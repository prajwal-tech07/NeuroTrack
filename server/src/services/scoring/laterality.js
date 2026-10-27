import { clamp, isNum } from './common.js';

/**
 * Laterality engine.
 *
 * The single measurement that separates the two motor patterns we screen for:
 *
 *   Parkinsonian hypokinesia -> both sides slow and stiff together (LOW laterality)
 *   Hemiparesis              -> one side weak, the other spared (HIGH laterality)
 *
 * For each paired measurement we compute a normalised side difference in the
 * range 0..1 and record which side came out worse. Aggregating those per
 * modality gives an overall laterality index and, when the same side is weak
 * across modalities, a confident "affected side".
 */

/**
 * Normalised difference between a left/right pair.
 * @param {number} left
 * @param {number} right
 * @param {boolean} higherIsBetter whether a larger value means healthier
 * @param {number} floor smallest magnitude that counts as a real signal. The
 *   difference is divided by max(|left|, |right|, floor), so two values that are
 *   both just measurement noise (an eye gap of 0.01 vs 0.02, a drift of +0.002
 *   vs -0.003) cannot read as a 100% one-sided difference.
 * @param {number} tolerance relative difference healthy people show anyway
 *   (dominant vs non-dominant hand, camera angle). Only the part beyond it
 *   counts, rescaled to 0..1, so ordinary handedness does not read as weakness.
 * @returns {{index: number, weakSide: 'left'|'right'|null}|null}
 */
export function pairAsymmetry(left, right, higherIsBetter = true, floor = 0, tolerance = 0) {
  if (!isNum(left) || !isNum(right)) return null;

  const scale = Math.max(Math.abs(left), Math.abs(right), floor);
  if (scale < 1e-6) return { index: 0, weakSide: null };

  const raw = clamp(Math.abs(left - right) / scale, 0, 1);
  const index = tolerance > 0 ? clamp((raw - tolerance) / (1 - tolerance), 0, 1) : raw;

  let weakSide = null;
  if (index > 1e-9) {
    const leftWorse = higherIsBetter ? left < right : left > right;
    weakSide = leftWorse ? 'left' : 'right';
  }

  return { index, weakSide };
}

/**
 * Measures compared per modality.
 * `higherIsBetter: false` means a larger number is the impaired direction
 * (a residual eye gap, a downward arm drift, a longer gap between steps).
 */
// `floor` = the magnitude of a clearly real (healthy-range) value for that measure,
// in its own units. Below it, differences are treated as noise-level.
// `tolerance` = side difference healthy people show anyway (see pairAsymmetry).
const PAIRED_MEASURES = {
  face: [
    { key: 'expressivity', label: 'Side expressivity', higherIsBetter: true, weight: 0.34, floor: 0.03, tolerance: 0.25 },
    // Healthy smile peak blendshape: median 0.58 on healthy faces.
    { key: 'smile', label: 'Smile excursion', higherIsBetter: true, weight: 0.3, floor: 0.2, tolerance: 0.25 },
    { key: 'brow', label: 'Brow elevation', higherIsBetter: true, weight: 0.16, floor: 0.1, tolerance: 0.3 },
    // Eye height / interocular distance: ~0.08 open (healthy photos, MediaPipe),
    // ~0.01-0.02 shut; an incompletely closing eye leaves ~0.03-0.06.
    { key: 'eyeShutResidual', label: 'Eye closure', higherIsBetter: false, weight: 0.2, floor: 0.03, tolerance: 0.2 },
  ],
  hand: [
    // Dominant hands tap ~10% faster, up to ~25% in healthy people.
    { key: 'tapFrequencyHz', label: 'Tap speed', higherIsBetter: true, weight: 0.45, floor: 1.5, tolerance: 0.25 },
    { key: 'tapAmplitudeMean', label: 'Tap amplitude', higherIsBetter: true, weight: 0.4, floor: 0.4, tolerance: 0.3 },
    // Palm lengths over the hold. Normal holds drift up to ~0.65 (90th pct, real
    // recordings), so this is weak evidence and weighted lightly.
    { key: 'holdDropY', label: 'Arm drift', higherIsBetter: false, weight: 0.15, floor: 0.6, tolerance: 0.2 },
  ],
  gait: [
    { key: 'armSwing', label: 'Arm swing', higherIsBetter: true, weight: 0.55, floor: 0.05, tolerance: 0.2 },
    { key: 'stepInterval', label: 'Step interval', higherIsBetter: false, weight: 0.45, floor: 0.4, tolerance: 0.1 },
  ],
};

/** Relative contribution of each modality to the overall laterality index. */
const MODALITY_WEIGHTS = { face: 0.34, hand: 0.4, gait: 0.26 };

/**
 * @param {object} modules raw module payloads, each with a `features` object
 *                         containing `left` and `right` sub-objects
 */
export function analyzeLaterality(modules = {}) {
  const perModality = {};
  const details = [];
  const sideVotes = { left: 0, right: 0 };

  for (const [modality, measures] of Object.entries(PAIRED_MEASURES)) {
    const features = modules[modality]?.features;
    const left = features?.left;
    const right = features?.right;

    if (!left || !right) {
      perModality[modality] = null;
      continue;
    }

    let weighted = 0;
    let weightSum = 0;
    const modVotes = { left: 0, right: 0 };

    for (const m of measures) {
      const pair = pairAsymmetry(left[m.key], right[m.key], m.higherIsBetter, m.floor, m.tolerance);
      if (!pair) continue;

      weighted += pair.index * m.weight;
      weightSum += m.weight;

      if (pair.weakSide && pair.index >= 0.15) modVotes[pair.weakSide] += m.weight;

      details.push({
        modality,
        key: m.key,
        label: m.label,
        left: isNum(left[m.key]) ? Number(left[m.key].toFixed(4)) : null,
        right: isNum(right[m.key]) ? Number(right[m.key].toFixed(4)) : null,
        index: Number(pair.index.toFixed(4)),
        weakSide: pair.weakSide,
      });
    }

    if (weightSum === 0) {
      perModality[modality] = null;
      continue;
    }

    const index = weighted / weightSum;
    const weakSide =
      modVotes.left === modVotes.right ? null : modVotes.left > modVotes.right ? 'left' : 'right';

    perModality[modality] = { index: Number(index.toFixed(4)), weakSide };

    // A modality only votes on the affected side if it is meaningfully lopsided.
    if (weakSide && index >= 0.2) sideVotes[weakSide] += MODALITY_WEIGHTS[modality];
  }

  const available = Object.entries(perModality).filter(([, v]) => v !== null);

  if (available.length === 0) {
    return {
      index: null,
      affectedSide: null,
      sideConsistency: 0,
      perModality,
      details,
      measured: false,
    };
  }

  let sum = 0;
  let weightSum = 0;
  for (const [modality, value] of available) {
    sum += value.index * MODALITY_WEIGHTS[modality];
    weightSum += MODALITY_WEIGHTS[modality];
  }
  const index = sum / weightSum;

  const totalVotes = sideVotes.left + sideVotes.right;
  const affectedSide =
    totalVotes === 0 ? null : sideVotes.left > sideVotes.right ? 'left' : 'right';

  // How much the modalities agree on which side is weak. A true hemiparesis
  // affects one side consistently; noise points in different directions.
  const sideConsistency =
    totalVotes === 0 ? 0 : Math.max(sideVotes.left, sideVotes.right) / totalVotes;

  return {
    index: Number(index.toFixed(4)),
    affectedSide,
    sideConsistency: Number(sideConsistency.toFixed(3)),
    modalitiesAgreeing: available.filter(([, v]) => v.weakSide === affectedSide && v.index >= 0.2)
      .length,
    modalitiesMeasured: available.length,
    perModality,
    details,
    measured: true,
  };
}

export default analyzeLaterality;
