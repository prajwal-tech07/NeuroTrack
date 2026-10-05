import { useCallback, useEffect, useRef, useState } from 'react';
import TestShell, { CaptureRing } from './TestShell.jsx';
import { Spinner } from '../../components/ui.jsx';
import { IconCheck, IconMic } from '../../components/Icons.jsx';
import { decodeRecording, extractVoiceFeatures, voiceQuality } from '../../lib/audioFeatures.js';
import { encodeWav } from '../../lib/wav.js';
import api from '../../api/client.js';

const SENTENCE = 'The quick brown fox jumps over the lazy dog.';
const SUSTAIN_SEC = 8;
const READ_SEC = 12;
const TOTAL_SEC = SUSTAIN_SEC + READ_SEC;

export default function VoiceTest({ onComplete, onSkip, initial }) {
  const [phase, setPhase] = useState('idle'); // idle | recording | analysing | done | error
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(initial || null);
  const [mlNote, setMlNote] = useState(null);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);
  const startedAtRef = useRef(0);
  // Raw microphone samples for the sustained vowel (sent to the voice model).
  const pcmRef = useRef([]);
  const pcmRateRef = useRef(48000);
  const processorRef = useRef(null);

  const teardown = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  /**
   * Sends the sustained vowel to the trained voice model. Optional: if the
   * model is unavailable or the vowel is unusable, the test still completes on
   * the on-device measures alone.
   */
  const scoreVowel = useCallback(async () => {
    setMlNote(null);
    if (!pcmRef.current.length) return null;
    try {
      const form = new FormData();
      form.append('audio', encodeWav(pcmRef.current, pcmRateRef.current), 'vowel.wav');
      const res = await api.post('/assessments/voice-audio', form);
      return res.data;
    } catch (err) {
      setMlNote(
        err.status === 400
          ? `Voice model skipped: ${err.message}`
          : 'Voice model unavailable right now; scored with on-device measures only.'
      );
      return null;
    } finally {
      pcmRef.current = [];
    }
  }, []);

  const analyse = useCallback(
    async (blob) => {
      setPhase('analysing');
      try {
        const buffer = await decodeRecording(blob);
        const features = extractVoiceFeatures(buffer);

        if (features.insufficientData) {
          setError(
            'Not enough voice was detected in that recording. Move closer to the microphone, ' +
              'check it is not muted, and try again.'
          );
          setPhase('error');
          return;
        }

        const quality = voiceQuality(features);
        const ml = await scoreVowel();
        const payload = { features, quality, durationSec: features.durationSec, ml };
        setResult(payload);
        setPhase('done');
        onComplete(payload);
      } catch (err) {
        setError(`Could not analyse the recording: ${err.message}`);
        setPhase('error');
      }
    },
    [onComplete, scoreVowel]
  );

  const tick = useCallback(() => {
    const secs = (performance.now() - startedAtRef.current) / 1000;
    setElapsed(secs);
    if (secs >= TOTAL_SEC) {
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false, // these would distort the acoustic measures
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      // Live level meter.
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      const meter = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
        if (audioCtxRef.current) requestAnimationFrame(meter);
      };
      meter();

      // Capture uncompressed samples during the sustained-vowel step only.
      pcmRef.current = [];
      pcmRateRef.current = ctx.sampleRate;
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if ((performance.now() - startedAtRef.current) / 1000 < SUSTAIN_SEC) {
          pcmRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        }
      };
      source.connect(processor);
      processor.connect(ctx.destination); // output stays silent; required for the node to run
      processorRef.current = processor;

      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined;
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        teardown();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        await analyse(blob);
      };

      recorder.start();
      startedAtRef.current = performance.now();
      setElapsed(0);
      setPhase('recording');
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      teardown();
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser address bar and try again.'
          : `Could not start recording: ${err.message}`
      );
      setPhase('error');
    }
  }, [analyse, tick, teardown]);

  const stopEarly = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const inSustain = elapsed < SUSTAIN_SEC;
  const remaining = Math.max(0, Math.ceil(TOTAL_SEC - elapsed));

  return (
    <TestShell
      title="Voice Analysis Test"
      intro="Two short tasks measure how steady and expressive your voice is."
      instructions={[
        'Find a quiet place with no background music or fans.',
        'Keep the microphone about 15 cm from your mouth.',
        `First, hold "Aaaah" steadily for ${SUSTAIN_SEC} seconds on one breath.`,
        'Then read the sentence on the right clearly and naturally.',
      ]}
      error={error}
      onSkip={phase === 'recording' || phase === 'analysing' ? undefined : onSkip}
    >
      <div className="flex h-full flex-col rounded-2xl bg-brand-50 p-6 dark:bg-brand-900/20">
        {/* Prompt */}
        <div className="mb-5 rounded-xl bg-white/70 px-5 py-4 text-center dark:bg-slate-900/40">
          {phase === 'recording' ? (
            inSustain ? (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-500">
                  Step 1 of 2 · sustained vowel
                </p>
                <p className="mt-1.5 text-2xl font-extrabold text-brand-700 dark:text-brand-200">
                  “Aaaaah…”
                </p>
                <p className="mt-1 text-xs muted">Hold it steady for {Math.ceil(SUSTAIN_SEC - elapsed)}s more</p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-500">
                  Step 2 of 2 · read aloud
                </p>
                <p className="mt-1.5 text-base font-bold text-brand-700 dark:text-brand-200">
                  “{SENTENCE}”
                </p>
                <p className="mt-1 text-xs muted">Read it a few times until the timer ends</p>
              </>
            )
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wide text-brand-500">
                You will be asked to say
              </p>
              <p className="mt-1.5 text-base font-bold text-brand-700 dark:text-brand-200">
                “{SENTENCE}”
              </p>
            </>
          )}
        </div>

        {/* Capture area */}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-4">
          {phase === 'recording' ? (
            <>
              <CaptureRing progress={elapsed / TOTAL_SEC} remaining={remaining} size={88} />
              <div className="flex h-12 items-end gap-1">
                {Array.from({ length: 22 }).map((_, i) => {
                  const centre = Math.abs(i - 10.5) / 10.5;
                  const h = Math.max(3, level * 46 * (1 - centre * 0.7) * (0.65 + Math.random() * 0.7));
                  return (
                    <span
                      key={i}
                      className="w-1.5 rounded-full bg-brand-500 transition-all duration-75"
                      style={{ height: `${h}px` }}
                    />
                  );
                })}
              </div>
              <p className="text-xs font-semibold text-brand-600 dark:text-brand-300">
                {level < 0.04 ? 'Speak up — almost no sound detected' : 'Recording…'}
              </p>
            </>
          ) : phase === 'analysing' ? (
            <>
              <Spinner className="h-9 w-9 text-brand-600" />
              <p className="text-sm font-semibold text-brand-600 dark:text-brand-300">
                Extracting acoustic features…
              </p>
            </>
          ) : phase === 'done' ? (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-risk-low/15 text-risk-low">
                <IconCheck className="h-8 w-8" />
              </div>
              <p className="text-sm font-bold text-risk-low">Voice captured</p>
              {result.ml ? (
                <p className="text-center text-[11px] muted">
                  {result.ml.reliable
                    ? `Voice model: ${Math.round(result.ml.pdLikeness * 100)}% Parkinson's-like pattern ` +
                      `(flag above ${Math.round(result.ml.threshold * 100)}%). A screening signal, not a diagnosis.`
                    : 'Voice model not applied: this recording did not resemble its training data.'}
                </p>
              ) : (
                mlNote && <p className="text-center text-[11px] muted">{mlNote}</p>
              )}
              <dl className="grid w-full grid-cols-2 gap-2 text-center text-[11px]">
                {[
                  ['Jitter', `${result.features.jitterPercent}%`],
                  ['Shimmer', `${result.features.shimmerPercent}%`],
                  ['HNR', `${result.features.hnrDb} dB`],
                  ['Pitch range', `${result.features.f0StdSemitones} st`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-white/70 px-2 py-2 dark:bg-slate-900/40">
                    <dt className="muted">{k}</dt>
                    <dd className="font-bold text-ink dark:text-slate-100">{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-brand-600 dark:bg-slate-900/50">
                <IconMic className="h-8 w-8" />
              </div>
              <p className="text-sm font-bold text-ink dark:text-slate-100">Ready to record</p>
              <p className="text-center text-xs muted">
                {TOTAL_SEC} seconds total. The {SUSTAIN_SEC}-second “Aaah” is sent to our voice model and is not
                stored; everything else is analysed on this device.
              </p>
            </>
          )}
        </div>

        {/* Controls */}
        <div className="mt-4">
          {phase === 'recording' ? (
            <button onClick={stopEarly} className="btn-outline w-full !py-3">
              Stop early
            </button>
          ) : phase === 'done' ? (
            <button
              onClick={() => {
                setResult(null);
                setPhase('idle');
              }}
              className="btn-ghost w-full !py-3"
            >
              Record again
            </button>
          ) : (
            <button onClick={start} disabled={phase === 'analysing'} className="btn-primary w-full !py-3">
              <IconMic className="h-4 w-4" />
              {phase === 'error' ? 'Try again' : 'Start Recording'}
            </button>
          )}
        </div>
      </div>
    </TestShell>
  );
}
