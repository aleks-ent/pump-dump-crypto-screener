export type ExchangeId = "binance" | "bybit";
export type Timeframe = "1m" | "5m";
export type PumpPhase =
  | "activation"
  | "active_pump"
  | "late_pump"
  | "distribution_or_fade"
  | "spike"
  | "ignore";

export type Confidence = "low" | "medium" | "high";

export interface Candle {
  openTimeMs: number;
  exchange: string;
  instrumentType: string;
  symbolNative: string;
  symbolCanonical: string;
  base: string;
  quote: string;
  interval: Timeframe;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
}

export interface SeriesQualityFlags {
  badData: boolean;
  duplicateBars: number;
  gaps: number;
  reasons: string[];
}

export interface FeatureSnapshot {
  volumeRatio: number;
  rangeRatio: number;
  bodyRatio: number;
  priceChangeLast3: number;
  priceChangeLast6: number;
  priceChangeLast12: number;
  priceChangeOneCandle: number;
  greenCountLast4: number;
  greenCountLast6: number;
  strongGreenCountLast5: number;
  volumeActivationCluster: number;
  volatilityExpansionCluster: number;
  currentPullback: number | null;
  impulseStartIndex: number | null;
  breakoutFromLocalRange: boolean;
  strongBreakout: boolean;
  accumulationBeforePump: boolean;
  maxConsecutiveRedLast6: number;
  pullbacksAreBought: boolean;
  directionalImpulse: boolean;
  greenCluster: boolean;
  strongGreenCluster: boolean;
  noPullback: boolean;
  strongNoPullback: boolean;
  trendBasic: boolean;
  trendStrong: boolean;
  latePumpDetected: boolean;
  distributionDetected: boolean;
  spikeDetected: boolean;
  activationConditionsMet: boolean;
  activePumpConditionsMet: boolean;
  /** Consecutive 5m bars (ending at this candle) with activation-level volume/volatility. */
  sustainedActivationBars: number;
  /** True when sustainedActivationBars covers at least 15 minutes (3 × 5m). */
  minPumpDurationMet: boolean;
  medianQuoteVolume24h: number;
  closePosition: number;
  ema20: number | null;
  ema50: number | null;
  ema20Slope: number | null;
  eligible: boolean;
}

export interface CoverageSnapshot {
  exchange: string;
  coveragePct: number;
  fromMs: number | null;
  toMs: number | null;
}

export interface PumpCandidate {
  timestamp: number;
  baseAsset: string;
  quoteAsset: string;
  symbol: string;
  exchange: ExchangeId;
  /** spot, linear_perp, … — used for TradingView links. */
  instrumentType?: string;
  timeframe: "5m";
  phase: PumpPhase;
  score: number;
  confidence: Confidence;
  leadingExchange: string;
  confirmed: boolean;
  /** Exchange names that confirmed the signal (includes leader). */
  confirmedExchanges: string[];
  peersAvailable: number;
  coverage: CoverageSnapshot[];
  metrics: {
    volumeRatio: number;
    rangeRatio: number;
    bodyRatio: number;
    priceChangeLast3Candles: number;
    priceChangeLast6Candles: number;
    priceChangeLast12Candles: number;
    greenCountLast4: number;
    greenCountLast6: number;
    strongGreenCountLast5: number;
    currentPullback: number | null;
    confirmedExchanges: number;
    medianQuoteVolume24h: number;
    closePosition: number;
    ema20: number | null;
    ema50: number | null;
    ema20Slope: number | null;
  };
  reasons: string[];
}

export interface ScanOptions {
  startMs: number;
  endMs: number;
  dataRoots: string[];
  archivesDir?: string | null;
  useArchives?: boolean;
  onLog?: (message: string) => void;
  liquidityThreshold?: number;
  minScore?: number;
  /** Minimum score for distribution_or_fade (dump) hits; defaults to minScore. */
  minDumpScore?: number;
  exchanges?: Set<string>;
  marketCategory?: "spot" | "futures" | null;
  /** Reuse cached candidates before the tail warmup zone; rescan only the last N bars. */
  incremental?: {
    cachedCandidates: PumpCandidate[];
    warmupBars?: number;
  };
}
