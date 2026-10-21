/**
 * Simulated MediaPipe hand landmarks for the HandTest protocol (4 stages, 38 s).
 * Used to check the real browser feature code + server scoring end to end.
 */
const STAGES = [
  { until: 11, side: 'left', phase: 'tap' },
  { until: 19, side: 'left', phase: 'hold' },
  { until: 30, side: 'right', phase: 'tap' },
  { until: 38, side: 'right', phase: 'hold' },
];

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

/**
 * @param {object} p
 *   fps            analysis frame rate
 *   tapHz          {left, right} tapping rate
 *   tapOpen        {left, right} max thumb-index opening / palm length
 *   switchSec      seconds at the start of each stage with no / moving hand
 *   jitter         landmark noise (normalised image units)
 *   tremorHz, tremorAmp  hold tremor
 *   drift          {left, right} downward sag of the held hand over 8 s (image units)
 */
export function simulateHand(push, p = {}) {
  const o = { fps: 30, tapHz: { left: 4.5, right: 4.5 }, tapOpen: { left: 0.9, right: 0.9 }, switchSec: 1.5,
    jitter: 0.003, tremorHz: 9, tremorAmp: 0.001, seed: 1, drift: { left: 0, right: 0 }, ...p };
  const r = rng(o.seed);
  const palm = 0.18; // wrist -> middle MCP, normalised
  let t = 0;
  let stageStart = 0;
  let prevStage = null;
  while (t < 38) {
    const stage = STAGES.find((s) => t < s.until);
    if (stage !== prevStage) { stageStart = t; prevStage = stage; }
    const ts = 1000 + t * 1000;
    const inSwitch = t - stageStart < o.switchSec;
    let result = { landmarks: [] };
    if (!inSwitch || r() < 0.3) {
      const wrist = { x: 0.5 + gauss(r) * o.jitter, y: 0.7 + gauss(r) * o.jitter };
      const mcp = { x: wrist.x, y: wrist.y - palm };
      const lm = Array.from({ length: 21 }, () => ({ x: wrist.x, y: wrist.y - palm / 2, z: 0 }));
      lm[0] = wrist; lm[9] = mcp;
      if (stage.phase === 'tap') {
        const open = o.tapOpen[stage.side] * palm * (0.5 - 0.5 * Math.cos(2 * Math.PI * o.tapHz[stage.side] * t));
        const thumb = { x: mcp.x - 0.02, y: mcp.y - 0.05 };
        lm[4] = { x: thumb.x + gauss(r) * o.jitter, y: thumb.y + gauss(r) * o.jitter };
        lm[8] = { x: thumb.x + open + 0.01 + gauss(r) * o.jitter, y: thumb.y - open * 0.3 + gauss(r) * o.jitter };
      } else {
        const tr = o.tremorAmp * Math.sin(2 * Math.PI * o.tremorHz * t);
        lm[4] = { x: mcp.x - 0.03, y: mcp.y };
        // Slow postural sag over the hold (normalised image units).
        const sag = o.drift[stage.side] * Math.min(1, (t - stageStart) / 8);
        lm[8] = { x: mcp.x + tr + gauss(r) * o.jitter, y: mcp.y - 0.08 + tr + sag + gauss(r) * o.jitter };
      }
      result = { landmarks: [lm] };
    }
    push(stage, result, ts);
    // irregular frame spacing like requestAnimationFrame under load
    t += (1 / o.fps) * (0.8 + 0.4 * r());
  }
}
