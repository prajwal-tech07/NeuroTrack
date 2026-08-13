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
 *   1. Finger tapping - thumb tip to index tip, 15 s, as big and fast as possible.
 *   2. Postural hold  - hand held out steady, 10 s.
 *
 * Features consumed:
 *   tapFrequencyHz        taps per second                  (>= 4 Hz typical)
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

  const speed = scoreHigherIsBetter(f.tapFrequencyHz, 4.0, 1.2);
  const amplitude = scoreHigherIsBetter(f.tapAmplitudeMean, 0.3, 0.07);
  const decay = scoreLowerIsBetter(f.tapAmplitudeDecay, 0.12, 0.55);
  const rhythm = scoreLowerIsBetter(f.tapIntervalCv, 0.18, 0.6);
  const hesitation = scoreLowerIsBetter(f.tapHesitations, 0, 6);
  const tremorPower = scoreLowerIsBetter(f.tremorPowerRatio, 0.12, 0.55);
  const steadiness = scoreLowerIsBetter(f.holdDriftPx, 0.02, 0.12);

  // A dominant frequency in the 4-6 Hz rest-tremor band is the concerning
  // pattern; physiological tremor sits higher (8-12 Hz) and is unremarkable.
  const tremorBand =
    isNum(f.tremorPeakHz) && isNum(f.tremorPowerRatio)
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
      normal: '>= 4 taps/s',
      note: 'Bradykinesia shows up as slowed repetitive movement.',
    }),
    indicator({
      key: 'tapAmplitude',
      label: 'Tap amplitude',
      value: f.tapAmplitudeMean,
      unit: '',
      score: amplitude,
      normal: '> 0.30',
      note: 'How wide the thumb and index finger separate.',
    }),
    indicator({
      key: 'decrement',
      label: 'Amplitude decrement',
      value: f.tapAmplitudeDecay,
      unit: '',
      score: decay,
      normal: '< 0.12',
      note: 'Taps shrinking over the trial (sequence effect).',
    }),
    indicator({
      key: 'rhythm',
      label: 'Rhythm consistency',
      value: f.tapIntervalCv,
      unit: '',
      score: rhythm,
      normal: '< 0.18',
      note: 'Variability between successive taps.',
    }),
    indicator({
      key: 'hesitations',
      label: 'Hesitations / halts',
      value: f.tapHesitations,
      unit: '',
      score: hesitation,
      normal: '0',
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
      normal: '< 0.02',
      note: 'Slow drift while holding the hand out.',
    }),
  ];

  const base = weightedMean([
    { score: speed, weight: 0.18 },
    { score: amplitude, weight: 0.14 },
    { score: decay, weight: 0.14 },
    { score: rhythm, weight: 0.14 },
    { score: tremorBand, weight: 0.16 },
    { score: tremorPower, weight: 0.1 },
    { score: steadiness, weight: 0.08 },
    { score: hesitation, weight: 0.06 },
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
