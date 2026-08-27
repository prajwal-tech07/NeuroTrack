/**
 * Pattern-classifier validation on synthetic labelled cases.
 *
 * ============================ READ THIS ============================
 * The accuracy this prints is measured against SIMULATED cases whose
 * labels we assigned ourselves. It is a REGRESSION TEST, not clinical
 * validation. It answers "does the classifier separate the patterns it
 * was designed to separate, and did a change break it?" It does NOT
 * answer "how often is this right about a real patient" — that needs
 * real labelled patients, which this project does not have.
 *
 * Quote it as "accuracy on synthetic profiles", never as clinical accuracy.
 * ===================================================================
 *
 *   npm run validate
 *   npm run validate -- --n 500 --seed 7 --verbose
 */
import { analyzeAssessment } from '../src/services/scoring/fusion.js';

// ---- Deterministic RNG so runs are reproducible ---------------------------
let seedState = 42;
const seedRandom = (s) => {
  seedState = s >>> 0;
};
function rnd() {
  // mulberry32
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const uniform = (lo, hi) => lo + rnd() * (hi - lo);
const gauss = (mu, sd) => {
  const u = Math.max(1e-9, rnd());
  const v = rnd();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pos = (v, min = 0) => Math.max(min, v);

/**
 * `--hard` restricts every impaired class to the mild/early severity band.
 * This is the band that actually matters for early screening and the one where
 * the patterns genuinely overlap, so accuracy here is the number worth trusting.
 */
const HARD = process.argv.includes('--hard');

// ---- Synthetic case generators -------------------------------------------
// Distributions are deliberately overlapping and noisy. Cleanly separable
// fake data would produce a meaningless 100%.

function handModule({ leftTap, rightTap, decay, tremorHz, tremorPower, leftDrift, rightDrift }) {
  const side = (tap, drift) => ({
    tapFrequencyHz: pos(tap, 0.2),
    tapCount: Math.round(pos(tap, 0.2) * 10),
    tapAmplitudeMean: pos(gauss(0.1 + tap * 0.055, 0.03), 0.02),
    tapAmplitudeDecay: pos(decay + gauss(0, 0.05)),
    tapIntervalCv: pos(gauss(0.12 + decay * 0.5, 0.05), 0.02),
    tapHesitations: Math.max(0, Math.round(gauss(decay * 6, 1.2))),
    tremorPeakHz: tremorHz,
    tremorPowerRatio: pos(tremorPower + gauss(0, 0.03)),
    holdDriftPx: pos(Math.abs(drift) + gauss(0.012, 0.006)),
    holdDropY: drift,
    trackedRatio: uniform(0.85, 0.99),
    tapAnalysed: true,
    holdAnalysed: true,
  });

  const left = side(leftTap, leftDrift);
  const right = side(rightTap, rightDrift);
  const worse = left.tapFrequencyHz <= right.tapFrequencyHz ? left : right;

  return {
    quality: uniform(0.78, 0.97),
    features: {
      ...worse,
      left,
      right,
      bothSidesTested: true,
      durationSec: uniform(30, 38),
      trackedRatio: uniform(0.85, 0.98),
      sampleCount: Math.round(uniform(500, 800)),
    },
  };
}

function faceModule({ expr, asym, smileL, smileR, browL, browR, shutL, shutR, blink }) {
  return {
    quality: uniform(0.78, 0.97),
    features: {
      blinkRate: pos(blink, 1),
      blinkCount: Math.round(pos(blink, 1) / 4),
      expressivityIndex: pos(expr, 0.005),
      smileAmplitude: Math.max(smileL, smileR),
      browRaiseAmplitude: (browL + browR) / 2,
      asymmetryIndex: pos(asym),
      mouthOpenRange: pos(gauss(0.06 + expr, 0.03), 0.01),
      eyeOpenAsymmetry: pos(Math.abs(shutL - shutR) * 2 + gauss(0.02, 0.012)),
      trackedRatio: uniform(0.85, 0.99),
      brightness: uniform(0.44, 0.58),
      durationSec: uniform(20, 26),
      left: {
        expressivity: pos(expr * uniform(0.9, 1.1) * (smileL / Math.max(smileL, smileR, 1e-6)), 0.002),
        smile: pos(smileL, 0.005),
        brow: pos(browL, 0.004),
        eyeShutResidual: pos(shutL, 0),
      },
      right: {
        expressivity: pos(expr * uniform(0.9, 1.1) * (smileR / Math.max(smileL, smileR, 1e-6)), 0.002),
        smile: pos(smileR, 0.005),
        brow: pos(browR, 0.004),
        eyeShutResidual: pos(shutR, 0),
      },
      eyeClosureGap: Math.abs(shutL - shutR),
      eyeClosureTested: true,
    },
  };
}

function gaitModule({ cadence, swingL, swingR, stepL, stepR, sway, lean }) {
  const asym =
    Math.max(swingL, swingR) > 0 ? Math.abs(swingL - swingR) / Math.max(swingL, swingR) : 0;
  return {
    quality: uniform(0.75, 0.95),
    features: {
      cadenceStepsMin: pos(cadence, 20),
      stepCount: Math.round(pos(cadence, 20) / 3),
      stepTimeCv: pos(gauss(0.035 + asym * 0.1, 0.02), 0.005),
      stepSymmetry:
        Math.max(stepL, stepR) > 0 ? Math.abs(stepL - stepR) / ((stepL + stepR) / 2) : 0,
      armSwingAmplitude: (swingL + swingR) / 2,
      armSwingAsymmetry: asym,
      trunkSwayIndex: pos(sway, 0.005),
      posturalLeanDeg: pos(lean, 0.5),
      doubleSupportRatio: pos(gauss(0.24 + asym * 0.12, 0.03), 0.1),
      trackedRatio: uniform(0.8, 0.98),
      durationSec: uniform(20, 26),
      left: { stepCount: 10, stepInterval: pos(stepL, 0.2), armSwing: pos(swingL, 0.005) },
      right: { stepCount: 10, stepInterval: pos(stepR, 0.2), armSwing: pos(swingR, 0.005) },
      bothLegsDetected: true,
    },
  };
}

function voiceModule({ jitter, shimmer, hnr, prosody }) {
  return {
    quality: uniform(0.75, 0.96),
    features: {
      jitterPercent: pos(jitter, 0.1),
      shimmerPercent: pos(shimmer, 0.5),
      hnrDb: pos(hnr, 2),
      f0Mean: gauss(185, 25),
      f0StdSemitones: pos(prosody, 0.15),
      voicedRatio: uniform(0.55, 0.85),
      pauseRatio: pos(gauss(0.18, 0.06), 0.05),
      speechRateSyll: pos(gauss(4.6, 0.8), 1),
      maxPhonationSec: pos(gauss(14, 3), 2),
      intensityCv: pos(gauss(0.18, 0.05), 0.05),
      snrDb: uniform(14, 26),
      durationSec: uniform(18, 24),
    },
  };
}

/** Healthy: symmetric, everything in range. */
function makeTypical() {
  const tap = gauss(5.0, 0.7);
  const shut = pos(gauss(0.012, 0.006));
  const expr = pos(gauss(0.165, 0.03), 0.02);
  const smile = pos(gauss(0.27, 0.05), 0.03);
  const brow = pos(gauss(0.16, 0.04), 0.02);
  const swing = pos(gauss(0.175, 0.03), 0.02);
  const step = gauss(1.05, 0.08);

  return {
    voice: voiceModule({ jitter: gauss(0.5, 0.15), shimmer: gauss(2.3, 0.6), hnr: gauss(23, 2.5), prosody: gauss(3.2, 0.5) }),
    face: faceModule({
      expr, asym: pos(gauss(0.03, 0.015)),
      smileL: smile * uniform(0.94, 1.06), smileR: smile * uniform(0.94, 1.06),
      browL: brow * uniform(0.93, 1.07), browR: brow * uniform(0.93, 1.07),
      shutL: shut, shutR: pos(shut + gauss(0, 0.004)), blink: gauss(18, 3.5),
    }),
    hand: handModule({
      leftTap: tap * uniform(0.93, 1.07), rightTap: tap * uniform(0.93, 1.07),
      decay: pos(gauss(0.06, 0.03)), tremorHz: uniform(8.5, 11.5),
      tremorPower: pos(gauss(0.05, 0.02)),
      leftDrift: gauss(0, 0.008), rightDrift: gauss(0, 0.008),
    }),
    gait: gaitModule({
      cadence: gauss(112, 8),
      swingL: swing * uniform(0.92, 1.08), swingR: swing * uniform(0.92, 1.08),
      stepL: step, stepR: step * uniform(0.95, 1.05),
      sway: pos(gauss(0.02, 0.008)), lean: pos(gauss(5, 2)),
    }),
  };
}

/** Parkinsonian: bilateral slowing, decrement, rest tremor, symmetric. */
function makeParkinsonian() {
  const severity = HARD ? uniform(0.22, 0.45) : uniform(0.35, 0.9);
  // Both hands slowed. PD onset is asymmetric, so allow a modest side gap —
  // this is what makes the task genuinely hard rather than trivially separable.
  const baseTap = 4.6 - severity * 2.9;
  const sideGap = uniform(0, 0.22);
  const expr = pos(0.16 - severity * 0.115, 0.01);
  const smile = pos(0.27 - severity * 0.19, 0.02);
  const brow = pos(0.16 - severity * 0.11, 0.015);
  const shut = pos(gauss(0.013, 0.006));
  const swing = pos(0.175 - severity * 0.13, 0.012);
  const step = gauss(1.05, 0.08) * (1 + severity * 0.1);

  return {
    voice: voiceModule({
      jitter: 0.5 + severity * 2.0, shimmer: 2.3 + severity * 5.5,
      hnr: 23 - severity * 13, prosody: pos(3.2 - severity * 2.4, 0.2),
    }),
    face: faceModule({
      expr, asym: pos(gauss(0.04, 0.02)),
      smileL: smile * uniform(0.9, 1.1), smileR: smile * uniform(0.9, 1.1),
      browL: brow * uniform(0.9, 1.1), browR: brow * uniform(0.9, 1.1),
      shutL: shut, shutR: pos(shut + gauss(0, 0.005)),
      blink: pos(18 - severity * 9, 3),
    }),
    hand: handModule({
      leftTap: baseTap * (1 - sideGap / 2), rightTap: baseTap * (1 + sideGap / 2),
      decay: 0.07 + severity * 0.38,
      tremorHz: uniform(4.0, 6.1),
      tremorPower: 0.1 + severity * 0.3,
      leftDrift: gauss(0, 0.01), rightDrift: gauss(0, 0.01),
    }),
    gait: gaitModule({
      cadence: 112 - severity * 32,
      swingL: swing * uniform(0.88, 1.12), swingR: swing * uniform(0.88, 1.12),
      stepL: step, stepR: step * uniform(0.94, 1.06),
      sway: pos(0.02 + severity * 0.07), lean: 5 + severity * 16,
    }),
  };
}

/** Hemiparetic: one side weak, other spared, no rest tremor. */
function makeHemiparetic() {
  const severity = HARD ? uniform(0.25, 0.5) : uniform(0.4, 0.95);
  const weakLeft = rnd() < 0.5;

  const goodTap = gauss(4.8, 0.6);
  const badTap = goodTap * (1 - severity * 0.62);
  const goodSmile = pos(gauss(0.27, 0.04), 0.03);
  const badSmile = goodSmile * (1 - severity * 0.72);
  const goodBrow = pos(gauss(0.16, 0.035), 0.02);
  // Central (stroke) lesions spare the forehead; peripheral palsy does not.
  const foreheadSpared = rnd() < 0.6;
  const badBrow = foreheadSpared ? goodBrow * uniform(0.85, 1.0) : goodBrow * (1 - severity * 0.7);
  const goodShut = pos(gauss(0.012, 0.005));
  const badShut = goodShut + severity * uniform(0.02, 0.06);
  const goodSwing = pos(gauss(0.175, 0.03), 0.02);
  const badSwing = goodSwing * (1 - severity * 0.7);
  const goodStep = gauss(1.05, 0.08);
  const badStep = goodStep * (1 + severity * 0.35);

  const pick = (good, bad) => (weakLeft ? { L: bad, R: good } : { L: good, R: bad });

  const tap = pick(goodTap, badTap);
  const smile = pick(goodSmile, badSmile);
  const brow = pick(goodBrow, badBrow);
  const shut = pick(goodShut, badShut);
  const swing = pick(goodSwing, badSwing);
  const step = pick(goodStep, badStep);
  const drift = pick(gauss(0, 0.008), severity * uniform(0.03, 0.09));

  return {
    // Speech after stroke is slurred rather than monotone: prosody is
    // relatively preserved, so this must not look Parkinsonian.
    voice: voiceModule({
      jitter: 0.6 + severity * 1.2, shimmer: 2.6 + severity * 3.0,
      hnr: 22 - severity * 8, prosody: pos(gauss(2.9, 0.6), 0.3),
    }),
    face: faceModule({
      expr: pos(gauss(0.13, 0.03), 0.015),
      asym: 0.06 + severity * 0.2,
      smileL: smile.L, smileR: smile.R,
      browL: brow.L, browR: brow.R,
      shutL: shut.L, shutR: shut.R,
      blink: gauss(16, 4),
    }),
    hand: handModule({
      leftTap: tap.L, rightTap: tap.R,
      decay: pos(gauss(0.1, 0.05)),
      tremorHz: uniform(8, 11.5),           // physiological band, not rest tremor
      tremorPower: pos(gauss(0.06, 0.025)),
      leftDrift: drift.L, rightDrift: drift.R,
    }),
    gait: gaitModule({
      cadence: 112 - severity * 22,
      swingL: swing.L, swingR: swing.R,
      stepL: step.L, stepR: step.R,
      sway: pos(0.025 + severity * 0.05), lean: pos(gauss(7, 3)),
    }),
  };
}

const GENERATORS = {
  typical: makeTypical,
  parkinsonian: makeParkinsonian,
  hemiparetic: makeHemiparetic,
};

// ---- Run -----------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, dflt) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
  };
  return {
    n: Number(get('--n', 300)),
    seed: Number(get('--seed', 42)),
    verbose: args.includes('--verbose'),
  };
}

function main() {
  const { n, seed, verbose } = parseArgs();
  seedRandom(seed);

  const labels = Object.keys(GENERATORS);
  const confusion = {};
  for (const t of labels) {
    confusion[t] = { typical: 0, parkinsonian: 0, hemiparetic: 0, mixed: 0 };
  }

  let correct = 0;
  let total = 0;
  let sideCorrect = 0;
  let sideTotal = 0;
  const misses = [];

  for (const trueLabel of labels) {
    for (let i = 0; i < n; i++) {
      const modules = GENERATORS[trueLabel]();
      const result = analyzeAssessment({ modules, age: 60 });
      const predicted = result.pattern.type;

      confusion[trueLabel][predicted]++;
      total++;
      if (predicted === trueLabel) correct++;
      else if (verbose && misses.length < 12) {
        misses.push({
          trueLabel,
          predicted,
          score: result.overallScore,
          lat: result.laterality.index,
          p: result.pattern.scores.parkinsonian,
          h: result.pattern.scores.hemiparetic,
        });
      }

      // For hemiparetic cases, also check the side was identified correctly.
      if (trueLabel === 'hemiparetic' && predicted === 'hemiparetic') {
        sideTotal++;
        const trueWeak = modules.hand.features.left.tapFrequencyHz <
          modules.hand.features.right.tapFrequencyHz ? 'left' : 'right';
        if (result.pattern.affectedSide === trueWeak) sideCorrect++;
      }
    }
  }

  // ---- Report ------------------------------------------------------------
  const pct = (a, b) => (b === 0 ? '  n/a' : `${((a / b) * 100).toFixed(1)}%`);

  console.log('');
  console.log('='.repeat(66));
  console.log('  PATTERN CLASSIFIER — SYNTHETIC VALIDATION');
  console.log(`  ${n} cases per class · seed ${seed} · ${total} total${HARD ? ' · MILD/EARLY ONLY' : ''}`);
  console.log('='.repeat(66));
  console.log('');
  console.log('  Confusion matrix (rows = truth, cols = predicted)');
  console.log('');
  console.log('  truth \\ pred    typical  parkins.  hemipar.     mixed   recall');
  console.log('  ' + '-'.repeat(62));
  for (const t of labels) {
    const row = confusion[t];
    const rowTotal = Object.values(row).reduce((a, b) => a + b, 0);
    console.log(
      `  ${t.padEnd(14)}${String(row.typical).padStart(8)}${String(row.parkinsonian).padStart(10)}` +
        `${String(row.hemiparetic).padStart(10)}${String(row.mixed).padStart(10)}` +
        `${pct(row[t], rowTotal).padStart(9)}`
    );
  }
  console.log('');

  // Precision per predicted class
  console.log('  Precision');
  for (const p of labels) {
    const predTotal = labels.reduce((acc, t) => acc + confusion[t][p], 0);
    console.log(`    ${p.padEnd(16)} ${pct(confusion[p][p], predTotal)}`);
  }
  console.log('');

  const accuracy = (correct / total) * 100;
  console.log(`  Overall accuracy      ${accuracy.toFixed(1)}%   (${correct}/${total})`);
  if (sideTotal > 0) {
    console.log(`  Affected-side correct ${pct(sideCorrect, sideTotal)}   (${sideCorrect}/${sideTotal})`);
  }
  console.log('');

  if (verbose && misses.length) {
    console.log('  Sample misclassifications');
    for (const m of misses) {
      console.log(
        `    ${m.trueLabel} -> ${m.predicted}  score=${m.score} lat=${m.lat} ` +
          `pEvid=${m.p} hEvid=${m.h}`
      );
    }
    console.log('');
  }

  console.log('  NOTE: synthetic cases with self-assigned labels. This is a');
  console.log('  regression test, NOT clinical validation. Do not quote this');
  console.log('  number as diagnostic accuracy.');
  console.log('='.repeat(66));
  console.log('');

  return accuracy;
}

const accuracy = main();
process.exit(accuracy >= 70 ? 0 : 1);
