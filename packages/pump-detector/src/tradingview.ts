export interface TradingViewChartLinkOptions {
  exchange: string;
  symbolNative: string;
  /** spot, linear_perp, swap, futures, … */
  instrumentType?: string;
  timeframe?: "1m" | "5m";
}

const TV_EXCHANGE: Record<string, string> = {
  binance: "BINANCE",
  bybit: "BYBIT",
};

function isPerpetual(instrumentType: string | undefined): boolean {
  if (!instrumentType) return true;
  return ["linear_perp", "swap", "futures"].includes(instrumentType);
}

/** TradingView `EXCHANGE:SYMBOL` identifier (e.g. BINANCE:SUSHIUSDT.P). */
export function tradingViewSymbol(opts: TradingViewChartLinkOptions): string {
  const prefix = TV_EXCHANGE[opts.exchange.toLowerCase()] ?? opts.exchange.toUpperCase();
  const suffix = isPerpetual(opts.instrumentType) ? ".P" : "";
  return `${prefix}:${opts.symbolNative}${suffix}`;
}

/** Open the coin on TradingView at the detector timeframe (5m by default). */
export function buildTradingViewChartUrl(opts: TradingViewChartLinkOptions): string {
  const interval = opts.timeframe === "1m" ? "1" : "5";
  const params = new URLSearchParams({
    symbol: tradingViewSymbol(opts),
    interval,
  });
  return `https://www.tradingview.com/chart/?${params.toString()}`;
}
