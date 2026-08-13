import ApiError from '../utils/ApiError.js';

/** Validates req[source] against a zod schema and replaces it with the parsed value. */
export const validate =
  (schema, source = 'body') =>
  (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!details[key]) details[key] = issue.message;
      }
      return next(ApiError.badRequest('Please check the highlighted fields', details));
    }
    if (source === 'body') req.body = result.data;
    else req.validated = result.data;
    next();
  };

export default validate;
