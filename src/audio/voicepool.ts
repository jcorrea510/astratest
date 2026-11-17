/**
 * Bounded voice allocation with stealing. Pure bookkeeping (generic over the voice handle) so it can be unit tested.
 * Rules, in order:
 *  1. Voices whose end time has passed are dropped.
 *  2. A key may hold at most `perKey(key)` voices: the oldest voice of that key is stolen.
 *  3. The pool may hold at most `max` voices: the lowest-priority (then oldest) voice is stolen, but only if its
 *     priority is <= the newcomer's; otherwise the newcomer is rejected.
 *  4. The same key started less than `minInterval(key)` seconds ago is rejected (rate limit for 100 shots/s spam).
 */
export interface PoolVoice<T> { key: string; start: number; end: number; priority: number; handle: T }
export interface Admission<T> { ok: boolean; steal: T[] }

export class VoicePool<T> {
  readonly voices: PoolVoice<T>[] = [];
  private lastStart = new Map<string, number>();
  constructor(
    readonly max: number,
    readonly perKey: (key: string) => number = () => 4,
    readonly minInterval: (key: string) => number = () => 0,
  ) {}

  get size(): number { return this.voices.length; }

  prune(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i].end <= now) this.voices.splice(i, 1);
  }

  /** Decide whether a new voice may start. On success the caller must stop the `steal` handles and then `add()`. */
  admit(key: string, priority: number, now: number): Admission<T> {
    this.prune(now);
    const last = this.lastStart.get(key);
    if (last !== undefined && now - last < this.minInterval(key) && now >= last) return { ok: false, steal: [] };
    const steal: PoolVoice<T>[] = [];
    const same = this.voices.filter(v => v.key === key).sort((a, b) => a.start - b.start);
    const limit = Math.max(1, this.perKey(key));
    for (let i = 0; same.length - i >= limit; i++) steal.push(same[i]);
    if (this.voices.length - steal.length >= this.max) {
      let victim: PoolVoice<T> | null = null;
      for (const v of this.voices) {
        if (steal.includes(v)) continue;
        if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.start < victim.start)) victim = v;
      }
      if (!victim || victim.priority > priority) return { ok: false, steal: [] };
      steal.push(victim);
    }
    for (const s of steal) this.voices.splice(this.voices.indexOf(s), 1);
    return { ok: true, steal: steal.map(s => s.handle) };
  }

  add(v: PoolVoice<T>): void { this.voices.push(v); this.lastStart.set(v.key, v.start); }

  remove(handle: T): void {
    const i = this.voices.findIndex(v => v.handle === handle);
    if (i >= 0) this.voices.splice(i, 1);
  }

  clear(): T[] { const h = this.voices.map(v => v.handle); this.voices.length = 0; this.lastStart.clear(); return h; }
}
