import { Router } from 'express';
import { getDashboard, getTrends } from '../controllers/dashboard.controller.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/', getDashboard);
router.get('/trends', getTrends);

export default router;
