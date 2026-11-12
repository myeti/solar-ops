/**
 * Thin wrapper around fetch for the SolarOps JSON API.
 *
 * - Sends the `X-SolarOps-Request` header required by the server's CSRF
 *   protection on every call.
 * - Throws an ApiError carrying the message and per-field errors returned
 *   by the server, so forms can highlight invalid fields.
 * - Emits "unauthorized" when the session expired, so the app can go back
 *   to the login screen.
 */

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details || {};
    this.fields = this.details.fields || {};
  }
}

const listeners = {
  unauthorized: [],
};

/**
 * Subscribe to API events ("unauthorized").
 *
 * @param {string} event
 * @param {Function} callback
 */
export function onApiEvent(event, callback) {
  listeners[event].push(callback);
}

function emit(event, payload) {
  for (const callback of listeners[event]) {
    callback(payload);
  }
}

/**
 * Perform an API request.
 *
 * @param {string} method
 * @param {string} path path below /api, e.g. "/projects"
 * @param {object} [body]
 * @returns {Promise<any>}
 */
export async function request(method, path, body) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'X-SolarOps-Request': '1',
    },
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;

  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new ApiError(0, 'Lost contact with SolarOps. Is the server running?');
  }

  let payload = null;
  const isJson = (response.headers.get('content-type') || '').includes('application/json');

  if (isJson) {
    payload = await response.json();
  }

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;

    if (payload && payload.error) {
      message = payload.error;
    }

    if (response.status === 401 && !path.startsWith('/auth/')) {
      emit('unauthorized');
    }

    throw new ApiError(response.status, message, payload?.details);
  }

  return payload;
}

const api = {
  get(path) {
    return request('GET', path);
  },
  post(path, body = {}) {
    return request('POST', path, body);
  },
  put(path, body = {}) {
    return request('PUT', path, body);
  },
  patch(path, body = {}) {
    return request('PATCH', path, body);
  },
  delete(path, body) {
    return request('DELETE', path, body);
  },
};

export default api;
