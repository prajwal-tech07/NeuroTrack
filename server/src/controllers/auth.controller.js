import User from '../models/User.js';
import env from '../config/env.js';
import ApiError, { asyncHandler } from '../utils/ApiError.js';
import {
  REFRESH_COOKIE,
  refreshCookieOptions,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../utils/tokens.js';

const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

async function issueSession(user, res, remember = true) {
  const accessToken = signAccessToken(user._id.toString());
  const refreshToken = signRefreshToken(user._id.toString());

  // Keep the 5 most recent sessions per account.
  await User.findByIdAndUpdate(user._id, {
    $push: { refreshTokens: { $each: [refreshToken], $slice: -5 } },
  });

  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(remember));
  return accessToken;
}

export const register = asyncHandler(async (req, res) => {
  const { fullName, email, password, age, gender } = req.body;

  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with that email already exists');
  }

  const user = await User.create({
    fullName,
    email,
    password,
    age,
    gender,
    nextAssessmentAt: addDays(new Date(), 0), // first assessment available immediately
  });

  const accessToken = await issueSession(user, res);

  res.status(201).json({
    success: true,
    message: 'Account created',
    data: { user: user.toPublic(), accessToken },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password, remember = true } = req.body;

  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Email or password is incorrect');
  }

  const accessToken = await issueSession(user, res, remember);

  res.json({
    success: true,
    message: 'Signed in',
    data: { user: user.toPublic(), accessToken },
  });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw ApiError.unauthorized('No active session');

  const payload = verifyRefreshToken(token);
  const user = await User.findById(payload.sub).select('+refreshTokens');
  if (!user || !user.refreshTokens.includes(token)) {
    throw ApiError.unauthorized('Session is no longer valid');
  }

  // Rotate: the used token is spent, so drop it and issue a fresh one. Keeping
  // only the 5 newest bounds the array on long-lived accounts.
  const newRefresh = signRefreshToken(user._id.toString());
  user.refreshTokens = [...user.refreshTokens.filter((t) => t !== token), newRefresh].slice(-5);
  await user.save({ validateBeforeSave: false });

  res.cookie(REFRESH_COOKIE, newRefresh, refreshCookieOptions());
  res.json({
    success: true,
    data: { user: user.toPublic(), accessToken: signAccessToken(user._id.toString()) },
  });
});

export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await User.findByIdAndUpdate(payload.sub, { $pull: { refreshTokens: token } });
    } catch {
      /* token already invalid — clearing the cookie is enough */
    }
  }
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(false) });
  res.json({ success: true, message: 'Signed out' });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: req.user.toPublic() } });
});

/**
 * Password reset without an email provider configured would be a dead end, so
 * this endpoint always reports success and only sends mail when SMTP is set up.
 */
export const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const user = await User.findOne({ email });

  if (user && env.smtp.host) {
    const { sendPasswordResetEmail } = await import('../services/mailer.js');
    const resetToken = signAccessToken(user._id.toString());
    await sendPasswordResetEmail(user, `${env.clientUrl}/reset-password?token=${resetToken}`);
  }

  res.json({
    success: true,
    message: 'If an account exists for that email, a reset link has been sent.',
    ...(env.smtp.host ? {} : { note: 'Email delivery is not configured on this server.' }),
  });
});
