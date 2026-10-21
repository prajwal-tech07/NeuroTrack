import { cv, detrend, dist, findPeaks, mean, median, spectralPeak, std } from './dsp.js';

/** A tremor peak must stand this many times above the median spectral power... */
const TREMOR_PEAKINESS = 6;
/** ...and move at least this much (palm lengths, ~3 mm), above landmark jitter. */
const TREMOR_MIN_AMPLITUDE = 0.03;

/** HandLandmarker indices. */
const WRIST = 0;
const THUMB_TIP = 4;
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

/** Per-side sample buckets. */
const emptySide = () => ({
  tapTimes: [],
  tapDistances: [],
  holdTimes: [],
  holdX: [],
  holdY: [],
  frames: 0,
  detected: 0,
});

/**
 * Accumulates HandLandmarker output across four sub-tasks:
 *
 *   left  / tap   -> finger tapping, left hand
 *   left  / hold  -> postural hold,  left hand
 *   right / tap   -> finger tapping, right hand
 *   right / hold  -> postural hold,  right hand
 *
 * Testing both hands is what makes laterality measurable: Parkinsonian
 * slowing is broadly symmetric, whereas hemiparesis affects one side only.
 * The caller drives the sequence with `setSide()` and `setPhase()`.
 */
export class HandTracker {
  constructor() {
    this.side = 'left';
    this.phase = 'tap';
    this.sides = { left: emptySide(), right: emptySide() };
    this.startMs = null;
    this.endMs = null;
  }

  setSide(side) {
    this.side = side;
  }

  setPhase(phase) {
    this.phase = phase;
  }

  push(result, timestampMs) {
    const bucket = this.sides[this.side];
    bucket.frames++;

    if (this.startMs === null) this.startMs = timestampMs;
    this.endMs = timestampMs;

    const lm = result?.landmarks?.[0];
    if (!lm) return;
    bucket.detected++;

    // Palm length normalises for how close the hand is to the camera.
    const palm = dist(lm[WRIST], lm[MIDDLE_MCP]) || 1e-6;

    if (this.phase === 'tap') {
      bucket.tapTimes.push(timestampMs);
      bucket.tapDistances.push(dist(lm[THUMB_TIP], lm[INDEX_TIP]) / palm);
    } else {
      bucket.holdTimes.push(timestampMs);
      bucket.holdX.push(lm[INDEX_TIP].x / palm);
      bucket.holdY.push(lm[INDEX_TIP].y / palm);
    }
  }

  get durationSec() {
    return this.startMs === null ? 0 : Math.max(0, (this.endMs - this.startMs) / 1000);
  }

  get trackedRatio() {
    const frames = this.sides.left.frames + this.sides.right.frames;
    const detected = this.sides.left.detected + this.sides.right.detected;
    return frames ? detected / frames : 0;
  }

  /** True once at least one side produced enough data to score. */
  get isUsable() {
    return ['left', 'right'].some(
      (s) => this.sides[s].tapDistances.length >= 40 || this.sides[s].holdX.length >= 40
    );
  }

  /**
   * Tapping analysis for one side, built to give the same answer at 12 fps as at
   * 30 fps. Browsers often analyse far fewer frames than the camera delivers,
   * and the previous peak-counting version read a healthy hand as slow and
   * small on slower machines.
   *
   * - speed: dominant frequency of the uniformly resampled trace (spectral,
   *   so it does not depend on catching every peak)
   * - amplitude: 5th-95th percentile spread in 2 s windows. Frames land at
   *   different phases of successive taps, so the spread still reaches the
   *   true opening even when individual peaks are under-sampled.
   * - rhythm (interval CV, hesitations) needs individual taps and is only
   *   reported when the frame rate is high enough to resolve them.
   */
  analyzeTaps(side) {
    const bucket = this.sides[side];
    const raw = bucket.tapDistances;
    const times = bucket.tapTimes;
    const n = raw.length;
    if (n < 20) return null;

    const durationSec = (times[n - 1] - times[0]) / 1000;
    if (durationSec < 3) return null;
    const fps = (n - 1) / durationSec;

    const range = percentile(raw, 95) - percentile(raw, 5);
    if (range < 0.05) return null; // hand never really moved

    const rate = Math.max(8, Math.min(30, Math.round(fps)));
    const { series } = resampleUniform(times, raw, rate);
    const spec = spectralPeak(series, rate, { minHz: 0.8, maxHz: Math.min(8, rate / 2 - 0.25) });
    const tapFrequencyHz = spec.peakHz;
    if (!(tapFrequencyHz > 0)) return null;

    // Amplitude per 2 s window, in time order (for the decrement).
    const amplitudes = [];
    const windowMs = 2000;
    for (let start = times[0]; start + windowMs <= times[n - 1] + 1; start += windowMs) {
      const w = [];
      for (let i = 0; i < n; i++) if (times[i] >= start && times[i] < start + windowMs) w.push(raw[i]);
      if (w.length >= 6) amplitudes.push(percentile(w, 95) - percentile(w, 5));
    }
    if (!amplitudes.length) amplitudes.push(range);
    const third = Math.max(1, Math.floor(amplitudes.length / 3));
    const firstThird = mean(amplitudes.slice(0, third));
    const lastThird = mean(amplitudes.slice(-third));
    const decay = firstThird > 0 ? Math.max(0, (firstThird - lastThird) / firstThird) : 0;

    // Individual taps need >= ~4 samples per cycle.
    let tapIntervalCv = null;
    let tapHesitations = null;
    if (fps >= 4 * tapFrequencyHz) {
      const peaks = findPeaks(raw, {
        minDistance: Math.max(2, Math.round(fps / 8)),
        minProminence: percentile(raw, 5) + range * 0.5,
      });
      if (peaks.length >= 4) {
        const intervals = [];
        for (let i = 1; i < peaks.length; i++) intervals.push((times[peaks[i]] - times[peaks[i - 1]]) / 1000);
        const medianInterval = median(intervals) || 1;
        tapIntervalCv = cv(intervals);
        tapHesitations = intervals.filter((iv) => iv > medianInterval * 2).length;
      }
    }

    return {
      tapCount: Math.round(tapFrequencyHz * durationSec),
      tapFrequencyHz,
      tapAmplitudeMean: median(amplitudes),
      tapAmplitudeDecay: decay,
      tapIntervalCv,
      tapHesitations,
      fps,
    };
  }

  /**
   * Tremor and drift analysis of one side's postural hold.
   *
   * A tremor is only reported when there is one: a clear spectral peak well
   * above the background AND a movement larger than landmark noise. Reporting
   * the 4-6 Hz share of pure tracking noise (as before) flagged healthy hands
   * with a "rest tremor".
   */
  analyzeHold(side) {
    const bucket = this.sides[side];
    const n = bucket.holdX.length;
    if (n < 30) return null;

    const durationSec = (bucket.holdTimes[n - 1] - bucket.holdTimes[0]) / 1000;
    if (durationSec < 2) return null;
    const fps = (n - 1) / durationSec;
    // Analyse at the real frame rate: upsampling invents spectrum above it.
    const rate = Math.max(8, Math.min(30, Math.round(fps)));
    const { series: xs } = resampleUniform(bucket.holdTimes, bucket.holdX, rate);
    const { series: ys } = resampleUniform(bucket.holdTimes, bucket.holdY, rate);
    if (xs.length < 16) return null;

    const maxHz = Math.min(12, rate / 2 - 0.25);
    const opts = { minHz: 1, maxHz, bandLo: 3.5, bandHi: 6.5 };
    const sx = spectralPeak(xs, rate, opts);
    const sy = spectralPeak(ys, rate, opts);
    const dominant = sx.peakPower >= sy.peakPower ? sx : sy;
    const axis = dominant === sx ? xs : ys;

    // Oscillation size in palm lengths, slow drift removed.
    const amplitude = std(detrend(axis, Math.max(5, Math.round(rate * 0.7))));
    const tremorDetected = dominant.peakiness >= TREMOR_PEAKINESS && amplitude >= TREMOR_MIN_AMPLITUDE;

    // Slow drift: how far the mean position moved from the first to last quarter.
    const q = Math.max(2, Math.floor(xs.length / 4));
    const driftX = mean(xs.slice(-q)) - mean(xs.slice(0, q));
    const driftY = mean(ys.slice(-q)) - mean(ys.slice(0, q));

    return {
      tremorDetected,
      tremorPeakHz: tremorDetected ? dominant.peakHz : null,
      tremorPowerRatio: tremorDetected ? dominant.bandRatio : 0,
      tremorAmplitude: amplitude,
      holdDriftPx: Math.hypot(driftX, driftY),
      // Downward drift specifically suggests weakness rather than tremor.
      holdDropY: driftY,
      holdJitter: (std(xs) + std(ys)) / 2,
    };
  }

  /** Combined per-side feature block, or null when that side has no usable data. */
  sideFeatures(side) {
    const taps = this.analyzeTaps(side);
    const hold = this.analyzeHold(side);
    if (!taps && !hold) return null;

    const bucket = this.sides[side];
    return {
      tapFrequencyHz: round(taps?.tapFrequencyHz, 3),
      tapCount: taps?.tapCount ?? null,
      tapAmplitudeMean: round(taps?.tapAmplitudeMean, 4),
      tapAmplitudeDecay: round(taps?.tapAmplitudeDecay, 4),
      tapIntervalCv: round(taps?.tapIntervalCv, 4),
      tapHesitations: taps?.tapHesitations ?? null,
      tremorDetected: hold ? hold.tremorDetected : null,
      tremorPeakHz: round(hold?.tremorPeakHz, 2),
      tremorAmplitude: round(hold?.tremorAmplitude, 4),
      tremorPowerRatio: round(hold?.tremorPowerRatio, 4),
      holdDriftPx: round(hold?.holdDriftPx, 4),
      holdDropY: round(hold?.holdDropY, 4),
      trackedRatio: round(bucket.frames ? bucket.detected / bucket.frames : 0, 3),
      fps: round(taps?.fps, 1),
      tapAnalysed: Boolean(taps),
      holdAnalysed: Boolean(hold),
    };
  }

  finish() {
    const left = this.sideFeatures('left');
    const right = this.sideFeatures('right');

    // The module score reports the *worse* side, so a one-sided deficit is not
    // averaged away into a healthy-looking number. Which pattern it represents
    // is decided separately by the laterality/pattern engine.
    const worse = pickWorse(left, right);

    return {
      durationSec: round(this.durationSec, 2),
      left,
      right,
      bothSidesTested: Boolean(left && right),

      // Flattened worse-side values keep the existing hand scorer working.
      ...(worse || {}),

      trackedRatio: round(this.trackedRatio, 3),
      sampleCount:
        this.sides.left.tapDistances.length +
        this.sides.left.holdX.length +
        this.sides.right.tapDistances.length +
        this.sides.right.holdX.length,
    };
  }

  quality() {
    const f = this.finish();
    let q = 1;
    q *= clamp01(f.trackedRatio / 0.7);
    if (f.durationSec < 24) q *= f.durationSec / 24;
    if (!f.bothSidesTested) q *= 0.6;
    if (!f.tapAnalysed) q *= 0.55;
    if (!f.holdAnalysed) q *= 0.7;
    // Below ~15 analysed frames per second tapping is under-sampled: report
    // lower confidence instead of letting it read as slowness.
    const fps = Math.min(...['left', 'right'].map((s) => f[s]?.fps).filter(Number.isFinite));
    if (Number.isFinite(fps) && fps < 15) q *= Math.max(0.3, fps / 15);
    return Number(clamp01(q).toFixed(3));
  }
}

/**
 * Picks the more impaired of two sides. Slower tapping and larger decrement
 * both mean worse, so a small composite decides it.
 */
function pickWorse(left, right) {
  if (!left) return right;
  if (!right) return left;
  // A side without tap data cannot be compared on tapping; prefer the measured one.
  if (left.tapFrequencyHz == null) return right.tapFrequencyHz == null ? left : right;
  if (right.tapFrequencyHz == null) return left;
  const burden = (s) => s.tapFrequencyHz - (s.tapAmplitudeDecay || 0) * 3;
  return burden(left) <= burden(right) ? left : right;
}

/** Rounds a measurement; anything not measured stays null (never 0, which reads as "no movement"). */
const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return 0;
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
