export function pumpIndexKey(coin: string, startMs: number): string {
  return `${coin}|${new Date(startMs).toISOString()}`;
}
