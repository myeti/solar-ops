/**
 * Formatting helpers, available in templates as `$format.xxx()`.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/**
 * 1536 => "1.5 KB"
 */
export function bytes(value) {
  if (value === null || value === undefined) {
    return '—';
  }

  let size = Number(value);
  let unit = 0;

  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  let digits = 0;
  if (size < 10 && unit > 0) {
    digits = 1;
  }

  return `${size.toFixed(digits)} ${UNITS[unit]}`;
}

/**
 * 93784000 ms => "1d 2h"
 */
export function duration(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) {
    return '—';
  }

  const seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
}

/**
 * Relative time: "3 minutes ago", "in 12 days".
 */
export function timeAgo(value) {
  if (!value) {
    return 'never';
  }

  const date = new Date(value);
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const steps = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];

  for (const [unit, size] of steps) {
    if (Math.abs(diffSeconds) >= size) {
      return formatter.format(Math.round(diffSeconds / size), unit);
    }
  }

  return formatter.format(diffSeconds, 'second');
}

/**
 * Full local date and time.
 */
export function dateTime(value) {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Short local date.
 */
export function date(value) {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Task duration from its timestamps.
 */
export function taskDuration(task) {
  if (!task.startedAt) {
    return '—';
  }

  let end = Date.now();

  if (task.finishedAt) {
    end = new Date(task.finishedAt).getTime();
  }

  return duration(end - new Date(task.startedAt).getTime());
}

export default {
  bytes,
  duration,
  timeAgo,
  dateTime,
  date,
  taskDuration,
};
