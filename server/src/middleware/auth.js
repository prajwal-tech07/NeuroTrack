import User from '../models/User.js';
import ApiError, { asyncHandler } from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/tokens.js';

export const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) throw ApiError.unauthorized('Please log in to continue');

  const payload = verifyAccessToken(token);
  if (payload.type !== 'access') throw ApiError.unauthorized('Invalid token');

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('This account no longer exists');

  // Reject tokens issued before the last password change.
  if (user.passwordChangedAt && payload.iat * 1000 < user.passwordChangedAt.getTime()) {
    throw ApiError.unauthorized('Password was changed recently, please log in again');
  }

  req.user = user;
  next();
});

export default protect;
