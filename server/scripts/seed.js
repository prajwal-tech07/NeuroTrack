/**
 * Seeds a demo account with ~6 months of assessment history.
 *
 * The synthetic feature vectors are pushed through the *real* scoring engine,
 * so seeded history is internally consistent with anything you record live.
 *
 *   npm run seed            # wipes and reseeds the demo account
 *   npm run seed -- --keep  # leaves existing data in place
 */
import mongoose from 'mongoose';
import env from '../src/config/env.js';
import User from '../src/models/User.js';
import Assessment from '../src/models/Assessment.js';
import Report from '../src/models/Report.js';
import { analyzeAssessment } from '../src/services/scoring/fusion.js';
import { buildRecommendations } from '../src/services/recommendations.js';
import { regenerateAllReports } from '../src/services/reports.js';

const DEMO = {
  fullName: 'Vinayashree Karoshi',
  email: 'demo@neurotrackai.com',
  password: 'Demo1234',
  age: 22,
  gender: 'female',
  dateOfBirth: new Date('2005-01-11'),
  phone: '+91 98765 43210',
};

const rand = (min, max) => min + Math.random() * (max - min);
const jitter = (v, pct) => v * (1 + rand(-pct, pct));

/**
 * Generates a feature vector at a given wellness level.
 * @param {number} h 0 (poor) .. 1 (excellent)
 */
function features(h) {
  const inv = 1 - h;

  return {
    voice: {
      quality: rand(0.75, 0.98),
      durationSec: rand(18, 26),
      features: {
        jitterPercent: jitter(0.45 + inv * 2.4, 0.15),
        shimmerPercent: jitter(2.1 + inv * 7.0, 0.15),
        hnrDb: jitter(24 - inv * 15, 0.1),
        f0Mean: jitter(190, 0.08),
        f0StdSemitones: jitter(3.2 - inv * 2.4, 0.15),
        voicedRatio: rand(0.55, 0.85),
        pauseRatio: jitter(0.15 + inv * 0.3, 0.2),
        speechRateSyll: jitter(4.8 - inv * 1.8, 0.12),
        maxPhonationSec: jitter(16 - inv * 10, 0.15),
        intensityCv: jitter(0.16 + inv * 0.3, 0.2),
        snrDb: rand(14, 26),
      },
    },
    face: (() => {
      const expr = jitter(0.16 - inv * 0.12, 0.15);
      const smile = jitter(0.26 - inv * 0.19, 0.15);
      const brow = jitter(0.15 - inv * 0.11, 0.15);
      const shut = jitter(0.013, 0.3);
      // The demo user is symmetric: both sides move together, which is what
      // produces a bilateral (non-hemiparetic) reading.
      const side = (base) => base * rand(0.93, 1.07);
      return {
        quality: rand(0.75, 0.97),
        durationSec: rand(20, 26),
        features: {
          blinkRate: jitter(18 - inv * 9, 0.2),
          expressivityIndex: expr,
          smileAmplitude: smile,
          browRaiseAmplitude: brow,
          asymmetryIndex: jitter(0.03 + inv * 0.05, 0.2),
          mouthOpenRange: jitter(0.18 - inv * 0.13, 0.15),
          eyeOpenAsymmetry: jitter(0.03 + inv * 0.04, 0.2),
          trackedRatio: rand(0.82, 0.99),
          brightness: rand(0.42, 0.6),
          left: { expressivity: side(expr), smile: side(smile), brow: side(brow), eyeShutResidual: side(shut) },
          right: { expressivity: side(expr), smile: side(smile), brow: side(brow), eyeShutResidual: side(shut) },
          eyeClosureGap: Math.abs(side(shut) - side(shut)),
          eyeClosureTested: true,
        },
      };
    })(),
    hand: (() => {
      const tap = jitter(5.2 - inv * 3.4, 0.12);
      const amp = jitter(0.4 - inv * 0.28, 0.15);
      const decay = jitter(0.07 + inv * 0.4, 0.2);
      // Rest tremor becomes progressively less likely as wellness improves,
      // rather than switching on at a hard threshold.
      const tremorHz = Math.random() < Math.max(0, (0.72 - h) / 0.45)
        ? rand(4.0, 6.2)   // rest-tremor band
        : rand(8, 11.5);   // physiological tremor
      const tremorPower = jitter(0.06 + inv * 0.38, 0.2);
      // Both hands perform similarly - a bilateral, not one-sided, profile.
      const side = () => ({
        tapFrequencyHz: tap * rand(0.94, 1.06),
        tapAmplitudeMean: amp * rand(0.94, 1.06),
        tapAmplitudeDecay: decay * rand(0.9, 1.1),
        tapIntervalCv: jitter(0.12 + inv * 0.38, 0.18),
        tapHesitations: Math.round(rand(0, 1) + inv * rand(0, 5)),
        tremorPeakHz: tremorHz,
        tremorPowerRatio: tremorPower * rand(0.9, 1.1),
        holdDriftPx: jitter(0.012 + inv * 0.09, 0.2),
        holdDropY: rand(-0.01, 0.01),
      });
      const left = side();
      const right = side();
      return {
        quality: rand(0.72, 0.96),
        durationSec: rand(34, 40),
        features: {
          tapFrequencyHz: Math.min(left.tapFrequencyHz, right.tapFrequencyHz),
          tapAmplitudeMean: amp,
          tapAmplitudeDecay: decay,
          tapIntervalCv: jitter(0.12 + inv * 0.38, 0.18),
          tapHesitations: Math.round(rand(0, 1) + inv * rand(0, 5)),
          tremorPeakHz: tremorHz,
          tremorPowerRatio: tremorPower,
          holdDriftPx: jitter(0.012 + inv * 0.09, 0.2),
          trackedRatio: rand(0.8, 0.99),
          sampleCount: Math.round(rand(560, 840)),
          left,
          right,
          bothSidesTested: true,
        },
      };
    })(),
    gait: {
      quality: rand(0.7, 0.95),
      durationSec: rand(20, 26),
      features: {
        cadenceStepsMin: jitter(112 - inv * 34, 0.08),
        stepTimeCv: jitter(0.03 + inv * 0.11, 0.2),
        stepSymmetry: jitter(0.03 + inv * 0.16, 0.2),
        armSwingAmplitude: jitter(0.17 - inv * 0.13, 0.15),
        armSwingAsymmetry: jitter(0.1 + inv * 0.42, 0.2),
        trunkSwayIndex: jitter(0.02 + inv * 0.1, 0.2),
        posturalLeanDeg: jitter(5 + inv * 18, 0.2),
        doubleSupportRatio: jitter(0.23 + inv * 0.18, 0.12),
        trackedRatio: rand(0.78, 0.98),
        stepCount: Math.round(rand(16, 30)),
        left: {
          stepCount: Math.round(rand(8, 15)),
          stepInterval: jitter(1.05, 0.06),
          armSwing: jitter(0.17 - inv * 0.13, 0.12),
        },
        right: {
          stepCount: Math.round(rand(8, 15)),
          stepInterval: jitter(1.05, 0.06),
          armSwing: jitter(0.17 - inv * 0.13, 0.12),
        },
        bothLegsDetected: true,
      },
    },
  };
}

async function seed() {
  const keep = process.argv.includes('--keep');

  await mongoose.connect(env.mongoUri);
  console.log(`[seed] connected to ${mongoose.connection.name}`);

  let user = await User.findOne({ email: DEMO.email });

  if (user && !keep) {
    await Promise.all([
      Assessment.deleteMany({ user: user._id }),
      Report.deleteMany({ user: user._id }),
    ]);
    console.log('[seed] cleared existing demo history');
  }

  if (!user) {
    user = await User.create(DEMO);
    console.log(`[seed] created demo user ${DEMO.email}`);
  }

  // 26 weekly assessments ending today, trending gently upward with noise —
  // the shape a real user who starts paying attention to their health produces.
  const WEEKS = 26;
  const now = new Date();
  let previousScore = null;
  let created = 0;

  for (let i = WEEKS - 1; i >= 0; i--) {
    const progress = (WEEKS - 1 - i) / (WEEKS - 1); // 0 -> 1 over time
    // Tuned so the series starts in the mild/moderate band and climbs into the
    // low-risk band, which is the shape the dashboard mockup shows.
    const health = Math.max(0.15, Math.min(0.95, 0.34 + progress * 0.46 + rand(-0.05, 0.05)));

    const completedAt = new Date(now.getTime() - i * 7 * 86400000);
    completedAt.setHours(9 + Math.floor(rand(0, 8)), Math.floor(rand(0, 59)), 0, 0);

    const analysis = analyzeAssessment({ modules: features(health), age: DEMO.age });
    const delta = previousScore === null ? null : analysis.overallScore - previousScore;
    previousScore = analysis.overallScore;

    await Assessment.create({
      user: user._id,
      voice: analysis.modules.voice,
      face: analysis.modules.face,
      hand: analysis.modules.hand,
      gait: analysis.modules.gait,
      pattern: analysis.pattern,
      laterality: analysis.laterality,
      overallScore: analysis.overallScore,
      riskLevel: analysis.riskLevel,
      riskLabel: analysis.riskLabel,
      delta,
      recommendations: buildRecommendations({ ...analysis, delta }),
      flags: analysis.flags,
      engineVersion: analysis.engineVersion,
      completedAt,
    });
    created++;
  }

  user.lastAssessmentAt = now;
  user.nextAssessmentAt = new Date(now.getTime() + env.assessmentIntervalDays * 86400000);
  await user.save({ validateBeforeSave: false });

  const months = await regenerateAllReports(user._id);

  console.log(`[seed] created ${created} assessments across ${months} monthly reports`);
  console.log('');
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log('  │  Demo login                                 │');
  console.log('  │  email:    demo@neurotrackai.com            │');
  console.log('  │  password: Demo1234                         │');
  console.log('  └─────────────────────────────────────────────┘');
  console.log('');

  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error('[seed] failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
