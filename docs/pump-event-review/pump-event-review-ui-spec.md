# Pump Event Review UI — Technical Specification

## 1. Purpose

Build a small internal web application for manually reviewing and classifying pump-like events detected by an existing crypto market screener.

The application must allow the user to:

1. Browse all historical events detected by the screener.
2. Open each event at the correct symbol and timestamp on a chart.
3. Assign one of six predefined categories.
4. Add an optional free-text comment.
5. Save the annotation.
6. Immediately move to the next unreviewed event.
7. Revisit and edit previously reviewed events.
8. Export the resulting labeled dataset for future AI analysis or model training.

This is a manual labeling tool. It is not an ML system and must not attempt to automatically classify events in the MVP.

---

## 2. Product Scope

### 2.1 In scope

- Event list.
- Single selected event review workspace.
- TradingView chart integration, or an equivalent chart implementation if TradingView embedding cannot reliably open historical timestamps.
- Six-category manual classification.
- Optional comment.
- Optional confidence field.
- Save and edit annotations.
- Keyboard-driven review workflow.
- Filtering and sorting.
- Review progress statistics.
- Export of labeled events as JSON and CSV.
- Preservation of detector metadata already produced by the screener.
- Clear indication of the screener detection timestamp.

### 2.2 Out of scope

Do not implement the following in the first version:

- AI classification.
- OpenAI or other LLM API integration.
- Machine learning training.
- RAG.
- Order book history.
- Open interest ingestion.
- Liquidation data ingestion.
- New pump detection logic.
- Automated trading.
- Backtesting.
- Complex role-based access control.
- Multi-user annotation consensus.
- Chart-image generation for every event.
- Automatic validation of whether a human label is correct.

The code should leave room for future AI annotations, but no AI functionality is required now.

---

## 3. Core User Workflow

The primary workflow must be optimized for fast sequential labeling.

1. The user opens the review page.
2. The application selects the first unreviewed event.
3. The chart opens at the event symbol and historical timestamp.
4. The detection timestamp is clearly marked.
5. The user reviews the chart.
6. The user selects a category using the mouse or keyboard keys `1` through `6`.
7. The user optionally enters a comment.
8. The user presses `Enter` or clicks **Save & Next**.
9. The annotation is saved.
10. The next unreviewed event opens automatically.

An obvious event should be labelable in a few seconds without repeatedly using the mouse.

---

## 4. Classification Taxonomy

Use exactly the following six categories in the MVP.

```ts
export type PumpCategory =
  | "sustained_move"
  | "wick_spike"
  | "volume_only"
  | "market_move"
  | "illiquid_noise"
  | "unclear";
```

### 4.1 `sustained_move`

A meaningful directional price move occurred.

Typical characteristics:

- Price moved materially upward.
- The move continued across multiple candles or phases.
- Price held above the initial level for a meaningful period.
- The event resembles the type of pump the screener is intended to detect.
- A later retracement does not invalidate the label if a real impulse occurred.

UI label:

> Sustained move

Keyboard shortcut:

> `1`

### 4.2 `wick_spike`

A brief upward price spike occurred without meaningful continuation.

Typical characteristics:

- One or a few candles moved sharply upward.
- Price quickly returned toward the pre-event level.
- The move was dominated by a wick or short-lived impulse.
- There was no sustained continuation.

UI label:

> Wick spike

Keyboard shortcut:

> `2`

### 4.3 `volume_only`

Trading activity increased, but the price did not produce a meaningful directional move.

Typical characteristics:

- Abnormal volume or trade activity.
- Price remained inside a range.
- No meaningful breakout or continuation.
- Buyers and sellers may have absorbed each other.

UI label:

> Volume only

Keyboard shortcut:

> `3`

### 4.4 `market_move`

The symbol moved, but the move appeared to be part of a broader market or sector move rather than an independent pump.

Typical characteristics:

- BTC, ETH, or many altcoins moved at the same time.
- The symbol broadly followed the market.
- The move was not meaningfully idiosyncratic.

UI label:

> Market move

Keyboard shortcut:

> `4`

The application does not need to prove this classification automatically. This is a manual judgment.

### 4.5 `illiquid_noise`

The event appears to be caused by poor liquidity, sparse trading, bad data, or an effectively untradeable market.

Typical characteristics:

- Very sparse candles or trades.
- Large candles caused by small absolute volume.
- Large spread or discontinuous price action.
- Data gaps or suspicious market data.
- A move that would be impractical to trade.

UI label:

> Illiquid noise

Keyboard shortcut:

> `5`

### 4.6 `unclear`

The event cannot be confidently assigned to another category.

Typical characteristics:

- Ambiguous chart structure.
- Insufficient data.
- Multiple categories appear equally plausible.
- The reviewer wants to revisit the event later.

UI label:

> Unclear

Keyboard shortcut:

> `6`

Do not force ambiguous events into another category.

---

## 5. Confidence

Confidence is recommended but may be implemented as a small optional field.

```ts
export type AnnotationConfidence = "high" | "medium" | "low";
```

Suggested UI:

- High
- Medium
- Low

Default:

```text
high
```

The confidence field must not block saving.

If implementing confidence significantly delays the MVP, it may be omitted initially as long as the database schema can be extended later.

---

## 6. Main Page Layout

Use a desktop-first three-column layout.

```text
┌────────────────────┬─────────────────────────────────┬──────────────────────┐
│ Event list         │ Chart and event context         │ Annotation panel     │
│                    │                                 │                      │
│ Filters            │ Symbol                          │ Category buttons     │
│ Progress           │ Exchange                        │ Confidence            │
│                    │ Detected timestamp              │ Comment               │
│ Event rows         │                                 │                      │
│                    │ Historical chart                │ Save                  │
│                    │                                 │ Save & Next           │
└────────────────────┴─────────────────────────────────┴──────────────────────┘
```

Suggested widths:

- Event list: `280–360px`
- Chart area: flexible
- Annotation panel: `300–380px`

Minimum supported desktop viewport:

```text
1280 × 720
```

A basic responsive mode is welcome, but mobile support is not required.

---

## 7. Event List

### 7.1 Row contents

Each event row should display:

- Symbol.
- Exchange.
- Detection date and time.
- Review status.
- Current category, if reviewed.
- Optional detector score or trigger summary, if available.

Example:

```text
FUELUSDT
Bybit · 2026-07-12 14:32 UTC
Reviewed · Wick spike
```

### 7.2 Review status

Use three statuses:

```ts
export type ReviewStatus =
  | "unreviewed"
  | "reviewed"
  | "unclear";
```

Rules:

- No human annotation: `unreviewed`.
- Human annotation with a category other than `unclear`: `reviewed`.
- Human annotation with category `unclear`: `unclear`.

### 7.3 Selected event

The selected row must be visually distinct.

When the selected event changes:

- Load the event details.
- Load any existing annotation.
- Update the chart.
- Do not lose unsaved changes without warning.

### 7.4 Pagination or virtualization

If the dataset contains hundreds or thousands of events, use one of:

- Server-side pagination.
- Infinite scrolling.
- List virtualization.

Do not render hundreds of chart widgets at once. Only the selected event should render a full chart.

---

## 8. Filters and Sorting

### 8.1 Required filters

- Review status:
  - All
  - Unreviewed
  - Reviewed
  - Unclear
- Category.
- Exchange.
- Symbol search.
- Date range.
- Detector version, if available.

### 8.2 Required sorting

- Detection time descending.
- Detection time ascending.
- Unreviewed first.
- Symbol alphabetically.

Default view:

```text
Status: Unreviewed
Sort: Detection time descending
```

The application should preserve filters in the URL query string where practical.

Example:

```text
/review?status=unreviewed&exchange=bybit&sort=detectedAtDesc
```

---

## 9. Review Progress

Display a compact progress summary near the event list.

Required values:

- Total events.
- Reviewed events.
- Unreviewed events.
- Unclear events.
- Percentage reviewed.

Example:

```text
213 / 684 reviewed — 31%
```

Optionally display category counts.

```json
{
  "sustained_move": 61,
  "wick_spike": 48,
  "volume_only": 55,
  "market_move": 17,
  "illiquid_noise": 22,
  "unclear": 10
}
```

---

## 10. Event Header

Above the chart, display:

- Symbol.
- Exchange.
- Market type, if known.
- Detection timestamp.
- Detector version.
- Event ID.
- Any trigger values already stored by the screener.

Example:

```text
FUELUSDT · Bybit Linear
Detected: 2026-07-12 14:32:00 UTC
Detector version: 0.4.1
```

All internal timestamps must be stored in UTC.

The UI may optionally show both UTC and the browser's local time, but UTC must always remain visible.

---

## 11. Chart Requirements

### 11.1 Preferred behavior

The chart must:

- Open the correct symbol.
- Open around the historical detection timestamp.
- Default to a five-minute timeframe because it has substantially better local coverage.
- Allow switching between one-minute and five-minute timeframes.
- Display sufficient pre-event and post-event context.
- Clearly mark the screener detection timestamp.

Recommended default visible window:

```text
2 hours before detection
2 hours after detection
```

### 11.2 Required markers

Display a vertical marker at:

```text
detectedAt
```

Recommended additional markers:

```text
detectedAt + 5 minutes
detectedAt + 10 minutes
detectedAt + 15 minutes
```

Suggested marker labels:

- Detection
- +5m
- +10m
- +15m

The detection marker must be visually stronger than the later markers.

### 11.3 Chart implementation options

Use one of the following approaches.

#### Option A: Existing TradingView integration

Use this only if the current application already has a reliable TradingView integration that can:

- Open a symbol programmatically.
- Set a timeframe programmatically.
- Navigate to a historical timestamp.
- Keep chart state stable when switching events.

#### Option B: Lightweight Charts or equivalent

Use an internally rendered OHLCV chart when TradingView embedding cannot reliably navigate to historical timestamps.

This option should:

- Load candles from the application's backend.
- Display price candles and volume.
- Support one-minute and five-minute intervals.
- Draw the required event markers.
- Keep chart behavior deterministic.

The implementation should prefer reliable review behavior over visual similarity to the full TradingView terminal.

### 11.4 Loading and error states

Show clear states for:

- Chart loading.
- Missing candle data.
- Unsupported symbol.
- Exchange API failure.
- Empty historical range.

A chart failure must not prevent the user from assigning `unclear` or adding a comment.

---

## 12. Annotation Panel

### 12.1 Category controls

Display all six categories as large selectable buttons or radio-card controls.

Each option must show:

- Keyboard number.
- Short label.
- Optional one-line hint.

Example:

```text
[1] Sustained move
[2] Wick spike
[3] Volume only
[4] Market move
[5] Illiquid noise
[6] Unclear
```

The selected category must be clearly highlighted.

### 12.2 Comment

Provide an optional multi-line text field.

Label:

```text
Comment
```

Placeholder:

```text
What happened? Why was this a good or bad detection?
```

The comment should support at least several hundred characters.

Do not require a comment for ordinary labels.

A comment is recommended for:

- `unclear`
- unusual false positives
- bad market data
- late detection
- observations that may help improve the screener logic

### 12.3 Save actions

Provide:

- **Save**
- **Save & Next**

Behavior:

#### Save

- Validate the selected category.
- Save the annotation.
- Stay on the same event.
- Show a small success indicator.

#### Save & Next

- Validate the selected category.
- Save the annotation.
- Select the next event matching the current filters.
- Prefer the next unreviewed event.

If no next event exists, show:

```text
No more matching events.
```

---

## 13. Keyboard Shortcuts

Keyboard support is required.

| Key | Action |
|---|---|
| `1` | Select `sustained_move` |
| `2` | Select `wick_spike` |
| `3` | Select `volume_only` |
| `4` | Select `market_move` |
| `5` | Select `illiquid_noise` |
| `6` | Select `unclear` |
| `Enter` | Save and open next event |
| `Ctrl+Enter` or `Cmd+Enter` | Save and stay |
| `J` or `ArrowDown` | Select next event |
| `K` or `ArrowUp` | Select previous event |
| `C` | Focus the comment field |
| `Escape` | Remove focus from the comment field or close a dialog |

Rules:

- Number shortcuts must not fire while the user is typing in an input or textarea.
- `Enter` inside the comment textarea must create a new line.
- Use `Ctrl+Enter` or `Cmd+Enter` to save while the textarea is focused.
- Display the shortcuts in a small help popover.

---

## 14. Unsaved Changes

Track whether the current form differs from the last saved annotation.

When the user tries to switch events with unsaved changes:

- Show a small confirmation dialog.
- Options:
  - Save and continue.
  - Discard changes.
  - Cancel.

Do not silently discard comments or changed categories.

After a successful save, reset the dirty state.

---

## 15. Data Model

Adapt the schema to the existing database and codebase. Do not migrate to a new database solely for this feature.

### 15.1 Pump event

```ts
export interface PumpEvent {
  id: string;

  exchange: string;
  marketType?: string;
  symbol: string;

  detectedAt: string; // ISO 8601 UTC timestamp
  detectorVersion?: string;
  detectorScore?: number;

  triggerData?: Record<string, unknown>;

  createdAt: string;
  updatedAt?: string;
}
```

### 15.2 Annotation

Store annotations separately from events.

```ts
export interface PumpAnnotation {
  id: string;
  eventId: string;

  source: "human" | "ai";
  category: PumpCategory;
  confidence?: AnnotationConfidence;
  comment?: string;

  createdAt: string;
  updatedAt: string;
}
```

For the MVP:

```text
source = "human"
```

The `source` field exists to support future AI annotations without overwriting human labels.

### 15.3 Uniqueness

For the MVP, allow one current human annotation per event.

Recommended unique constraint:

```text
UNIQUE(event_id, source)
```

If annotation history is desired, keep a revision table or audit log rather than creating ambiguous duplicate current annotations.

### 15.4 Audit fields

Recommended optional fields:

```ts
reviewerId?: string;
revision?: number;
```

A hard-coded single reviewer is acceptable for the first version.

---

## 16. Suggested SQL Schema

Adjust syntax to the database already used by the project.

```sql
CREATE TABLE pump_annotations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'human',
  category TEXT NOT NULL,
  confidence TEXT,
  comment TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,

  CONSTRAINT pump_annotations_event_source_unique
    UNIQUE (event_id, source)
);
```

Validate `category` in application code or with a database constraint.

Allowed values:

```text
sustained_move
wick_spike
volume_only
market_move
illiquid_noise
unclear
```

Allowed confidence values:

```text
high
medium
low
```

---

## 17. Backend API

Follow the project's existing API style. The following endpoints describe required behavior, not mandatory URL names.

### 17.1 List events

```http
GET /api/pump-events
```

Supported query parameters:

```text
status
category
exchange
symbol
dateFrom
dateTo
detectorVersion
sort
page
pageSize
```

Example:

```http
GET /api/pump-events?status=unreviewed&sort=detectedAtDesc&page=1&pageSize=50
```

Suggested response:

```json
{
  "items": [
    {
      "id": "bybit-FUELUSDT-2026-07-12T14:32:00Z",
      "exchange": "bybit",
      "marketType": "linear",
      "symbol": "FUELUSDT",
      "detectedAt": "2026-07-12T14:32:00Z",
      "detectorVersion": "0.4.1",
      "detectorScore": 0.81,
      "triggerData": {
        "volumeMultiplier": 9.6
      },
      "annotation": null
    }
  ],
  "page": 1,
  "pageSize": 50,
  "total": 684
}
```

### 17.2 Get event details

```http
GET /api/pump-events/:eventId
```

Response should include:

- Event metadata.
- Trigger data.
- Existing human annotation.
- Chart data references or candle endpoint parameters.

### 17.3 Create or update annotation

```http
PUT /api/pump-events/:eventId/annotation
```

Request:

```json
{
  "category": "wick_spike",
  "confidence": "high",
  "comment": "One-minute spike with an almost complete retracement."
}
```

Behavior:

- Create the annotation if it does not exist.
- Update it if it already exists.
- Set `source` to `human`.
- Update `updatedAt`.
- Return the saved annotation.

### 17.4 Get progress statistics

```http
GET /api/pump-events/stats
```

Suggested response:

```json
{
  "total": 684,
  "reviewed": 203,
  "unreviewed": 471,
  "unclear": 10,
  "reviewedPercentage": 31.1,
  "categories": {
    "sustained_move": 61,
    "wick_spike": 48,
    "volume_only": 55,
    "market_move": 17,
    "illiquid_noise": 22,
    "unclear": 10
  }
}
```

### 17.5 Get candles

Only required when using an internally rendered chart.

```http
GET /api/market-data/candles
```

Parameters:

```text
exchange
symbol
interval
from
to
```

Example:

```http
GET /api/market-data/candles?exchange=bybit&symbol=FUELUSDT&interval=1m&from=...&to=...
```

Response:

```json
{
  "items": [
    {
      "time": 1783866600,
      "open": 0.0121,
      "high": 0.0128,
      "low": 0.0120,
      "close": 0.0126,
      "volume": 125000
    }
  ]
}
```

Use Unix timestamps in a format expected by the selected chart library.

---

## 18. Export

Provide an export action for the currently filtered dataset and for the complete dataset.

Required formats:

- JSON
- CSV

### 18.1 JSON export

Suggested shape:

```json
[
  {
    "eventId": "bybit-FUELUSDT-2026-07-12T14:32:00Z",
    "exchange": "bybit",
    "marketType": "linear",
    "symbol": "FUELUSDT",
    "detectedAt": "2026-07-12T14:32:00Z",
    "detectorVersion": "0.4.1",
    "detectorScore": 0.81,
    "triggerData": {
      "volumeMultiplier": 9.6
    },
    "humanAnnotation": {
      "category": "wick_spike",
      "confidence": "high",
      "comment": "One-minute spike with an almost complete retracement.",
      "updatedAt": "2026-08-04T14:20:00Z"
    }
  }
]
```

### 18.2 CSV export

Flatten nested fields where practical.

Required columns:

```text
event_id
exchange
market_type
symbol
detected_at
detector_version
detector_score
category
confidence
comment
annotation_updated_at
```

`triggerData` may be exported as a JSON string in one column or flattened if the schema is stable.

---

## 19. Error Handling

Handle the following cases:

- Failed event list request.
- Failed annotation save.
- Failed chart load.
- Missing historical candles.
- Invalid category.
- Event no longer exists.
- Duplicate save request.
- Network interruption.

Requirements:

- Do not clear unsaved form values after a failed save.
- Show a clear retry action.
- Disable duplicate submission while a save is in progress.
- Use optimistic UI only if failure rollback is implemented correctly.
- Prefer a simple confirmed save over a fragile optimistic implementation.

---

## 20. Loading States

Required loading states:

- Initial event list loading.
- Event details loading.
- Chart loading.
- Annotation saving.
- Export generation.

Do not block the entire page when only the chart is loading.

---

## 21. Accessibility and UX

- All category controls must be keyboard accessible.
- Use visible focus states.
- Use semantic buttons and form controls.
- Do not rely only on color to indicate category or review status.
- Keep labels concise and readable.
- Use tooltips for category definitions.
- Preserve scroll position in the event list when moving between events.
- After **Save & Next**, focus should remain suitable for keyboard classification.
- Avoid modal dialogs except for unsaved changes or destructive actions.

---

## 22. Performance Requirements

For a dataset of at least 1,000 events:

- The initial event list should remain responsive.
- Only the selected chart should be mounted.
- Switching events should not reload the entire page.
- Filters should respond without noticeable UI freezing.
- Annotation save should not require a full list refresh.
- Cache recently loaded event details and chart data where reasonable.

Do not prematurely build distributed infrastructure. A normal application database and API are sufficient.

---

## 23. Security

This is an internal tool.

Minimum acceptable options:

- Existing application authentication, if already available.
- A simple environment-configured password or basic auth for a private deployment.
- Network-level restriction for a local-only deployment.

Do not expose annotation or market-data mutation endpoints publicly without authentication.

Do not store API secrets in frontend code.

---

## 24. Future Compatibility

The architecture should make the following future additions possible without changing the human annotation format:

- AI-generated annotations.
- Human-versus-AI comparison.
- Multiple AI model versions.
- Screenshot generation.
- AI analysis of false-positive groups.
- Model training.
- Additional market data.
- Multiple human reviewers.
- Annotation history.
- Detector version comparison.

Future AI annotations should be stored separately:

```ts
{
  source: "ai",
  category: "volume_only",
  confidence: "medium",
  comment: "The price response was weak relative to the volume anomaly."
}
```

Human annotations must always remain independently accessible and must not be overwritten by AI output.

---

## 25. Implementation Guidance for Codex

1. Inspect the existing repository before choosing frameworks or database libraries.
2. Reuse the existing frontend framework, routing, styling system, API conventions, database, and authentication.
3. Do not introduce a new framework solely for this page.
4. Find the existing pump event storage format and map it into the `PumpEvent` interface.
5. Preserve all existing event fields, even if the UI does not initially display them.
6. Add a separate annotation table or collection.
7. Implement the review workflow end to end before adding optional visual polish.
8. Prefer a reliable chart implementation over a visually sophisticated but difficult-to-control TradingView embed.
9. Add database migrations according to the repository's existing migration system.
10. Add tests for category validation, annotation updates, filtering, and keyboard workflow.
11. Document local setup and any required market-data configuration.
12. Do not add AI dependencies in this task.

---

## 26. Suggested Delivery Phases

### Phase 1 — Functional review MVP

Implement:

- Event list.
- Event selection.
- One chart.
- Six categories.
- Comment.
- Save.
- Save & Next.
- Existing annotation editing.

### Phase 2 — Fast labeling workflow

Implement:

- Keyboard shortcuts.
- Filters.
- Progress statistics.
- Unsaved-change protection.
- Previous and next navigation.

### Phase 3 — Dataset management

Implement:

- JSON export.
- CSV export.
- Category counts.
- Detector-version filter.
- Optional confidence.

### Phase 4 — Polish

Implement:

- Better loading states.
- Error recovery.
- Category tooltips.
- URL-persisted filters.
- Recently loaded event caching.
- Basic responsive behavior.

---

## 27. Acceptance Criteria

The task is complete when all of the following are true.

### Event browsing

- The user can see all historical screener events.
- The user can filter unreviewed and reviewed events.
- The user can select an event without reloading the page.
- The currently selected event is clearly visible in the list.

### Chart

- The selected symbol is shown.
- The chart opens around the event's historical detection time.
- The user can view one-minute and five-minute timeframes.
- The exact detection timestamp is visibly marked.
- A chart error does not block annotation.

### Annotation

- The user can select exactly one of the six categories.
- The user can add an optional comment.
- The user can save a new annotation.
- The user can edit an existing annotation.
- Human annotations are stored separately from pump events.
- Saving does not overwrite event metadata.

### Fast workflow

- Keys `1–6` select categories.
- `Enter` saves and opens the next event when the comment field is not focused.
- The user can label consecutive events without repeatedly using the mouse.
- Unsaved changes are not silently discarded.

### Filters and progress

- The user can filter by review status.
- The user can search by symbol.
- The user can filter by date and exchange.
- The user can see total and reviewed counts.

### Export

- The user can export reviewed data as JSON.
- The user can export reviewed data as CSV.
- Exported rows include event metadata, category, comment, confidence if present, and annotation timestamps.

### Code quality

- The implementation follows the repository's existing architecture.
- Category values are centrally defined and validated.
- No AI integration is added.
- No unnecessary infrastructure is introduced.
- Basic tests cover annotation creation, annotation editing, and filtering.

---

## 28. MVP Definition of Done

The smallest acceptable first release is:

```text
Event list
+ selected historical chart
+ detection-time marker
+ six category controls
+ optional comment
+ Save & Next
+ persistent annotation storage
```

Everything else may be delivered incrementally, but the initial data model must not prevent later exports or AI annotations.
