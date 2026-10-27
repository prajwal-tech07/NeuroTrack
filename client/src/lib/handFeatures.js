import { cv, detrend, mean, median, spectralPeak, std } from './dsp.js';

/**
 * Thresholds below were calibrated on real MediaPipe recordings (PN Expert,
 * 215 doctor-rated postural holds, 196 finger-tapping trials) and on 240 fps
 * tracks of healthy tappers. Re-run: `npm run evaluate:hand` in server/.
 */
/** Tremor needs a clear spectral peak in the tremor band... */
const TREMOR_PEAKINESS = 14;
/**
 * ...and an oscillation (palm lengths, RMS, > ~2.5 Hz) well above landmark jitter.
 * 0.045 palm lengths is ~1.3 cm peak to peak. With these two limits 5% of holds
 * a doctor rated tremor-free are flagged (was 98%).
 */
const TREMOR_MIN_AMPLITUDE = 0.045;
const TREMOR_BAND = [3, 8];

/**
 * Hand test timeline (seconds from start). 'settle' periods give the user time
 * to get into position or switch hands and are not analysed. Shared by the
 * test UI and the end-to-end tests so they cannot drift apart.
 */
export const HAND_STAGES = [
  { until: 3, side: 'left', phase: 'settle' },
  { until: 13, side: 'left', phase: 'tap' },
  { until: 15, side: 'left', phase: 'settle' },
  { until: 22, side: 'left', phase: 'hold' },
  { until: 26, side: 'right', phase: 'settle' },
  { until: 36, side: 'right', phase: 'tap' },
  { until: 38, side: 'right', phase: 'settle' },
  { until: 45, side: 'right', phase: 'hold' },
];

/** HandLandmarker indices. */
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;
const PALM_POINTS = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];

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

/** Per-side sample buckets. Raw geometry is kept; scaling happens at analysis time. */
const emptySide = () => ({
  tapTimes: [],
  tapDistances: [], // thumb-index distance, image units
  tapPalms: [],
  holdTimes: [],
  holdTipX: [],
  holdTipY: [],
  holdCx: [], // palm centroid
  holdCy: [],
  holdPalms: [],
  frames: 0,
  detected: 0,
  wrongHand: 0,
});

/**
 * Accumulates HandLandmarker output across cued sub-tasks:
 *
 *   left  / tap   -> finger tapping, left hand
 *   left  / hold  -> postural hold,  left hand
 *   right / tap   -> finger tapping, right hand
 *   right / hold  -> postural hold,  right hand
 *
 * plus 'settle' periods between them (getting into position, switching hands),
 * which are not analysed: frames from a hand that is still moving into place
 * read as slowing, decrement and hesitations.
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
    // Video width / height. Normalised x and y have different units unless
    // corrected, which makes distances depend on the hand's orientation.
    this.aspect = 4 / 3;
  }

  setSide(side) {
    this.side = side;
  }

  setPhase(phase) {
    this.phase = phase;
  }

  setAspect(aspect) {
    if (Number.isFinite(aspect) && aspect > 0.2 && aspect < 5) this.aspect = aspect;
  }

  /** Landmark in units of image height; z uses roughly the scale of x. */
  point(p) {
    return { x: p.x * this.aspect, y: p.y, z: (p.z ?? 0) * this.aspect };
  }

  push(result, timestampMs) {
    if (this.startMs === null) this.startMs = timestampMs;
    this.endMs = timestampMs;
    if (this.phase !== 'tap' && this.phase !== 'hold') return;

    const bucket = this.sides[this.side];
    bucket.frames++;

    const { hand, wrong } = pickHand(result, this.side);
    if (!hand) return;
    bucket.detected++;
    if (wrong) bucket.wrongHand++;

    const P = (i) => this.point(hand[i]);
    // 3D palm length: far less sensitive to how the hand is turned than the 2D one.
    const palm = dist3(P(WRIST), P(MIDDLE_MCP));

    if (this.phase === 'tap') {
      bucket.tapTimes.push(timestampMs);
      bucket.tapDistances.push(dist3(P(THUMB_TIP), P(INDEX_TIP)));
      bucket.tapPalms.push(palm);
    } else {
      const tip = P(INDEX_TIP);
      let cx = 0;
      let cy = 0;
      for (const i of PALM_POINTS) {
        const q = P(i);
        cx += q.x / PALM_POINTS.length;
        cy += q.y / PALM_POINTS.length;
      }
      bucket.holdTimes.push(timestampMs);
      bucket.holdTipX.push(tip.x);
      bucket.holdTipY.push(tip.y);
      bucket.holdCx.push(cx);
      bucket.holdCy.push(cy);
      bucket.holdPalms.push(palm);
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
      (s) => this.sides[s].tapDistances.length >= 40 || this.sides[s].holdTipX.length >= 40
    );
  }

  /**
   * Tapping analysis for one side.
   *
   * Distances are divided by the phase's median palm length (one constant), not
   * frame by frame: the per-frame ratio of two noisy lengths added ~13% noise
   * and inflated amplitude whenever the hand turned.
   *
   * - speed: dominant frequency of the drift-removed trace, with a check for
   *   the classic half-rate error (uneven taps put power at half the tap rate;
   *   on real recordings the spectrum alone reported half the true speed in
   *   >10% of trials), using a time-domain tap count.
   * - amplitude: 5th-95th percentile spread in 2 s windows (median over windows).
   * - rhythm (interval CV, hesitations) needs individual taps and is only
   *   reported when the frame rate is high enough to resolve them.
   */
  analyzeTaps(side) {
    const bucket = this.sides[side];
    const times = bucket.tapTimes;
    const n = times.length;
    if (n < 20) return null;

    const durationSec = (times[n - 1] - times[0]) / 1000;
    if (durationSec < 3) return null;
    const fps = (n - 1) / durationSec;

    const palm = median(bucket.tapPalms);
    if (!(palm > 1e-4)) return null;
    const raw = bucket.tapDistances.map((d) => d / palm);

    const range = percentile(raw, 95) - percentile(raw, 5);
    if (range < 0.05) return null; // hand never really moved

    const rate = Math.max(8, Math.min(30, Math.round(fps)));
    const { series } = resampleUniform(times, raw, rate);
    // Remove posture drift (slower than ~0.8 Hz) so it cannot win the spectrum.
    const hp = detrend(series, Math.max(5, Math.round(rate * 1.2)));
    const maxHz = Math.min(8, rate / 2 - 0.25);
    const spec = spectralPeak(hp, rate, { minHz: 0.6, maxHz });
    let tapFrequencyHz = spec.peakHz;
    if (!(tapFrequencyHz > 0)) return null;

    const counted = cycleRate(hp, rate);
    if (counted && counted > tapFrequencyHz * 1.6 && counted < tapFrequencyHz * 2.6 && counted <= maxHz) {
      tapFrequencyHz = counted;
    }

    // Amplitude per 2 s window, in time order (for the decrement).
    const amplitudes = [];
    const windowMs = 2000;
    for (let start = times[0]; start + windowMs <= times[n - 1] + 1; start += windowMs) {
      const w = [];
      for (let i = 0; i < n; i++) if (times[i] >= start && times[i] < start + windowMs) w.push(raw[i]);
      if (w.length >= 6) amplitudes.push(percentile(w, 95) - percentile(w, 5));
    }
    if (!amplitudes.length) amplitudes.push(range);
    // Windows at the end with almost no movement mean the user stopped before
    // the countdown ended, not that the taps shrank: drop them from the
    // decrement (a real decrement fades, it does not stop dead).
    const typical = median(amplitudes);
    let stoppedEarlyWindows = 0;
    while (amplitudes.length > 2 && amplitudes[amplitudes.length - 1] < typical * 0.3) {
      amplitudes.pop();
      stoppedEarlyWindows++;
    }
    const third = Math.max(1, Math.floor(amplitudes.length / 3));
    const firstThird = mean(amplitudes.slice(0, third));
    const lastThird = mean(amplitudes.slice(-third));
    const decay = firstThird > 0 ? Math.max(0, (firstThird - lastThird) / firstThird) : 0;

    // Individual taps need >= ~4 samples per cycle.
    let tapIntervalCv = null;
    let tapHesitations = null;
    if (fps >= 4 * tapFrequencyHz) {
      const taps = tapTimesOf(raw, times);
      if (taps.length >= 5) {
        const intervals = [];
        for (let i = 1; i < taps.length; i++) intervals.push((taps[i] - taps[i - 1]) / 1000);
        const medianInterval = median(intervals) || 1;
        tapIntervalCv = cv(intervals);
        tapHesitations = intervals.filter((iv) => iv > medianInterval * 2.5).length;
      }
    }

    return {
      tapCount: Math.round(tapFrequencyHz * durationSec),
      tapFrequencyHz,
      tapAmplitudeMean: median(amplitudes),
      tapAmplitudeDecay: decay,
      tapIntervalCv,
      tapHesitations,
      tapStoppedEarlySec: stoppedEarlyWindows * (windowMs / 1000),
      fps,
    };
  }

  /**
   * Tremor and drift analysis of one side's postural hold.
   *
   * Positions are measured relative to the hold's own median position and
   * divided by its median palm length. Dividing raw image coordinates by a
   * per-frame palm length (as before) turned every small change in hand
   * distance or tilt into "drift" and "tremor": on real recordings rated
   * tremor-free by a doctor it reported a tremor in 78 of 80.
   *
   * A tremor is only reported when there is one: a clear spectral peak in the
   * 3-8 Hz band AND an oscillation clearly larger than landmark noise.
   */
  analyzeHold(side) {
    const b = this.sides[side];
    const n = b.holdTimes.length;
    if (n < 30) return null;

    const durationSec = (b.holdTimes[n - 1] - b.holdTimes[0]) / 1000;
    if (durationSec < 2) return null;
    const fps = (n - 1) / durationSec;
    const palm = median(b.holdPalms);
    if (!(palm > 1e-4)) return null;

    // Analyse at the real frame rate: upsampling invents spectrum above it.
    const rate = Math.max(8, Math.min(30, Math.round(fps)));
    const rel = (arr) => {
      const m = median(arr);
      return arr.map((v) => (v - m) / palm);
    };
    const { series: tx } = resampleUniform(b.holdTimes, rel(b.holdTipX), rate);
    const { series: ty } = resampleUniform(b.holdTimes, rel(b.holdTipY), rate);
    const { series: cxs } = resampleUniform(b.holdTimes, rel(b.holdCx), rate);
    const { series: cys } = resampleUniform(b.holdTimes, rel(b.holdCy), rate);
    if (tx.length < 16) return null;

    // Tremor: oscillation above ~2.5 Hz (slow sway removed), on the fingertip.
    const hpWin = Math.max(3, Math.round(rate / 2.5));
    const hx = detrend(tx, hpWin);
    const hy = detrend(ty, hpWin);
    const maxHz = Math.min(TREMOR_BAND[1], rate / 2 - 0.25);
    const opts = { minHz: TREMOR_BAND[0], maxHz, bandLo: 3.5, bandHi: 6.5 };
    const sx = spectralPeak(detrend(tx, Math.max(5, Math.round(rate * 0.7))), rate, opts);
    const sy = spectralPeak(detrend(ty, Math.max(5, Math.round(rate * 0.7))), rate, opts);
    const dominant = sx.peakPower >= sy.peakPower ? sx : sy;
    const amplitude = Math.hypot(std(hx), std(hy));
    const tremorDetected =
      maxHz > TREMOR_BAND[0] + 0.5 && dominant.peakiness >= TREMOR_PEAKINESS && amplitude >= TREMOR_MIN_AMPLITUDE;

    // Slow drift of the palm: first quarter vs last quarter of the hold.
    const q = Math.max(2, Math.floor(cxs.length / 4));
    const driftX = median(cxs.slice(-q)) - median(cxs.slice(0, q));
    const driftY = median(cys.slice(-q)) - median(cys.slice(0, q));

    return {
      tremorDetected,
      tremorPeakHz: tremorDetected ? dominant.peakHz : null,
      tremorPowerRatio: tremorDetected ? dominant.bandRatio : 0,
      tremorAmplitude: amplitude,
      tremorPeakiness: dominant.peakiness,
      holdDriftPx: Math.hypot(driftX, driftY),
      // Image y grows downward: positive = the hand sank.
      holdDropY: driftY,
      holdJitter: (std(cxs) + std(cys)) / 2,
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
      tapStoppedEarlySec: taps?.tapStoppedEarlySec ?? null,
      tremorDetected: hold ? hold.tremorDetected : null,
      tremorPeakHz: round(hold?.tremorPeakHz, 2),
      tremorAmplitude: round(hold?.tremorAmplitude, 4),
      tremorPowerRatio: round(hold?.tremorPowerRatio, 4),
      tremorPeakiness: round(hold?.tremorPeakiness, 2),
      holdDriftPx: round(hold?.holdDriftPx, 4),
      holdDropY: round(hold?.holdDropY, 4),
      trackedRatio: round(bucket.frames ? bucket.detected / bucket.frames : 0, 3),
      wrongHandRatio: round(bucket.detected ? bucket.wrongHand / bucket.detected : 0, 3),
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
        this.sides.left.holdTipX.length +
        this.sides.right.tapDistances.length +
        this.sides.right.holdTipX.length,
      protocol: 'settle-v2',
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
 * Chooses the hand being tested. With two hands in view, MediaPipe's
 * handedness label decides (checked on 320 labelled hand photos: it names the
 * real hand 99% of the time on an un-mirrored camera image, which is what the
 * landmarker sees — the preview is only mirrored on screen). With one hand in
 * view it is used as is: the cue says which hand it should be.
 */
function pickHand(result, side) {
  const hands = result?.landmarks || [];
  if (!hands.length) return { hand: null, wrong: false };
  const labels = result.handedness || result.handednesses || [];
  const labelOf = (i) => labels[i]?.[0]?.categoryName?.toLowerCase?.();
  const scoreOf = (i) => labels[i]?.[0]?.score ?? 0;

  if (hands.length === 1) {
    const wrong = labelOf(0) && labelOf(0) !== side && scoreOf(0) > 0.85;
    return { hand: hands[0], wrong: Boolean(wrong) };
  }
  let idx = hands.findIndex((_, i) => labelOf(i) === side);
  if (idx < 0) {
    // No label match: take the larger (nearer, raised) hand.
    const size = (h) => Math.hypot(h[WRIST].x - h[MIDDLE_MCP].x, h[WRIST].y - h[MIDDLE_MCP].y);
    idx = size(hands[0]) >= size(hands[1]) ? 0 : 1;
  }
  return { hand: hands[idx], wrong: false };
}

/**
 * Tap rate from a time-domain count: one tap per rise through the upper band
 * of a hysteresis trigger, so uneven taps are each counted once.
 */
function cycleRate(x, fs) {
  if (x.length < 10) return null;
  const lo = percentile(x, 10);
  const hi = percentile(x, 90);
  const mid = (lo + hi) / 2;
  const h = (hi - lo) * 0.2;
  if (!(h > 0)) return null;
  let state = 0;
  const rises = [];
  for (let i = 0; i < x.length; i++) {
    if (state <= 0 && x[i] > mid + h) {
      state = 1;
      rises.push(i);
    } else if (state >= 0 && x[i] < mid - h) {
      state = -1;
    }
  }
  if (rises.length < 4) return null;
  return (rises.length - 1) / ((rises[rises.length - 1] - rises[0]) / fs);
}

/** Times of individual tap openings (hysteresis on a drift-removed copy). */
function tapTimesOf(raw, times) {
  const fpsWin = Math.max(5, Math.round(((raw.length - 1) / ((times[times.length - 1] - times[0]) / 1000)) * 1.2));
  const x = detrend(raw, fpsWin);
  const lo = percentile(x, 10);
  const hi = percentile(x, 90);
  const mid = (lo + hi) / 2;
  const h = (hi - lo) * 0.2;
  const out = [];
  let state = 0;
  let best = -Infinity;
  let bestT = null;
  for (let i = 0; i < x.length; i++) {
    if (state <= 0 && x[i] > mid + h) {
      state = 1;
      best = x[i];
      bestT = times[i];
    } else if (state === 1) {
      if (x[i] > best) {
        best = x[i];
        bestT = times[i];
      }
      if (x[i] < mid - h) {
        out.push(bestT);
        state = -1;
      }
    } else if (state >= 0 && x[i] < mid - h) {
      state = -1;
    }
  }
  return out;
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

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

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
