import mongoose from 'mongoose';

/**
 * One module result: the raw feature vector extracted in the browser plus the
 * score the server's engine derived from it. Keeping the features lets us
 * re-score historical assessments if the engine is tuned later.
 */
const moduleResultSchema = new mongoose.Schema(
  {
    score: { type: Number, min: 0, max: 100, required: true },
    completed: { type: Boolean, default: true },
    features: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Per-indicator breakdown: [{ key, label, value, unit, status, note }] */
    indicators: { type: [mongoose.Schema.Types.Mixed], default: [] },
    /** Data-quality 0..1 — low quality down-weights the module in fusion. */
    quality: { type: Number, min: 0, max: 1, default: 1 },
    durationSec: { type: Number, default: 0 },
  },
  { _id: false }
);

const assessmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    voice: { type: moduleResultSchema, default: null },
    face: { type: moduleResultSchema, default: null },
    hand: { type: moduleResultSchema, default: null },
    gait: { type: moduleResultSchema, default: null },

    overallScore: { type: Number, min: 0, max: 100, required: true },
    riskLevel: {
      type: String,
      enum: ['low', 'mild', 'moderate', 'high'],
      required: true,
    },
    riskLabel: { type: String, required: true },

    /** Change vs. the previous assessment, in points. */
    delta: { type: Number, default: null },

    recommendations: {
      type: [
        {
          _id: false,
          title: String,
          detail: String,
          category: String,
          priority: { type: String, enum: ['high', 'medium', 'low'] },
        },
      ],
      default: [],
    },

    flags: { type: [String], default: [] },
    engineVersion: { type: String, default: '1.0.0' },
    completedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

assessmentSchema.index({ user: 1, completedAt: -1 });

assessmentSchema.methods.toPublic = function () {
  const mod = (m) =>
    m ? { score: m.score, completed: m.completed, indicators: m.indicators, quality: m.quality } : null;

  return {
    id: this._id.toString(),
    voice: mod(this.voice),
    face: mod(this.face),
    hand: mod(this.hand),
    gait: mod(this.gait),
    overallScore: this.overallScore,
    riskLevel: this.riskLevel,
    riskLabel: this.riskLabel,
    delta: this.delta,
    recommendations: this.recommendations,
    flags: this.flags,
    completedAt: this.completedAt,
  };
};

export const Assessment = mongoose.model('Assessment', assessmentSchema);
export default Assessment;
