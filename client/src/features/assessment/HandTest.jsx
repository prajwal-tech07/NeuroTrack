import { useCallback, useRef, useState } from 'react';
import TestShell from './TestShell.jsx';
import CameraPanel from './CameraPanel.jsx';
import { loadHandLandmarker } from '../../lib/mediapipe.js';
import { HAND_STAGES, HandTracker } from '../../lib/handFeatures.js';
import useVisionRecorder from '../../hooks/useVisionRecorder.js';

/**
 * Four cued sub-tasks in one capture. Both hands are required: the difference
 * between them is what separates bilateral slowing (Parkinsonian) from
 * one-sided weakness (hemiparesis), and it cannot be measured from one hand.
 *
 * 'settle' stages give time to get into position or switch hands and are not
 * analysed. Without them the hand switch landed at the start of the right-hand
 * tapping window and read as right-sided slowing and decrement.
 */
const CUES = [
  { task: 1, action: 'Raise your LEFT hand', hint: 'Palm towards the camera, get ready to tap' },
  { task: 1, action: 'Tap with your LEFT hand', hint: 'Thumb to index finger, as big and fast as you can' },
  { task: 2, action: 'Stop — hold your LEFT hand out', hint: 'Arm out in front, palm down' },
  { task: 2, action: 'Hold your LEFT hand still', hint: 'Arm out, palm down, as steady as possible' },
  { task: 3, action: 'Switch: lower LEFT, raise RIGHT hand', hint: 'Palm towards the camera, get ready to tap' },
  { task: 3, action: 'Tap with your RIGHT hand', hint: 'Same again — big and fast' },
  { task: 4, action: 'Stop — hold your RIGHT hand out', hint: 'Arm out in front, palm down' },
  { task: 4, action: 'Hold your RIGHT hand still', hint: 'Arm out, palm down, hold steady' },
];
const STAGES = HAND_STAGES.map((stage, i) => ({ ...stage, ...CUES[i] }));

const DURATION = STAGES[STAGES.length - 1].until;

/** Skeleton edges for the overlay. */
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/** Draws one hand's skeleton with the thumb and index tips highlighted. */
function drawHand(ctx, lm, canvas) {
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
}

const stageAt = (t) => STAGES.find((s) => t < s.until) || STAGES[STAGES.length - 1];

export default function HandTest({ onComplete, onSkip, initial }) {
  const trackerRef = useRef(null);
  const [result, setResult] = useState(initial || null);

  const handleResult = useCallback((res, ts, _brightness, video) => {
    const tracker = trackerRef.current;
    if (!tracker) return;
    if (video?.videoWidth && video?.videoHeight) tracker.setAspect(video.videoWidth / video.videoHeight);

    const elapsed = tracker.startMs === null ? 0 : (ts - tracker.startMs) / 1000;
    const stage = stageAt(elapsed);
    tracker.setSide(stage.side);
    tracker.setPhase(stage.phase);
    tracker.push(res, ts);
  }, []);

  const handleDraw = useCallback((ctx, res, canvas) => {
    for (const lm of res?.landmarks || []) drawHand(ctx, lm, canvas);
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

  const stage = recorder.isRecording ? stageAt(recorder.elapsed) : null;

  const prompt = recorder.isRecording
    ? {
        step: stage.phase === 'settle'
          ? `Get ready · ${Math.ceil(stage.until - recorder.elapsed)}s`
          : `Task ${stage.task} of 4 · ${Math.ceil(stage.until - recorder.elapsed)}s left`,
        action: stage.action,
        hint: stage.hint,
      }
    : {
        step: 'Four hand tasks',
        action: 'Left hand, then right',
        hint: `${DURATION}s total — tap and hold on each side`,
      };

  const sideStat = (side) => {
    const s = result?.features?.[side];
    return s ? `${s.tapFrequencyHz} Hz` : '—';
  };

  return (
    <TestShell
      title="Hand Movement & Tremor Test"
      intro="Measures tapping speed, amplitude decrement and rhythm on each hand separately, then runs a frequency analysis for tremor."
      instructions={[
        'Hold one hand about 40 cm from the camera, palm facing it.',
        'You will do four short tasks: tap and hold with your LEFT hand, then the same with your RIGHT.',
        'Follow the on-screen cue — it tells you which hand and what to do. You get a few seconds to get ready before each task.',
        'Keep the other hand down, out of the picture.',
        'Testing both hands is what lets the analysis tell one-sided weakness apart from overall slowing.',
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
        idleHint={`${DURATION} seconds across four tasks. Switch hands when the cue tells you to.`}
        doneTitle="Both hands captured"
        doneStats={
          result
            ? [
                ['Left taps', sideStat('left')],
                ['Right taps', sideStat('right')],
                ['Tremor', result.features.tremorDetected ? `${result.features.tremorPeakHz} Hz` : 'none detected'],
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
