import {
  clamp,
  indicator,
  isNum,
  MIN_QUALITY,
  scoreHigherIsBetter,
  scoreInRange,
  scoreLowerIsBetter,
  weightedMean,
} from './common.js';

/**
 * Gait / posture analysis.
 *
 * The browser runs MediaPipe PoseLandmarker while the user marches in place
 * (or walks across frame) for ~20 s. Ankle vertical oscillation gives step
 * events; wrist trajectories give arm swing; hip-centre motion gives sway.
 *
 * Features consumed:
 *   cadenceStepsMin       steps per minute                 (100-125 typical)
 *   stepTimeCv            coefficient of variation of step times
 *   stepSymmetry          |L-R| step time / mean           (0 = symmetric)
 *   armSwingAmplitude     mean normalised wrist excursion
 *   armSwingAsymmetry     |L-R| swing / max                (0 = symmetric)
 *   trunkSwayIndex        lateral hip-centre std-dev, normalised
 *   posturalLeanDeg       forward trunk lean, degrees
 *   doubleSupportRatio    fraction of cycle with both feet down
 *   trackedRatio          fraction of frames with a detected pose
 */
export function scoreGait(raw = {}) {
  const f = raw.features || raw;
  const quality = isNum(raw.quality) ? raw.quality : estimateQuality(f);

  if (quality < MIN_QUALITY) {
    return {
      completed: false,
      score: 0,
      quality,
      features: f,
      indicators: [],
      flags: ['gait_low_quality'],
    };
  }

  const cadence = scoreInRange(f.cadenceStepsMin, 100, 125, 55, 165);
  const variability = scoreLowerIsBetter(f.stepTimeCv, 0.04, 0.16);
  const symmetry = scoreLowerIsBetter(f.stepSymmetry, 0.05, 0.25);
  const armSwing = scoreHigherIsBetter(f.armSwingAmplitude, 0.12, 0.02);
  const armAsym = scoreLowerIsBetter(f.armSwingAsymmetry, 0.15, 0.6);
  const sway = scoreLowerIsBetter(f.trunkSwayIndex, 0.03, 0.14);
  const lean = scoreLowerIsBetter(f.posturalLeanDeg, 8, 28);
  const doubleSupport = scoreLowerIsBetter(f.doubleSupportRatio, 0.26, 0.45);

  const indicators = [
    indicator({
      key: 'cadence',
      label: 'Cadence',
      value: f.cadenceStepsMin,
      unit: 'steps/min',
      score: cadence,
      normal: '100 - 125 steps/min',
      note: 'Slowed cadence is one of the earliest gait changes.',
    }),
    indicator({
      key: 'variability',
      label: 'Step time variability',
      value: f.stepTimeCv,
      unit: '',
      score: variability,
      normal: '< 0.04',
      note: 'Irregular timing between steps.',
    }),
    indicator({
      key: 'symmetry',
      label: 'Step symmetry',
      value: f.stepSymmetry,
      unit: '',
      score: symmetry,
      normal: '< 0.05',
      note: 'Left/right difference in step duration.',
    }),
    indicator({
      key: 'armSwing',
      label: 'Arm swing amplitude',
      value: f.armSwingAmplitude,
      unit: '',
      score: armSwing,
      normal: '> 0.12',
      note: 'Reduced arm swing often precedes other gait changes.',
    }),
    indicator({
      key: 'armAsymmetry',
      label: 'Arm swing asymmetry',
      value: f.armSwingAsymmetry,
      unit: '',
      score: armAsym,
      normal: '< 0.15',
      note: 'One arm swinging noticeably less than the other.',
    }),
    indicator({
      key: 'sway',
      label: 'Trunk sway',
      value: f.trunkSwayIndex,
      unit: '',
      score: sway,
      normal: '< 0.03',
      note: 'Lateral instability of the torso.',
    }),
    indicator({
      key: 'lean',
      label: 'Forward lean',
      value: f.posturalLeanDeg,
      unit: 'deg',
      score: lean,
      normal: '< 8 deg',
      note: 'Stooped posture.',
    }),
    indicator({
      key: 'doubleSupport',
      label: 'Double support ratio',
      value: f.doubleSupportRatio,
      unit: '',
      score: doubleSupport,
      normal: '< 0.26',
      note: 'Time spent with both feet on the ground - rises with unsteadiness.',
    }),
  ];

  const base = weightedMean([
    { score: cadence, weight: 0.18 },
    { score: variability, weight: 0.18 },
    { score: armSwing, weight: 0.16 },
    { score: symmetry, weight: 0.12 },
    { score: armAsym, weight: 0.12 },
    { score: sway, weight: 0.1 },
    { score: lean, weight: 0.08 },
    { score: doubleSupport, weight: 0.06 },
  ]);

  const score = clamp(base * (0.85 + 0.15 * quality));

  const flags = [];
  if (isNum(armSwing) && armSwing < 45) flags.push('gait_reduced_arm_swing');
  if (isNum(variability) && variability < 45) flags.push('gait_high_variability');
  if (isNum(cadence) && cadence < 45) flags.push('gait_cadence_atypical');

  return {
    completed: true,
    score: Math.round(score),
    quality,
    features: f,
    indicators,
    durationSec: f.durationSec || 0,
    flags,
  };
}

function estimateQuality(f) {
  let q = 1;
  if (isNum(f.trackedRatio)) q *= clamp(f.trackedRatio / 0.7, 0, 1);
  if (isNum(f.durationSec) && f.durationSec < 12) q *= f.durationSec / 12;
  if (isNum(f.stepCount) && f.stepCount < 8) q *= f.stepCount / 8;
  return Number(clamp(q, 0, 1).toFixed(3));
}

export default scoreGait;
