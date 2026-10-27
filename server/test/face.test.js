/**
 * Browser face feature code: left/right conventions and cue reaction time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaceTracker } from '../../client/src/lib/faceFeatures.js';

const IOD = 0.2; // landmark 33 (image left) to 263 (image right)

/**
 * One FaceLandmarker result on an un-mirrored frame. The subject's LEFT eye is
 * the 263/386/374 eye on the image's right, as measured on real photos.
 */
function frame({ subjectLeftOpen, subjectRightOpen }) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  lm[33] = { x: 0.4, y: 0.4, z: 0 };
  lm[263] = { x: 0.4 + IOD, y: 0.4, z: 0 };
  // Subject's right eye (image left).
  lm[159] = { x: 0.43, y: 0.4, z: 0 };
  lm[145] = { x: 0.43, y: 0.4 + subjectRightOpen * IOD, z: 0 };
  // Subject's left eye (image right).
  lm[386] = { x: 0.57, y: 0.4, z: 0 };
  lm[374] = { x: 0.57, y: 0.4 + subjectLeftOpen * IOD, z: 0 };
  const blink = (open) => Math.max(0, Math.min(1, 1 - open / 0.08));
  return {
    faceLandmarks: [lm],
    faceBlendshapes: [{
      categories: [
        { categoryName: 'eyeBlinkLeft', score: blink(subjectLeftOpen) },
        { categoryName: 'eyeBlinkRight', score: blink(subjectRightOpen) },
      ],
    }],
  };
}

test('eye measures are named by the subject\'s own side, like the blendshapes', () => {
  const tr = new FaceTracker();
  let t = 0;
  tr.setPhase('rest');
  for (; t < 3000; t += 50) tr.push(frame({ subjectLeftOpen: 0.08, subjectRightOpen: 0.08 }), t);
  tr.setPhase('eyesShut');
  // The subject's left eye only half closes (weak orbicularis on the left).
  for (; t < 8000; t += 50) tr.push(frame({ subjectLeftOpen: 0.04, subjectRightOpen: 0.01 }), t);

  const f = tr.finish();
  assert.ok(Math.abs(f.left.eyeShutResidual - 0.04) < 0.002, `left ${f.left.eyeShutResidual}`);
  assert.ok(Math.abs(f.right.eyeShutResidual - 0.01) < 0.002, `right ${f.right.eyeShutResidual}`);
});

test('the reaction second after "close your eyes" does not count as an eye that will not close', () => {
  const tr = new FaceTracker();
  let t = 0;
  tr.setPhase('rest');
  for (; t < 3000; t += 50) tr.push(frame({ subjectLeftOpen: 0.08, subjectRightOpen: 0.08 }), t);
  tr.setPhase('eyesShut');
  const cue = t;
  for (; t < 8000; t += 50) {
    // Still reading the cue for 1.2 s, and the right eye closes a beat later.
    const sinceCue = t - cue;
    const left = sinceCue < 1000 ? 0.08 : 0.012;
    const right = sinceCue < 1200 ? 0.08 : 0.012;
    tr.push(frame({ subjectLeftOpen: left, subjectRightOpen: right }), t);
  }
  const f = tr.finish();
  assert.ok(f.eyeClosureGap < 0.005, `gap ${f.eyeClosureGap}`);
  assert.ok(f.left.eyeShutResidual < 0.02 && f.right.eyeShutResidual < 0.02);
});
