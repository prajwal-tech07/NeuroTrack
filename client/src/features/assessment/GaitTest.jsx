import { useCallback, useRef, useState } from 'react';
import TestShell from './TestShell.jsx';
import CameraPanel from './CameraPanel.jsx';
import { loadPoseLandmarker } from '../../lib/mediapipe.js';
import { GaitTracker } from '../../lib/gaitFeatures.js';
import useVisionRecorder from '../../hooks/useVisionRecorder.js';

const DURATION = 22;

/** Torso, arm and leg edges from the 33-point pose model. */
const CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32],
];

export default function GaitTest({ onComplete, onSkip, initial }) {
  const trackerRef = useRef(null);
  const [result, setResult] = useState(initial || null);

  const handleResult = useCallback((res, ts) => {
    trackerRef.current?.push(res, ts);
  }, []);

  const handleDraw = useCallback((ctx, res, canvas) => {
    const lm = res?.landmarks?.[0];
    if (!lm) return;

    ctx.strokeStyle = 'rgba(37, 99, 235, 0.85)';
    ctx.lineWidth = 3;
    for (const [a, b] of CONNECTIONS) {
      if (!lm[a] || !lm[b]) continue;
      ctx.beginPath();
      ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
      ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
      ctx.stroke();
    }

    // Highlight the ankles — they drive step detection.
    ctx.fillStyle = '#F59E0B';
    for (const i of [27, 28]) {
      if (!lm[i]) continue;
      ctx.beginPath();
      ctx.arc(lm[i].x * canvas.width, lm[i].y * canvas.height, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  const handleComplete = useCallback(() => {
    const tracker = trackerRef.current;
    if (!tracker) return;

    const features = tracker.finish();
    const quality = tracker.quality();
    const payload = { features, quality, durationSec: features.durationSec };

    setResult(payload);
    onComplete(payload, tracker.isUsable ? null : 'lowData');
  }, [onComplete]);

  const recorder = useVisionRecorder({
    loadLandmarker: loadPoseLandmarker,
    onResult: handleResult,
    onDraw: handleDraw,
    durationSec: DURATION,
    onComplete: handleComplete,
  });

  const start = async () => {
    trackerRef.current = new GaitTracker();
    setResult(null);
    await recorder.start();
  };

  const retake = () => {
    setResult(null);
    recorder.reset();
  };

  const prompt = recorder.isRecording
    ? {
        step: `${Math.ceil(DURATION - recorder.elapsed)}s left`,
        action: 'March in place',
        hint: 'Lift each knee clearly and swing your arms naturally',
      }
    : {
        step: 'Full-body pose task',
        action: 'March in place',
        hint: `${DURATION} seconds — step back so your whole body is visible`,
      };

  return (
    <TestShell
      title="Gait Analysis Test"
      intro="Derives cadence, step-time variability, arm swing symmetry and trunk sway from full-body pose tracking."
      instructions={[
        'Place your laptop on a table and step back 2–3 metres so your whole body is in frame.',
        'March in place at a comfortable pace, lifting each knee clearly.',
        'Let your arms swing naturally — do not hold anything or fold them.',
        'Stand somewhere with clear space around you, and hold onto something if you feel unsteady.',
      ]}
      error={recorder.error}
      status={recorder.status}
      onSkip={recorder.isRecording ? undefined : onSkip}
    >
      <CameraPanel
        recorder={recorder}
        prompt={prompt}
        subjectLabel="body"
        idleTitle="Camera off"
        idleHint={`${DURATION} seconds. Your head, hips and both feet all need to be visible.`}
        doneTitle="Gait captured"
        doneStats={
          result
            ? [
                ['Cadence', `${result.features.cadenceStepsMin}/min`],
                ['Steps', result.features.stepCount],
                ['Arm swing', result.features.armSwingAmplitude],
                ['Tracked', `${Math.round(result.features.trackedRatio * 100)}%`],
              ]
            : []
        }
        onStart={start}
        onRetake={retake}
        aspect="aspect-[3/4] sm:aspect-[4/3]"
      />
    </TestShell>
  );
}
