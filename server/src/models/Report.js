import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /** Calendar month the report covers, e.g. "2026-08". */
    period: { type: String, required: true },
    periodLabel: { type: String, required: true }, // "Aug 2026"
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    assessmentCount: { type: Number, default: 0 },
    overallScore: { type: Number, min: 0, max: 100, required: true },
    riskLevel: { type: String, enum: ['low', 'mild', 'moderate', 'high'], required: true },
    riskLabel: { type: String, required: true },

    moduleAverages: {
      voice: { type: Number, default: null },
      face: { type: Number, default: null },
      hand: { type: Number, default: null },
      gait: { type: Number, default: null },
    },

    /** Change vs. the previous month's report, in points. */
    trend: { type: Number, default: null },
    trendLabel: { type: String, default: 'stable' },

    /** Chronological score series used to draw the sparkline in the PDF. */
    series: {
      type: [{ _id: false, date: Date, score: Number }],
      default: [],
    },

    summary: { type: String, default: '' },
    recommendations: {
      type: [{ _id: false, title: String, detail: String, category: String, priority: String }],
      default: [],
    },

    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

reportSchema.index({ user: 1, period: 1 }, { unique: true });
reportSchema.index({ user: 1, periodStart: -1 });

reportSchema.methods.toPublic = function () {
  return {
    id: this._id.toString(),
    period: this.period,
    periodLabel: this.periodLabel,
    assessmentCount: this.assessmentCount,
    overallScore: this.overallScore,
    riskLevel: this.riskLevel,
    riskLabel: this.riskLabel,
    moduleAverages: this.moduleAverages,
    trend: this.trend,
    trendLabel: this.trendLabel,
    series: this.series,
    summary: this.summary,
    recommendations: this.recommendations,
    generatedAt: this.generatedAt,
  };
};

export const Report = mongoose.model('Report', reportSchema);
export default Report;
