export class DedupeStore {
  private readonly entries = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  has(key: string) {
    this.cleanup();
    const expiresAt = this.entries.get(key);
    return typeof expiresAt === "number" && expiresAt > Date.now();
  }

  remember(key: string) {
    this.entries.set(key, Date.now() + this.ttlMs);
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, expiresAt] of this.entries.entries()) {
      if (expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
