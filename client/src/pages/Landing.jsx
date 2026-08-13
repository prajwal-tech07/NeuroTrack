import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext.jsx';
import { DisclaimerNote, Logo } from '../components/ui.jsx';
import {
  IconFace,
  IconHand,
  IconMic,
  IconMoon,
  IconReports,
  IconShield,
  IconSparkle,
  IconSun,
  IconTrend,
  IconWalk,
} from '../components/Icons.jsx';

const FEATURES = [
  {
    icon: IconSparkle,
    title: 'AI Detection',
    body: 'Voice, face, hand and gait analysis from a single five-minute session.',
  },
  {
    icon: IconTrend,
    title: 'Weekly Tracking',
    body: 'Monitor neurological changes regularly and see the direction of travel.',
  },
  {
    icon: IconReports,
    title: 'Monthly Reports',
    body: 'Clear PDF reports with trends and insights you can take to a clinician.',
  },
  {
    icon: IconShield,
    title: 'Secure & Private',
    body: 'Recordings never leave your device — only numeric features are stored.',
  },
];

const MODULES = [
  {
    icon: IconMic,
    name: 'Voice Analysis',
    body: 'Measures jitter, shimmer, harmonics-to-noise ratio and pitch variation from a sustained vowel and a read sentence.',
    color: 'text-brand-600 bg-brand-50 dark:bg-brand-900/30 dark:text-brand-300',
  },
  {
    icon: IconFace,
    name: 'Facial Analysis',
    body: 'Tracks 478 facial landmarks to quantify blink rate, expression amplitude and left/right symmetry.',
    color: 'text-risk-low bg-risk-low/10',
  },
  {
    icon: IconHand,
    name: 'Hand Movement',
    body: 'Finger-tapping speed, amplitude decrement and rhythm, plus spectral tremor analysis during a steady hold.',
    color: 'text-risk-mild bg-risk-mild/10',
  },
  {
    icon: IconWalk,
    name: 'Gait Analysis',
    body: 'Derives cadence, step-time variability, arm swing symmetry and trunk sway from full-body pose tracking.',
    color: 'text-blue-600 bg-blue-500/10',
  },
];

const STEPS = [
  { n: 1, title: 'Create your account', body: 'Takes under a minute. Age and gender let the engine normalise your scores.' },
  { n: 2, title: 'Complete the four tests', body: 'Speak, smile, tap and march. Your camera and microphone do the rest.' },
  { n: 3, title: 'Get your AI analysis', body: 'An overall score, risk band, per-measure breakdown and specific next steps.' },
  { n: 4, title: 'Track it every week', body: 'The trend across weeks is what matters — one reading never tells the story.' },
];

function Nav() {
  const { isDark, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all ${
        scrolled ? 'border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-surface-dark/85' : ''
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Logo />
        <div className="hidden items-center gap-8 md:flex">
          {[
            ['Features', '#features'],
            ['How It Works', '#how'],
            ['About', '#about'],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="text-sm font-medium text-slate-500 transition hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-300"
            >
              {label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Toggle theme"
          >
            {isDark ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
          </button>
          <Link to="/login" className="px-3 text-sm font-bold text-brand-600 dark:text-brand-300">
            Login
          </Link>
          <Link to="/register" className="btn-primary !px-5 !py-2">
            Get Started
          </Link>
        </div>
      </nav>
    </header>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen">
      <Nav />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-12 lg:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="animate-fade-up">
            <span className="chip mb-5 border border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-200">
              <IconSparkle className="h-3.5 w-3.5" />
              Multimodal · Secure · Continuous
            </span>
            <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-ink dark:text-white sm:text-5xl lg:text-[3.4rem]">
              AI-Powered Early{' '}
              <span className="text-brand-600 dark:text-brand-400">Neurological Disorder Screening</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed muted">
              Detect early changes using multimodal AI analysis of voice, face, hand movement and
              gait — from your own laptop, in about five minutes a week.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="btn-primary !px-7 !py-3">
                Get Started
              </Link>
              <Link to="/login" className="btn-outline !px-7 !py-3">
                Login
              </Link>
            </div>
            <p className="mt-6 text-xs muted">
              No credit card. Your audio and video are processed on your device and never uploaded.
            </p>
          </div>

          <div className="relative animate-fade-up">
            <div className="flex aspect-[4/3] items-center justify-center rounded-3xl bg-gradient-to-br from-brand-50 to-brand-100 dark:from-brand-900/40 dark:to-brand-800/20">
              <div className="relative flex h-56 w-56 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-brand-400/25 animate-pulse-ring" />
                <span className="absolute inset-0 rounded-full border-2 border-brand-300/60 dark:border-brand-600/50" />
                <span className="text-6xl font-extrabold text-brand-600 dark:text-brand-300">AI</span>
              </div>
            </div>
            <div className="pointer-events-none absolute -bottom-5 -left-5 hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-card sm:block dark:border-slate-800 dark:bg-surface-cardDark">
              <p className="text-[10px] font-semibold uppercase tracking-wide muted">Overall score</p>
              <p className="text-2xl font-extrabold text-risk-low">82%</p>
              <p className="text-[10px] font-semibold text-risk-low">Low Risk</p>
            </div>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6 transition hover:-translate-y-0.5 hover:shadow-lift">
              <f.icon className="mb-4 h-6 w-6 text-brand-600 dark:text-brand-300" />
              <h3 className="text-base font-bold text-brand-700 dark:text-brand-300">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-ink dark:text-white">
            Four modalities, one score
          </h2>
          <p className="mt-3 text-sm leading-relaxed muted">
            Each test measures a different domain where early motor and speech changes tend to
            appear. The engine fuses them into a single tracked number, weighted by how clean each
            recording was.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {MODULES.map((m) => (
            <div key={m.name} className="card flex gap-4 p-6">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${m.color}`}>
                <m.icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-ink dark:text-slate-100">{m.name}</h3>
                <p className="mt-1.5 text-sm leading-relaxed muted">{m.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-surface-cardDark">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="mb-10 text-3xl font-extrabold tracking-tight text-ink dark:text-white">
            How it works
          </h2>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n}>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-extrabold text-white">
                  {s.n}
                </div>
                <h3 className="text-base font-bold text-ink dark:text-slate-100">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed muted">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About / disclaimer */}
      <section id="about" className="mx-auto max-w-3xl px-5 py-16 text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-ink dark:text-white">
          Built for early awareness, not diagnosis
        </h2>
        <p className="mt-4 text-sm leading-relaxed muted">
          NeuroTrackAI applies published acoustic and kinematic reference ranges to measurements
          taken from your own recordings. It is designed to help you notice a trend and start a
          conversation with a clinician earlier than you otherwise would.
        </p>
        <div className="mt-8">
          <Link to="/register" className="btn-primary !px-8 !py-3">
            Create your free account
          </Link>
        </div>
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 text-left dark:border-slate-800 dark:bg-surface-cardDark">
          <DisclaimerNote />
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 dark:border-slate-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 sm:flex-row">
          <p className="text-xs muted">NeuroTrackAI · AI-powered neurological screening</p>
          <p className="text-xs muted">Built with React, Node.js, MongoDB and MediaPipe</p>
        </div>
      </footer>
    </div>
  );
}
