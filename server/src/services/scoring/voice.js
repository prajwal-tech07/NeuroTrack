import {
  ageAdjust,
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
 * Voice analysis.
 *
 * The browser records a sustained vowel + a read sentence and extracts the
 * feature vector below with the Web Audio API (autocorrelation pitch tracking,
 * peak-picking amplitude analysis, cepstral HNR estimate).
 *
 * Features consumed:
 *   jitterPercent      cycle-to-cycle F0 perturbation        (< 1.04% typical)
 *   shimmerPercent     cycle-to-cycle amplitude perturbation (< 3.81% typical)
 *   hnrDb              harmonics-to-noise ratio              (> 20 dB typical)
 *   f0Mean             mean fundamental frequency, Hz
 *   f0StdSemitones     pitch variability of read speech      (monotone speech = low)
 *   voicedRatio        fraction of frames with detected pitch
 *   pauseRatio         silence fraction of the read passage
 *   speechRateSyll     approximate syllables per second
 *   maxPhonationSec    sustained-vowel hold time
 *   intensityCv        loudness coefficient of variation
 */
export function scoreVoice(raw = {}) {
  const f = raw.features || raw;
  const quality = isNum(raw.quality) ? raw.quality : estimateQuality(f);

  if (quality < MIN_QUALITY) {
    return {
      completed: false,
      score: 0,
      quality,
      features: f,
      indicators: [],
      flags: ['voice_low_quality'],
    };
  }

  const jitter = scoreLowerIsBetter(f.jitterPercent, 1.04, 3.2);
  const shimmer = scoreLowerIsBetter(f.shimmerPercent, 3.81, 10.5);
  const hnr = scoreHigherIsBetter(f.hnrDb, 20, 7);
  const prosody = scoreHigherIsBetter(f.f0StdSemitones, 2.4, 0.6);
  const pauses = scoreLowerIsBetter(f.pauseRatio, 0.22, 0.55);
  const rate = scoreInRange(f.speechRateSyll, 3.5, 6.0, 1.6, 8.5);
  const phonation = scoreHigherIsBetter(f.maxPhonationSec, 12, 4);
  const loudness = scoreLowerIsBetter(f.intensityCv, 0.22, 0.6);

  const indicators = [
    indicator({
      key: 'jitter',
      label: 'Pitch stability (jitter)',
      value: f.jitterPercent,
      unit: '%',
      score: jitter,
      normal: '< 1.04%',
      note: 'Cycle-to-cycle variation in vocal fold vibration.',
    }),
    indicator({
      key: 'shimmer',
      label: 'Loudness stability (shimmer)',
      value: f.shimmerPercent,
      unit: '%',
      score: shimmer,
      normal: '< 3.81%',
      note: 'Cycle-to-cycle variation in amplitude.',
    }),
    indicator({
      key: 'hnr',
      label: 'Harmonics-to-noise ratio',
      value: f.hnrDb,
      unit: 'dB',
      score: hnr,
      normal: '> 20 dB',
      note: 'How clear the voice is relative to breathy noise.',
    }),
    indicator({
      key: 'prosody',
      label: 'Pitch variation (prosody)',
      value: f.f0StdSemitones,
      unit: 'st',
      score: prosody,
      normal: '> 2.4 semitones',
      note: 'Flat, monotone speech is a common early speech change.',
    }),
    indicator({
      key: 'pauses',
      label: 'Pause ratio',
      value: f.pauseRatio,
      unit: '',
      score: pauses,
      normal: '< 0.22',
      note: 'Proportion of the read passage spent silent.',
    }),
    indicator({
      key: 'rate',
      label: 'Speech rate',
      value: f.speechRateSyll,
      unit: 'syll/s',
      score: rate,
      normal: '3.5 - 6.0 syll/s',
      note: 'Both slowed and rushed speech are tracked.',
    }),
    indicator({
      key: 'phonation',
      label: 'Max phonation time',
      value: f.maxPhonationSec,
      unit: 's',
      score: phonation,
      normal: '> 12 s',
      note: 'How long a vowel can be held on one breath.',
    }),
    indicator({
      key: 'loudness',
      label: 'Loudness control',
      value: f.intensityCv,
      unit: '',
      score: loudness,
      normal: '< 0.22',
      note: 'Fading volume across a sentence.',
    }),
  ];

  const base = weightedMean([
    { score: jitter, weight: 0.18 },
    { score: shimmer, weight: 0.16 },
    { score: hnr, weight: 0.18 },
    { score: prosody, weight: 0.16 },
    { score: pauses, weight: 0.1 },
    { score: rate, weight: 0.08 },
    { score: phonation, weight: 0.08 },
    { score: loudness, weight: 0.06 },
  ]);

  const score = clamp(ageAdjust(base, raw.age) * (0.85 + 0.15 * quality));

  const flags = [];
  if (isNum(jitter) && jitter < 45) flags.push('voice_jitter_elevated');
  if (isNum(prosody) && prosody < 45) flags.push('voice_monotone');
  if (isNum(hnr) && hnr < 45) flags.push('voice_breathiness');

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
  if (isNum(f.voicedRatio)) q *= clamp(f.voicedRatio / 0.5, 0, 1);
  if (isNum(f.snrDb)) q *= clamp((f.snrDb - 3) / 17, 0, 1);
  if (isNum(f.durationSec) && f.durationSec < 4) q *= f.durationSec / 4;
  return Number(clamp(q, 0, 1).toFixed(3));
}

export default scoreVoice;
