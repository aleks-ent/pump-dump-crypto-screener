export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function sortedInsert(sorted: number[], value: number): void {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  sorted.splice(lo, 0, value);
}

function sortedRemoveOne(sorted: number[], value: number): void {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  if (lo < sorted.length && sorted[lo] === value) {
    sorted.splice(lo, 1);
  }
}

/** O(window) insert/remove median for fixed-size sliding windows (no per-bar slice+sort). */
export class SlidingWindowMedian {
  private readonly ring: number[];
  private readonly sorted: number[] = [];
  private ringIndex = 0;
  private filled = 0;

  constructor(private readonly window: number) {
    this.ring = new Array(window);
  }

  push(value: number): void {
    if (this.filled >= this.window) {
      sortedRemoveOne(this.sorted, this.ring[this.ringIndex]!);
    } else {
      this.filled += 1;
    }
    this.ring[this.ringIndex] = value;
    sortedInsert(this.sorted, value);
    this.ringIndex = (this.ringIndex + 1) % this.window;
  }

  isFull(): boolean {
    return this.filled >= this.window;
  }

  median(): number | null {
    if (!this.isFull()) return null;
    const n = this.sorted.length;
    const mid = Math.floor(n / 2);
    if (n % 2 === 1) return this.sorted[mid]!;
    return (this.sorted[mid - 1]! + this.sorted[mid]!) / 2;
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function safeDiv(n: number, d: number): number | null {
  if (d === 0 || !Number.isFinite(d) || !Number.isFinite(n)) return null;
  return n / d;
}
