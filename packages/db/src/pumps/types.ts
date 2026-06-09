export type PumpClassification = "pump" | "dump" | "none";

export interface StoredPump {
  index: string;
  coin: string;
  startMs: number;
  startUtc: string;
  endMs: number;
  endUtc: string;
  durationMinutes: number;
  peakScore: number;
  dominantPhase: string;
  leadingExchange: string;
  symbolNative: string;
  instrumentType: string;
  tradingViewUrl: string;
  confirmed: boolean;
  confirmedExchanges: string[];
  eventCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  classification: PumpClassification | null;
}

export interface LegacyPumpIndexStore {
  version: 1;
  updatedAt: string;
  pumps: Record<
    string,
    Omit<StoredPump, "classification"> & { classification?: never }
  >;
}
