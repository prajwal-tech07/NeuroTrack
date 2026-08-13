import { Router } from 'express';
import * as user from '../controllers/user.controller.js';
import { protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  changePasswordSchema,
  settingsSchema,
  updateProfileSchema,
} from '../validators/schemas.js';

const router = Router();
router.use(protect);

router.get('/profile', user.getProfile);
router.patch('/profile', validate(updateProfileSchema), user.updateProfile);
router.post('/change-password', validate(changePasswordSchema), user.changePassword);

router.get('/settings', user.getSettings);
router.patch('/settings', validate(settingsSchema), user.updateSettings);

router.get('/export', user.exportData);
router.delete('/account', user.deleteAccount);

export default router;
