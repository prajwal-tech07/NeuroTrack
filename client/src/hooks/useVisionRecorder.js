import { useCallback, useEffect, useRef, useState } from 'react';
import { frameBrightness, startCamera, stopStream } from '../lib/mediapipe.js';

/**
 * Drives a camera + MediaPipe landmarker capture session.
 *
 * The caller supplies a loader for the landmarker and a per-frame callback; the
 * hook owns the camera stream, the rAF loop, timing and teardown.
 *
 * @param {object}   options
 * @param {Function} options.loadLandmarker  async () => landmarker
 * @param {Function} options.onResult        (result, timestampMs, brightness) => void
 * @param {Function} [options.onDraw]        (ctx, result, video) => void  overlay painter
 * @param {number}   options.durationSec     capture length
 * @param {Function} [options.onComplete]    called once when the timer finishes
 */
export function useVisionRecorder({
  loadLandmarker,
  onResult,
  onDraw,
  durationSec,
  onComplete,
}) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const brightnessCanvasRef = useRef(null);

  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const startedAtRef = useRef(0);
  const lastTimestampRef = useRef(-1);
  const runningRef = useRef(false);
  // Per-frame bookkeeping kept out of React state: re-rendering on every frame
  // (as before) cut the analysed frame rate on ordinary laptops.
  const lastVideoTimeRef = useRef(-1);
  const frameIndexRef = useRef(0);
  const brightnessRef = useRef(undefined);
  const lastUiUpdateRef = useRef(0);
  const detectingRef = useRef(false);

  const [status, setStatus] = useState('idle'); // idle | loading | ready | recording | done | error
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [detecting, setDetecting] = useState(false);

  // Keep the latest callbacks without restarting the loop when they change.
  const cbs = useRef({ onResult, onDraw, onComplete });
  useEffect(() => {
    cbs.current = { onResult, onDraw, onComplete };
  }, [onResult, onDraw, onComplete]);

  const cleanup = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  /** Opens the camera and loads the model, but does not start capturing yet. */
  const prepare = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      if (!brightnessCanvasRef.current) brightnessCanvasRef.current = document.createElement('canvas');

      const [landmarker, stream] = await Promise.all([
        loadLandmarker(),
        startCamera(videoRef.current),
      ]);
      landmarkerRef.current = landmarker;
      streamRef.current = stream;
      setStatus('ready');
      return true;
    } catch (err) {
      cleanup();
      const message =
        err?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow it in your browser address bar and try again.'
          : err?.name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : `Could not start the camera or load the AI model: ${err.message}`;
      setError(message);
      setStatus('error');
      return false;
    }
  }, [loadLandmarker, cleanup]);

  const loop = useCallback(() => {
    if (!runningRef.current) return;

    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    // Only analyse a frame the camera has actually delivered. requestAnimationFrame
    // runs at the screen rate (60+ Hz) while cameras deliver ~30 fps, so the old
    // loop re-analysed duplicate frames and wasted the time real frames needed.
    // Fallback: some browsers advance currentTime coarsely for live streams, so
    // never wait more than 100 ms between analysed frames.
    const freshFrame =
      video &&
      (video.currentTime !== lastVideoTimeRef.current || performance.now() - lastTimestampRef.current > 100);

    if (video && landmarker && video.readyState >= 2 && freshFrame) {
      lastVideoTimeRef.current = video.currentTime;
      // MediaPipe's VIDEO mode requires strictly increasing timestamps.
      let ts = performance.now();
      if (ts <= lastTimestampRef.current) ts = lastTimestampRef.current + 1;
      lastTimestampRef.current = ts;

      try {
        const result = landmarker.detectForVideo(video, ts);

        // Brightness changes slowly; reading back pixels every frame is costly.
        if (frameIndexRef.current++ % 10 === 0) {
          try {
            brightnessRef.current = frameBrightness(video, brightnessCanvasRef.current);
          } catch {
            brightnessRef.current = undefined;
          }
        }

        cbs.current.onResult?.(result, ts, brightnessRef.current);

        const hasSubject =
          (result?.faceLandmarks?.length || result?.landmarks?.length || 0) > 0;
        if (hasSubject !== detectingRef.current) {
          detectingRef.current = hasSubject;
          setDetecting(hasSubject);
        }

        const overlay = overlayRef.current;
        if (overlay && cbs.current.onDraw) {
          if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
            overlay.width = video.videoWidth || 640;
            overlay.height = video.videoHeight || 480;
          }
          const ctx = overlay.getContext('2d');
          ctx.clearRect(0, 0, overlay.width, overlay.height);
          cbs.current.onDraw(ctx, result, overlay);
        }
      } catch {
        // A dropped frame is not worth aborting the session for.
      }
    }

    const now = performance.now();
    const secs = (now - startedAtRef.current) / 1000;
    if (now - lastUiUpdateRef.current > 120) {
      lastUiUpdateRef.current = now;
      setElapsed(secs);
    }

    if (secs >= durationSec) {
      runningRef.current = false;
      setStatus('done');
      cleanup();
      cbs.current.onComplete?.();
      return;
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [durationSec, cleanup]);

  const start = useCallback(async () => {
    if (status !== 'ready') {
      const ok = await prepare();
      if (!ok) return;
    }
    startedAtRef.current = performance.now();
    lastTimestampRef.current = -1;
    lastVideoTimeRef.current = -1;
    frameIndexRef.current = 0;
    brightnessRef.current = undefined;
    detectingRef.current = false;
    runningRef.current = true;
    setElapsed(0);
    setStatus('recording');
    rafRef.current = requestAnimationFrame(loop);
  }, [status, prepare, loop]);

  const stop = useCallback(() => {
    runningRef.current = false;
    cleanup();
    setStatus('done');
    cbs.current.onComplete?.();
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setStatus('idle');
    setElapsed(0);
    setError(null);
  }, [cleanup]);

  return {
    videoRef,
    overlayRef,
    status,
    error,
    elapsed,
    detecting,
    progress: Math.min(1, elapsed / durationSec),
    remaining: Math.max(0, Math.ceil(durationSec - elapsed)),
    prepare,
    start,
    stop,
    reset,
    isRecording: status === 'recording',
  };
}

export default useVisionRecorder;
