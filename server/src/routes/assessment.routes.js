import { Router } from 'express';
import * as assessment from '../controllers/assessment.controller.js';
import { downloadAssessmentPDF } from '../controllers/report.controller.js';
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

export default router;
