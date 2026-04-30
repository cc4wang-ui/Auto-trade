# mikai YouTube Channels — Internal Analytics Dashboard

**Operator**: mikai Inc., a wholly-owned subsidiary of 17LIVE Inc.
**Audience**: ~10 internal employees (content production, talent management, finance)
**Platform**: Google Connected Sheets on top of Google Cloud BigQuery
**Refresh**: Daily 09:00 JST (scheduled) + on-demand
**Access**: View-only, restricted via Google Workspace SSO. No external sharing.

---

## Tab 1 — Overview

> All 50 managed channels ranked by recent performance. Used by leadership for portfolio review.

| Rank | Channel | Manager Group | Views 7d | Views 30d | Views 90d | Likes 30d | Comments 30d | Revenue 30d (USD) |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | Channel A | Manzoku | 3,210,400 | 14,150,200 | 41,520,800 | 580,400 | 92,100 | $12,420 |
| 2 | Channel B | Heimao | 2,890,000 | 12,800,000 | 38,200,000 | 510,000 | 84,300 | $10,940 |
| 3 | Channel C | Nagai | 2,440,500 | 11,100,000 | 32,800,000 | 470,200 | 78,500 | $9,820 |
| 4 | Channel D | Kamata | 2,210,000 | 10,200,000 | 29,400,000 | 420,000 | 71,000 | $8,910 |
| 5 | Channel E | Manzoku | 1,980,400 | 9,150,000 | 27,300,000 | 380,000 | 64,800 | $8,200 |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |
| 50 | Channel AX | Graduated | 41,200 | 180,400 | 580,200 | 7,800 | 1,400 | $128 |

Conditional formatting: top-quartile values highlighted green; bottom-quartile red.
Filter row: Manager Group, Channel Type (main / collab / graduated), Active (yes / no).

---

## Tab 2 — Per-Manager

> Nine talent-management groups with aggregated metrics + per-talent comparison.

### Group totals

| Manager Group | Talents | Views 30d | Likes 30d | Comments 30d | Revenue 30d (USD) | Avg viewers / talent |
|---|---:|---:|---:|---:|---:|---:|
| Manzoku   | 7 | 48,200,000 | 1,810,000 | 312,000 | $42,800 | 6,885,714 |
| Heimao    | 6 | 38,500,000 | 1,420,000 | 248,500 | $34,200 | 6,416,667 |
| Nagai     | 6 | 31,200,000 | 1,180,000 | 198,000 | $28,400 | 5,200,000 |
| Kamata    | 5 | 26,400,000 |   980,400 | 168,500 | $23,800 | 5,280,000 |
| Takaichi  | 4 | 18,200,000 |   720,200 | 124,000 | $16,400 | 4,550,000 |
| Official  | 4 | 15,400,000 |   610,000 | 102,400 | $14,200 | 3,850,000 |
| Franky    | 4 | 12,800,000 |   480,200 |  84,000 | $11,400 | 3,200,000 |
| Shiratori | 3 |  9,200,000 |   348,000 |  62,400 | $ 8,400 | 3,066,667 |
| Katabami  | 3 |  7,400,000 |   281,000 |  48,800 | $ 6,800 | 2,466,667 |

### Within-group comparison (example: Manzoku)

| Talent | Views 30d | Δ vs prev 30d | Likes / view | Comments / view | Revenue 30d |
|---|---:|---:|---:|---:|---:|
| Talent M1 | 14,150,200 | +12.4% | 4.10% | 0.65% | $12,420 |
| Talent M2 |  9,150,000 |  -3.2% | 4.15% | 0.71% | $ 8,200 |
| Talent M3 |  7,820,400 |  +8.1% | 3.92% | 0.68% | $ 6,820 |
| Talent M4 |  5,400,000 | +21.0% | 4.20% | 0.74% | $ 4,910 |
| Talent M5 |  4,800,200 |  +5.4% | 3.85% | 0.62% | $ 4,180 |
| Talent M6 |  4,200,000 |  -1.8% | 4.05% | 0.69% | $ 3,640 |
| Talent M7 |  2,680,200 | +14.2% | 4.30% | 0.78% | $ 2,640 |

---

## Tab 3 — Per-Talent (drill-down)

> Single-channel 90-day daily time series + top videos. Selected via dropdown at top.

**Selected channel**: Channel A (Manzoku group)
**Channel ID**: UCxxxxxxxxxxxxxxxxxxxx
**Selection control**: dropdown linked to dim_talent

### Channel-level daily series (last 90 days, abbreviated)

| Date | Views | Unique Viewers | Watch Hours | Avg View Duration | Subs +/- | Revenue (USD) | Ad Revenue (USD) | CPM (USD) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-04-29 | 142,400 | 98,200 | 8,420 | 213s | +482 | $612 | $548 | $4.12 |
| 2026-04-28 | 138,000 | 95,400 | 8,140 | 209s | +410 | $588 | $524 | $4.05 |
| 2026-04-27 | 140,200 | 96,800 | 8,300 | 211s | +445 | $602 | $538 | $4.10 |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

### Top 10 videos (last 30 days, by views)

| Rank | Title | Published | Views | Likes | Comments | Comment Velocity (24h) |
|---:|---|---|---:|---:|---:|---:|
| 1 | Video title example 1 | 2026-04-12 | 1,420,000 | 58,400 | 12,400 | 102 / hr |
| 2 | Video title example 2 | 2026-04-18 | 1,180,000 | 51,200 | 10,800 |  84 / hr |
| 3 | Video title example 3 | 2026-04-05 |   980,400 | 42,800 |  9,200 |  68 / hr |
| ... | ... | ... | ... | ... | ... | ... |

### Top 10 videos (last 30 days, by comment velocity)

| Rank | Title | Published | Comment Velocity (24h) | Total Comments | Views |
|---:|---|---|---:|---:|---:|
| 1 | Video title example 9 | 2026-04-26 | 248 / hr | 5,950 | 312,000 |
| 2 | Video title example 1 | 2026-04-12 | 102 / hr | 12,400 | 1,420,000 |
| ... | ... | ... | ... | ... | ... |

---

## Tab 4 — Live Watch

> Channels currently broadcasting. Refreshed every 5 minutes during work hours.

| Channel | Manager | Stream Title | Started | Concurrent Viewers | Peak Concurrent (this stream) | Likes (this stream) |
|---|---|---|---|---:|---:|---:|
| Channel A | Manzoku | "Friday night chat" | 21:02 JST | 4,820 | 6,140 | 18,400 |
| Channel L | Nagai | "Apex ranked grind" | 20:45 JST | 2,140 | 2,580 |  9,820 |
| Channel R | Heimao | "Karaoke request" | 21:14 JST | 1,680 | 1,680 |  4,200 |

**Historical concurrent peaks** are captured during each broadcast (5-minute polling) and persisted to BigQuery, since they are not retrievable post-broadcast via the Data API.

Bottom of tab: stacked area chart of concurrent-viewer counts across all currently-live channels (last 6 hours).

---

## Tab 5 — Tag Insights

> Internal NLP step derives 1-5 tags per video from title + description and stores them in BigQuery alongside the metric data. Used for content-mix planning.

### Tag distribution across all 50 channels (last 30 days)

| Tag | Videos | Total Views | Avg Views / Video | Avg Comments / Video |
|---|---:|---:|---:|---:|
| gaming         | 1,240 | 28,400,000 | 22,903 | 384 |
| talk-show      |   980 | 18,200,000 | 18,571 | 312 |
| music          |   520 | 14,800,000 | 28,461 | 410 |
| collab         |   420 | 12,400,000 | 29,523 | 458 |
| asmr           |   280 |  6,200,000 | 22,142 | 248 |
| announcement   |   210 |  4,800,000 | 22,857 | 524 |
| short-form     |   840 |  9,200,000 | 10,952 | 142 |
| tutorial       |   180 |  3,400,000 | 18,888 | 210 |
| ...            |   ... |    ...     | ...    | ... |

### Per-talent tag mix (example: Channel A, Manzoku group)

| Tag | Videos last 30d | Share of channel views |
|---|---:|---:|
| gaming     | 18 | 42% |
| talk-show  | 12 | 28% |
| collab     |  6 | 18% |
| announcement | 4 |  8% |
| short-form |  9 |  4% |

---

## Data flow summary

```
YouTube Data API v3 ──┐
YouTube Analytics API ┼─► BigQuery (raw layer, append-only snapshots)
                      │       │
                      │       ▼ scheduled queries (daily 04:00-05:00 UTC)
                      │   BigQuery (mart layer, deduplicated KPIs)
                      │       │
                      │       ▼ Connected Sheets refresh (daily 09:00 JST)
                      └─► Google Sheet (this workbook, view-only,
                                          ~10 internal employees)
```

All compute and storage stays inside the 17LIVE Google Cloud organisation. The Connected Sheets workbook is the only presentation surface, and it is shared via Google Workspace SSO with named internal employees only.
