import type { Result, Season } from '../../shared/types';

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const bad = (error: string): Result<never> => ({ ok: false, error });

export { parseDuration as parseTime } from '../../shared/time';

export function parseName(raw: string): Result<string> {
  const t = raw.trim();
  return t ? ok(t) : bad('Name can’t be empty');
}

const NON_NEGATIVE = /^\d+(\.\d+)?$/;

/** Empty → null; otherwise a number ≥ 0. */
export function parseOptionalValue(raw: string): Result<number | null> {
  const t = raw.trim();
  if (t === '') return ok(null);
  return NON_NEGATIVE.test(t) ? ok(Number(t)) : bad('Enter a number, zero or more (or leave empty)');
}

export function parseNonNegative(raw: string): Result<number> {
  const t = raw.trim();
  return NON_NEGATIVE.test(t) ? ok(Number(t)) : bad('Enter a number, zero or more');
}

export function parsePositiveInt(raw: string): Result<number> {
  const t = raw.trim();
  return /^\d+$/.test(t) && Number(t) > 0 ? ok(Number(t)) : bad('Enter a positive whole number');
}

export function parseSeason(raw: string): Result<Season> {
  const t = raw.trim().toLowerCase();
  if (t === 'permanent') return ok('permanent');
  return /^\d+$/.test(t) && Number(t) > 0 ? ok(Number(t)) : bad('Enter "permanent" or a season number');
}
