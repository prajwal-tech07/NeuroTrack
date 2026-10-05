import mongoose from 'mongoose';

/**
 * One assessment donated for model validation by a user who opted in.
 *
 * Pseudonymous by construction: no user id, name, email or exact age. The
 * participant id is an HMAC of the user id (services/research.js), which lets
 * us group a person's samples for subject-level evaluation and delete them on
 * withdrawal, without storing who they are. Only numeric features are kept --
 * never video or audio.
 */
const researchSampleSchema = new mongoose.Schema(
  {
    participantId: { type: String, required: true, index: true },
    consentVersion: { type: String, required: true },
    /** Self-reported at donation time; the label models are evaluated against. */
    diagnosis: {
      type: String,
      enum: ['none', 'parkinsons', 'stroke', 'other', 'prefer_not_to_say'],
      required: true,
    },
    ageBand: { type: String, default: null }, // e.g. "60-64"
    gender: { type: String, default: null },
    /** Per module: { features, quality } exactly as measured in the browser. */
    modules: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Voice-model output, so its browser-microphone accuracy can be measured. */
    voiceModel: { type: mongoose.Schema.Types.Mixed, default: null },
    engineVersion: { type: String },
    day: { type: String, required: true }, // YYYY-MM-DD, no time of day
  },
  { timestamps: false, versionKey: false }
);

export const ResearchSample = mongoose.model('ResearchSample', researchSampleSchema);
export default ResearchSample;
