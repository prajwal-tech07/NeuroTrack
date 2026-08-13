import { useCallback, useRef, useState } from 'react';
import TestShell from './TestShell.jsx';
import CameraPanel from './CameraPanel.jsx';
import { loadFaceLandmarker } from '../../lib/mediapipe.js';
import { FaceTracker } from '../../lib/faceFeatures.js';
import useVisionRecorder from '../../hooks/useVisionRecorder.js';

const DURATION = 18;

/** Cued expression tasks, so the recording captures range of motion, not just rest. */
const PHASES = [
  { until: 6, step: 'Step 1 of 3', action: 'Relax your face', hint: 'Look at the camera, blink naturally' },
  { until: 12, step: 'Step 2 of 3', action: 'Smile widely', hint: 'Hold the smile, then relax, then repeat' },
  { until: 18, step: 'Step 3 of 3', action: 'Raise your eyebrows', hint: 'Raise and lower them a few times' },
];

const phaseAt = (t) => PHASES.find((p) => t < p.until) || PHASES[PHASES.length - 1];

export default function FaceTest({ onComplete, onSkip, initial }) {
  const trackerRef = useRef(null);
  const [result, setResult] = useState(initial || null);

  const handleResult = useCallback((res, ts, brightness) => {
    trackerRef.current?.push(res, ts, brightness);
  }, []);

  /** Draws a sparse landmark cloud so the user can see tracking is live. */
  const handleDraw = useCallback((ctx, res, canvas) => {
    const lm = res?.faceLandmarks?.[0];
    if (!lm) return;
    ctx.fillStyle = 'rgba(139, 103, 237, 0.75)';
    for (let i = 0; i < lm.length; i += 4) {
      ctx.beginPath();
      ctx.arc(lm[i].x * canvas.width, lm[i].y * canvas.height, 1.4, 0, Math.PI * 2);
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
    loadLandmarker: loadFaceLandmarker,
    onResult: handleResult,
    onDraw: handleDraw,
    durationSec: DURATION,
    onComplete: handleComplete,
  });

  const start = async () => {
    trackerRef.current = new FaceTracker();
    setResult(null);
    await recorder.start();
  };

  const retake = () => {
    setResult(null);
    recorder.reset();
  };

  const prompt = recorder.isRecording
    ? phaseAt(recorder.elapsed)
    : { step: 'Facial expression tasks', action: 'Three short cues', hint: `${DURATION} seconds total` };

  return (
    <TestShell
      title="Facial Analysis Test"
      intro="Tracks 478 facial landmarks to measure blink rate, expression range and left/right symmetry."
      instructions={[
        'Sit facing a window or lamp — even lighting matters more than brightness.',
        'Keep your whole face in frame and remove glasses if they reflect badly.',
        'Follow the on-screen cue: relax, then smile, then raise your eyebrows.',
        'Video is processed frame by frame in your browser and never uploaded.',
      ]}
      error={recorder.error}
      status={recorder.status}
      onSkip={recorder.isRecording ? undefined : onSkip}
    >
      <CameraPanel
        recorder={recorder}
        prompt={prompt}
        subjectLabel="face"
        idleTitle="Camera off"
        idleHint={`${DURATION} seconds. Make sure your face fills a good part of the frame.`}
        doneTitle="Face captured"
        doneStats={
          result
            ? [
                ['Blink rate', `${result.features.blinkRate}/min`],
                ['Expressivity', result.features.expressivityIndex],
                ['Symmetry', result.features.asymmetryIndex],
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
