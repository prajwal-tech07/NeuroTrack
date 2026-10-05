import crypto from 'node:crypto';
import env from '../config/env.js';
import ResearchSample from '../models/ResearchSample.js';

/** Bump when the consent text in the client changes; samples record the version agreed to. */
export const CONSENT_VERSION = '2026-10-v1';

export const DIAGNOSES = ['none', 'parkinsons', 'stroke', 'other', 'prefer_not_to_say'];

const MODULE_KEYS = ['voice', 'face', 'hand', 'gait'];

/** Stable pseudonym for a user: grouping and withdrawal without storing identity. */
export function participantId(userId) {
  return crypto.createHmac('sha256', env.researchSecret).update(String(userId)).digest('hex').slice(0, 32);
}

export function ageBand(age) {
  if (typeof age !== 'number' || !Number.isFinite(age)) return null;
  const lo = Math.floor(age / 5) * 5;
  return `${lo}-${lo + 4}`;
}

/** Keeps numeric feature values only, so nothing identifying can ride along. */
function numericOnly(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = numericOnly(v);
      if (Object.keys(nested).length) out[k] = nested;
    }
  }
  return out;
}

/** Builds the stored sample; exported for tests. */
export function buildSample(user, modules, analysis) {
  const mods = {};
  for (const key of MODULE_KEYS) {
    const m = modules[key];
    if (!m) continue;
    mods[key] = { features: numericOnly(m.features), quality: typeof m.quality === 'number' ? m.quality : null };
  }
  const ml = analysis?.modules?.voice?.ml;
  return {
    participantId: participantId(user._id),
    consentVersion: user.research.consentVersion,
    diagnosis: user.research.diagnosis || 'prefer_not_to_say',
    ageBand: ageBand(user.age),
    gender: user.gender || null,
    modules: mods,
    voiceModel: ml
      ? { pdLikeness: ml.pdLikeness, reliable: ml.reliable, distributionDistance: ml.distributionDistance, engine: ml.engine }
      : null,
    engineVersion: analysis?.engineVersion,
    day: new Date().toISOString().slice(0, 10),
  };
}

/** Stores a donated sample if the user has opted in. Never throws into the request. */
export async function recordIfConsented(user, modules, analysis) {
  if (!user.research?.consented) return false;
  try {
    await ResearchSample.create(buildSample(user, modules, analysis));
    return true;
  } catch (err) {
    console.error('[research] could not store sample:', err.message);
    return false;
  }
}

export async function deleteParticipantData(userId) {
  const { deletedCount } = await ResearchSample.deleteMany({ participantId: participantId(userId) });
  return deletedCount;
}

export async function countParticipantSamples(userId) {
  return ResearchSample.countDocuments({ participantId: participantId(userId) });
}
