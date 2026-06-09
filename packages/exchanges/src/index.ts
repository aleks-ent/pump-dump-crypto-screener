import { BinanceAdapter } from "./binance.js";
import { BybitAdapter } from "./bybit.js";
import type { ExchangeAdapter } from "./adapter.js";

export type { ExchangeAdapter } from "./adapter.js";
export { BinanceAdapter, BybitAdapter };

export function getAdapters(): Record<string, ExchangeAdapter> {
  return {
    binance: new BinanceAdapter(),
    bybit: new BybitAdapter(),
  };
}
