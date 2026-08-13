import { CaptureRing, TrackingPill } from './TestShell.jsx';
import { Spinner } from '../../components/ui.jsx';
import { IconCamera, IconCheck } from '../../components/Icons.jsx';

/**
 * Shared camera surface for the three vision tests: preview, landmark overlay,
 * countdown, live prompt and the start/stop control.
 */
export default function CameraPanel({
  recorder,
  prompt,
  subjectLabel,
  idleTitle,
  idleHint,
  doneTitle,
  doneStats = [],
  onStart,
  onRetake,
  mirrored = true,
  aspect = 'aspect-[4/3]',
}) {
  const { videoRef, overlayRef, status, elapsed, progress, remaining, detecting } = recorder;
  const showVideo = status === 'ready' || status === 'recording' || status === 'loading';

  return (
    <div className="flex h-full flex-col rounded-2xl bg-brand-50 p-5 dark:bg-brand-900/20">
      {prompt && (
        <div className="mb-4 rounded-xl bg-white/70 px-4 py-3 text-center dark:bg-slate-900/40">
          <p className="text-[11px] font-bold uppercase tracking-wide text-brand-500">
            {prompt.step}
          </p>
          <p className="mt-1 text-lg font-extrabold text-brand-700 dark:text-brand-200">
            {prompt.action}
          </p>
          {prompt.hint && <p className="mt-0.5 text-xs muted">{prompt.hint}</p>}
        </div>
      )}

      <div className={`relative w-full overflow-hidden rounded-xl bg-slate-900 ${aspect}`}>
        <video
          ref={videoRef}
          playsInline
          muted
          className={`h-full w-full object-cover ${mirrored ? 'scale-x-[-1]' : ''} ${
            showVideo ? '' : 'opacity-0'
          }`}
        />
        <canvas
          ref={overlayRef}
          className={`pointer-events-none absolute inset-0 h-full w-full ${
            mirrored ? 'scale-x-[-1]' : ''
          }`}
        />

        {!showVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
            {status === 'done' ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-risk-low/20 text-risk-low">
                  <IconCheck className="h-7 w-7" />
                </div>
                <p className="text-sm font-bold text-risk-low">{doneTitle}</p>
              </>
            ) : (
              <>
                <IconCamera className="h-10 w-10" />
                <p className="text-sm font-semibold">{idleTitle}</p>
              </>
            )}
          </div>
        )}

        {status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/70 text-white">
            <Spinner className="h-7 w-7" />
            <p className="text-xs font-semibold">Loading AI model…</p>
          </div>
        )}

        {status === 'recording' && (
          <>
            <div className="absolute left-3 top-3">
              <TrackingPill detecting={detecting} label={subjectLabel} />
            </div>
            <div className="absolute right-3 top-3 rounded-full bg-slate-900/70 px-3 py-1 text-xs font-bold text-white">
              ● REC {elapsed.toFixed(0)}s
            </div>
          </>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4">
        {status === 'recording' ? (
          <CaptureRing progress={progress} remaining={remaining} />
        ) : status === 'done' ? (
          doneStats.length > 0 && (
            <dl className="grid w-full grid-cols-2 gap-2 text-center text-[11px]">
              {doneStats.map(([k, v]) => (
                <div key={k} className="rounded-lg bg-white/70 px-2 py-2 dark:bg-slate-900/40">
                  <dt className="muted">{k}</dt>
                  <dd className="font-bold text-ink dark:text-slate-100">{v}</dd>
                </div>
              ))}
            </dl>
          )
        ) : (
          idleHint && <p className="text-center text-xs muted">{idleHint}</p>
        )}
      </div>

      <div>
        {status === 'recording' ? (
          <button onClick={recorder.stop} className="btn-outline w-full !py-3">
            Stop early
          </button>
        ) : status === 'done' ? (
          <button onClick={onRetake} className="btn-ghost w-full !py-3">
            Record again
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={status === 'loading'}
            className="btn-primary w-full !py-3"
          >
            <IconCamera className="h-4 w-4" />
            {status === 'error' ? 'Try again' : 'Start Recording'}
          </button>
        )}
      </div>
    </div>
  );
}
