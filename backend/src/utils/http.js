export class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = Number(error.status || (error.name === 'ZodError' ? 422 : 500));
  const fields = error.fields || (error.name === 'ZodError' ? Object.fromEntries(error.issues.map((issue) => [issue.path.join('.'), issue.message])) : undefined);
  const message = status >= 500 ? 'حدث خطأ غير متوقع. حاول مرة أخرى.' : error.message;
  if (status >= 500) req.log?.error({ err: error, requestId: req.id }, 'request failed');
  res.status(status).json({ error: { code: error.code || (status === 422 ? 'VALIDATION_ERROR' : 'REQUEST_ERROR'), message, ...(fields ? { fields } : {}) } });
}

export function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'المسار المطلوب غير موجود.' } });
}

export function idParam(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'INVALID_ID', 'المعرّف غير صالح.');
  return id;
}

export function pagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageResult(rows, total, page, pageSize) {
  return { data: rows, pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } };
}
