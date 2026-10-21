import {
  cv,
  detectPitch,
  findPeaks,
  mean,
  median,
  pitchSpreadSemitones,
  rms,
  smooth,
  std,
} from './dsp.js';

const FRAME_MS = 40;
const HOP_MS = 20;

/**
 * Minimum normalised-correlation "clarity" for a frame to count as voiced.
 * 0.7 agrees with Praat's voicing decision on ~91% of frames of real read
 * speech (KCL recordings); the previous 0.42 also called breathy consonants voiced.
 */
const VOICING_CLARITY = 0.7;

/**
 * Extracts the voice feature vector the server's scoring engine expects.
 *
 * The recording is a sustained vowel followed by a read sentence. Each measure
 * comes from the part it is defined on: perturbation (jitter, shimmer), HNR and
 * phonation from the vowel; prosody, pauses, rate and loudness control from the
 * sentence. Measuring "jitter" across connected speech (as before) mostly
 * captured normal intonation and failed nearly every healthy speaker.
 *
 * @param {AudioBuffer} audioBuffer decoded recording (sustained vowel + read sentence)
 * @param {{sustainSec?: number}} [options] length of the leading vowel segment;
 *   without it every measure uses the whole recording
 * @returns {object} feature vector
 */
export function extractVoiceFeatures(audioBuffer, { sustainSec } = {}) {
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.getChannelData(0);
  const durationSec = audioBuffer.duration;

  const frameLen = Math.floor((FRAME_MS / 1000) * sampleRate);
  const hopLen = Math.floor((HOP_MS / 1000) * sampleRate);
  const frameCount = Math.max(0, Math.floor((samples.length - frameLen) / hopLen) + 1);

  const energies = [];
  const peakAmps = [];
  const f0Track = [];
  const clarities = [];

  for (let i = 0; i < frameCount; i++) {
    const start = i * hopLen;
    const frame = samples.subarray(start, start + frameLen);

    energies.push(rms(frame));

    let peak = 0;
    for (let j = 0; j < frame.length; j++) {
      const v = Math.abs(frame[j]);
      if (v > peak) peak = v;
    }
    peakAmps.push(peak);

    const { f0, clarity } = detectPitch(frame, sampleRate);
    f0Track.push(f0);
    clarities.push(clarity);
  }

  if (frameCount < 10) {
    return { durationSec, voicedRatio: 0, snrDb: 0, insufficientData: true };
  }

  // ---- Voicing / silence segmentation -------------------------------------
  const sortedEnergy = [...energies].sort((a, b) => a - b);
  const noiseFloor = sortedEnergy[Math.floor(sortedEnergy.length * 0.1)] || 1e-6;
  const speechLevel = sortedEnergy[Math.floor(sortedEnergy.length * 0.9)] || 1e-6;
  // Frame ranges for the two tasks.
  const split = sustainSec > 0
    ? Math.min(frameCount, Math.max(0, Math.round((sustainSec * 1000) / HOP_MS)))
    : null;
  const vowelRange = split === null ? [0, frameCount] : [0, split];
  const readRange = split === null || frameCount - split < 25 ? [0, frameCount] : [split, frameCount];
  const framesIn = ([a, b]) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);

  // Silence threshold from a segment's own loudness distribution, capped well
  // below its speech level. Per segment, because the sustained vowel is usually
  // much louder than the sentence: one threshold for the whole take counted
  // ordinary reading as "pauses" and missed its syllables. The cap handles takes
  // with little silence, where the 10th percentile is the voice itself.
  const thresholdFor = (frames) => {
    const sorted = frames.map((i) => energies[i]).sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)] || 1e-6;
    const level = sorted[Math.floor(sorted.length * 0.9)] || 1e-6;
    return Math.min(Math.max(floor * 2.2, level * 0.08), level * 0.25);
  };
  const vowelThreshold = thresholdFor(framesIn(vowelRange));
  const readThreshold = thresholdFor(framesIn(readRange));
  const silenceThresholdAt = (i) => (split !== null && i < split ? vowelThreshold : readThreshold);
  const silenceThreshold = readThreshold;
  const isVoiced = (i) => f0Track[i] > 0 && clarities[i] > VOICING_CLARITY && energies[i] > silenceThresholdAt(i);

  const voicedIdx = framesIn([0, frameCount]).filter(isVoiced);
  const voicedRatio = voicedIdx.length / frameCount;
  const snrDb = 20 * Math.log10(Math.max(speechLevel, 1e-9) / Math.max(noiseFloor, 1e-9));

  const readFrames = framesIn(readRange);
  const pauseRatio = readFrames.filter((i) => energies[i] <= silenceThreshold).length / Math.max(1, readFrames.length);

  if (voicedIdx.length < 8) {
    return { durationSec, voicedRatio, pauseRatio, snrDb, insufficientData: true };
  }

  // ---- Vowel: perturbation, HNR, phonation --------------------------------
  // Frame-level (20 ms hop) perturbation of the sustained vowel. This is NOT
  // cycle-to-cycle MDVP jitter/shimmer; when the voice model runs, the server
  // uses its Praat measures instead. Thresholds for these frame-level values
  // are calibrated on real healthy recordings (see server voice scorer).
  const vowelVoiced = framesIn(vowelRange).filter(isVoiced);
  const pairs = [];
  for (let k = 0; k < vowelVoiced.length - 1; k++) {
    if (vowelVoiced[k + 1] - vowelVoiced[k] === 1) pairs.push([vowelVoiced[k], vowelVoiced[k + 1]]);
  }

  let jitterPercent = null;
  let shimmerPercent = null;
  if (pairs.length >= 10) {
    const periodDiffs = pairs.map(([a, b]) => Math.abs(1 / f0Track[a] - 1 / f0Track[b]));
    const meanPeriod = mean(pairs.map(([a]) => 1 / f0Track[a]));
    jitterPercent = meanPeriod > 0 ? (mean(periodDiffs) / meanPeriod) * 100 : null;
    const ampDiffs = pairs.map(([a, b]) => Math.abs(peakAmps[a] - peakAmps[b]));
    const meanAmp = mean(pairs.map(([a]) => peakAmps[a]));
    shimmerPercent = meanAmp > 0 ? (mean(ampDiffs) / meanAmp) * 100 : null;
  }

  // HNR from periodicity: for a normalised correlation peak r the harmonic/noise
  // power ratio is r/(1-r).
  const hnrFrames = vowelVoiced.length >= 10 ? vowelVoiced : voicedIdx;
  const voicedClarity = median(hnrFrames.map((i) => Math.min(0.999, clarities[i])));
  const hnrDb = 10 * Math.log10(Math.max(1e-3, voicedClarity / Math.max(1e-3, 1 - voicedClarity)));

  // Longest sustained phonation, bridging dropouts of up to MAX_GAP frames
  // (60 ms): momentary dips in pitch clarity are tracking noise, not breaths.
  const MAX_GAP = 3;
  let longestRun = 0;
  let runStart = -1;
  let gap = 0;
  for (const i of framesIn(vowelRange)) {
    if (isVoiced(i)) {
      if (runStart < 0) runStart = i;
      gap = 0;
      longestRun = Math.max(longestRun, i - runStart + 1);
    } else if (runStart >= 0 && ++gap > MAX_GAP) {
      runStart = -1;
      gap = 0;
    }
  }
  const maxPhonationSec = (longestRun * HOP_MS) / 1000;

  // ---- Sentence: prosody, rate, loudness ----------------------------------
  const readVoiced = readFrames.filter(isVoiced);
  const prosodyFrames = readVoiced.length >= 10 ? readVoiced : voicedIdx;
  const f0Mean = median(voicedIdx.map((i) => f0Track[i]));
  const f0StdSemitones = pitchSpreadSemitones(prosodyFrames.map((i) => f0Track[i]));

  // Syllable nuclei are peaks in the energy envelope of the sentence.
  const readEnergies = readFrames.map((i) => energies[i]);
  const envelope = smooth(readEnergies, 5);
  const envPeaks = findPeaks(envelope, {
    minDistance: Math.max(2, Math.round(120 / HOP_MS)), // syllables rarely under 120 ms apart
    minProminence: silenceThreshold * 1.6,
  });
  const readSec = (readFrames.length * HOP_MS) / 1000;
  const speechRateSyll = readSec > 0 ? envPeaks.length / readSec : 0;

  const intensityCv = cv(prosodyFrames.map((i) => energies[i]));

  return {
    durationSec: Number(durationSec.toFixed(2)),
    jitterPercent: round(jitterPercent, 3),
    shimmerPercent: round(shimmerPercent, 3),
    hnrDb: round(hnrDb, 2),
    f0Mean: round(f0Mean, 1),
    f0StdSemitones: round(f0StdSemitones, 3),
    voicedRatio: round(voicedRatio, 3),
    pauseRatio: round(pauseRatio, 3),
    speechRateSyll: round(speechRateSyll, 2),
    maxPhonationSec: round(maxPhonationSec, 2),
    intensityCv: round(intensityCv, 3),
    snrDb: round(snrDb, 1),
    frameCount,
    perturbationSource: 'browser-frame-level',
  };
}

/** Overall usability of the recording, 0..1. */
export function voiceQuality(features) {
  if (!features || features.insufficientData) return 0;
  let q = 1;
  q *= clampRange(features.voicedRatio / 0.45, 0, 1);
  q *= clampRange((features.snrDb - 4) / 16, 0, 1);
  if (features.durationSec < 8) q *= features.durationSec / 8;
  return Number(Math.max(0, Math.min(1, q)).toFixed(3));
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const clampRange = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Decodes a recorded Blob into an AudioBuffer. */
export async function decodeRecording(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close().catch(() => {});
  }
}
