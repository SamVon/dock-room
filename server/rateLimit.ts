import type { Limit } from "./config";

/** Sliding-window limiter: at most `limit` hits per `windowMs` for each key. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly rule: Limit) {}

  /** Records a hit and returns whether it is allowed. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.rule.windowMs);
    const allowed = recent.length < this.rule.limit;
    if (allowed) recent.push(now);
    this.hits.set(key, recent);
    return allowed;
  }

  /** After a refusal: how long until the oldest hit leaves the window and one more is allowed. */
  retryAfterMs(key: string, now = Date.now()): number {
    const oldest = this.hits.get(key)?.[0];
    return oldest === undefined ? 0 : Math.max(0, oldest + this.rule.windowMs - now);
  }

  /** Forgets keys with no recent hits, so memory does not grow forever. */
  sweep(now = Date.now()) {
    for (const [key, times] of this.hits) {
      if (times.every((time) => now - time >= this.rule.windowMs)) this.hits.delete(key);
    }
  }
}
