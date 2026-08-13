import env from '../config/env.js';

export function notFound(req, res, next) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.statusCode || 500;
  let message = err.message || 'Something went wrong';
  let details = err.details;

  // Mongoose duplicate key
  if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = field === 'email' ? 'An account with that email already exists' : `Duplicate ${field}`;
  }

  // Mongoose validation
  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Validation failed';
    details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
  }

  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  }

  if (err.name === 'JsonWebTokenError') {
    status = 401;
    message = 'Invalid token';
  }
  if (err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Session expired, please log in again';
  }

  if (status >= 500) console.error('[error]', err);

  res.status(status).json({
    success: false,
    message,
    ...(details ? { details } : {}),
    ...(env.isProd ? {} : { stack: err.stack }),
  });
}
