export class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg = 'Bad request', details) {
    return new ApiError(400, msg, details);
  }
  static unauthorized(msg = 'Not authenticated') {
    return new ApiError(401, msg);
  }
  static forbidden(msg = 'Not allowed') {
    return new ApiError(403, msg);
  }
  static notFound(msg = 'Not found') {
    return new ApiError(404, msg);
  }
  static conflict(msg = 'Already exists') {
    return new ApiError(409, msg);
  }
}

/** Wraps an async route handler so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default ApiError;
