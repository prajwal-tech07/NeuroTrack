/**
 * Turns a scored assessment into plain-language guidance.
 *
 * Rules are ordered by priority; the highest-priority matches are surfaced
 * first. Nothing here is diagnostic — the advice is exercise, lifestyle and
 * "when to see a clinician" guidance appropriate to a screening tool.
 */

const RULES = [
  // ---- Flag-driven, highest priority ----
  {
    when: (a) => a.flags.includes('hand_rest_tremor_band'),
    priority: 'high',
    category: 'hand',
    title: 'Oscillation detected in the 4-6 Hz range',
    detail:
      'Your hand showed rhythmic movement in the band associated with rest tremor while holding still. ' +
      'A single reading is not conclusive — repeat the test rested, well-hydrated and without caffeine. ' +
      'If it repeats across two or three assessments, bring these results to a neurologist.',
  },
  {
    when: (a) => a.flags.includes('hand_amplitude_decrement'),
    priority: 'high',
    category: 'hand',
    title: 'Finger taps shrank over the trial',
    detail:
      'Your taps became noticeably smaller towards the end of the task. Practise large, deliberate ' +
      'finger and hand movements twice a day — amplitude-focused exercise (LSVT BIG style) is the ' +
      'standard first response to this pattern.',
  },
  {
    when: (a) => a.flags.includes('gait_reduced_arm_swing'),
    priority: 'high',
    category: 'gait',
    title: 'Reduced arm swing while walking',
    detail:
      'Arm swing was smaller than expected for your cadence. Try 20 minutes of brisk walking daily with ' +
      'a conscious, exaggerated arm swing, and re-test next week to see whether it recovers.',
  },
  {
    when: (a) => a.flags.includes('voice_monotone'),
    priority: 'medium',
    category: 'voice',
    title: 'Speech was flatter than typical',
    detail:
      'Pitch variation across the read sentence was low. Reading aloud with exaggerated intonation for ' +
      '10 minutes a day, or singing, directly trains the muscles involved.',
  },
  {
    when: (a) => a.flags.includes('voice_jitter_elevated'),
    priority: 'medium',
    category: 'voice',
    title: 'Vocal stability was reduced',
    detail:
      'Cycle-to-cycle pitch variation was above the typical range. Hydration, vocal rest and avoiding ' +
      'throat-clearing help. Persistent hoarseness lasting more than three weeks should be reviewed by a doctor.',
  },
  {
    when: (a) => a.flags.includes('face_reduced_expressivity'),
    priority: 'medium',
    category: 'face',
    title: 'Facial movement range was limited',
    detail:
      'Expression amplitude was below the typical range. Facial exercises — wide smiles, brow raises and ' +
      'exaggerated vowel shapes held for 5 seconds each — help maintain range of motion.',
  },
  {
    when: (a) => a.flags.includes('face_asymmetry'),
    priority: 'high',
    category: 'face',
    title: 'Left/right facial asymmetry detected',
    detail:
      'Movement differed noticeably between the two sides of your face. Asymmetry that appears suddenly ' +
      'is worth same-day medical review; if it has been present for a long time and is stable, mention ' +
      'it at your next appointment.',
  },
  {
    when: (a) => a.flags.includes('gait_high_variability'),
    priority: 'medium',
    category: 'gait',
    title: 'Step timing was irregular',
    detail:
      'Step-to-step timing varied more than expected. Walking to a metronome or a steady music beat at ' +
      '110 bpm is an effective way to retrain rhythm, and it also reduces fall risk.',
  },
  {
    when: (a) => a.flags.includes('hand_bradykinesia'),
    priority: 'medium',
    category: 'hand',
    title: 'Repetitive hand movement was slowed',
    detail:
      'Tap rate was below the typical range. Rule out simple causes first — cold hands, fatigue, or a ' +
      'cramped camera position — then re-test. Fine-motor drills such as buttoning, coin-flipping and ' +
      'finger-to-thumb sequences help.',
  },

  // ---- Score-driven ----
  {
    when: (a) => a.overallScore < 50,
    priority: 'high',
    category: 'general',
    title: 'Book a clinical review',
    detail:
      'Your combined score is in the high-risk band. This tool is a screening aid, not a diagnosis, but a ' +
      'score in this range across multiple modalities is worth showing to a neurologist. Download the PDF ' +
      'report and take it with you.',
  },
  {
    when: (a) => a.overallScore >= 50 && a.overallScore < 65,
    priority: 'medium',
    category: 'general',
    title: 'Increase your assessment frequency',
    detail:
      'Switch to twice-weekly assessments for the next month. Trend direction matters far more than any ' +
      'single reading, and a denser series makes a real change easier to distinguish from normal variation.',
  },
  {
    when: (a) => a.delta !== null && a.delta <= -8,
    priority: 'high',
    category: 'general',
    title: (a) => `Your score dropped ${Math.abs(Math.round(a.delta))} points since last time`,
    detail:
      'A drop of 8 points or more between assessments is larger than typical week-to-week variation. ' +
      'Check for temporary explanations first — poor sleep, illness, new medication, alcohol — and re-test ' +
      'in 48 hours under normal conditions.',
  },
  {
    when: (a) => a.delta !== null && a.delta >= 5,
    priority: 'low',
    category: 'general',
    title: 'Your score is improving',
    detail:
      'You gained ground since your last assessment. Whatever you changed — sleep, exercise, medication ' +
      'timing — is worth keeping consistent.',
  },
  {
    when: (a) => a.overallScore >= 80,
    priority: 'low',
    category: 'general',
    title: 'Stay on your weekly schedule',
    detail:
      'All modalities are within typical ranges. The value of this tool comes from a long baseline, so keep ' +
      'testing weekly at roughly the same time of day and under the same lighting.',
  },
  {
    when: (a) => a.completedModules.length < 4,
    priority: 'medium',
    category: 'general',
    title: 'Complete all four tests next time',
    detail:
      'Some modules were skipped or did not capture usable data, so this score is based on partial ' +
      'information and is capped accordingly. A full four-module assessment gives a much more reliable number.',
  },

  // ---- Always-on lifestyle guidance ----
  {
    when: () => true,
    priority: 'low',
    category: 'lifestyle',
    title: 'Keep the protective basics in place',
    detail:
      'Regular aerobic exercise, 7-9 hours of sleep, a Mediterranean-style diet and cognitively demanding ' +
      'activity all have evidence behind them for long-term neurological health.',
  },
];

/**
 * @param {object} analysis result from analyzeAssessment(), plus `delta`
 * @param {number} max maximum number of recommendations to return
 */
export function buildRecommendations(analysis, max = 6) {
  const ctx = {
    flags: analysis.flags || [],
    overallScore: analysis.overallScore,
    riskLevel: analysis.riskLevel,
    completedModules: analysis.completedModules || [],
    delta: analysis.delta ?? null,
    modules: analysis.modules || {},
  };

  const matched = RULES.filter((r) => {
    try {
      return r.when(ctx);
    } catch {
      return false;
    }
  });

  const order = { high: 0, medium: 1, low: 2 };
  matched.sort((a, b) => order[a.priority] - order[b.priority]);

  return matched.slice(0, max).map((r) => ({
    title: typeof r.title === 'function' ? r.title(ctx) : r.title,
    detail: r.detail,
    category: r.category,
    priority: r.priority,
  }));
}

export default buildRecommendations;
