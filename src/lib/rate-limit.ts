// Simple in-memory limiter for failed logins. Good enough for a single server instance;
// if the app is ever scaled to several instances, move this to the database or Redis.
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000;

export function isLimited(key: string, max: number) {
  const b = buckets.get(key);
  if (!b || b.resetAt < Date.now()) return false;
  return b.count >= max;
}

export function recordFailure(key: string) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else b.count++;
  // Keep memory bounded.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
}

export function clearFailures(key: string) {
  buckets.delete(key);
}
