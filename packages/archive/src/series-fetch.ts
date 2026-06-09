import type { HttpClient, Instrument } from "@screener/core";
import type { ExchangeAdapter } from "@screener/exchanges";
import { SeriesQuality, seriesKey, writeRawRecords } from "@screener/storage";

export async function runSeriesRaw(
  adapter: ExchangeAdapter,
  client: HttpClient,
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
  baseDir: string,
  checkpoint: Record<string, unknown>,
  checkpointEnabled: boolean,
): Promise<{ key: string; report: Record<string, unknown>; rawRows: number }> {
  const key = seriesKey(inst, interval);
  let cursor = checkpoint[key] as Record<string, unknown> | null | undefined;
  if (cursor == null) {
    cursor = adapter.initialCursor(startMs, endMs);
  }

  const quality = new SeriesQuality(
    inst.exchange,
    inst.instrumentType,
    inst.symbolNative,
    interval,
  );
  let rawRows = 0;

  while (cursor) {
    const page = await adapter.fetchCandlesPage(client, inst, interval, cursor);
    if (page.records.length > 0) {
      rawRows += writeRawRecords(baseDir, page.records, page.requestMeta);
      quality.observe(page.records, startMs, endMs);
    }
    cursor = page.nextCursor;
    if (checkpointEnabled) {
      checkpoint[key] = cursor;
    }
  }
  if (key in checkpoint && checkpoint[key] == null) {
    delete checkpoint[key];
  }

  return { key, report: quality.toReport(), rawRows };
}
