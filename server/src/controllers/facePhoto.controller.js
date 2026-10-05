/**
 * facePhoto.controller.js
 *
 * Handles POST /api/assessments/face-photo
 *
 * Receives a multipart image upload, proxies it to the Python ML sidecar
 * at ML_SERVICE_URL/score/face-photo, and returns a structured facial
 * analysis result. Falls back to a descriptive error if the ML service
 * is unavailable.
 *
 * The result is shaped to match what the FaceTest component's onComplete()
 * callback expects so the assessment flow works identically to the live
 * webcam path.
 */

import ApiError, { asyncHandler } from '../utils/ApiError.js';
import env from '../config/env.js';
import multer from 'multer';

// ---------------------------------------------------------------------------
// Multer — in-memory storage, 10 MB limit, JPEG/PNG only
// ---------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, `Unsupported file type '${file.mimetype}'. Please upload a JPEG or PNG image.`));
  }
};

/**
 * Exported multer middleware — used directly in the route definition:
 *   router.post('/face-photo', uploadMiddleware, analyzeFacePhoto)
 *
 * Multer calls next(err) on validation failure so the Express error
 * handler catches it cleanly.
 */
export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter,
}).single('image');

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------
export const analyzeFacePhoto = asyncHandler(async (req, res) => {
  // req.file is populated by the multer middleware that runs before us.
  if (!req.file) {
    throw ApiError.badRequest(
      'No image file was provided. Attach an image with the field name "image".'
    );
  }

  // File-size error from multer arrives via next(err) but let's also guard here.
  if (req.file.size > MAX_FILE_SIZE_BYTES) {
    throw ApiError.badRequest(
      `File is too large (${Math.round(req.file.size / (1024 * 1024))} MB). Maximum allowed is 10 MB.`
    );
  }

  // ---------------------------------------------------------------------------
  // Proxy to Python ML sidecar
  // ---------------------------------------------------------------------------
  const mlUrl = `${env.mlServiceUrl}/score/face-photo`;

  let mlResult;
  try {
    // Node 18+ has globalThis.fetch and FormData / Blob built-in.
    const formData = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    formData.append('image', blob, req.file.originalname || 'upload.jpg');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000); // 30 s for image processing

    const response = await fetch(mlUrl, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const detail = errBody.detail || `ML service returned status ${response.status}`;

      // 400 from the ML service = user-facing error (no face, multi-face, bad image, etc.)
      if (response.status === 400) {
        throw ApiError.badRequest(detail);
      }
      throw new ApiError(502, `ML service error: ${detail}`);
    }

    mlResult = await response.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;

    if (err.name === 'AbortError') {
      throw new ApiError(503, 'The AI analysis service timed out. Please try again in a moment.');
    }

    const isConnErr =
      err.code === 'ECONNREFUSED' ||
      err.code === 'ENOTFOUND' ||
      err.message?.includes('fetch failed');

    if (isConnErr) {
      throw new ApiError(
        503,
        'The AI analysis service is currently unavailable. Please try again in a moment.'
      );
    }

    throw err;
  }

  // ---------------------------------------------------------------------------
  // Shape response to match the assessment payload format expected by FaceTest
  // ---------------------------------------------------------------------------
  const features = mlResult.features || {};
  const quality = mlResult.faceDetected ? 0.85 : 0.0;

  const payload = {
    // Standard assessment module fields (same shape as live recording path)
    features: {
      ...features,
      blinkRate:         features.blinkRate ?? null,
      expressivityIndex: features.expressivityIndex ?? null,
      asymmetryIndex:    features.asymmetryIndex ?? null,
      trackedRatio:      features.trackedRatio ?? 1.0,
      durationSec:       0,
    },
    quality,
    durationSec: 0,

    // Photo-analysis specific fields — surfaced in the FaceTest result card
    photoAnalysis: {
      parkinsonsRiskScore: mlResult.parkinsonsRiskScore ?? null,
      confidence:          mlResult.confidence ?? null,
      prediction:          mlResult.prediction ?? null,
      condition:           mlResult.condition ?? 'unknown',
      conditionLabel:      mlResult.conditionLabel ?? 'Unknown',
      faceDetected:        mlResult.faceDetected ?? false,
      faceCount:           mlResult.faceCount ?? 0,
      finalScore:          mlResult.finalScore ?? null,
      flags:               mlResult.flags ?? [],
      indicators:          mlResult.indicators ?? [],
      engine:              mlResult.engine ?? 'unknown',
    },
  };

  res.json({ success: true, data: payload });
});
