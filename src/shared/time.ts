import type { Result } from './types';

const fail = (error: string): Result<number> => ({ ok: false, error });

/**
 * Parse a typed duration into integer seconds.
 * Accepts H:MM, H:MM:SS, "45m", "1h 30m", "1h30m", "2h", and a bare number (minutes).
 * Zero/negative totals and malformed input are errors.
 */
export function parseDuration(s: string): Result<number> {
  const t = s.trim().toLowerCase();
  if (!t) return fail('Enter a duration, e.g. 2:15 or 1h 30m');

  let total: number | null = null;

  if (t.includes(':')) {
    const parts = t.split(':');
    const [head, ...rest] = parts;
    if (parts.length > 3 || !/^\d+$/.test(head) || !rest.every(p => /^\d{1,2}$/.test(p))) {
      return fail(`Can't read "${s}" as a duration`);
    }
    const nums = parts.map(Number);
    if (nums.slice(1).some(n => n >= 60)) return fail('Minutes and seconds must be below 60');
    const [h, m, sec = 0] = nums;
    total = h * 3600 + m * 60 + sec;
  } else if (/^\d+$/.test(t)) {
    total = Number(t) * 60;
  } else {
    const m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(t);
    if (m && (m[1] !== undefined || m[2] !== undefined)) {
      total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60;
    }
  }

  if (total === null) return fail(`Can't read "${s}" as a duration`);
  if (!Number.isSafeInteger(total) || total <= 0) return fail('Duration must be greater than zero');
  return { ok: true, value: total };
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** Local calendar day as YYYY-MM-DD. */
export function localDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function atTime(d: Date, resetTime: string, dayOffset = 0): Date {
  const [h, m] = resetTime.split(':').map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h, m, 0, 0);
}

/** Most recent daily reset at or before `now` (local time). */
export function lastResetAt(now: Date, resetTime: string): Date {
  const today = atTime(now, resetTime);
  return today.getTime() <= now.getTime() ? today : atTime(now, resetTime, -1);
}

/** Most recent weekly reset (weekday 0=Sun..6, at resetTime) at or before `now`. */
export function lastWeeklyResetAt(now: Date, resetTime: string, weekday: number): Date {
  const back = (now.getDay() - weekday + 7) % 7;
  const candidate = atTime(now, resetTime, -back);
  return candidate.getTime() <= now.getTime() ? candidate : atTime(now, resetTime, -back - 7);
}
