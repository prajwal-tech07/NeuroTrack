import { cv, dist, mean, std } from './dsp.js';

/** FaceMesh landmark indices used for the geometric measures. */
const LM = {
  leftEyeUpper: 159,
  leftEyeLower: 145,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  rightEyeUpper: 386,
  rightEyeLower: 374,
  rightEyeOuter: 263,
  rightEyeInner: 362,
  mouthLeft: 61,
  mouthRight: 291,
  lipUpper: 13,
  lipLower: 14,
  noseTip: 1,
  chin: 152,
  forehead: 10,
};

/** Blendshapes averaged into the overall expressivity index. */
const EXPRESSIVE_SHAPES = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekSquintLeft', 'cheekSquintRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft',
  'eyeWideRight', 'jawOpen', 'mouthFrownLeft', 'mouthFrownRight', 'mouthPucker',
  'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'noseSneerLeft',
];

/** Same-muscle blendshapes split by side, for per-side expressivity. */
const SIDE_SHAPES = {
  left: [
    'mouthSmileLeft', 'browOuterUpLeft', 'eyeSquintLeft', 'cheekSquintLeft',
    'mouthFrownLeft', 'mouthStretchLeft', 'eyeWideLeft', 'browDownLeft',
  ],
  right: [
    'mouthSmileRight', 'browOuterUpRight', 'eyeSquintRight', 'cheekSquintRight',
    'mouthFrownRight', 'mouthStretchRight', 'eyeWideRight', 'browDownRight',
  ],
};

/** Left/right blendshape pairs used for the asymmetry index. */
const SYMMETRY_PAIRS = [
  ['mouthSmileLeft', 'mouthSmileRight'],
  ['browOuterUpLeft', 'browOuterUpRight'],
  ['eyeSquintLeft', 'eyeSquintRight'],
  ['mouthFrownLeft', 'mouthFrownRight'],
  ['cheekSquintLeft', 'cheekSquintRight'],
  ['mouthStretchLeft', 'mouthStretchRight'],
];

const BLINK_ON = 0.5;
const BLINK_OFF = 0.28;

/**
 * Accumulates FaceLandmarker output frame by frame, then derives the feature
 * vector the server's face scorer and laterality engine consume.
 *
 * The caller drives cued tasks with `setPhase()`:
 *   'rest' | 'smile' | 'brow' | 'eyesShut'
 *
 * Side naming follows MediaPipe's blendshape convention (the subject's own
 * anatomical left/right). The on-screen preview is mirrored for usability, so
 * anything shown to the user must be labelled from their perspective, not the
 * screen's.
 */
export class FaceTracker {
  constructor() {
    this.phase = 'rest';
    this.frames = 0;
    this.detected = 0;
    this.blendshapeSeries = new Map(); // name -> number[]
    this.eyeApertureL = [];
    this.eyeApertureR = [];
    this.mouthOpen = [];
    this.brightness = [];
    this.blinkCount = 0;
    this.blinkOpen = true;
    this.startMs = null;
    this.endMs = null;

    // Aperture samples captured only while the user is told to shut their eyes.
    this.shutApertureL = [];
    this.shutApertureR = [];
  }

  setPhase(phase) {
    this.phase = phase;
  }

  /**
   * @param {object} result MediaPipe FaceLandmarker VIDEO result
   * @param {number} timestampMs frame timestamp
   * @param {number} [brightness] optional 0..1 frame brightness
   */
  push(result, timestampMs, brightness) {
    this.frames++;
    if (this.startMs === null) this.startMs = timestampMs;
    this.endMs = timestampMs;
    if (typeof brightness === 'number') this.brightness.push(brightness);

    const landmarks = result?.faceLandmarks?.[0];
    if (!landmarks) return;
    this.detected++;

    // Normalised by interocular distance so measurements are invariant to how
    // close the user sits to the camera.
    const interocular = dist(landmarks[LM.leftEyeOuter], landmarks[LM.rightEyeOuter]) || 1e-6;

    const apertureL = dist(landmarks[LM.leftEyeUpper], landmarks[LM.leftEyeLower]) / interocular;
    const apertureR = dist(landmarks[LM.rightEyeUpper], landmarks[LM.rightEyeLower]) / interocular;

    this.eyeApertureL.push(apertureL);
    this.eyeApertureR.push(apertureR);
    this.mouthOpen.push(dist(landmarks[LM.lipUpper], landmarks[LM.lipLower]) / interocular);

    if (this.phase === 'eyesShut') {
      this.shutApertureL.push(apertureL);
      this.shutApertureR.push(apertureR);
    }

    const categories = result?.faceBlendshapes?.[0]?.categories;
    if (!categories) return;

    let blinkL = 0;
    let blinkR = 0;
    for (const cat of categories) {
      const name = cat.categoryName;
      if (!this.blendshapeSeries.has(name)) this.blendshapeSeries.set(name, []);
      this.blendshapeSeries.get(name).push(cat.score);
      if (name === 'eyeBlinkLeft') blinkL = cat.score;
      if (name === 'eyeBlinkRight') blinkR = cat.score;
    }

    // Blinks are only counted during the rest cue — the eyes-shut task would
    // otherwise register as a very long blink and distort the rate.
    if (this.phase === 'rest') {
      const blink = (blinkL + blinkR) / 2;
      if (this.blinkOpen && blink > BLINK_ON) {
        this.blinkCount++;
        this.blinkOpen = false;
      } else if (!this.blinkOpen && blink < BLINK_OFF) {
        this.blinkOpen = true;
      }
      this.restFrames = (this.restFrames || 0) + 1;
    }
  }

  get durationSec() {
    return this.startMs === null ? 0 : Math.max(0, (this.endMs - this.startMs) / 1000);
  }

  get trackedRatio() {
    return this.frames ? this.detected / this.frames : 0;
  }

  get isUsable() {
    return this.detected >= 45 && this.durationSec >= 6;
  }

  series(name) {
    return this.blendshapeSeries.get(name) || [];
  }

  peak(name) {
    const s = this.series(name);
    return s.length ? Math.max(...s) : 0;
  }

  /** Mean temporal variance across one side's muscle groups. */
  sideExpressivity(side) {
    const variances = SIDE_SHAPES[side].map((n) => std(this.series(n))).filter(Number.isFinite);
    return variances.length ? mean(variances) : 0;
  }

  finish() {
    const durationSec = this.durationSec;
    const trackedRatio = this.trackedRatio;

    const variances = EXPRESSIVE_SHAPES.map((name) => std(this.series(name))).filter((v) =>
      Number.isFinite(v)
    );
    const expressivityIndex = variances.length ? mean(variances) : 0;

    // Asymmetry: mean absolute left/right mismatch, scaled by activation so a
    // resting face does not read as perfectly symmetric by default.
    const asymmetries = [];
    for (const [left, right] of SYMMETRY_PAIRS) {
      const l = this.series(left);
      const r = this.series(right);
      if (l.length < 5 || r.length < 5) continue;
      const n = Math.min(l.length, r.length);
      const diffs = [];
      for (let i = 0; i < n; i++) {
        const activation = Math.max(l[i], r[i]);
        if (activation < 0.08) continue; // ignore frames with no expression at all
        diffs.push(Math.abs(l[i] - r[i]) / Math.max(activation, 0.08));
      }
      if (diffs.length) asymmetries.push(mean(diffs));
    }
    const asymmetryIndex = asymmetries.length ? mean(asymmetries) : 0;

    const smileLeft = this.peak('mouthSmileLeft');
    const smileRight = this.peak('mouthSmileRight');
    const smileAmplitude = Math.max(smileLeft, smileRight, (smileLeft + smileRight) / 2);

    const browLeft = this.peak('browOuterUpLeft');
    const browRight = this.peak('browOuterUpRight');
    const browRaiseAmplitude = Math.max(this.peak('browInnerUp'), (browLeft + browRight) / 2);

    const mouthOpenRange = this.mouthOpen.length
      ? Math.max(...this.mouthOpen) - Math.min(...this.mouthOpen)
      : 0;

    const meanL = mean(this.eyeApertureL);
    const meanR = mean(this.eyeApertureR);
    const eyeOpenAsymmetry =
      meanL + meanR > 0 ? Math.abs(meanL - meanR) / ((meanL + meanR) / 2) : 0;

    // Lagophthalmos: residual aperture while trying to shut the eyes. A healthy
    // eye closes to near zero; a weak orbicularis oculi leaves a visible gap.
    const shutL = this.shutApertureL.length ? mean(this.shutApertureL) : null;
    const shutR = this.shutApertureR.length ? mean(this.shutApertureR) : null;
    const eyeClosureGap =
      shutL !== null && shutR !== null ? Math.abs(shutL - shutR) : 0;

    // Blink rate is computed over the rest cue only.
    const restSec = (this.restFrames || 0) > 0 && this.frames > 0
      ? durationSec * ((this.restFrames || 0) / this.frames)
      : durationSec;
    const blinkRate = restSec > 0 ? (this.blinkCount / restSec) * 60 : 0;

    const leftExpressivity = this.sideExpressivity('left');
    const rightExpressivity = this.sideExpressivity('right');

    return {
      durationSec: round(durationSec, 2),
      blinkRate: round(blinkRate, 2),
      blinkCount: this.blinkCount,
      expressivityIndex: round(expressivityIndex, 4),
      smileAmplitude: round(smileAmplitude, 4),
      browRaiseAmplitude: round(browRaiseAmplitude, 4),
      asymmetryIndex: round(asymmetryIndex, 4),
      mouthOpenRange: round(mouthOpenRange, 4),
      eyeOpenAsymmetry: round(eyeOpenAsymmetry, 4),
      eyeApertureCv: round(cv(this.eyeApertureL.concat(this.eyeApertureR)), 4),
      trackedRatio: round(trackedRatio, 3),
      brightness: this.brightness.length ? round(mean(this.brightness), 3) : 0.5,
      frameCount: this.frames,

      // ---- Per-side block consumed by the laterality engine ----
      left: {
        expressivity: round(leftExpressivity, 4),
        smile: round(smileLeft, 4),
        brow: round(browLeft, 4),
        eyeShutResidual: shutL === null ? null : round(shutL, 4),
      },
      right: {
        expressivity: round(rightExpressivity, 4),
        smile: round(smileRight, 4),
        brow: round(browRight, 4),
        eyeShutResidual: shutR === null ? null : round(shutR, 4),
      },
      eyeClosureGap: round(eyeClosureGap, 4),
      eyeClosureTested: shutL !== null && shutR !== null,
    };
  }

  quality() {
    const f = this.finish();
    let q = 1;
    q *= clamp01(f.trackedRatio / 0.7);
    if (f.durationSec < 16) q *= f.durationSec / 16;
    q *= clamp01(1 - Math.abs(f.brightness - 0.5) * 1.4);
    return Number(clamp01(q).toFixed(3));
  }
}

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : 0);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
