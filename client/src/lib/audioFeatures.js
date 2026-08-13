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
 * Extracts the voice feature vector the server's scoring engine expects.
 *
 * @param {AudioBuffer} audioBuffer decoded recording (sustained vowel + read sentence)
 * @returns {object} feature vector
 */
export function extractVoiceFeatures(audioBuffer) {
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
  const silenceThreshold = Math.max(noiseFloor * 2.2, speechLevel * 0.08);

  const voicedIdx = [];
  for (let i = 0; i < frameCount; i++) {
    if (f0Track[i] > 0 && clarities[i] > 0.42 && energies[i] > silenceThreshold) voicedIdx.push(i);
  }

  const voicedRatio = voicedIdx.length / frameCount;
  const silentFrames = energies.filter((e) => e <= silenceThreshold).length;
  const pauseRatio = silentFrames / frameCount;
  const snrDb = 20 * Math.log10(Math.max(speechLevel, 1e-9) / Math.max(noiseFloor, 1e-9));

  if (voicedIdx.length < 8) {
    return {
      durationSec,
      voicedRatio,
      pauseRatio,
      snrDb,
      insufficientData: true,
    };
  }

  // ---- Jitter: cycle-to-cycle period perturbation --------------------------
  // Only consecutive voiced frames are comparable, so runs are handled separately.
  const periods = [];
  for (let k = 0; k < voicedIdx.length - 1; k++) {
    const a = voicedIdx[k];
    const b = voicedIdx[k + 1];
    if (b - a !== 1) continue;
    periods.push([1 / f0Track[a], 1 / f0Track[b]]);
  }

  let jitterPercent = 0;
  if (periods.length >= 3) {
    const diffs = periods.map(([t1, t2]) => Math.abs(t1 - t2));
    const meanPeriod = mean(periods.map(([t1]) => t1));
    jitterPercent = meanPeriod > 0 ? (mean(diffs) / meanPeriod) * 100 : 0;
  }

  // ---- Shimmer: cycle-to-cycle amplitude perturbation ----------------------
  const amps = [];
  for (let k = 0; k < voicedIdx.length - 1; k++) {
    const a = voicedIdx[k];
    const b = voicedIdx[k + 1];
    if (b - a !== 1) continue;
    amps.push([peakAmps[a], peakAmps[b]]);
  }

  let shimmerPercent = 0;
  if (amps.length >= 3) {
    const diffs = amps.map(([a1, a2]) => Math.abs(a1 - a2));
    const meanAmp = mean(amps.map(([a1]) => a1));
    shimmerPercent = meanAmp > 0 ? (mean(diffs) / meanAmp) * 100 : 0;
  }

  // ---- HNR from periodicity ------------------------------------------------
  // For a normalised autocorrelation peak r, the harmonic/noise power ratio is
  // r/(1-r); expressing that in dB gives a usable HNR estimate.
  const voicedClarity = median(voicedIdx.map((i) => Math.min(0.995, clarities[i])));
  const hnrDb = 10 * Math.log10(Math.max(1e-3, voicedClarity / Math.max(1e-3, 1 - voicedClarity)));

  // ---- Prosody -------------------------------------------------------------
  const voicedF0 = voicedIdx.map((i) => f0Track[i]);
  const f0Mean = median(voicedF0);
  const f0StdSemitones = pitchSpreadSemitones(voicedF0);

  // ---- Speech rate: syllable nuclei are peaks in the energy envelope -------
  const envelope = smooth(energies, 5);
  const envPeaks = findPeaks(envelope, {
    minDistance: Math.max(2, Math.round(120 / HOP_MS)), // syllables rarely under 120 ms apart
    minProminence: silenceThreshold * 1.6,
  });
  const speechRateSyll = durationSec > 0 ? envPeaks.length / durationSec : 0;

  // ---- Max phonation: longest unbroken voiced run --------------------------
  let longestRun = 0;
  let run = 0;
  for (let i = 0; i < frameCount; i++) {
    const voiced = f0Track[i] > 0 && clarities[i] > 0.42 && energies[i] > silenceThreshold;
    run = voiced ? run + 1 : 0;
    if (run > longestRun) longestRun = run;
  }
  const maxPhonationSec = (longestRun * HOP_MS) / 1000;

  // ---- Loudness control ----------------------------------------------------
  const intensityCv = cv(voicedIdx.map((i) => energies[i]));

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

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : 0);
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
