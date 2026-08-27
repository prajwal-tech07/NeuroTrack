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
 * @returns {{index: number, weakSide: 'left'|'right'|null}|null}
 */
export function pairAsymmetry(left, right, higherIsBetter = true) {
  if (!isNum(left) || !isNum(right)) return null;

  const scale = Math.max(Math.abs(left), Math.abs(right));
  if (scale < 1e-6) return { index: 0, weakSide: null };

  const index = clamp(Math.abs(left - right) / scale, 0, 1);

  let weakSide = null;
  if (Math.abs(left - right) > 1e-9) {
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
const PAIRED_MEASURES = {
  face: [
    { key: 'expressivity', label: 'Side expressivity', higherIsBetter: true, weight: 0.34 },
    { key: 'smile', label: 'Smile excursion', higherIsBetter: true, weight: 0.3 },
    { key: 'brow', label: 'Brow elevation', higherIsBetter: true, weight: 0.16 },
    { key: 'eyeShutResidual', label: 'Eye closure', higherIsBetter: false, weight: 0.2 },
  ],
  hand: [
    { key: 'tapFrequencyHz', label: 'Tap speed', higherIsBetter: true, weight: 0.4 },
    { key: 'tapAmplitudeMean', label: 'Tap amplitude', higherIsBetter: true, weight: 0.32 },
    { key: 'holdDropY', label: 'Arm drift', higherIsBetter: false, weight: 0.28 },
  ],
  gait: [
    { key: 'armSwing', label: 'Arm swing', higherIsBetter: true, weight: 0.55 },
    { key: 'stepInterval', label: 'Step interval', higherIsBetter: false, weight: 0.45 },
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
      const pair = pairAsymmetry(left[m.key], right[m.key], m.higherIsBetter);
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
