/**
 * In-memory sliding-window rate limiter with lockout, used to protect the
 * PIN login and the public clock kiosk from brute-force guessing.
 *
 * State is per-process; a server restart clears it. That is acceptable for
 * this internal tool because the windows are short and every attempt is also
 * written to the audit log for after-the-fact review.
 */

type Bucket = {
  /** Timestamps (ms) of recent failures inside the window. */
  failures: number[];
  /** If set, all attempts are rejected until this time (ms). */
  lockedUntil: number;
};

export class SlidingWindowLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private maxFailures: number,
    private windowMs: number,
    private lockMs: number,
  ) {}

  /** Milliseconds until the key unlocks, or 0 when attempts are allowed. */
  lockedForMs(key: string, now = Date.now()): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    if (bucket.lockedUntil > now) return bucket.lockedUntil - now;
    return 0;
  }

  /** Record a failed attempt; locks the key when the window overflows. */
  recordFailure(key: string, now = Date.now()): void {
    const bucket = this.buckets.get(key) ?? { failures: [], lockedUntil: 0 };
    bucket.failures = bucket.failures.filter((t) => now - t < this.windowMs);
    bucket.failures.push(now);
    if (bucket.failures.length >= this.maxFailures) {
      bucket.lockedUntil = now + this.lockMs;
      bucket.failures = [];
    }
    this.buckets.set(key, bucket);
    this.gc(now);
  }

  /** Clear a key after a successful attempt. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Drop stale buckets so the map cannot grow without bound. */
  private gc(now: number): void {
    if (this.buckets.size < 10_000) return;
    this.buckets.forEach((bucket, key) => {
      const stale =
        bucket.lockedUntil < now &&
        bucket.failures.every((t: number) => now - t >= this.windowMs);
      if (stale) this.buckets.delete(key);
    });
  }
}

/** PIN login: 5 failures in 10 minutes → locked for 15 minutes. */
export const pinLoginLimiter = new SlidingWindowLimiter(5, 10 * 60_000, 15 * 60_000);

/** Kiosk clock codes: 8 failures in 10 minutes → locked for 5 minutes. */
export const clockPunchLimiter = new SlidingWindowLimiter(8, 10 * 60_000, 5 * 60_000);

/** Best-effort client IP, proxy-aware. */
export function requestIp(req: {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string | null };
  ip?: string;
}): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim().slice(0, 64);
  }
  return (req.ip || req.socket?.remoteAddress || "unknown").slice(0, 64);
}
