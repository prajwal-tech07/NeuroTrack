import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const settingsSchema = new mongoose.Schema(
  {
    darkMode: { type: Boolean, default: false },
    emailNotifications: { type: Boolean, default: true },
    weeklyReminder: { type: Boolean, default: true },
    language: { type: String, enum: ['en', 'hi', 'kn', 'mr', 'ta', 'te'], default: 'en' },
    dateFormat: { type: String, enum: ['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd'], default: 'dd/mm/yyyy' },
    timeFormat: { type: String, enum: ['12h', '24h'], default: '12h' },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: { type: String, required: true, minlength: 8, select: false },
    age: { type: Number, min: 1, max: 120 },
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer_not_to_say'] },
    dateOfBirth: { type: Date },
    phone: { type: String, trim: true, maxlength: 20 },

    settings: { type: settingsSchema, default: () => ({}) },

    /** Opt-in donation of assessment features for model validation (services/research.js). */
    research: {
      consented: { type: Boolean, default: false },
      consentVersion: { type: String, default: null },
      consentedAt: { type: Date, default: null },
      diagnosis: {
        type: String,
        enum: ['none', 'parkinsons', 'stroke', 'other', 'prefer_not_to_say'],
        default: 'prefer_not_to_say',
      },
    },

    // Assessment scheduling
    lastAssessmentAt: { type: Date, default: null },
    nextAssessmentAt: { type: Date, default: null },

    // Security
    refreshTokens: { type: [String], default: [], select: false },
    passwordChangedAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.virtual('initials').get(function () {
  return (this.fullName || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

/** Strips sensitive fields for API responses. */
userSchema.methods.toPublic = function () {
  return {
    id: this._id.toString(),
    fullName: this.fullName,
    email: this.email,
    age: this.age ?? null,
    gender: this.gender ?? null,
    dateOfBirth: this.dateOfBirth ?? null,
    phone: this.phone ?? null,
    initials: this.initials,
    settings: this.settings,
    research: {
      consented: Boolean(this.research?.consented),
      consentVersion: this.research?.consentVersion ?? null,
      consentedAt: this.research?.consentedAt ?? null,
      diagnosis: this.research?.diagnosis ?? 'prefer_not_to_say',
    },
    lastAssessmentAt: this.lastAssessmentAt,
    nextAssessmentAt: this.nextAssessmentAt,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
export default User;
