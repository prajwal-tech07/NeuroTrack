import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageBand, buildSample, CONSENT_VERSION, participantId } from '../src/services/research.js';

const user = {
  _id: '65f0c0ffee0000000000abcd',
  fullName: 'Jane Doe',
  email: 'jane@example.com',
  age: 63,
  gender: 'female',
  research: { consented: true, consentVersion: CONSENT_VERSION, diagnosis: 'parkinsons' },
};

test('participant id is stable, opaque and not the user id', () => {
  const a = participantId(user._id);
  assert.equal(a, participantId(user._id));
  assert.notEqual(a, participantId('65f0c0ffee0000000000abce'));
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.ok(!a.includes(user._id));
});

test('age is reduced to a 5-year band', () => {
  assert.equal(ageBand(63), '60-64');
  assert.equal(ageBand(65), '65-69');
  assert.equal(ageBand(undefined), null);
});

test('sample keeps numeric features only and no identity', () => {
  const modules = {
    voice: {
      features: { jitterPercent: 0.6, hnrDb: 21, note: 'my name is Jane', nested: { a: 1, b: 'x' }, list: [1, 2] },
      quality: 0.9,
      ml: { pdLikeness: 0.3 },
    },
    hand: { features: { tapFrequencyHz: 4.2, insufficientData: false }, quality: 1 },
  };
  const analysis = {
    engineVersion: '1.0.0',
    modules: { voice: { ml: { pdLikeness: 0.3, reliable: true, distributionDistance: 1.2, engine: 'e', features: { x: 1 } } } },
  };
  const s = buildSample(user, modules, analysis);
  const text = JSON.stringify(s);
  for (const secret of ['Jane', 'jane@example.com', user._id, '63']) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(s.modules.voice.features, { jitterPercent: 0.6, hnrDb: 21, nested: { a: 1 } });
  assert.equal(s.modules.hand.features.insufficientData, false);
  assert.equal(s.diagnosis, 'parkinsons');
  assert.equal(s.ageBand, '60-64');
  assert.equal(s.consentVersion, CONSENT_VERSION);
  assert.deepEqual(s.voiceModel, { pdLikeness: 0.3, reliable: true, distributionDistance: 1.2, engine: 'e' });
  assert.match(s.day, /^\d{4}-\d{2}-\d{2}$/);
});
