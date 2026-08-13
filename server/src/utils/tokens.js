import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

export const signAccessToken = (userId) =>
  jwt.sign({ sub: userId, type: 'access' }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });

/**
 * `jti` is essential, not decorative: JWT `iat` only has second resolution, so
 * without a unique claim two refresh tokens minted for the same user in the same
 * second are byte-identical. Rotation would then be a no-op and a spent token
 * would stay valid.
 */
export const signRefreshToken = (userId) =>
  jwt.sign({ sub: userId, type: 'refresh', jti: crypto.randomUUID() }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });

export const verifyAccessToken = (token) => jwt.verify(token, env.jwtSecret);
export const verifyRefreshToken = (token) => jwt.verify(token, env.jwtRefreshSecret);

/**
 * httpOnly cookie options for the refresh token.
 *
 * With `remember` the cookie persists for 30 days; without it the cookie has no
 * maxAge, so the browser drops it when the session ends. That is what makes the
 * "Remember me" checkbox actually mean something.
 */
export const refreshCookieOptions = (remember = true) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.isProd,
  path: '/api/auth',
  ...(remember ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}),
});

export const REFRESH_COOKIE = 'ntai_rt';
