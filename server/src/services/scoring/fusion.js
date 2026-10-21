import { clamp, ENGINE_VERSION, isNum } from './common.js';
import scoreVoice from './voice.js';
import scoreFace from './face.js';
import scoreHand from './hand.js';
import scoreGait from './gait.js';
import analyzeLaterality from './laterality.js';
import classifyPattern from './pattern.js';

export const MODULE_KEYS = ['voice', 'face', 'hand', 'gait'];

/**
 * Tests the assessment flow currently offers. The coverage cap counts only
 * these: gait was removed from the flow, and counting it capped every
 * complete assessment at 84.
 */
export const OFFERED_MODULES = ['voice', 'face', 'hand'];

export const MODULE_LABELS = {
  voice: 'Voice Analysis',
  face: 'Facial Analysis',
  hand: 'Hand Movement',
  gait: 'Gait Analysis',
};

/** Highest overall score allowed alongside a confident / tentative pattern finding. */
const PATTERN_CAP_CONFIDENT = 64;
const PATTERN_CAP_TENTATIVE = 79;

/** Base fusion weights — renormalised over whichever modules were completed. */
const BASE_WEIGHTS = { voice: 0.27, face: 0.23, hand: 0.27, gait: 0.23 };

export const RISK_BANDS = [
  { level: 'low', label: 'Low Risk', min: 80, tone: 'Healthy' },
  { level: 'mild', label: 'Mild Risk', min: 65, tone: 'Monitor' },
  { level: 'moderate', label: 'Moderate Risk', min: 50, tone: 'Needs attention' },
  { level: 'high', label: 'High Risk', min: 0, tone: 'Consult a clinician' },
];

export function riskFromScore(score) {
  const band = RISK_BANDS.find((b) => score >= b.min) || RISK_BANDS[RISK_BANDS.length - 1];
  return { level: band.level, label: band.label, tone: band.tone };
}

/**
 * Runs each module's scorer, then fuses the results.
 *
 * Fusion is a quality-weighted mean of the completed modules, with a "weakest
 * link" correction: a single badly-scoring modality should not be washed out by
 * three good ones, because early signs typically appear in one domain first.
 */
export function analyzeAssessment({ modules = {}, age } = {}) {
  const scorers = { voice: scoreVoice, face: scoreFace, hand: scoreHand, gait: scoreGait };

  const results = {};
  const flags = [];

  for (const key of MODULE_KEYS) {
    const input = modules[key];
    if (!input) {
      results[key] = null;
      continue;
    }
    const result = scorers[key]({ ...input, age });
    results[key] = result;
    if (Array.isArray(result.flags)) flags.push(...result.flags);
  }

  const completed = MODULE_KEYS.filter((k) => results[k]?.completed);
  if (completed.length === 0) {
    throw new Error('At least one module must produce a usable result');
  }

  let weightSum = 0;
  let weighted = 0;
  for (const key of completed) {
    const w = BASE_WEIGHTS[key] * (0.6 + 0.4 * (results[key].quality ?? 1));
    weighted += results[key].score * w;
    weightSum += w;
  }
  const mean = weighted / weightSum;

  // Weakest-link correction: pull the mean toward the lowest module score.
  const lowest = Math.min(...completed.map((k) => results[k].score));
  const spread = mean - lowest;
  const penalty = spread > 12 ? Math.min(8, (spread - 12) * 0.35) : 0;

  // Incomplete assessments are reported but capped, since fewer signals means
  // less confidence in a high score.
  const missing = OFFERED_MODULES.filter((k) => !completed.includes(k)).length;
  const coverageCap = missing === 0 ? 100 : 88 - missing * 4;

  const uncapped = clamp(mean - penalty);

  // Which pattern the impairment resembles is decided separately from how
  // severe it is: the module scores answer "how much", the classifier "what kind".
  const laterality = analyzeLaterality(modules);
  // The pattern classifier judges impairment on the measured score, not the
  // coverage-capped one (a cap is about confidence, not about being impaired).
  const pattern = classifyPattern({ modules: results, raw: modules, laterality, overallScore: uncapped });

  // A recognised pattern must not sit under a "Low Risk" label: a confident
  // Parkinsonian or one-sided-weakness finding caps the score in the moderate
  // band, a tentative one in the mild band.
  const patternCap = pattern.type === 'parkinsonian' || pattern.type === 'hemiparetic'
    ? (pattern.tentative ? PATTERN_CAP_TENTATIVE : PATTERN_CAP_CONFIDENT)
    : 100;

  const overallScore = Math.round(Math.min(uncapped, coverageCap, patternCap));
  const risk = riskFromScore(overallScore);

  return {
    modules: results,
    laterality,
    pattern,
    overallScore,
    riskLevel: risk.level,
    riskLabel: risk.label,
    riskTone: risk.tone,
    completedModules: completed,
    flags: [...new Set(flags)],
    scoringEngine: results.voice?.ml ? 'rules+voice-ml-v1' : 'rules-v1',
    engineVersion: ENGINE_VERSION,
  };
}

/** Mean of a numeric array, or null when empty. */
export const mean = (arr) => {
  const nums = arr.filter(isNum);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

export default analyzeAssessment;
