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
 * Hand movement / tremor analysis.
 *
 * The browser runs MediaPipe HandLandmarker over two tasks:
 *   1. Finger tapping - thumb tip to index tip, 10 s per hand, as big and fast as possible.
 *   2. Postural hold  - hand held out steady, 7 s per hand.
 *
 * Features consumed:
 *   tapFrequencyHz        taps per second                  (>= 2.2 Hz typical on camera)
 *   tapAmplitudeMean      mean normalised tap opening
 *   tapAmplitudeDecay     % amplitude lost first->last third (sequence effect)
 *   tapIntervalCv         coefficient of variation of inter-tap intervals
 *   tapHesitations        count of halts / freezes
 *   tremorPeakHz          dominant frequency during the hold
 *   tremorPowerRatio      4-6 Hz band power / total band power
 *   holdDriftPx           slow positional drift during the hold, normalised
 *   trackedRatio          fraction of frames with a detected hand
 */
export function scoreHand(raw = {}) {
  const f = raw.features || raw;
  const quality = isNum(raw.quality) ? raw.quality : estimateQuality(f);

  if (quality < MIN_QUALITY) {
    return {
      completed: false,
      score: 0,
      quality,
      features: f,
      indicators: [],
      flags: ['hand_low_quality'],
    };
  }

  // Reference ranges measured with the browser feature code on real MediaPipe
  // recordings rated by a doctor (MDS-UPDRS finger tapping / postural tremor,
  // PN Expert): "normal" (rated 0) hands tap at 3.2 Hz median (10th pct 2.0),
  // open 1.28 palm lengths (10th pct 0.64), lose < 0.31 of amplitude (90th pct)
  // and drift < 0.65 palm lengths (90th pct) over a hold. The previous limits
  // (4 Hz, 0.02 drift...) were stricter than what normal hands do on camera.
  const speed = scoreHigherIsBetter(f.tapFrequencyHz, 2.2, 0.8);
  const amplitude = scoreHigherIsBetter(f.tapAmplitudeMean, 0.6, 0.15);
  const decay = scoreLowerIsBetter(f.tapAmplitudeDecay, 0.3, 0.7);
  // Rhythm and hesitations barely differ between normal and impaired hands on
  // camera (normal 90th pct: CV 0.70, 5 hesitations): lenient and lightly weighted.
  const rhythm = scoreLowerIsBetter(f.tapIntervalCv, 0.6, 1.2);
  const hesitation = scoreLowerIsBetter(f.tapHesitations, 5, 10);
  const tremorPower = scoreLowerIsBetter(f.tremorPowerRatio, 0.12, 0.55);
  const steadiness = scoreLowerIsBetter(f.holdDriftPx, 0.4, 1.1);

  // A dominant frequency in the 4-6 Hz rest-tremor band is the concerning
  // pattern; physiological tremor sits higher (8-12 Hz) and is unremarkable.
  // `tremorDetected === false` means the hold was measured and no oscillation
  // stood out from tracking noise: that is a normal result, not a missing one.
  const tremorBand = f.tremorDetected === false
    ? 100
    : isNum(f.tremorPeakHz) && isNum(f.tremorPowerRatio)
      ? f.tremorPeakHz >= 3.5 && f.tremorPeakHz <= 6.5
        ? scoreLowerIsBetter(f.tremorPowerRatio, 0.08, 0.4)
        : 100
      : null;

  const indicators = [
    indicator({
      key: 'tapFrequency',
      label: 'Tap frequency',
      value: f.tapFrequencyHz,
      unit: 'Hz',
      score: speed,
      normal: '>= 2.2 taps/s',
      note: 'Bradykinesia shows up as slowed repetitive movement.',
    }),
    indicator({
      key: 'tapAmplitude',
      label: 'Tap amplitude',
      value: f.tapAmplitudeMean,
      unit: '',
      score: amplitude,
      normal: '> 0.60',
      note: 'How wide the thumb and index finger separate.',
    }),
    indicator({
      key: 'decrement',
      label: 'Amplitude decrement',
      value: f.tapAmplitudeDecay,
      unit: '',
      score: decay,
      normal: '< 0.30',
      note: 'Taps shrinking over the trial (sequence effect).',
    }),
    indicator({
      key: 'rhythm',
      label: 'Rhythm consistency',
      value: f.tapIntervalCv,
      unit: '',
      score: rhythm,
      normal: '< 0.60',
      note: 'Variability between successive taps.',
    }),
    indicator({
      key: 'hesitations',
      label: 'Hesitations / halts',
      value: f.tapHesitations,
      unit: '',
      score: hesitation,
      normal: '<= 5',
      note: 'Momentary freezing during tapping.',
    }),
    indicator({
      key: 'tremorFrequency',
      label: 'Dominant tremor frequency',
      value: f.tremorPeakHz,
      unit: 'Hz',
      score: tremorBand,
      normal: 'outside 3.5 - 6.5 Hz',
      note: 'Rest tremor characteristically sits in the 4-6 Hz band.',
    }),
    indicator({
      key: 'tremorPower',
      label: 'Tremor power ratio',
      value: f.tremorPowerRatio,
      unit: '',
      score: tremorPower,
      normal: '< 0.12',
      note: 'Share of hand motion energy that is oscillatory.',
    }),
    indicator({
      key: 'steadiness',
      label: 'Postural steadiness',
      value: f.holdDriftPx,
      unit: '',
      score: steadiness,
      normal: '< 0.40',
      note: 'Slow drift while holding the hand out (palm lengths).',
    }),
  ];

  const base = weightedMean([
    { score: speed, weight: 0.24 },
    { score: amplitude, weight: 0.16 },
    { score: decay, weight: 0.16 },
    { score: rhythm, weight: 0.05 },
    { score: tremorBand, weight: 0.18 },
    { score: tremorPower, weight: 0.1 },
    { score: steadiness, weight: 0.08 },
    { score: hesitation, weight: 0.03 },
  ]);

  const score = clamp(base * (0.85 + 0.15 * quality));

  const flags = [];
  if (isNum(tremorBand) && tremorBand < 55) flags.push('hand_rest_tremor_band');
  if (isNum(decay) && decay < 45) flags.push('hand_amplitude_decrement');
  if (isNum(speed) && speed < 45) flags.push('hand_bradykinesia');

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
  if (isNum(f.sampleCount) && f.sampleCount < 60) q *= f.sampleCount / 60;
  return Number(clamp(q, 0, 1).toFixed(3));
}

export default scoreHand;
