import User from '../models/User.js';
import Assessment from '../models/Assessment.js';
import Report from '../models/Report.js';
import ApiError, { asyncHandler } from '../utils/ApiError.js';

export const getProfile = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: req.user.toPublic() } });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const updates = req.body;

  if (updates.email && updates.email !== req.user.email) {
    if (await User.exists({ email: updates.email, _id: { $ne: req.user._id } })) {
      throw ApiError.conflict('That email is already in use');
    }
  }

  // Keep age and date of birth consistent: if DOB is given, age follows from it.
  if (updates.dateOfBirth) {
    const dob = new Date(updates.dateOfBirth);
    const diff = Date.now() - dob.getTime();
    updates.age = Math.floor(diff / (365.25 * 86400000));
  }

  Object.assign(req.user, updates);
  await req.user.save();

  res.json({ success: true, message: 'Profile updated', data: { user: req.user.toPublic() } });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) {
    throw ApiError.badRequest('Your current password is incorrect', {
      currentPassword: 'Incorrect password',
    });
  }

  user.password = newPassword;
  user.refreshTokens = []; // sign out every other session
  await user.save();

  res.json({ success: true, message: 'Password updated. Please sign in again on other devices.' });
});

export const getSettings = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { settings: req.user.settings } });
});

export const updateSettings = asyncHandler(async (req, res) => {
  req.user.settings = { ...req.user.settings.toObject(), ...req.body };
  await req.user.save();
  res.json({ success: true, message: 'Settings saved', data: { settings: req.user.settings } });
});

export const deleteAccount = asyncHandler(async (req, res) => {
  await Promise.all([
    Assessment.deleteMany({ user: req.user._id }),
    Report.deleteMany({ user: req.user._id }),
    User.findByIdAndDelete(req.user._id),
  ]);
  res.json({ success: true, message: 'Account and all associated data deleted' });
});

/** Full data export — everything the system holds about the signed-in user. */
export const exportData = asyncHandler(async (req, res) => {
  const [assessments, reports] = await Promise.all([
    Assessment.find({ user: req.user._id }).sort({ completedAt: 1 }).lean(),
    Report.find({ user: req.user._id }).sort({ periodStart: 1 }).lean(),
  ]);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="neurotrackai-export.json"');
  res.send(
    JSON.stringify(
      { exportedAt: new Date(), profile: req.user.toPublic(), assessments, reports },
      null,
      2
    )
  );
});
