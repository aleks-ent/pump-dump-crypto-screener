import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { strFromU8, unzipSync } from "fflate";

export function readGzipText(path: string): string {
  const raw = gunzipSync(readFileSync(path));
  return raw.toString("utf-8");
}

/** First .csv entry inside a zip (Binance daily archives). */
export function readZipCsvEntries(
  path: string,
  nameFilter?: (name: string) => boolean,
): { name: string; text: string }[] {
  const buf = readFileSync(path);
  const entries = unzipSync(new Uint8Array(buf));
  const out: { name: string; text: string }[] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (!name.toLowerCase().endsWith(".csv")) continue;
    if (nameFilter && !nameFilter(name)) continue;
    out.push({ name, text: strFromU8(data) });
  }
  return out;
}

export function readZipFirstCsv(path: string, nameFilter?: (name: string) => boolean): string | null {
  const entries = readZipCsvEntries(path, nameFilter);
  return entries[0]?.text ?? null;
}
