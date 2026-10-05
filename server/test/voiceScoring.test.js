/**
 * Voice-model integration in the rule engine.   Run:  npm test  (from server/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import scoreVoice, { ML_WEIGHT } from '../src/services/scoring/voice.js';
import { analyzeAssessment } from '../src/services/scoring/fusion.js';
import { encodeWav } from '../../client/src/lib/wav.js';

const FEATURES = {
  jitterPercent: 0.6,
  shimmerPercent: 3.0,
  hnrDb: 21,
  f0StdSemitones: 2.8,
  pauseRatio: 0.18,
  speechRateSyll: 4.5,
  maxPhonationSec: 14,
  intensityCv: 0.15,
  durationSec: 20,
};

const ml = (over = {}) => ({
  pdLikeness: 0.8,
  threshold: 0.505,
  elevated: true,
  reliable: true,
  distributionDistance: 1.1,
  engine: 'voice-pd-xgboost-sakar2018-v1',
  validation: { auc: 0.82, balancedAccuracy: 0.74, sensitivity: 0.74, specificity: 0.73, trainingSubjects: 252 },
  ...over,
});

test('without ml the score is the rule score', () => {
  const r = scoreVoice({ features: FEATURES, quality: 1 });
  assert.equal(r.ml, null);
  assert.ok(!r.indicators.some((i) => i.key === 'voiceModel'));
});

test('reliable ml output is blended with ML_WEIGHT', () => {
  const rule = scoreVoice({ features: FEATURES, quality: 1 });
  const r = scoreVoice({ features: FEATURES, quality: 1, ml: ml() });
  const expected = Math.round(rule.score * (1 - ML_WEIGHT) + 100 * (1 - 0.8) * ML_WEIGHT);
  assert.ok(Math.abs(r.score - expected) <= 1, `${r.score} vs ${expected}`);
  assert.equal(r.ml.used, true);
  assert.equal(r.ml.weight, ML_WEIGHT);
  assert.equal(r.ml.ruleScore, rule.score);
  assert.ok(r.flags.includes('voice_model_elevated'));
  const ind = r.indicators.find((i) => i.key === 'voiceModel');
  assert.equal(ind.value, 80);
  assert.match(ind.note, /252 people/);
});

test('a low pdLikeness raises the score, a high one lowers it', () => {
  const low = scoreVoice({ features: FEATURES, quality: 1, ml: ml({ pdLikeness: 0.05, elevated: false }) });
  const high = scoreVoice({ features: FEATURES, quality: 1, ml: ml({ pdLikeness: 0.95 }) });
  assert.ok(low.score > high.score);
});

test('unreliable (out-of-distribution) ml output is recorded but not used', () => {
  const rule = scoreVoice({ features: FEATURES, quality: 1 });
  const r = scoreVoice({ features: FEATURES, quality: 1, ml: ml({ reliable: false }) });
  assert.equal(r.score, rule.score);
  assert.equal(r.ml.used, false);
  assert.ok(r.flags.includes('voice_model_out_of_distribution'));
  assert.ok(!r.flags.includes('voice_model_elevated'));
  assert.equal(r.indicators.find((i) => i.key === 'voiceModel').status, 'unknown');
});

test('tampered or malformed ml payloads cannot push scores out of range', () => {
  const rule = scoreVoice({ features: FEATURES, quality: 1 });
  for (const bad of [{ pdLikeness: 'x', reliable: true }, { reliable: true }, 'nope', 42]) {
    const r = scoreVoice({ features: FEATURES, quality: 1, ml: bad });
    assert.equal(r.score, rule.score);
    assert.equal(r.ml, null);
  }
  const r = scoreVoice({ features: FEATURES, quality: 1, ml: ml({ pdLikeness: -50 }) });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.equal(r.ml.pdLikeness, 0);
  // `reliable` must be literally true
  assert.equal(scoreVoice({ features: FEATURES, quality: 1, ml: ml({ reliable: 'yes' }) }).ml.used, false);
});

test('fusion labels the engine by what actually ran', () => {
  const plain = analyzeAssessment({ modules: { voice: { features: FEATURES, quality: 1 } } });
  assert.equal(plain.scoringEngine, 'rules-v1');
  const withMl = analyzeAssessment({ modules: { voice: { features: FEATURES, quality: 1, ml: ml() } } });
  assert.equal(withMl.scoringEngine, 'rules+voice-ml-v1');
  const ood = analyzeAssessment({ modules: { voice: { features: FEATURES, quality: 1, ml: ml({ reliable: false }) } } });
  assert.equal(ood.scoringEngine, 'rules+voice-ml-v1'); // model ran; its output was rejected and stored as such
});

test('client WAV encoder writes a valid 16-bit mono PCM file', async () => {
  const sr = 48000;
  const a = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
  const b = new Float32Array([0.25]);
  const buf = Buffer.from(await encodeWav([a, b], sr).arrayBuffer());
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  assert.equal(buf.readUInt16LE(20), 1); // PCM
  assert.equal(buf.readUInt16LE(22), 1); // mono
  assert.equal(buf.readUInt32LE(24), sr);
  assert.equal(buf.readUInt16LE(34), 16);
  assert.equal(buf.readUInt32LE(40), 7 * 2);
  assert.equal(buf.length, 44 + 14);
  const samples = Array.from({ length: 7 }, (_, i) => buf.readInt16LE(44 + i * 2));
  assert.deepEqual(samples, [0, 16383, -16384, 32767, -32768, 32767, 8191]); // 2 is clipped
});
