import { cv, dist, findPeaks, mean, median, smooth, spectralPeak, std } from './dsp.js';

/** HandLandmarker indices. */
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;

/**
 * Resamples an irregular (t, v) series onto a uniform grid so the FFT sees
 * evenly-spaced samples. requestAnimationFrame timing is not uniform enough to
 * feed a spectrum directly.
 */
function resampleUniform(times, values, targetHz = 30) {
  if (times.length < 4) return { series: [], rate: targetHz };

  const t0 = times[0];
  const t1 = times[times.length - 1];
  const durationSec = (t1 - t0) / 1000;
  if (durationSec <= 0.2) return { series: [], rate: targetHz };

  const n = Math.max(8, Math.floor(durationSec * targetHz));
  const out = new Array(n);
  let j = 0;

  for (let i = 0; i < n; i++) {
    const t = t0 + (i / (n - 1)) * (t1 - t0);
    while (j < times.length - 2 && times[j + 1] < t) j++;
    const span = times[j + 1] - times[j] || 1;
    const frac = Math.max(0, Math.min(1, (t - times[j]) / span));
    out[i] = values[j] + (values[j + 1] - values[j]) * frac;
  }

  return { series: out, rate: targetHz };
}

/**
 * Accumulates HandLandmarker output across the two hand tasks:
 * `setPhase('tap')` during finger tapping, `setPhase('hold')` during the
 * steady postural hold.
 */
export class HandTracker {
  constructor() {
    this.phase = 'tap';
    this.frames = 0;
    this.detected = 0;

    this.tapTimes = [];
    this.tapDistances = [];

    this.holdTimes = [];
    this.holdX = [];
    this.holdY = [];

    this.startMs = null;
    this.endMs = null;
  }

  setPhase(phase) {
    this.phase = phase;
  }

  push(result, timestampMs) {
    this.frames++;
    if (this.startMs === null) this.startMs = timestampMs;
    this.endMs = timestampMs;

    const lm = result?.landmarks?.[0];
    if (!lm) return;
    this.detected++;

    // Palm length normalises for how close the hand is to the camera.
    const palm = dist(lm[WRIST], lm[MIDDLE_MCP]) || 1e-6;

    if (this.phase === 'tap') {
      this.tapTimes.push(timestampMs);
      this.tapDistances.push(dist(lm[THUMB_TIP], lm[INDEX_TIP]) / palm);
    } else {
      this.holdTimes.push(timestampMs);
      this.holdX.push(lm[INDEX_TIP].x / palm);
      this.holdY.push(lm[INDEX_TIP].y / palm);
    }
  }

  get durationSec() {
    return this.startMs === null ? 0 : Math.max(0, (this.endMs - this.startMs) / 1000);
  }

  get trackedRatio() {
    return this.frames ? this.detected / this.frames : 0;
  }

  get isUsable() {
    return this.tapDistances.length >= 40 || this.holdX.length >= 40;
  }

  /** Peak/trough analysis of the tapping trace. */
  analyzeTaps() {
    if (this.tapDistances.length < 20) return null;

    const signal = smooth(this.tapDistances, 3);
    const range = Math.max(...signal) - Math.min(...signal);
    if (range < 0.05) return null; // hand never really moved

    const tapDurationSec = (this.tapTimes[this.tapTimes.length - 1] - this.tapTimes[0]) / 1000;
    const fps = signal.length / Math.max(tapDurationSec, 0.001);

    // Taps faster than ~8 Hz are not physiologically plausible, so that sets the
    // minimum separation between accepted peaks.
    const peaks = findPeaks(signal, {
      minDistance: Math.max(2, Math.round(fps / 8)),
      minProminence: Math.min(...signal) + range * 0.45,
    });

    if (peaks.length < 3) return null;

    // Amplitude of each tap: peak height above the following local minimum.
    const amplitudes = [];
    for (let i = 0; i < peaks.length; i++) {
      const start = peaks[i];
      const end = i + 1 < peaks.length ? peaks[i + 1] : signal.length;
      let trough = signal[start];
      for (let k = start; k < end; k++) if (signal[k] < trough) trough = signal[k];
      amplitudes.push(signal[start] - trough);
    }

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
      intervals.push((this.tapTimes[peaks[i]] - this.tapTimes[peaks[i - 1]]) / 1000);
    }

    const third = Math.max(1, Math.floor(amplitudes.length / 3));
    const firstThird = mean(amplitudes.slice(0, third));
    const lastThird = mean(amplitudes.slice(-third));
    const decay = firstThird > 0 ? Math.max(0, (firstThird - lastThird) / firstThird) : 0;

    const medianInterval = median(intervals) || 1;
    const hesitations = intervals.filter((iv) => iv > medianInterval * 2).length;

    return {
      tapCount: peaks.length,
      tapFrequencyHz: tapDurationSec > 0 ? peaks.length / tapDurationSec : 0,
      tapAmplitudeMean: mean(amplitudes),
      tapAmplitudeDecay: decay,
      tapIntervalCv: cv(intervals),
      tapHesitations: hesitations,
      tapDurationSec,
    };
  }

  /** Spectral analysis of the postural-hold trace. */
  analyzeHold() {
    if (this.holdX.length < 30) return null;

    const { series: xs, rate } = resampleUniform(this.holdTimes, this.holdX);
    const { series: ys } = resampleUniform(this.holdTimes, this.holdY);
    if (xs.length < 16) return null;

    // Physiological tremor is 8-12 Hz; rest tremor sits at 4-6 Hz. We look for
    // the dominant oscillation and how much of the total energy sits in 3.5-6.5 Hz.
    const sx = spectralPeak(xs, rate, { minHz: 1, maxHz: 14, bandLo: 3.5, bandHi: 6.5 });
    const sy = spectralPeak(ys, rate, { minHz: 1, maxHz: 14, bandLo: 3.5, bandHi: 6.5 });
    const dominant = sx.peakPower >= sy.peakPower ? sx : sy;

    // Slow drift: how far the mean position moved from the first to the last quarter.
    const q = Math.max(2, Math.floor(xs.length / 4));
    const driftX = mean(xs.slice(-q)) - mean(xs.slice(0, q));
    const driftY = mean(ys.slice(-q)) - mean(ys.slice(0, q));

    return {
      tremorPeakHz: dominant.peakHz,
      tremorPowerRatio: Math.max(sx.bandRatio, sy.bandRatio),
      holdDriftPx: Math.hypot(driftX, driftY),
      holdJitter: (std(xs) + std(ys)) / 2,
      holdSampleCount: xs.length,
    };
  }

  finish() {
    const taps = this.analyzeTaps();
    const hold = this.analyzeHold();

    return {
      durationSec: round(this.durationSec, 2),
      tapFrequencyHz: round(taps?.tapFrequencyHz ?? 0, 3),
      tapCount: taps?.tapCount ?? 0,
      tapAmplitudeMean: round(taps?.tapAmplitudeMean ?? 0, 4),
      tapAmplitudeDecay: round(taps?.tapAmplitudeDecay ?? 0, 4),
      tapIntervalCv: round(taps?.tapIntervalCv ?? 0, 4),
      tapHesitations: taps?.tapHesitations ?? 0,
      tremorPeakHz: round(hold?.tremorPeakHz ?? 0, 2),
      tremorPowerRatio: round(hold?.tremorPowerRatio ?? 0, 4),
      holdDriftPx: round(hold?.holdDriftPx ?? 0, 4),
      holdJitter: round(hold?.holdJitter ?? 0, 5),
      trackedRatio: round(this.trackedRatio, 3),
      sampleCount: this.tapDistances.length + this.holdX.length,
      tapAnalysed: Boolean(taps),
      holdAnalysed: Boolean(hold),
    };
  }

  quality() {
    const f = this.finish();
    let q = 1;
    q *= clamp01(f.trackedRatio / 0.7);
    if (f.durationSec < 16) q *= f.durationSec / 16;
    if (!f.tapAnalysed) q *= 0.55;
    if (!f.holdAnalysed) q *= 0.7;
    return Number(clamp01(q).toFixed(3));
  }
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : 0);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
