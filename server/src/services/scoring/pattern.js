import { clamp, isNum, scoreHigherIsBetter, scoreLowerIsBetter } from './common.js';

/**
 * Motor pattern classifier.
 *
 * This does NOT diagnose. It reports which of four movement patterns the
 * measurements most resemble, which is how a clinician localises before
 * diagnosing:
 *
 *   typical       - everything within reference ranges
 *   parkinsonian  - bilateral hypokinesia: slow, decrementing, symmetric,
 *                   often with a 4-6 Hz rest tremor and reduced expression
 *   hemiparetic   - unilateral weakness: one side consistently worse across
 *                   modalities, no rest tremor
 *   mixed         - impairment present but not cleanly either pattern
 *
 * Both evidence scores are computed independently on 0..1, then compared. A
 * clear winner needs both a minimum strength and a margin over the runner-up;
 * otherwise the result is "mixed", which is the honest answer.
 */

export const PATTERNS = {
  typical: {
    label: 'Typical',
    summary: 'Movement measurements are within typical ranges.',
  },
  parkinsonian: {
    label: 'Parkinsonian pattern',
    summary:
      'Slowed, reduced-amplitude movement affecting both sides fairly evenly — the pattern seen in Parkinsonian conditions.',
  },
  hemiparetic: {
    label: 'One-sided weakness pattern',
    summary:
      'One side of the body is consistently weaker than the other — the pattern seen after a stroke or in facial nerve palsy.',
  },
  mixed: {
    label: 'Mixed / unclear pattern',
    summary:
      'Measurements are outside typical ranges but do not match a single clear pattern.',
  },
};

/**
 * Evidence tiers.
 *
 * A hard "typical vs pattern" cut throws away the most useful band: early
 * presentations, where a pattern is leaning but not established. Forcing those
 * to "typical" is a false negative on exactly the cases early screening exists
 * to catch, while forcing them to a confident label would overclaim.
 *
 * So there are two tiers. Above CONFIDENT the pattern is reported normally;
 * between TENTATIVE and CONFIDENT it is reported as a possible early pattern
 * with `tentative: true` and low confidence, which the UI shows as "repeat next
 * week and compare" rather than a finding.
 */
const CONFIDENT_EVIDENCE = 0.4;
const TENTATIVE_EVIDENCE = 0.28;
const CONFIDENT_MARGIN = 0.1;
const TENTATIVE_MARGIN = 0.05;

const val = (obj, path, fallback = null) => {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return fallback;
    cur = cur[key];
  }
  return cur ?? fallback;
};

/**
 * Combines the measured components into an evidence score.
 *
 * A plain weighted mean is wrong here. Clinical reasoning is not an average:
 * a 4-6 Hz rest tremor, or an eye that will not close, is a *specific* finding
 * that means something on its own even when everything else is only mildly
 * off. Averaging buries exactly those findings — which is what made mild
 * Parkinsonian cases read as "typical".
 *
 * So the score blends the overall picture with the single strongest specific
 * finding. `specificity` marks the components that are meaningful alone.
 */
function evidenceScore(components) {
  let sum = 0;
  let weightSum = 0;
  let strongest = 0;
  const hits = [];

  for (const c of components) {
    if (!isNum(c.value)) continue;
    const v = clamp(c.value, 0, 1);

    sum += v * c.weight;
    weightSum += c.weight;

    // Only components flagged as specific can carry the argument alone.
    if (c.specificity) strongest = Math.max(strongest, v * c.specificity);

    if (v >= 0.5 && c.evidence) hits.push(c.evidence);
  }

  if (weightSum === 0) return { score: null, coverage: 0, hits };

  const mean = sum / weightSum;
  return {
    score: BREADTH_WEIGHT * mean + SPECIFIC_WEIGHT * strongest,
    mean,
    strongest,
    coverage: weightSum,
    hits,
  };
}

/** How much the overall picture vs. the single strongest finding counts. */
const BREADTH_WEIGHT = 0.62;
const SPECIFIC_WEIGHT = 0.38;

/**
 * @param {object} params
 * @param {object} params.modules   scored module results (voice/face/hand/gait)
 * @param {object} params.raw       raw module payloads (for per-side features)
 * @param {object} params.laterality output of analyzeLaterality()
 * @param {number} params.overallScore
 */
export function classifyPattern({ modules = {}, raw = {}, laterality = {}, overallScore = 100 }) {
  const lat = isNum(laterality.index) ? laterality.index : null;
  const consistency = isNum(laterality.sideConsistency) ? laterality.sideConsistency : 0;

  const handF = raw.hand?.features || {};
  const faceF = raw.face?.features || {};
  const gaitF = raw.gait?.features || {};
  const voiceF = raw.voice?.features || {};

  const leftTap = val(handF, 'left.tapFrequencyHz');
  const rightTap = val(handF, 'right.tapFrequencyHz');
  const bothTaps = [leftTap, rightTap].filter(isNum);
  const slowestTap = bothTaps.length ? Math.min(...bothTaps) : null;
  const fastestTap = bothTaps.length ? Math.max(...bothTaps) : null;

  // ---- Rest tremor in the 4-6 Hz band: strongly Parkinsonian, absent in palsy.
  const tremorHz = handF.tremorPeakHz;
  const tremorPower = handF.tremorPowerRatio;
  const restTremor =
    isNum(tremorHz) && isNum(tremorPower) && tremorHz >= 3.5 && tremorHz <= 6.5
      ? clamp(tremorPower / 0.35, 0, 1)
      : 0;

  // ================= Parkinsonian evidence =================
  const parkinsonian = evidenceScore([
    {
      // Both hands slow — bradykinesia is bilateral even when asymmetric at onset.
      value: isNum(fastestTap) ? 1 - scoreHigherIsBetter(fastestTap, 4.0, 1.2) / 100 : null,
      weight: 0.2,
      specificity: 0.62,
      evidence: 'Repetitive movement slowed on both sides',
    },
    {
      value: isNum(handF.tapAmplitudeDecay)
        ? 1 - scoreLowerIsBetter(handF.tapAmplitudeDecay, 0.12, 0.55) / 100
        : null,
      weight: 0.16,
      specificity: 0.8, // decrement is characteristic of Parkinsonian bradykinesia
      evidence: 'Tap amplitude decreased through the trial',
    },
    {
      value: restTremor,
      weight: 0.2,
      specificity: 1.0, // a rest tremor in this band is the single most telling finding
      evidence: 'Rest tremor in the 4-6 Hz band',
    },
    {
      // Bilateral hypomimia: expression reduced AND both sides reduced together.
      value: isNum(faceF.expressivityIndex)
        ? (1 - scoreHigherIsBetter(faceF.expressivityIndex, 0.12, 0.02) / 100) *
          (lat === null ? 1 : 1 - clamp(lat, 0, 1))
        : null,
      weight: 0.16,
      evidence: 'Reduced facial expression on both sides',
    },
    {
      value: isNum(gaitF.armSwingAmplitude)
        ? 1 - scoreHigherIsBetter(gaitF.armSwingAmplitude, 0.12, 0.02) / 100
        : null,
      weight: 0.1,
      evidence: 'Reduced arm swing',
    },
    {
      // Monotone, quiet speech — hypokinetic dysarthria.
      value: isNum(voiceF.f0StdSemitones)
        ? 1 - scoreHigherIsBetter(voiceF.f0StdSemitones, 2.4, 0.6) / 100
        : null,
      weight: 0.08,
      evidence: 'Flat, monotone speech',
    },
    {
      // Symmetry itself is evidence for this pattern.
      value: lat === null ? null : 1 - clamp(lat / 0.4, 0, 1),
      weight: 0.1,
      evidence: 'Both sides affected roughly equally',
    },
  ]);

  // ================= Hemiparetic evidence =================
  const hemiparetic = evidenceScore([
    {
      // The headline signal: a large side difference.
      value: lat === null ? null : clamp((lat - 0.15) / 0.4, 0, 1),
      weight: 0.3,
      specificity: 0.92, // a large, consistent side gap is the defining feature
      evidence: 'Large difference between the two sides',
    },
    {
      // Multiple modalities agreeing on the same weak side.
      value: lat === null ? null : consistency >= 0.7 ? clamp(consistency, 0, 1) : 0,
      weight: 0.16,
      evidence: 'The same side is weaker across several tests',
    },
    {
      // One hand near-normal while the other is slow: a spared side.
      value:
        isNum(slowestTap) && isNum(fastestTap) && fastestTap > 0
          ? clamp(((fastestTap - slowestTap) / fastestTap - 0.2) / 0.4, 0, 1)
          : null,
      weight: 0.14,
      specificity: 0.8, // a clearly spared side argues against a bilateral process
      evidence: 'One hand taps normally while the other is slowed',
    },
    {
      value: faceF.eyeClosureTested
        ? clamp((faceF.eyeClosureGap - 0.01) / 0.05, 0, 1)
        : null,
      weight: 0.14,
      specificity: 0.95, // lagophthalmos is highly specific to facial weakness
      evidence: 'One eye does not close as fully as the other',
    },
    {
      value: isNum(faceF.asymmetryIndex) ? clamp((faceF.asymmetryIndex - 0.05) / 0.2, 0, 1) : null,
      weight: 0.12,
      evidence: 'Facial movement is uneven between the two sides',
    },
    {
      // Absence of rest tremor argues for weakness over Parkinsonism.
      value: isNum(tremorHz) ? 1 - restTremor : null,
      weight: 0.08,
      evidence: 'No rest tremor detected',
    },
    {
      value: isNum(gaitF.armSwingAsymmetry)
        ? clamp((gaitF.armSwingAsymmetry - 0.15) / 0.45, 0, 1)
        : null,
      weight: 0.06,
      evidence: 'One arm swings noticeably less than the other',
    },
  ]);

  const pScore = parkinsonian.score ?? 0;
  const hScore = hemiparetic.score ?? 0;

  // ---- Decide -------------------------------------------------------------
  let type;
  let confidence;
  let tentative = false;

  const impaired = overallScore < 78;
  const leader = pScore >= hScore ? 'parkinsonian' : 'hemiparetic';
  const leadScore = Math.max(pScore, hScore);
  const trailScore = Math.min(pScore, hScore);
  const margin = leadScore - trailScore;

  if (leadScore >= CONFIDENT_EVIDENCE && margin >= CONFIDENT_MARGIN) {
    type = leader;
    confidence = clamp(leadScore * 0.7 + margin * 0.6, 0.3, 0.95);
  } else if (leadScore >= TENTATIVE_EVIDENCE && margin >= TENTATIVE_MARGIN) {
    // Leaning but not established — reported as a possible early pattern.
    type = leader;
    tentative = true;
    confidence = clamp(0.2 + leadScore * 0.4, 0.2, 0.5);
  } else if (impaired) {
    type = 'mixed';
    confidence = clamp(0.4 + trailScore * 0.4, 0.3, 0.8);
  } else {
    type = 'typical';
    confidence = clamp(1 - leadScore * 1.4, 0.35, 0.95);
  }

  const affectedSide = type === 'hemiparetic' ? laterality.affectedSide || null : null;

  return {
    type,
    label: tentative ? `Possible early ${PATTERNS[type].label.toLowerCase()}` : PATTERNS[type].label,
    summary: tentative
      ? `${PATTERNS[type].summary} The signal is weak, so treat this as something to re-test next week rather than a finding.`
      : PATTERNS[type].summary,
    tentative,
    confidence: Number(confidence.toFixed(3)),
    affectedSide,
    scores: {
      parkinsonian: Number(pScore.toFixed(3)),
      hemiparetic: Number(hScore.toFixed(3)),
    },
    evidence: type === 'parkinsonian' ? parkinsonian.hits : type === 'hemiparetic' ? hemiparetic.hits : [...parkinsonian.hits, ...hemiparetic.hits],
    lateralityIndex: lat,
  };
}

export default classifyPattern;
