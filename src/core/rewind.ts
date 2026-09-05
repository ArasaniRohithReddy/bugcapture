/** In-memory circular event buffer used for the two-minute rewind capture. */
export const REWIND_BUFFER_MS = 2 * 60 * 1000;
export const REWIND_TRIM_MIN_MS = 10 * 1000;

export interface RewindEvent<T> {
  timestamp: number;
  value: T;
}

export class RewindBuffer<T> {
  private events: RewindEvent<T>[] = [];
  constructor(public readonly bufferMs = REWIND_BUFFER_MS) {}
  push(value: T, timestamp = Date.now()): void {
    this.events.push({ value, timestamp });
    this.trim(timestamp);
  }
  trim(now = Date.now()): void {
    const cutoff = now - Math.max(REWIND_TRIM_MIN_MS, this.bufferMs);
    this.events = this.events.filter((event) => event.timestamp >= cutoff);
  }
  since(timestamp: number): RewindEvent<T>[] {
    return this.events.filter((event) => event.timestamp >= timestamp);
  }
  values(): T[] {
    return this.events.map((event) => event.value);
  }
  clear(): void {
    this.events = [];
  }
  get size(): number {
    return this.events.length;
  }
}
