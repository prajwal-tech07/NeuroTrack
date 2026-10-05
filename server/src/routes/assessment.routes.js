import { Router } from 'express';
import * as assessment from '../controllers/assessment.controller.js';
import { downloadAssessmentPDF } from '../controllers/report.controller.js';
import { analyzeFacePhoto, uploadMiddleware } from '../controllers/facePhoto.controller.js';
import { analyzeVoiceAudio, audioUploadMiddleware } from '../controllers/voiceAudio.controller.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { submitAssessmentSchema } from '../validators/schemas.js';

const router = Router();
router.use(protect);

router.post('/', validate(submitAssessmentSchema), assessment.submitAssessment);
router.get('/', assessment.listAssessments);
router.get('/latest', assessment.getLatestAssessment);
router.get('/:id', assessment.getAssessment);
router.get('/:id/pdf', downloadAssessmentPDF);
router.delete('/:id', assessment.deleteAssessment);

// Face photo upload — multipart, handled by multer middleware before the controller
router.post('/face-photo', uploadMiddleware, analyzeFacePhoto);

// Sustained-vowel WAV -> trained voice model. Audio is held in memory only.
router.post('/voice-audio', audioUploadMiddleware, analyzeVoiceAudio);

export default router;

