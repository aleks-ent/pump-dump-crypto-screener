# Scalping Insights Extracted from the Telegram Export

## Scope

Source:

- Chat: `Trading "Scalping Trading School"`
- Export period: 2024-08-22 through 2026-06-11
- 36,234 messages
- 7,488 attached photos
- 1,312 messages in the `Trade Reviews` topic
- 332 substantial trade-review messages; 187 included charts

This report extracts recurring, testable ideas. It intentionally excludes most
course promotion, referral material, unsupported profit claims, and repetitive
announcements.

The material is community-generated and has not been independently validated.
Percentages in screenshots often describe price movement, not account return.

## The Most Important Insight

The channel's useful edge is not directional prediction. It is a structured
process:

1. Identify the market phase.
2. Map a specific structure and invalidation point.
3. Enter only in a predefined area.
4. Size the position from the stop distance.
5. Reduce risk as the trade works.
6. Exit in parts and retain a small runner.
7. Review the trade from evidence, not memory.

The best documented trades repeatedly combine structure, Bitcoin context,
volume/order-flow context, and controlled execution. Weak trades usually fail
before the entry: the trader chases price, anticipates an unconfirmed breakout,
uses the wrong strategy for the phase, or enters emotionally.

## A Practical Scalping Framework

### 1. Use Multiple Timeframes for Different Jobs

The clearest workflow in the archive is:

- `1h`: map major support, resistance, trend, and room to the next obstacle.
- `15m`: identify the setup and determine whether the structure is mature.
- `1m`: execute, manage the stop, and observe immediate order flow.

The useful principle is separation of concerns. A one-minute chart is an
execution tool, not sufficient context for the entire trade.

Source: message `393`, 2024-11-25.

### 2. Entry Location Matters More Than Being Right About Direction

The archive repeatedly rejects entries that are directionally plausible but too
far from the invalidation point. A good thesis with a bad entry creates a large
stop, poor reward-to-risk, and emotional management.

Before entering, define:

- the structure being traded;
- the exact entry area;
- the point that invalidates the idea;
- the next obstacle and available price travel;
- what Bitcoin and immediate order flow must do for the setup to remain valid.

At a direct collision between trend and a level, the channel describes the
outcome as effectively uncertain. Waiting for one side to take control is
preferable to guessing.

Sources: messages `15585`, `19331`, `22222`.

### 3. Trade the Phase, Not the Pattern Name

The same visual pattern behaves differently during accumulation, expansion,
active pump, exhaustion, and reversal.

The strongest recurring rule is:

- During active expansion, trade with the movement.
- Do not blindly catch countertrend pullbacks in a pump or dump.
- After a trend break, wait for evidence of a phase change before reversing.
- If the strategy was designed for a pump, do not apply it to an ordinary
  low-energy trend near resistance.

This is more useful than the channel's occasional absolute language such as
`strictly long`. Direction should remain conditional on the phase and
invalidation.

Sources: messages `1604`, `4736`, `21409`, `39265`, `40158`.

### 4. Favor Confirmed Breakouts Over Anticipated Breakouts

One of the cleanest distinctions in the archive:

- Weak: enter before the breakout because it looks likely.
- Better: wait for the break, acceptance or consolidation beyond the level,
  then enter in a controlled area.

A breakout followed by a compact consolidation can offer:

- evidence that price is holding beyond the level;
- a nearby invalidation point;
- a place for a small add-on;
- less risk than chasing the breakout candle.

Do not continue adding if price is rejecting the level and disproving the idea.

Sources: messages `19331`, `2674`, `29018`, `39537`.

### 5. Treat Bitcoin as Context, Not a Binary Signal

Bitcoin direction appears throughout the strongest reviews. It is used to:

- confirm or weaken an altcoin setup;
- time partial exits;
- decide whether to add;
- recognize when local strength is becoming dangerous;
- distinguish an independent pump from broad market movement.

The archive also notes that correlation changes by phase. A pumping asset may
temporarily decouple from Bitcoin, then recouple violently. Therefore, a static
correlation coefficient is not enough; current co-movement and phase matter.

Sources: messages `393`, `12623`, `21409`, `34226`, `40493`.

### 6. Keep Monetary Risk Fixed While Stop Distance Changes

The channel teaches a useful sizing identity:

`position notional = monetary risk / stop distance`

Example from the archive with a `$100` account and `$0.80` risk:

| Stop distance | Position notional | Monetary risk |
|---:|---:|---:|
| 1.6% | $50 | $0.80 |
| 8.0% | $10 | $0.80 |

The important idea is not the particular `0.8%` value. It is that a wider stop
requires a smaller position. Stop distance should come from structure and
volatility; position size should then be calculated from the risk budget.

The channel's beginner template uses:

- risk per trade: `0.8%` of equity;
- maximum daily loss: `2.4%`;
- stop trading after the daily limit.

These are templates, not universal optimal values. Fees, slippage, funding, and
gap risk must be included.

Source: message `3746`, 2025-07-26.

### 7. Enter and Exit in Parts

Phased execution is one of the most consistent ideas in the archive.

Entry:

- define an entry area rather than one exact price;
- divide size into several orders;
- do not keep adding beyond the invalidation side of the level;
- add only when new information improves the trade, such as a confirmed hold.

Exit:

- take the first partial at a nearby objective;
- reduce or remove downside after progress is confirmed;
- take more profit at control points;
- trail a final portion while the structure remains intact.

The archive contains different percentage ladders for calm setups and pumps.
They should not be mixed. Targets and trailing distance must be scaled to the
asset's current volatility.

Sources: messages `393`, `2674`, `33657`, `39269`.

### 8. The Exit Algorithm Often Creates More Edge Than the Entry

Repeated failure mode: a trader identifies the move correctly but gives the
profit back.

The channel's recurring solution:

- place profit-taking orders before the fast move;
- move the stop closer only after meaningful progress;
- take partial profit rather than making an all-or-nothing decision;
- keep a runner only while the phase and structure remain valid;
- exit when the phase breaks, not when hope finally disappears.

Moving immediately to breakeven can also be too aggressive. Several reviews
show good trades being stopped before continuation. Breakeven should follow a
defined event, not anxiety.

Sources: messages `2672`, `2673`, `2677`, `29604`, `40089`.

### 9. Slippage and Terminal Behavior Are Part of the Strategy

In high volatility, market-executed stops, take-profits, and conditional orders
may fill far from their trigger. Limit orders offer price control but no fill
guarantee.

Operational lessons from the archive:

- assume stops can slip in fast markets;
- reduce size when volatility expands;
- check for residual positions after partial closing;
- verify that closing a remainder did not open an opposite position;
- cancel stale limit orders at the end of the session;
- have a tested emergency close/cancel action;
- do not trade when the exchange or terminal connection is unstable.

Source: messages `393`, `38148`, `4976`.

### 10. A Planned Stop Is Not a Failed Trade

Some of the best reviews explicitly describe a loss as correctly executed:
the setup failed, the planned stop was taken, and no rule was broken.

The damaging behavior is immediate emotional re-entry. The archive strongly
recommends a pause after a stop, especially when the trader is trying to win the
loss back.

Sources: messages `31686`, `37344`, `19332`.

### 11. Fatigue Is a Trading Variable

Several reviews show decision quality deteriorating after long monitoring,
trading while working, or continuing after concentration was gone.

Useful rules inferred from those examples:

- define a maximum session duration;
- stop when attention degrades;
- do not turn a scalp into an overnight position because you are too tired to
  manage it;
- after one or two emotionally intense trades, take a break;
- reduce complexity when you cannot watch the position continuously.

Sources: messages `2673`, `31578`, `39537`, `40338`.

### 12. Journaling Corrects Memory Bias

The archive's best review format records:

- chart with the relevant level or trend;
- setup and reason for entry;
- entry area and actual fills;
- planned stop and targets;
- Bitcoin direction at entry;
- management decisions;
- result in both price movement and account impact;
- rule followed or broken;
- screenshot from the trading journal.

One participant's key observation was that memory misrepresented which setups
worked; statistics showed that only a small subset of structures produced the
best results.

Sources: messages `22294`, `31614`.

## The Setups Worth Testing

These are the most coherent setup families in the export:

1. **Trend continuation**
   Enter near a defined trend structure, with room to the next level and
   Bitcoin aligned or at least not strongly opposing.

2. **Breakout with consolidation**
   Wait for a level to break and price to hold beyond it. Use the consolidation
   boundary as part of the invalidation logic.

3. **Rejection from a major level**
   Prefer confirmation from actual market activity, not a visible order-book
   wall alone. Walls can be cancelled.

4. **Phase reversal after a trend break**
   Do not reverse solely because a line broke. Look for changed behavior,
   acceptance, or a new structure.

5. **Active pump/dump momentum**
   Trade in the direction of expansion, use smaller size and wider structural
   tolerance, pre-place exits, and expect severe slippage.

## A Compact Pre-Trade Checklist

- What phase is the asset in?
- What exact structure am I trading?
- Is this entry near the invalidation point, or am I chasing?
- Where is the next meaningful obstacle?
- Is there enough room after fees and slippage?
- What is Bitcoin doing right now?
- Are volume, transaction activity, and volatility suitable?
- Is the move confirmed, or am I predicting a breakout?
- What monetary amount will I lose at the stop?
- How many entry parts will I use?
- Where are the partial exits?
- What event moves the stop?
- What event invalidates the trade immediately?
- Am I calm, attentive, and able to manage the position?

## What Should Not Be Accepted at Face Value

The export contains useful process knowledge, but also substantial noise and
risk:

- Profit screenshots are not audited performance.
- A label such as `32% movement` does not mean a 32% account gain.
- Charts selected after a successful move create survivorship and hindsight
  bias.
- Claims of guaranteed success or exceptional returns are marketing, not
  evidence.
- Examples using the full deposit, extreme leverage, or very wide stops should
  not be copied without an independently tested risk model.
- `A false breakout strengthens the level` is a heuristic, not a law.
- Visible order-book density may be spoofed or cancelled.
- Exact exit percentages conflict across setups because volatility differs.
- A single successful trade does not validate a strategy.

The material should be converted into explicit, backtestable hypotheses before
it influences automated signals or real capital.

## Useful Features for This Screener

The archive suggests the following high-value signals:

- market phase classification: accumulation, expansion, exhaustion, reversal;
- trend persistence on `15m`;
- distance to major `1h` levels and round numbers;
- compression or repeated approaches into a level;
- breakout followed by acceptance/consolidation;
- current Bitcoin direction and rolling short-horizon correlation;
- 24-hour volume, transaction count, and sudden activity expansion;
- current volatility relative to recent volatility;
- order-book density near the setup, treated as confirmation only;
- available price travel to the next obstacle;
- expected slippage and liquidity-adjusted position limits;
- phase-break alerts for trailing-stop management.

## Representative Source Index

| Message | Date | Main idea |
|---:|---|---|
| 393 | 2024-11-25 | Multi-timeframe workflow; phased entry and exit |
| 1604 | 2025-05-31 | Avoid countertrend entries during pumps/dumps |
| 2672-2677 | 2025-07-08 | Profit protection, consolidation, and stop management |
| 3746 | 2025-07-26 | Fixed monetary risk and volatility-adjusted size |
| 12623 | 2025-09-22 | Structure plus Bitcoin confirmation |
| 15585 | 2025-10-07 | Wait for control at a contested level |
| 19331-19332 | 2025-10-18 | Do not pre-empt breakouts or revenge re-enter |
| 22294 | 2025-10-30 | Recommended trade-journal format |
| 29018 | 2025-12-09 | Breakout/consolidation with phased management |
| 31414 | 2026-01-17 | Round-number breakout and partial entry |
| 31614 | 2026-01-19 | Statistics correcting memory bias |
| 33657 | 2026-02-05 | Partial-profit ladder and runner |
| 37626 | 2026-03-25 | Hope and expectation as emotional failure modes |
| 38148 | 2026-04-06 | Slippage and execution hazards |
| 39537 | 2026-05-10 | Long-duration management and fatigue |
| 40158 | 2026-05-29 | Active-phase momentum and phased unloading |

Representative chart files:

- [Round-number breakout](/Users/aleksandr/Downloads/Telegram%20Desktop/ChatExport_2026-06-11/photos/photo_5652@17-01-2026_15-05-19.jpg)
- [Active pump execution](/Users/aleksandr/Downloads/Telegram%20Desktop/ChatExport_2026-06-11/photos/photo_7393@29-05-2026_09-23-46.jpg)
- [Breakout with consolidation](/Users/aleksandr/Downloads/Telegram%20Desktop/ChatExport_2026-06-11/photos/photo_7257@10-05-2026_12-37-50.jpg)
- [High-volatility execution example](/Users/aleksandr/Downloads/Telegram%20Desktop/ChatExport_2026-06-11/photos/photo_7025@06-04-2026_14-45-33.jpg)
