import { cv, dist, findPeaks, mean, smooth, std } from './dsp.js';

/** PoseLandmarker indices. */
const P = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftAnkle: 27,
  rightAnkle: 28,
};

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Accumulates PoseLandmarker output during the gait task (marching in place or
 * walking across frame) and derives cadence, variability, arm swing and sway.
 */
export class GaitTracker {
  constructor() {
    this.frames = 0;
    this.detected = 0;
    this.times = [];

    this.leftAnkleY = [];
    this.rightAnkleY = [];
    this.hipCenterX = [];
    this.leanDeg = [];
    this.leftWristOffset = [];
    this.rightWristOffset = [];

    this.startMs = null;
    this.endMs = null;
  }

  push(result, timestampMs) {
    this.frames++;
    if (this.startMs === null) this.startMs = timestampMs;
    this.endMs = timestampMs;

    const lm = result?.landmarks?.[0];
    if (!lm) return;

    const shoulderMid = mid(lm[P.leftShoulder], lm[P.rightShoulder]);
    const hipMid = mid(lm[P.leftHip], lm[P.rightHip]);

    // Torso length normalises every distance for camera distance and body size.
    const torso = dist(shoulderMid, hipMid);
    if (torso < 0.02) return; // pose is degenerate / person too far away

    this.detected++;
    this.times.push(timestampMs);

    this.leftAnkleY.push(lm[P.leftAnkle].y / torso);
    this.rightAnkleY.push(lm[P.rightAnkle].y / torso);
    this.hipCenterX.push(hipMid.x / torso);

    // Forward lean: angle between the shoulder->hip axis and vertical.
    const dx = shoulderMid.x - hipMid.x;
    const dy = hipMid.y - shoulderMid.y || 1e-6;
    this.leanDeg.push(Math.abs((Math.atan2(dx, dy) * 180) / Math.PI));

    // Arm swing measured as wrist displacement from the shoulder on the same side.
    this.leftWristOffset.push(dist(lm[P.leftWrist], lm[P.leftShoulder]) / torso);
    this.rightWristOffset.push(dist(lm[P.rightWrist], lm[P.rightShoulder]) / torso);
  }

  get durationSec() {
    return this.startMs === null ? 0 : Math.max(0, (this.endMs - this.startMs) / 1000);
  }

  get trackedRatio() {
    return this.frames ? this.detected / this.frames : 0;
  }

  get isUsable() {
    return this.detected >= 90 && this.durationSec >= 8;
  }

  /**
   * Step events for one leg. A step is a local maximum in foot elevation, which
   * is a local *minimum* in the landmark y coordinate (y grows downward), so we
   * peak-pick the negated trace.
   */
  stepTimes(ankleY) {
    if (ankleY.length < 20) return [];

    const signal = smooth(ankleY, 5);
    const inverted = signal.map((v) => -v);
    const range = Math.max(...inverted) - Math.min(...inverted);
    if (range < 0.02) return []; // foot barely moved

    const fps = signal.length / Math.max(this.durationSec, 0.001);
    const peaks = findPeaks(inverted, {
      // Steps faster than ~4 Hz per leg are not plausible.
      minDistance: Math.max(2, Math.round(fps / 4)),
      minProminence: Math.min(...inverted) + range * 0.4,
    });

    return peaks.map((i) => this.times[i] / 1000);
  }

  finish() {
    const durationSec = this.durationSec;

    const leftSteps = this.stepTimes(this.leftAnkleY);
    const rightSteps = this.stepTimes(this.rightAnkleY);
    const stepCount = leftSteps.length + rightSteps.length;

    const cadenceStepsMin = durationSec > 0 ? (stepCount / durationSec) * 60 : 0;

    // Merge both legs into one chronological sequence for overall step timing.
    const allSteps = [...leftSteps, ...rightSteps].sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < allSteps.length; i++) intervals.push(allSteps[i] - allSteps[i - 1]);
    const stepTimeCv = intervals.length >= 3 ? cv(intervals) : 0;

    const legInterval = (steps) => {
      if (steps.length < 2) return 0;
      const iv = [];
      for (let i = 1; i < steps.length; i++) iv.push(steps[i] - steps[i - 1]);
      return mean(iv);
    };
    const leftInterval = legInterval(leftSteps);
    const rightInterval = legInterval(rightSteps);
    const stepSymmetry =
      leftInterval > 0 && rightInterval > 0
        ? Math.abs(leftInterval - rightInterval) / ((leftInterval + rightInterval) / 2)
        : 0;

    // Arm swing amplitude = how much the wrist-to-shoulder distance varies.
    const leftSwing = this.leftWristOffset.length
      ? Math.max(...this.leftWristOffset) - Math.min(...this.leftWristOffset)
      : 0;
    const rightSwing = this.rightWristOffset.length
      ? Math.max(...this.rightWristOffset) - Math.min(...this.rightWristOffset)
      : 0;
    const armSwingAmplitude = (leftSwing + rightSwing) / 2;
    const maxSwing = Math.max(leftSwing, rightSwing);
    const armSwingAsymmetry = maxSwing > 0 ? Math.abs(leftSwing - rightSwing) / maxSwing : 0;

    const trunkSwayIndex = std(this.hipCenterX);
    const posturalLeanDeg = this.leanDeg.length ? mean(this.leanDeg) : 0;

    // Double-support proxy: fraction of frames where both feet are in the lower
    // (planted) half of their own vertical range.
    const doubleSupportRatio = this.computeDoubleSupport();

    return {
      durationSec: round(durationSec, 2),
      cadenceStepsMin: round(cadenceStepsMin, 2),
      stepCount,
      leftStepCount: leftSteps.length,
      rightStepCount: rightSteps.length,
      stepTimeCv: round(stepTimeCv, 4),
      stepSymmetry: round(stepSymmetry, 4),
      armSwingAmplitude: round(armSwingAmplitude, 4),
      armSwingAsymmetry: round(armSwingAsymmetry, 4),
      trunkSwayIndex: round(trunkSwayIndex, 4),
      posturalLeanDeg: round(posturalLeanDeg, 2),
      doubleSupportRatio: round(doubleSupportRatio, 4),
      trackedRatio: round(this.trackedRatio, 3),
      frameCount: this.frames,
    };
  }

  computeDoubleSupport() {
    const n = Math.min(this.leftAnkleY.length, this.rightAnkleY.length);
    if (n < 20) return 0;

    const threshold = (arr) => {
      const lo = Math.min(...arr);
      const hi = Math.max(...arr);
      return lo + (hi - lo) * 0.5;
    };
    const lt = threshold(this.leftAnkleY);
    const rt = threshold(this.rightAnkleY);

    let both = 0;
    for (let i = 0; i < n; i++) {
      // Larger y = lower on screen = foot planted.
      if (this.leftAnkleY[i] >= lt && this.rightAnkleY[i] >= rt) both++;
    }
    return both / n;
  }

  quality() {
    const f = this.finish();
    let q = 1;
    q *= clamp01(f.trackedRatio / 0.7);
    if (f.durationSec < 15) q *= f.durationSec / 15;
    if (f.stepCount < 10) q *= Math.max(0.2, f.stepCount / 10);
    return Number(clamp01(q).toFixed(3));
  }
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : 0);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
