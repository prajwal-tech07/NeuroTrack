import { z } from 'zod';

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Include at least one letter and one number');

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Please enter your full name').max(100),
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    password,
    confirmPassword: z.string(),
    age: z.coerce.number().int().min(1).max(120).optional(),
    gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional().default(true),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').optional(),
  age: z.coerce.number().int().min(1).max(120).nullable().optional(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).nullable().optional(),
  dateOfBirth: z.coerce.date().nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const settingsSchema = z.object({
  darkMode: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  weeklyReminder: z.boolean().optional(),
  language: z.enum(['en', 'hi', 'kn', 'mr', 'ta', 'te']).optional(),
  dateFormat: z.enum(['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd']).optional(),
  timeFormat: z.enum(['12h', '24h']).optional(),
});

/** A module payload: browser-extracted features + optional self-reported quality. */
const moduleSchema = z
  .object({
    features: z.record(z.any()).default({}),
    quality: z.number().min(0).max(1).optional(),
    durationSec: z.number().min(0).optional(),
  })
  .optional()
  .nullable();

export const submitAssessmentSchema = z
  .object({
    voice: moduleSchema,
    face: moduleSchema,
    hand: moduleSchema,
    gait: moduleSchema,
  })
  .refine((d) => d.voice || d.face || d.hand || d.gait, {
    message: 'Complete at least one test before submitting',
  });
