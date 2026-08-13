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
 * Facial analysis (hypomimia / asymmetry screening).
 *
 * The browser runs MediaPipe FaceLandmarker (478 landmarks + 52 blendshapes)
 * over a short webcam clip while the user holds neutral, smiles, and raises
 * their eyebrows.
 *
 * Features consumed:
 *   blinkRate             blinks per minute                 (12-25 typical)
 *   expressivityIndex     mean std-dev of active blendshapes (hypomimia = low)
 *   smileAmplitude        peak mouth-corner displacement, normalised
 *   browRaiseAmplitude    peak brow elevation, normalised
 *   asymmetryIndex        L/R landmark displacement mismatch (0 = symmetric)
 *   mouthOpenRange        max - min jaw opening
 *   eyeOpenAsymmetry      L/R palpebral aperture mismatch
 *   trackedRatio          fraction of frames with a detected face
 */
export function scoreFace(raw = {}) {
  const f = raw.features || raw;
  const quality = isNum(raw.quality) ? raw.quality : estimateQuality(f);

  if (quality < MIN_QUALITY) {
    return {
      completed: false,
      score: 0,
      quality,
      features: f,
      indicators: [],
      flags: ['face_low_quality'],
    };
  }

  const blink = scoreInRange(f.blinkRate, 12, 25, 3, 42);
  const expressivity = scoreHigherIsBetter(f.expressivityIndex, 0.12, 0.02);
  const smile = scoreHigherIsBetter(f.smileAmplitude, 0.18, 0.03);
  const brow = scoreHigherIsBetter(f.browRaiseAmplitude, 0.1, 0.015);
  const symmetry = scoreLowerIsBetter(f.asymmetryIndex, 0.05, 0.22);
  const jaw = scoreHigherIsBetter(f.mouthOpenRange, 0.12, 0.02);
  const eyeSym = scoreLowerIsBetter(f.eyeOpenAsymmetry, 0.06, 0.25);

  const indicators = [
    indicator({
      key: 'blinkRate',
      label: 'Blink rate',
      value: f.blinkRate,
      unit: '/min',
      score: blink,
      normal: '12 - 25 per minute',
      note: 'Reduced spontaneous blinking is an early motor sign.',
    }),
    indicator({
      key: 'expressivity',
      label: 'Facial expressivity',
      value: f.expressivityIndex,
      unit: '',
      score: expressivity,
      normal: '> 0.12',
      note: 'Overall movement across facial muscle groups.',
    }),
    indicator({
      key: 'smile',
      label: 'Smile amplitude',
      value: f.smileAmplitude,
      unit: '',
      score: smile,
      normal: '> 0.18',
      note: 'How far the mouth corners travel on request.',
    }),
    indicator({
      key: 'brow',
      label: 'Brow raise amplitude',
      value: f.browRaiseAmplitude,
      unit: '',
      score: brow,
      normal: '> 0.10',
      note: 'Upper-face mobility.',
    }),
    indicator({
      key: 'symmetry',
      label: 'Facial symmetry',
      value: f.asymmetryIndex,
      unit: '',
      score: symmetry,
      normal: '< 0.05',
      note: 'Left/right mismatch during expression.',
    }),
    indicator({
      key: 'jaw',
      label: 'Jaw opening range',
      value: f.mouthOpenRange,
      unit: '',
      score: jaw,
      normal: '> 0.12',
      note: 'Range of motion when opening the mouth.',
    }),
    indicator({
      key: 'eyeSymmetry',
      label: 'Eye aperture symmetry',
      value: f.eyeOpenAsymmetry,
      unit: '',
      score: eyeSym,
      normal: '< 0.06',
      note: 'Difference in how wide each eye opens.',
    }),
  ];

  const base = weightedMean([
    { score: expressivity, weight: 0.24 },
    { score: blink, weight: 0.18 },
    { score: smile, weight: 0.16 },
    { score: symmetry, weight: 0.16 },
    { score: brow, weight: 0.12 },
    { score: jaw, weight: 0.08 },
    { score: eyeSym, weight: 0.06 },
  ]);

  const score = clamp(base * (0.85 + 0.15 * quality));

  const flags = [];
  if (isNum(expressivity) && expressivity < 45) flags.push('face_reduced_expressivity');
  if (isNum(blink) && blink < 45) flags.push('face_blink_rate_atypical');
  if (isNum(symmetry) && symmetry < 45) flags.push('face_asymmetry');

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
  if (isNum(f.durationSec) && f.durationSec < 8) q *= f.durationSec / 8;
  if (isNum(f.brightness)) q *= clamp(1 - Math.abs(f.brightness - 0.5) * 1.4, 0.2, 1);
  return Number(clamp(q, 0, 1).toFixed(3));
}

export default scoreFace;
