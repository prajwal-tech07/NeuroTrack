import { Router } from 'express';
import * as report from '../controllers/report.controller.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/', report.listReports);
router.post('/generate', report.generateCurrentReport);
router.post('/rebuild', report.rebuildReports);
router.get('/:id', report.getReport);
router.get('/:id/pdf', report.downloadReportPDF);

export default router;
