export function pumpIndexKey(coin: string, startMs: number): string {
  return `${coin}|${new Date(startMs).toISOString()}`;
}

export function dumpIndexKey(coin: string, startMs: number): string {
  return `dump|${coin}|${new Date(startMs).toISOString()}`;
}

export function episodeIndexKey(
  episodeType: "pump" | "dump",
  coin: string,
  startMs: number,
): string {
  return episodeType === "dump" ? dumpIndexKey(coin, startMs) : pumpIndexKey(coin, startMs);
}
