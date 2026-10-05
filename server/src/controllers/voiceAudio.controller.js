/**
 * voiceAudio.controller.js
 *
 * POST /api/assessments/voice-audio
 *
 * Receives the sustained-vowel WAV recorded in the Voice test, forwards it to
 * the ML sidecar (ML_SERVICE_URL/score/voice/audio) together with the user's
 * sex from their profile, and returns the model output. The client attaches
 * that output to the voice module as `ml` when the assessment is submitted.
 *
 * The audio stays in memory: it is never written to disk or stored.
 */

import multer from 'multer';
import ApiError, { asyncHandler } from '../utils/ApiError.js';
import env from '../config/env.js';

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']);

export const audioUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES },
  fileFilter: (_req, file, cb) =>
    ALLOWED_MIME_TYPES.has(file.mimetype)
      ? cb(null, true)
      : cb(ApiError.badRequest(`Unsupported audio type '${file.mimetype}'. Send a WAV file.`)),
}).single('audio');

export const analyzeVoiceAudio = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw ApiError.badRequest('No audio was provided. Attach a WAV file with the field name "audio".');
  }

  const form = new FormData();
  form.append('audio', new Blob([req.file.buffer], { type: 'audio/wav' }), 'vowel.wav');
  if (req.user.gender === 'male' || req.user.gender === 'female') form.append('sex', req.user.gender);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetch(`${env.mlServiceUrl}/score/voice/audio`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError(503, 'The voice model timed out. Please try again.');
    throw new ApiError(503, 'The voice model service is currently unavailable.');
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : `ML service returned status ${response.status}`;
    // 400 = the recording itself was unusable (too short, silent, unvoiced).
    if (response.status === 400) throw ApiError.badRequest(detail);
    throw new ApiError(response.status === 503 ? 503 : 502, `Voice model error: ${detail}`);
  }

  res.json({ success: true, data: body });
});
