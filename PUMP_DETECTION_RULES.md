# Pump Detection Rules

This document describes formal rules for detecting pump-like market regimes using only OHLCV candle data.

The project does **not** use order book, depth, DOM, footprint, tape, liquidation feed or real-time trade data. All rules below must be implemented using candles only.

## 1. Goal

The goal is to detect **pump-like regime changes**, not just simple price increases.

A good pump candidate is a situation where an instrument suddenly changes behaviour:

- volume expands sharply
- volatility expands sharply
- price moves directionally upward
- pullbacks are shallow
- several candles support the move
- the move is visible on more than one exchange when possible

The detector should classify phases of a pump and return human-readable explanations for every detected candidate.

## 2. Available data

Data sources:

- Binance
- Bybit

History:

- last 5 days

Timeframes:

- 1m
- 5m

Expected OHLCV candle format:

```ts
interface Candle {
  timestamp: number
  exchange: 'binance' | 'bybit'
  symbol: string
  timeframe: '1m' | '5m'
  open: number
  high: number
  low: number
  close: number
  volume: number
}
```

## 3. Important limitation: no order book data

Because there is no order book data, the system must **not** implement rules based on:

- liquidity walls
- moving limit orders
- bid/ask depth
- absorption in the order book
- spoofing detection
- visible support/resistance in DOM
- aggressive market buys/sells from tape

Instead, the system should use candle-based proxies:

- fast recovery after red candles
- shallow pullbacks
- strong candle closes near highs
- price holding above EMA20
- volume expansion together with upward movement
- volatility expansion relative to the instrument's own baseline

## 4. Main timeframe logic

Use **5m** as the primary detection timeframe.

Use **1m** only for additional confirmation and more precise timing of the impulse.

Recommended logic:

- scan all 5m candles for pump candidates
- calculate the main score on 5m
- use 1m to confirm that the move was not a single dirty spike
- use 1m to inspect the beginning of the impulse if needed

## 5. Symbol normalization

Symbols must be normalized across exchanges.

Examples:

```text
Binance: XYZUSDT
Bybit:   XYZUSDT
```

These should be normalized into:

```ts
{
  baseAsset: 'XYZ',
  quoteAsset: 'USDT',
  marketType: 'spot' | 'swap' | 'futures' | 'unknown'
}
```

Cross-exchange confirmation should be performed by `baseAsset + quoteAsset` where possible.

## 6. Data quality filters

Ignore candles where:

```ts
open <= 0
high <= 0
low <= 0
close <= 0
volume <= 0
high < low
```

Also flag symbols with:

- missing candles
- duplicated timestamps
- large timestamp gaps
- abnormal zero-volume periods

A candidate with bad data should not be treated as a valid pump.

## 7. Liquidity filter

Very illiquid instruments create too many false positives.

Calculate quote volume:

```ts
quoteVolume = volume * close
```

For every symbol/exchange/timeframe calculate 24h median quote volume.

Default liquidity filter:

```ts
medianQuoteVolume24h >= 100_000
```

Stricter filter:

```ts
medianQuoteVolume24h >= 500_000
```

If the instrument fails the liquidity filter, either ignore it or apply a strong score penalty.

Recommended penalty:

```ts
if lowLiquidity: score -= 20
```

## 8. Derived candle metrics

For every candle calculate:

```ts
bodyPct = Math.abs(close - open) / open * 100
rangePct = (high - low) / open * 100
changePct = (close - open) / open * 100
isGreen = close > open
quoteVolume = volume * close
```

Calculate candle close position:

```ts
closePosition = (close - low) / (high - low)
```

Interpretation:

```text
closePosition >= 0.80 -> very strong close near high
closePosition >= 0.65 -> strong close
closePosition around 0.50 -> neutral close
closePosition <= 0.20 -> weak close near low
```

Handle division by zero safely. If `high === low`, set `closePosition` to `0.5` or mark it as invalid.

## 9. Rolling baselines

All thresholds must be relative to the instrument's own recent behaviour.

Do not use one universal absolute threshold for all instruments.

### 5m baselines

For every `exchange + symbol + timeframe`, calculate rolling baselines using previous candles only.

For 5m:

```ts
volumeBaseline = median(volume over previous 288 candles)
rangeBaseline = median(rangePct over previous 288 candles)
bodyBaseline = median(bodyPct over previous 288 candles)
```

288 candles on 5m = 24 hours.

### 1m baselines

For 1m:

```ts
volumeBaseline = median(volume over previous 1440 candles)
rangeBaseline = median(rangePct over previous 1440 candles)
bodyBaseline = median(bodyPct over previous 1440 candles)
```

1440 candles on 1m = 24 hours.

### Relative metrics

For every candle calculate:

```ts
volumeRatio = volume / volumeBaseline
rangeRatio = rangePct / rangeBaseline
bodyRatio = bodyPct / bodyBaseline
```

Handle division by zero safely.

If baseline is unavailable due to insufficient history, mark the candle as not eligible for scoring.

## 10. Feature 1: Volume Activation

Human meaning: the instrument suddenly became actively traded.

A candle has volume activation when:

```ts
volumeRatio >= 3
```

Strength levels:

```ts
volumeRatio >= 3  -> weak activation
volumeRatio >= 5  -> strong activation
volumeRatio >= 10 -> extreme activation
```

Also calculate a cluster metric:

```ts
volumeActivationCluster = count of candles in last 4 candles where volumeRatio >= 3
```

A better signal is not one isolated high-volume candle, but a cluster:

```ts
volumeActivationCluster >= 2
```

## 11. Feature 2: Volatility Expansion

Human meaning: candles became much larger than usual.

A candle has volatility expansion when:

```ts
rangeRatio >= 2
```

Strong volatility expansion:

```ts
rangeRatio >= 3
```

Also calculate:

```ts
volatilityExpansionCluster = count of candles in last 4 candles where rangeRatio >= 2
```

A better signal:

```ts
volatilityExpansionCluster >= 2
```

## 12. Feature 3: Directional Impulse

Human meaning: price is not just noisy; it is actually moving upward.

For 5m candles calculate:

```ts
priceChangeLast3Candles = close[now] / close[now - 3] - 1
priceChangeLast6Candles = close[now] / close[now - 6] - 1
priceChangeLast12Candles = close[now] / close[now - 12] - 1
```

Directional impulse is true when:

```ts
priceChangeLast3Candles >= 0.02
OR priceChangeLast6Candles >= 0.04
```

Meaning:

```text
last 15 minutes: +2% or more
OR
last 30 minutes: +4% or more
```

Optional ATR-based rule:

```ts
priceChangeLast6Candles >= 3 * ATR_5m_24h
```

This is useful because different instruments have different normal volatility.

## 13. Feature 4: Green Candle Cluster

Human meaning: price is moving upward through a sequence of candles, not just one spike.

Calculate:

```ts
greenCountLast4 = count of green candles in last 4 candles
greenCountLast6 = count of green candles in last 6 candles
```

Basic green cluster:

```ts
greenCountLast4 >= 3
```

Strong green cluster:

```ts
greenCountLast6 >= 5
```

Also calculate strong green candles:

```ts
strongGreenCountLast5 = count of candles in last 5 where:
  isGreen === true
  closePosition >= 0.65
  volumeRatio >= 2
```

Strong candle cluster is true when:

```ts
strongGreenCountLast5 >= 3
```

## 14. Feature 5: No-Pullback Movement

Human meaning: price is moving upward and does not give a deep pullback.

Detect the beginning of the current impulse as the first candle in the recent volume/volatility activation cluster.

Suggested simple impulse start logic:

```ts
impulseStart = first candle within last 12 candles where:
  volumeRatio >= 3
  AND rangeRatio >= 2
  AND close > open
```

Then calculate:

```ts
impulseStartPrice = low at impulseStart
impulseHigh = highest high since impulseStart
currentPullback = (impulseHigh - currentClose) / (impulseHigh - impulseStartPrice)
```

No-pullback movement:

```ts
currentPullback <= 0.30
```

Strong no-pullback movement:

```ts
currentPullback <= 0.20
```

If current pullback is above `0.50`, the move is probably no longer an active pump.

## 15. Feature 6: Trend Structure

Human meaning: the move has an upward structure.

Calculate EMA20 and EMA50 on 5m candles.

Basic trend is valid when:

```ts
close > EMA20
EMA20 slope over last 6 candles > 0
```

Strong trend is valid when:

```ts
close > EMA20
EMA20 > EMA50
EMA20 slope over last 6 candles > 0
```

Suggested EMA20 slope calculation:

```ts
ema20Slope = EMA20[now] - EMA20[now - 6]
```

Trend is positive when:

```ts
ema20Slope > 0
```

## 16. Feature 7: Breakout From Local Range

Human meaning: price broke out of a local consolidation range.

For 5m candles calculate:

```ts
localHigh = max(high over previous 24 candles)
```

24 candles on 5m = 2 hours.

Breakout is true when:

```ts
close > localHigh * 1.003
```

Strong breakout is true when:

```ts
close > localHigh * 1.003
AND volumeRatio >= 3
AND rangeRatio >= 2
```

The `1.003` buffer helps avoid weak fake breakouts by requiring a close at least 0.3% above the local high.

## 17. Feature 8: Accumulation Before Pump

Human meaning: the instrument was quiet before it suddenly started moving.

Check the period before the impulse start.

Suggested pre-impulse window on 5m:

```ts
previous 24 to 72 candles before impulseStart
```

This equals 2 to 6 hours.

Calculate:

```ts
preWindowHigh = max(high in preWindow)
preWindowLow = min(low in preWindow)
preWindowRangePct = (preWindowHigh - preWindowLow) / preWindowLow * 100
preWindowVolumeMedian = median(volume in preWindow)
```

Accumulation-like behaviour is true when:

```ts
preWindowRangePct <= median of comparable rolling 24-candle ranges over last 5 days
AND preWindowVolumeMedian <= 1.2 * volumeBaseline
```

This is not required for every pump, but it increases confidence.

### Optional calm-period gate

`pump.requireCalmPrePump` is a feature flag (default `false`) that turns the calm period
from supporting evidence into a required quality gate for pump-side phases. The gate uses
the 24 five-minute candles (2 hours) immediately before `impulseStart`, never candles from
the impulse itself or later.

The pre-pump window must satisfy all of these conditions:

```ts
prePumpRangePct <= 10
prePumpPathPct <= 20
prePumpMedianRangeRatio <= 2.5
prePumpMedianVolumeRatio <= 2.5
```

`prePumpPathPct` is the sum of absolute close-to-close moves. It catches a chart that has
a narrow high/low envelope but repeatedly oscillates inside that envelope. Range and volume
ratios use the instrument's own preceding 24-hour baselines. The maximum single-candle range
ratio remains available as diagnostic metadata, but it does not veto an otherwise calm window.

When the flag is enabled, activation, active-pump, late-pump, and spike candidates that do
not meet this gate are omitted. Distribution/fade (dump) candidates are unchanged. Toggling
the flag invalidates the per-coin scan cache so results are recomputed under the new rule.

## 18. Feature 9: Pullbacks Are Bought

Human meaning: when the price dips, it quickly recovers.

Candle-based proxy because there is no order book.

Calculate:

```ts
maxConsecutiveRedCandles over last 6 candles
```

Pullbacks are considered bought when:

```ts
maxConsecutiveRedCandles <= 2
AND close > EMA20
```

Also detect red candle recovery:

```ts
A red candle is considered recovered if one of the next 2 candles closes above the red candle close.
```

A stronger version:

```ts
For every red candle in the last 6 candles,
one of the next 2 candles closes above that red candle's close.
```

## 19. Feature 10: Multi-Exchange Confirmation

Human meaning: a real pump is often visible on more than one major exchange.

When a pump candidate is detected on one exchange, check other exchanges for the same normalized symbol.

Confirmation from another exchange exists when, within `+/- 3` five-minute candles:

```ts
priceChangeLast6Candles >= 60% of leaderExchangeMove
AND volumeRatio >= 2
AND priceChangeLast6Candles > 0
```

Calculate:

```ts
confirmedExchanges = number of exchanges where confirmation exists
```

Interpretation:

```text
confirmedExchanges = 1 -> only one exchange saw the move; lower confidence
confirmedExchanges = 2 -> good confirmation
confirmedExchanges = 3 -> strong confirmation
```

Do not discard single-exchange moves automatically, but reduce confidence.

## 20. Feature 11: Single-Candle Spike Filter

Human meaning: avoid treating one dirty spike as a real pump.

A spike-like move is detected when:

```ts
priceChangeOneCandle >= 0.05
AND next 2 candles retrace more than 70% of the spike
```

If detected, classify as:

```ts
phase = 'spike'
```

Do not classify it as `active_pump`.

## 21. Pump phase classification

The detector should classify every candidate into one of these phases:

```ts
type PumpPhase =
  | 'activation'
  | 'active_pump'
  | 'late_pump'
  | 'distribution_or_fade'
  | 'spike'
  | 'ignore'
```

### 21.1 Activation

Human meaning: something may be starting, but the pump is not fully confirmed yet.

Conditions:

```ts
volumeRatio >= 3
rangeRatio >= 1.5
priceChangeLast3Candles > 0
```

Additional useful signals:

```ts
close > EMA20
OR breakoutFromLocalRange === true
```

### 21.2 Active pump

Human meaning: this is the main interesting phase.

Conditions:

```ts
volumeActivationCluster >= 2
volatilityExpansionCluster >= 2
directionalImpulse === true
greenCluster === true
currentPullback <= 0.30
close > EMA20
EMA20 slope > 0
```

Optional confidence boosters:

```ts
breakoutFromLocalRange === true
confirmedExchanges >= 2
pullbacksAreBought === true
accumulationBeforePump === true
```

### 21.3 Late pump

Human meaning: the move may be too extended and dangerous for early entry.

Conditions:

```ts
priceChangeLast12Candles >= 0.12
AND volumeRatio >= 10
AND rangeRatio >= 4
```

If ATR is implemented, also check:

```ts
distanceFromEMA20 >= 2.5 * ATR_5m_24h
```

Late pump should not be treated as a good early pump signal.

### 21.4 Distribution or fade

Human meaning: the pump may be ending or has already started to unwind.

Conditions:

```ts
large red candle with volumeRatio >= 5
OR close < EMA20 after previous active_pump
OR pullback from impulse high >= 50% of impulse move
OR huge volume appears but price stops making new highs
```

Additional rule for price stalling on volume:

```ts
volumeRatio >= 5
AND priceChangeLast3Candles <= -0.01
AND close is at least 1% below the recent high
```

High-volume consolidation near the recent high is not a dump. When a
`distribution_or_fade` phase immediately follows a pump within the episode gap, keep it in
the preceding pump episode. Only standalone distribution/fade runs become dump episodes.

### 21.5 Spike

Human meaning: one-candle abnormal move that quickly reverted.

Conditions:

```ts
priceChangeOneCandle >= 0.05
AND retracement over next 2 candles >= 70% of spike
```

## 22. Scoring model

Implement a transparent 0-100 score.

```ts
score = 0

// Volume
if volumeRatio >= 3: score += 15
if volumeRatio >= 5: score += 10
if volumeRatio >= 10: score += 5

// Volatility
if rangeRatio >= 2: score += 15
if rangeRatio >= 3: score += 5

// Direction
if priceChangeLast3Candles >= 0.02: score += 10
if priceChangeLast6Candles >= 0.04: score += 10

// Green cluster
if greenCountLast4 >= 3: score += 10
if greenCountLast6 >= 5: score += 5

// No-pullback movement
if currentPullback <= 0.30: score += 10
if currentPullback <= 0.20: score += 5

// Trend
if close > EMA20 && ema20Slope > 0: score += 10

// Breakout
if breakoutFromLocalRange: score += 10

// Multi-exchange confirmation
if confirmedExchanges >= 2: score += 10
if confirmedExchanges === 3: score += 5

// Penalties
if latePumpDetected: score -= 20
if distributionDetected: score -= 30
if spikeDetected: score -= 30
if lowLiquidity: score -= 20

score = clamp(score, 0, 100)
```

Confidence levels:

```ts
score >= 75 -> high
score >= 55 -> medium
score >= 40 -> low
score < 40  -> ignore
```

## 23. Recommended final decision logic

Suggested classification order:

```ts
if badData:
  phase = 'ignore'

else if lowLiquidity:
  apply low liquidity penalty

if spikeDetected:
  phase = 'spike'

else if distributionDetected:
  phase = 'distribution_or_fade'

else if latePumpDetected:
  phase = 'late_pump'

else if activePumpConditionsMet && score >= 55:
  phase = 'active_pump'

else if activationConditionsMet && score >= 40:
  phase = 'activation'

else:
  phase = 'ignore'
```

Important: `late_pump` is not necessarily bearish. It means the move is already extended and should not be confused with early pump detection.

## 24. Required output format

For every detected candidate return:

```ts
interface PumpCandidate {
  timestamp: number
  baseAsset: string
  quoteAsset: string
  symbol: string
  exchange: 'binance' | 'bybit'
  timeframe: '5m'
  phase: 'activation' | 'active_pump' | 'late_pump' | 'distribution_or_fade' | 'spike'
  score: number
  confidence: 'low' | 'medium' | 'high'
  metrics: {
    volumeRatio: number
    rangeRatio: number
    bodyRatio: number
    priceChangeLast3Candles: number
    priceChangeLast6Candles: number
    priceChangeLast12Candles: number
    greenCountLast4: number
    greenCountLast6: number
    strongGreenCountLast5: number
    currentPullback: number | null
    confirmedExchanges: number
    medianQuoteVolume24h: number
    closePosition: number
    ema20: number | null
    ema50: number | null
    ema20Slope: number | null
  }
  reasons: string[]
}
```

`reasons` must be human-readable.

Example:

```json
{
  "timestamp": 1710000000000,
  "baseAsset": "XYZ",
  "quoteAsset": "USDT",
  "symbol": "XYZUSDT",
  "exchange": "binance",
  "timeframe": "5m",
  "phase": "active_pump",
  "score": 82,
  "confidence": "high",
  "metrics": {
    "volumeRatio": 7.4,
    "rangeRatio": 3.1,
    "bodyRatio": 2.8,
    "priceChangeLast3Candles": 0.031,
    "priceChangeLast6Candles": 0.068,
    "priceChangeLast12Candles": 0.091,
    "greenCountLast4": 3,
    "greenCountLast6": 5,
    "strongGreenCountLast5": 3,
    "currentPullback": 0.18,
    "confirmedExchanges": 2,
    "medianQuoteVolume24h": 850000,
    "closePosition": 0.82,
    "ema20": 1.234,
    "ema50": 1.198,
    "ema20Slope": 0.018
  },
  "reasons": [
    "Volume is 7.4x above the recent baseline",
    "Volatility is 3.1x above the recent baseline",
    "Price increased by 6.8% over the last 6 five-minute candles",
    "5 of the last 6 candles are green",
    "Current pullback is only 18% of the impulse move",
    "Move is confirmed on 2 exchanges"
  ]
}
```

## 25. Suggested event table

Store detected events in a table like this:

```text
pump_events
- id
- timestamp
- base_asset
- quote_asset
- symbol
- exchange
- phase
- score
- confidence
- volume_ratio
- range_ratio
- body_ratio
- price_change_15m
- price_change_30m
- price_change_60m
- current_pullback
- confirmed_exchanges
- median_quote_volume_24h
- reasons_json
- created_at
```

## 26. Recommended first implementation version

Do not start with machine learning.

Start with a transparent rule-based detector:

1. Load and validate OHLCV data.
2. Normalize symbols across Binance and Bybit.
3. Calculate candle metrics.
4. Calculate rolling baselines.
5. Calculate relative metrics.
6. Detect volume activation.
7. Detect volatility expansion.
8. Detect directional impulse.
9. Detect green candle clusters.
10. Detect shallow pullbacks.
11. Detect trend structure.
12. Detect local range breakouts.
13. Detect late pump / distribution / spike conditions.
14. Calculate score.
15. Classify phase.
16. Return candidates with human-readable reasons.
17. Manually review 50-100 detected events on charts.
18. Tune thresholds after manual review.

## 27. Key idea

The detector should not search for "green candles".

It should search for a **regime change**:

```text
quiet market
-> sudden volume expansion
-> sudden volatility expansion
-> local breakout
-> several strong green candles
-> shallow pullbacks
-> price holding above EMA20
-> optional confirmation on other exchanges
```

A dangerous late-stage move looks different:

```text
already vertical price move
-> extreme volume
-> extreme volatility
-> price far away from EMA20
-> large red candles appear
-> price stops making easy new highs
```

The first pattern can be an active pump candidate.

The second pattern should be classified as `late_pump` or `distribution_or_fade`, not as an early pump opportunity.
