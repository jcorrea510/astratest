/**
 * Frame-loop guard: a thrown error in one frame is logged once and the loop keeps going (most faults are one-off).
 * If it throws on every frame (`limit` in a row) the guard reports a fatal crash so the caller can stop and show an overlay.
 */
export interface LoopGuardOptions { limit?: number; log?: (e: unknown) => void; onFatal?: (e: unknown) => void }
export class LoopGuard {
  consecutive = 0;
  total = 0;
  fatal = false;
  private lastMsg = '';
  private readonly limit: number;
  constructor(private readonly opts: LoopGuardOptions = {}) { this.limit = opts.limit ?? 30; }
  /** Runs one frame body. Returns true when it completed. */
  run(fn: () => void): boolean {
    try {
      fn();
      this.consecutive = 0;
      return true;
    } catch (e) {
      this.consecutive++; this.total++;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== this.lastMsg) { this.lastMsg = msg; (this.opts.log ?? ((x: unknown) => console.error('frame error (continuing)', x)))(e); }
      if (this.consecutive >= this.limit && !this.fatal) { this.fatal = true; this.opts.onFatal?.(e); }
      return false;
    }
  }
  reset(): void { this.consecutive = 0; this.fatal = false; this.lastMsg = ''; }
}
