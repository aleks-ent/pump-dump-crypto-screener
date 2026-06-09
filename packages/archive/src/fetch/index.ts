import type { ArchiveFile, Instrument } from "@screener/core";
import * as binance from "./binance.js";
import * as bybit from "./bybit.js";

export function supportsArchives(inst: Instrument): boolean {
  if (inst.exchange === "binance") return binance.supportsArchives(inst);
  if (inst.exchange === "bybit") return bybit.supportsArchives(inst);
  return false;
}

export function planArchives(
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
): ArchiveFile[] {
  if (inst.exchange === "binance") {
    return binance.planArchives(inst, interval, startMs, endMs);
  }
  if (inst.exchange === "bybit") {
    return bybit.planArchives(inst, interval, startMs, endMs);
  }
  return [];
}

export {
  bybitSkipsPublicArchives,
  setBybitSkipPublicArchives,
} from "./bybit.js";
