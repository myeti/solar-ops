/**
 * HTTP-aware errors. Throw them from routes and services: the error handler
 * middleware turns them into JSON responses with the proper status code.
 */

export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message human readable message, safe to show in the UI
   * @param {object} [details] optional extra data (e.g. field errors)
   */
  constructor(status, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message, details) {
  return new HttpError(400, message, details);
}

export function unauthorized(message = 'Authentication required.') {
  return new HttpError(401, message);
}

export function forbidden(message = 'You are not allowed to do this.') {
  return new HttpError(403, message);
}

export function notFound(message = 'Not found.') {
  return new HttpError(404, message);
}

export function conflict(message, details) {
  return new HttpError(409, message, details);
}
