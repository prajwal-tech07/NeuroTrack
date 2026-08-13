import { useCallback, useRef, useState } from 'react';
import TestShell from './TestShell.jsx';
import CameraPanel from './CameraPanel.jsx';
import { loadHandLandmarker } from '../../lib/mediapipe.js';
import { HandTracker } from '../../lib/handFeatures.js';
import useVisionRecorder from '../../hooks/useVisionRecorder.js';

const TAP_SEC = 15;
const HOLD_SEC = 12;
const DURATION = TAP_SEC + HOLD_SEC;

/** Skeleton edges for the overlay. */
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export default function HandTest({ onComplete, onSkip, initial }) {
  const trackerRef = useRef(null);
  const [result, setResult] = useState(initial || null);

  const handleResult = useCallback((res, ts) => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    // Switch phases mid-recording so both tasks land in one capture session.
    const elapsed = tracker.startMs === null ? 0 : (ts - tracker.startMs) / 1000;
    tracker.setPhase(elapsed < TAP_SEC ? 'tap' : 'hold');
    tracker.push(res, ts);
  }, []);

  const handleDraw = useCallback((ctx, res, canvas) => {
    const lm = res?.landmarks?.[0];
    if (!lm) return;

    ctx.strokeStyle = 'rgba(139, 103, 237, 0.85)';
    ctx.lineWidth = 2;
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
      ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
      ctx.stroke();
    }

    ctx.fillStyle = '#F59E0B';
    for (const i of [4, 8]) {
      ctx.beginPath();
      ctx.arc(lm[i].x * canvas.width, lm[i].y * canvas.height, 5, 0, Math.PI * 2);
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
    loadLandmarker: loadHandLandmarker,
    onResult: handleResult,
    onDraw: handleDraw,
    durationSec: DURATION,
    onComplete: handleComplete,
  });

  const start = async () => {
    trackerRef.current = new HandTracker();
    setResult(null);
    await recorder.start();
  };

  const retake = () => {
    setResult(null);
    recorder.reset();
  };

  const inTap = recorder.elapsed < TAP_SEC;
  const prompt = recorder.isRecording
    ? inTap
      ? {
          step: `Task 1 of 2 · ${Math.ceil(TAP_SEC - recorder.elapsed)}s left`,
          action: 'Tap thumb and index finger',
          hint: 'As big and as fast as you can, without stopping',
        }
      : {
          step: `Task 2 of 2 · ${Math.ceil(DURATION - recorder.elapsed)}s left`,
          action: 'Hold your hand still',
          hint: 'Arm out, palm down, as steady as possible',
        }
    : {
        step: 'Two hand tasks',
        action: 'Tap, then hold',
        hint: `${TAP_SEC}s tapping + ${HOLD_SEC}s steady hold`,
      };

  return (
    <TestShell
      title="Hand Movement & Tremor Test"
      intro="Measures repetitive-movement speed, amplitude decrement and rhythm, then runs a frequency analysis for tremor."
      instructions={[
        'Hold one hand about 40 cm from the camera, palm facing it.',
        `Task 1 (${TAP_SEC}s): tap your thumb and index finger together as big and fast as you can.`,
        `Task 2 (${HOLD_SEC}s): hold the same hand out, as still as you can manage.`,
        'Avoid caffeine right before testing — it raises normal physiological tremor.',
      ]}
      error={recorder.error}
      status={recorder.status}
      onSkip={recorder.isRecording ? undefined : onSkip}
    >
      <CameraPanel
        recorder={recorder}
        prompt={prompt}
        subjectLabel="hand"
        idleTitle="Camera off"
        idleHint={`${DURATION} seconds across two tasks. Keep your whole hand in frame throughout.`}
        doneTitle="Hand captured"
        doneStats={
          result
            ? [
                ['Tap rate', `${result.features.tapFrequencyHz} Hz`],
                ['Taps', result.features.tapCount],
                ['Tremor peak', `${result.features.tremorPeakHz} Hz`],
                ['Tracked', `${Math.round(result.features.trackedRatio * 100)}%`],
              ]
            : []
        }
        onStart={start}
        onRetake={retake}
      />
    </TestShell>
  );
}
