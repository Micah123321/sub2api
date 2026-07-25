export class LoginRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs = 60_000,
    private readonly maxAttempts = 20,
  ) {}

  check(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const start = now - this.windowMs;
    const recent = (this.hits.get(key) || []).filter((ts) => ts >= start);
    if (recent.length >= this.maxAttempts) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSec };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSec: 0 };
  }
}
