/**
 * Real-data check of the hand test: runs the app's browser feature code and
 * server scoring on real MediaPipe hand recordings.
 *
 * Data: "Parkinson's Tremor Classification Dataset" (Kaggle, MIT licence),
 * recorded on the PN Expert platform: 21 MediaPipe hand landmarks per frame at
 * ~20 fps, with the treating doctor's MDS-UPDRS rating (0 = normal .. 4) for
 * finger tapping and postural tremor. Download once:
 *
 *   python -m kaggle datasets download -d nikee7/parkinsons-tremor-classification-dataset \
 *     -p ml-service/data/raw/tremor --unzip
 *
 *   npm run evaluate:hand            (from server/)
 *
 * Reports, per doctor rating: the measured tapping features, how often the
 * tremor rule fires on holds, and — for "people" assembled from four real
 * recordings (tap + hold, each hand) — the risk band and pattern the app shows.
 * The patients are people with Parkinson's; a rating of 0 means that item was
 * normal, so rating-0 hands are the closest stand-in for normal hands here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HandTracker } from '../../client/src/lib/handFeatures.js';
import { analyzeAssessment } from '../src/services/scoring/fusion.js';
import { healthyFace, healthyVoice } from '../test-support/healthyProfile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'ml-service/data/raw/tremor');
if (!fs.existsSync(path.join(DATA, 'train.csv'))) {
  console.error(`Dataset not found in ${DATA}. See the download command at the top of this file.`);
  process.exit(1);
}

const ASPECT = 16 / 9; // PN Expert video; makes 3D bone lengths most constant
const SETTLE_MS = 2000; // stands in for the app's untimed get-ready period

const items = fs.readFileSync(path.join(DATA, 'train.csv'), 'utf8').trim().split(/\r?\n/).slice(1)
  .map((l) => l.split(','))
  .map((c) => ({ file: c[0], task: c[1], rating: Number(c[5]) }));

const cache = new Map();
function frames(file) {
  if (cache.has(file)) return cache.get(file);
  const lines = fs.readFileSync(path.join(DATA, 'data', file), 'utf8').trim().split(/\r?\n/);
  const ti = lines[0].split(',').indexOf('TIME');
  const out = lines.slice(1).map((l) => l.split(',').map(Number)).map((r) => {
    const lm = [];
    for (let i = 0; i < 21; i++) lm.push({ x: r[i * 3], y: r[i * 3 + 1], z: r[i * 3 + 2] });
    return { t: r[ti] * 1000, lm };
  }).filter((f) => Number.isFinite(f.t) && Number.isFinite(f.lm[0].x));
  cache.set(file, out);
  return out;
}

/** Feeds one recording into the tracker as one phase, after the settle period. */
function feed(tracker, side, phase, file, maxSec, clock) {
  const fr = frames(file);
  const t0 = fr[0].t + SETTLE_MS;
  tracker.setSide(side);
  tracker.setPhase(phase);
  for (const f of fr) {
    if (f.t < t0 || f.t > t0 + maxSec * 1000) continue;
    tracker.push({ landmarks: [f.lm] }, clock + (f.t - t0));
  }
  return clock + maxSec * 1000 + SETTLE_MS;
}

const q = (arr, p) => {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(p * (s.length - 1))] : NaN;
};
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

// ---- 1. Single recordings, by rating -------------------------------------
const single = [];
for (const it of items) {
  if (it.task !== 'Finger tapping' && it.task !== 'Postural tremor') continue;
  if (frames(it.file).length < 40) continue;
  const tr = new HandTracker();
  tr.setAspect(ASPECT);
  feed(tr, 'left', it.task === 'Finger tapping' ? 'tap' : 'hold', it.file, 30, 0);
  single.push({ ...it, f: tr.sideFeatures('left') });
}

console.log('\nFinger tapping, by doctor rating (median [10th-90th pct])');
const tapRows = [];
for (const r of [0, 1, 2, 3, 4]) {
  const g = single.filter((o) => o.task === 'Finger tapping' && o.rating === r && o.f?.tapAnalysed);
  const v = (k) => g.map((o) => o.f[k]);
  const cell = (k) => `${f2(q(v(k), 0.5))} [${f2(q(v(k), 0.1))}-${f2(q(v(k), 0.9))}]`;
  tapRows.push({ rating: r, n: g.length, 'taps/s': cell('tapFrequencyHz'), amplitude: cell('tapAmplitudeMean'), decrement: cell('tapAmplitudeDecay') });
}
console.table(tapRows);

console.log('Postural hold, by doctor rating');
const holdRows = [];
for (const r of [0, 1, 2, 3, 4]) {
  const g = single.filter((o) => o.task === 'Postural tremor' && o.rating === r && o.f?.holdAnalysed);
  if (!g.length) continue;
  holdRows.push({
    rating: r,
    n: g.length,
    'tremor flagged': `${(g.filter((o) => o.f.tremorDetected).length / g.length * 100).toFixed(0)}%`,
    'tremor size (palm lengths)': f2(q(g.map((o) => o.f.tremorAmplitude), 0.5)),
    'drift p90': f2(q(g.map((o) => o.f.holdDriftPx), 0.9)),
  });
}
console.table(holdRows);

// ---- 2. Assembled "people", full scoring ---------------------------------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(7);
const N = 60;
console.log(`Full scoring: ${N} "people" per group, each hand/task from a different real recording`);
console.log('(different patients per side makes left/right differences larger than in one person)');
const groups = [['rated normal (0)', [0]], ['rated 0-1', [0, 1]], ['rated 3-4', [3, 4]]];
const rows = [];
for (const [name, ratings] of groups) {
  const taps = items.filter((i) => i.task === 'Finger tapping' && ratings.includes(i.rating));
  const holds = items.filter((i) => i.task === 'Postural tremor' && ratings.includes(i.rating));
  const pick = (arr) => arr[Math.floor(r() * arr.length)].file;
  const risk = { low: 0, mild: 0, moderate: 0, high: 0 };
  let flagged = 0;
  for (let i = 0; i < N; i++) {
    const tr = new HandTracker();
    tr.setAspect(ASPECT);
    let clock = 0;
    clock = feed(tr, 'left', 'tap', pick(taps), 10, clock);
    clock = feed(tr, 'left', 'hold', pick(holds), 7, clock);
    clock = feed(tr, 'right', 'tap', pick(taps), 10, clock);
    feed(tr, 'right', 'hold', pick(holds), 7, clock);
    const hand = { features: tr.finish(), quality: tr.quality() };
    const a = analyzeAssessment({ modules: { voice: healthyVoice(), face: healthyFace(), hand }, age: 60 });
    risk[a.riskLevel]++;
    if (a.pattern.type !== 'typical') flagged++;
  }
  rows.push({ group: name, 'Low risk': risk.low, Mild: risk.mild, Moderate: risk.moderate, High: risk.high, 'pattern flagged': flagged });
}
console.table(rows);
