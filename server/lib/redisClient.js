/**
 * A minimal Redis client (RESP over TCP) for SolarOps's own checks: PING,
 * INFO, DBSIZE, FLUSHALL, CONFIG SET. One connection per call, the password
 * sent with AUTH (never on a command line).
 */
import net from 'node:net';

const TIMEOUT_MS = 3000;

/** A command as RESP: *<count> then $<length> per argument. */
function encode(args) {
  let out = `*${args.length}\r\n`;

  for (const arg of args) {
    const value = String(arg);
    out += `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }

  return out;
}

/**
 * Parse one reply at `offset`; null when the buffer does not hold it whole.
 *
 * @returns {{value: any, end: number}|null}
 */
function parseReply(buffer, offset) {
  const lineEnd = buffer.indexOf('\r\n', offset);

  if (lineEnd === -1) {
    return null;
  }

  const type = String.fromCharCode(buffer[offset]);
  const line = buffer.toString('utf8', offset + 1, lineEnd);
  const next = lineEnd + 2;

  if (type === '+') {
    return { value: line, end: next };
  }

  if (type === '-') {
    return { value: new Error(line), end: next };
  }

  if (type === ':') {
    return { value: Number(line), end: next };
  }

  if (type === '$') {
    const length = Number(line);

    if (length === -1) {
      return { value: null, end: next };
    }

    if (buffer.length < next + length + 2) {
      return null;
    }

    return { value: buffer.toString('utf8', next, next + length), end: next + length + 2 };
  }

  if (type === '*') {
    const count = Number(line);
    const items = [];
    let position = next;

    for (let index = 0; index < count; index += 1) {
      const item = parseReply(buffer, position);

      if (item === null) {
        return null;
      }

      items.push(item.value);
      position = item.end;
    }

    return { value: items, end: position };
  }

  throw new Error(`Unexpected Redis reply: ${line}`);
}

/**
 * Run commands on a local Redis, after AUTH.
 *
 * @param {number} port
 * @param {string} password
 * @param {Array<Array<string|number>>} commands
 * @returns {Promise<any[]>} one reply per command (errors are thrown)
 */
export function redisCommands(port, password, commands) {
  const all = [['AUTH', password], ...commands];

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let buffer = Buffer.alloc(0);
    const replies = [];

    const fail = (error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(TIMEOUT_MS, () => fail(new Error(`Redis did not answer on port ${port}`)));
    socket.on('error', (error) =>
      fail(new Error(`Redis is unreachable on port ${port}: ${error.code || error.message}`)),
    );
    socket.on('connect', () => socket.write(all.map(encode).join('')));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let offset = 0;
      let reply = parseReply(buffer, offset);

      while (reply !== null) {
        replies.push(reply.value);
        offset = reply.end;

        if (replies.length === all.length) {
          socket.end();
          const error = replies.find((value) => value instanceof Error);

          if (error) {
            reject(new Error(`Redis: ${error.message}`));
          } else {
            resolve(replies.slice(1));
          }

          return;
        }

        reply = parseReply(buffer, offset);
      }

      buffer = buffer.subarray(offset);
    });
  });
}

/**
 * The fields of an INFO reply: "key:value" lines.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseInfo(text) {
  const info = {};

  for (const line of String(text || '').split('\r\n')) {
    const index = line.indexOf(':');

    if (index > 0 && !line.startsWith('#')) {
      info[line.slice(0, index)] = line.slice(index + 1);
    }
  }

  return info;
}
