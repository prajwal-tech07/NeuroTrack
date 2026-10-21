/**
 * A typical healthy adult's assessment payload, built from real-data reference
 * values: face metrics measured with MediaPipe on healthy photos, voice metrics
 * from the browser extractor on real healthy readers (KCL) and Praat measures of
 * healthy controls, hand from a simulated symmetric 4.5 Hz tapper.
 */
import { HandTracker } from '../../client/src/lib/handFeatures.js';
import { simulateHand } from './handSim.js';

export function healthyHand(opts = {}) {
  const tr = new HandTracker();
  simulateHand((st, res, ts) => { tr.setSide(st.side); tr.setPhase(st.phase); tr.push(res, ts); }, opts);
  return { features: tr.finish(), quality: tr.quality() };
}

export const healthyFace = () => ({
  features: {
    durationSec: 20, blinkRate: 17, blinkCount: 3, expressivityIndex: 0.13, smileAmplitude: 0.78,
    browRaiseAmplitude: 0.45, asymmetryIndex: 0.3, mouthOpenRange: 0.25, eyeOpenAsymmetry: 0.04,
    eyeApertureCv: 0.2, trackedRatio: 0.97, brightness: 0.5, frameCount: 520,
    left: { expressivity: 0.12, smile: 0.8, brow: 0.46, eyeShutResidual: 0.03 },
    right: { expressivity: 0.115, smile: 0.75, brow: 0.42, eyeShutResidual: 0.035 },
    eyeClosureGap: 0.005, eyeClosureTested: true,
  },
  quality: 0.95,
});

export const healthyVoice = ({ withModel = true } = {}) => ({
  features: {
    durationSec: 20, jitterPercent: 4, shimmerPercent: 0.6, hnrDb: 7.2, f0Mean: 150, f0StdSemitones: 3.6,
    voicedRatio: 0.5, pauseRatio: 0.28, speechRateSyll: 2.8, maxPhonationSec: 7.4, intensityCv: 0.5,
    snrDb: 30, frameCount: 999, perturbationSource: 'browser-frame-level',
  },
  quality: 1,
  ...(withModel && {
    ml: {
      pdLikeness: 0.3, threshold: 0.505, elevated: false, reliable: true, distributionDistance: 1.0,
      engine: 'voice-pd-xgboost-sakar2018-v1',
      features: { locPctJitter: 0.004, locShimmer: 0.055, meanHarmToNoiseHarmonicity: 19 },
      validation: { auc: 0.82, balancedAccuracy: 0.74, sensitivity: 0.74, specificity: 0.73, trainingSubjects: 252 },
    },
  }),
});

/** Parkinsonian profile: bilateral slowing, 5 Hz rest tremor, masked face, PD-like voice. */
export const parkinsonianProfile = ({ fps = 30, seed = 1 } = {}) => {
  const face = healthyFace();
  Object.assign(face.features, {
    blinkRate: 6, expressivityIndex: 0.04, smileAmplitude: 0.25, browRaiseAmplitude: 0.12, mouthOpenRange: 0.08,
    left: { expressivity: 0.04, smile: 0.26, brow: 0.12, eyeShutResidual: 0.03 },
    right: { expressivity: 0.038, smile: 0.24, brow: 0.11, eyeShutResidual: 0.03 },
  });
  const voice = healthyVoice();
  Object.assign(voice.features, { f0StdSemitones: 1.1, pauseRatio: 0.5, speechRateSyll: 1.6, maxPhonationSec: 3.5 });
  Object.assign(voice.ml, { pdLikeness: 0.82, elevated: true,
    features: { locPctJitter: 0.014, locShimmer: 0.13, meanHarmToNoiseHarmonicity: 12 } });
  const hand = healthyHand({ fps, seed, tremorHz: 5, tremorAmp: 0.012,
    tapHz: { left: 2.6, right: 2.8 }, tapOpen: { left: 0.45, right: 0.5 } });
  return { voice, face, hand };
};

/** Right-sided weakness (stroke / palsy): right face droop, right hand weak, voice normal. */
export const rightWeaknessProfile = ({ fps = 30, seed = 1 } = {}) => {
  const face = healthyFace();
  Object.assign(face.features, {
    asymmetryIndex: 0.68, smileAmplitude: 0.8, eyeOpenAsymmetry: 0.2, eyeClosureGap: 0.07,
    left: { expressivity: 0.13, smile: 0.8, brow: 0.45, eyeShutResidual: 0.03 },
    right: { expressivity: 0.05, smile: 0.22, brow: 0.12, eyeShutResidual: 0.1 },
  });
  const hand = healthyHand({ fps, seed, tapHz: { left: 4.5, right: 1.8 }, tapOpen: { left: 0.9, right: 0.35 } });
  return { voice: healthyVoice(), face, hand };
};
