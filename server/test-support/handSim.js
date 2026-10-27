/**
 * Simulated MediaPipe hand landmarks for the HandTest protocol (HAND_STAGES).
 * Used to check the real browser feature code + server scoring end to end.
 *
 * Noise levels follow real MediaPipe recordings (PN Expert): per-frame bone
 * lengths vary ~8% in 3D, hands drift and sway during a hold, the other hand
 * shows up while switching, and frames arrive irregularly.
 */
import { HAND_STAGES } from '../../client/src/lib/handFeatures.js';

const END = HAND_STAGES[HAND_STAGES.length - 1].until;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** 21 landmarks of an upright hand, palm to camera, at (cx, cy) with palm length `palm`. */
function handAt(cx, cy, palm, open, noise, r, mirror = 1) {
  const n = () => gauss(r) * noise * palm;
  const p = (dx, dy) => ({ x: cx + mirror * dx * palm + n(), y: cy + dy * palm + n(), z: n() });
  const lm = Array.from({ length: 21 }, () => p(0, -0.5));
  lm[0] = p(0, 0); // wrist
  lm[5] = p(0.25, -0.95); // index MCP
  lm[9] = p(0, -1); // middle MCP
  lm[13] = p(-0.22, -0.95); // ring MCP
  lm[17] = p(-0.42, -0.85); // pinky MCP
  lm[4] = p(0.45, -0.95); // thumb tip
  lm[8] = p(0.45 + open, -0.95 - open * 0.3); // index tip
  return lm;
}

/**
 * @param {object} p
 *   fps            analysis frame rate
 *   tapHz          {left, right} tapping rate
 *   tapOpen        {left, right} max thumb-index opening / palm length
 *   noise          per-landmark noise, fraction of palm length
 *   tremorHz, tremorAmp  hold tremor (palm lengths)
 *   drift          {left, right} downward sag over the hold (palm lengths)
 *   sway           slow random postural sway during a hold (palm lengths)
 *   depthChange    relative change in hand size (moving to/from camera) per stage
 *   otherHand      the other hand also in view while tapping
 *   stopEarlySec   stops tapping this long before each tapping cue ends
 */
export function simulateHand(push, p = {}) {
  const o = {
    fps: 30, tapHz: { left: 3.6, right: 4.0 }, tapOpen: { left: 1.0, right: 1.1 }, noise: 0.04,
    tremorHz: 9, tremorAmp: 0.004, seed: 1, drift: { left: 0.15, right: 0.15 }, sway: 0.08, depthChange: 0.1,
    otherHand: false, stopEarlySec: 0, ...p,
  };
  const r = rng(o.seed);
  const basePalm = 0.16;
  let t = 0;
  let stageStart = 0;
  let prevStage = null;
  let swayX = 0;
  let swayY = 0;
  while (t < END) {
    const stage = HAND_STAGES.find((s) => t < s.until) || HAND_STAGES[HAND_STAGES.length - 1];
    if (stage !== prevStage) { stageStart = t; prevStage = stage; swayX = 0; swayY = 0; }
    const into = t - stageStart;
    const ts = 1000 + t * 1000;
    const label = (side) => [{ categoryName: side === 'left' ? 'Left' : 'Right', score: 0.96 }];
    const mirror = stage.side === 'left' ? -1 : 1;
    let result = { landmarks: [], handedness: [] };

    if (stage.phase === 'settle') {
      // Hands moving into place: either hand, anywhere, sometimes none.
      if (r() < 0.7) {
        const side = r() < 0.5 ? 'left' : 'right';
        result = {
          landmarks: [handAt(0.3 + 0.4 * r(), 0.5 + 0.4 * r(), basePalm * (0.6 + 0.6 * r()), r(), 0.1, r)],
          handedness: [label(side)],
        };
      }
    } else if (r() < 0.95) {
      // Hand slowly moving toward/away from the camera through the stage.
      const palm = basePalm * (1 + o.depthChange * (into / 8 - 0.5));
      const cx = stage.side === 'left' ? 0.62 : 0.38; // un-mirrored frame: user's left hand on image right
      if (stage.phase === 'tap') {
        const stopped = stage.until - t < o.stopEarlySec;
        const open = stopped ? 0.3 : o.tapOpen[stage.side] * (0.5 - 0.5 * Math.cos(2 * Math.PI * o.tapHz[stage.side] * t));
        result = { landmarks: [handAt(cx, 0.75, palm, open, o.noise, r, mirror)], handedness: [label(stage.side)] };
      } else {
        swayX += gauss(r) * o.sway * 0.05;
        swayY += gauss(r) * o.sway * 0.05;
        const tr = o.tremorAmp * Math.sin(2 * Math.PI * o.tremorHz * t);
        const sag = o.drift[stage.side] * Math.min(1, into / 7);
        result = {
          landmarks: [handAt(cx + (swayX + tr) * palm, 0.6 + (swayY + tr + sag) * palm, palm, 0.3, o.noise, r, mirror)],
          handedness: [label(stage.side)],
        };
      }
      if (o.otherHand && stage.phase === 'tap') {
        // The resting hand, lower in the frame, listed first.
        const other = stage.side === 'left' ? 'right' : 'left';
        result.landmarks.unshift(handAt(1 - cx, 0.95, basePalm * 0.8, 0.2, o.noise, r, -mirror));
        result.handedness.unshift(label(other));
      }
    }
    push(stage, result, ts);
    // irregular frame spacing like requestAnimationFrame under load
    t += (1 / o.fps) * (0.8 + 0.4 * r());
  }
}
