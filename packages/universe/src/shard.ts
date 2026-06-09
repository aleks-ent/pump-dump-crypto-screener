import type { SeriesTask } from "./resolve.js";

export function uniqueSymbolsForExchange(tasks: SeriesTask[], exchange: string): string[] {
  const symbols = new Set<string>();
  for (const task of tasks) {
    if (task.instrument.exchange === exchange) {
      symbols.add(task.instrument.symbolNative);
    }
  }
  return [...symbols].sort();
}

export function shardByIndex<T>(items: T[], shardIndex: number, shardCount: number): T[] {
  if (shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error(`Invalid shard ${shardIndex}/${shardCount}`);
  }
  return items.filter((_, i) => i % shardCount === shardIndex);
}

export function tasksForSymbolShard(
  tasks: SeriesTask[],
  exchange: string,
  symbols: Set<string>,
): SeriesTask[] {
  return tasks.filter(
    (t) => t.instrument.exchange === exchange && symbols.has(t.instrument.symbolNative),
  );
}

export function symbolShardSet(
  allSymbols: string[],
  shardIndex: number,
  shardCount: number,
): Set<string> {
  return new Set(shardByIndex(allSymbols, shardIndex, shardCount));
}
