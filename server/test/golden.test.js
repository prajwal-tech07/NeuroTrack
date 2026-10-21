/**
 * End-to-end golden profiles: the real browser feature code (hand) + server
 * scoring, with face/voice values taken from real-data calibration
 * (test-support/healthyProfile.js).
 *
 * Guards against the bug where every user got roughly the same result:
 * a healthy person was scored "Mild/Moderate risk" and labelled one-sided
 * weakness or Parkinsonian, varying run to run and with frame rate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAssessment } from '../src/services/scoring/fusion.js';
import { pairAsymmetry } from '../src/services/scoring/laterality.js';
import {
  healthyFace,
  healthyHand,
  healthyVoice,
  parkinsonianProfile,
  rightWeaknessProfile,
} from '../test-support/healthyProfile.js';

const RUNS = [30, 20, 15, 12].flatMap((fps) => [1, 2, 3].map((seed) => ({ fps, seed })));

test('a healthy person scores low risk and typical at any frame rate', () => {
  for (const { fps, seed } of RUNS) {
    const a = analyzeAssessment({
      modules: { voice: healthyVoice(), face: healthyFace(), hand: healthyHand({ fps, seed }) },
      age: 45,
    });
    const where = `fps=${fps} seed=${seed}`;
    assert.equal(a.riskLevel, 'low', `${where}: ${a.overallScore} ${a.riskLabel}`);
    assert.equal(a.pattern.type, 'typical', `${where}: ${a.pattern.type}`);
    assert.ok(a.laterality.index < 0.15, `${where}: laterality ${a.laterality.index}`);
    assert.ok(a.modules.hand.score >= 85, `${where}: hand ${a.modules.hand.score}`);
  }
});

test('healthy without the voice model is still low risk', () => {
  const a = analyzeAssessment({
    modules: { voice: healthyVoice({ withModel: false }), face: healthyFace(), hand: healthyHand() },
    age: 45,
  });
  assert.equal(a.riskLevel, 'low');
  assert.equal(a.scoringEngine, 'rules-v1');
  // Browser frame-level perturbation is not scored.
  const ind = Object.fromEntries(a.modules.voice.indicators.map((i) => [i.key, i]));
  assert.equal(ind.jitter.score, null);
});

test('a Parkinsonian profile is flagged Parkinsonian, not low risk', () => {
  for (const { fps, seed } of RUNS) {
    const a = analyzeAssessment({ modules: parkinsonianProfile({ fps, seed }), age: 66 });
    assert.equal(a.pattern.type, 'parkinsonian', `fps=${fps} seed=${seed}`);
    assert.notEqual(a.riskLevel, 'low');
    const hand = a.modules.hand.features;
    // A 5 Hz tremor needs > 10 analysed frames/s (Nyquist); at ~11 fps it sits at
    // the limit, so only one hand is required there.
    if (fps >= 15) assert.ok(hand.left.tremorDetected && hand.right.tremorDetected, `tremor both hands @${fps}`);
    else assert.ok(hand.left.tremorDetected || hand.right.tremorDetected, `tremor one hand @${fps}`);
  }
});

test('right-sided weakness is flagged one-sided, right, and not low risk', () => {
  for (const { fps, seed } of RUNS) {
    const a = analyzeAssessment({ modules: rightWeaknessProfile({ fps, seed }), age: 66 });
    assert.equal(a.pattern.type, 'hemiparetic', `fps=${fps} seed=${seed}`);
    assert.equal(a.pattern.affectedSide, 'right');
    assert.ok(a.overallScore <= 64, `score ${a.overallScore}`);
  }
});

test('healthy hand: no false tremor, both sides measured equally', () => {
  for (const { fps, seed } of RUNS) {
    const { features: f } = healthyHand({ fps, seed });
    assert.equal(f.left.tremorDetected, false, `fps=${fps}`);
    assert.equal(f.right.tremorDetected, false, `fps=${fps}`);
    assert.ok(Math.abs(f.left.tapFrequencyHz - 4.5) < 0.3, `left ${f.left.tapFrequencyHz} @${fps}`);
    assert.ok(Math.abs(f.right.tapFrequencyHz - 4.5) < 0.3, `right ${f.right.tapFrequencyHz} @${fps}`);
    assert.ok(Math.abs(f.left.tapAmplitudeMean - f.right.tapAmplitudeMean) < 0.1);
  }
});

test('noise-level pairs do not read as one-sided', () => {
  // Arm drift of +0.002 vs -0.003 palm lengths is noise, not a 100% difference.
  assert.ok(pairAsymmetry(0.002, -0.003, false, 0.5).index < 0.02);
  // A real difference still registers.
  const real = pairAsymmetry(4.5, 1.8, true, 2);
  assert.ok(real.index > 0.5);
  assert.equal(real.weakSide, 'right');
});

test('a side with no measurement is null, never 0', () => {
  const { features: f } = healthyHand();
  const missing = { ...f, right: { ...f.right, tapFrequencyHz: null, tapAmplitudeMean: null } };
  const a = analyzeAssessment({ modules: { hand: { features: missing, quality: 1 } } });
  const tapDetail = a.laterality.details.find((d) => d.key === 'tapFrequencyHz');
  assert.equal(tapDetail, undefined, 'unmeasured pair must be skipped, not compared with 0');
});
