# YouTube ETL (17LIVE / mikai)

> **Note**: this scaffold lives in the `cc4wang-ui/auto-trade` repo on branch
> `claude/youtube-etl-review-i4TIH` as a **staging area**. **Cross is the active builder**
> (Cross + Claude Code as pair); see `docs/handoff/decisions.md` D-001. Migrate to a
> 17LIVE-internal repository before production deploy.

Re-architected on top of 宮前 san's GCP design + TikTok PoC. See plan at
`/root/.claude/plans/youtube-etl-lexical-bonbon.md` for the full strategy.

## Layout

```
youtube-etl/
├── README.md                         ← you are here
├── data/
│   └── channels.csv                  ← 50 talent channels, seed for dim_talent
├── sql/
│   ├── ddl/
│   │   ├── 01_youtube_raw.sql        ← per-call snapshots + poll_state + quota_log
│   │   ├── 02_youtube_mart.sql       ← dim/fact tables + denormalized KPI tables
│   │   └── README.md
│   └── seed/
│       └── dim_talent_load.sql       ← MERGE channels.csv → dim_talent
├── ingest/                           ← Cloud Run service (Python 3.12)
│   ├── main.py                       ← Flask app, 4 endpoints
│   ├── handlers/
│   │   ├── daily.py                  ← /jobs/daily        (Cloud Scheduler 02:00 UTC)
│   │   ├── hourly.py                 ← /jobs/hourly       (Cloud Scheduler 0 * * * *)
│   │   ├── live_poll.py              ← /jobs/live-poll    (Cloud Scheduler */5 * * * *)
│   │   └── analytics.py              ← /jobs/analytics    (Cloud Scheduler 03:00 UTC)
│   ├── lib/
│   │   ├── config.py                 ← env-var dataclass
│   │   ├── secrets.py                ← OAuth refresh-token loader (mikai shared account)
│   │   ├── youtube_client.py         ← Data API wrapper + retry + quota log
│   │   ├── analytics_client.py       ← Analytics API wrapper
│   │   ├── quota_tracker.py          ← per-method unit cost table
│   │   ├── bq_writer.py              ← streaming inserts + MERGE upsert helper
│   │   └── transforms.py             ← API → BQ row pure functions
│   ├── Dockerfile
│   └── requirements.txt
└── docs/
    └── phase-0-ops-checklist.md      ← step-by-step deployment runbook (Cross + Claude pair)
```

## What this delivers (Phases 0-2 of the plan)

- ✅ BigQuery schema (raw + mart layers), idempotent DDL
- ✅ Channel list seeded into `dim_talent` (50 talents, 9 manager groups)
- ✅ Cloud Run ingest service with hybrid polling state machine
  - Daily full sweep → all 50 channels
  - Hourly delta polling → videos published in the last 48h
  - 5-min live polling → only videos currently broadcasting
  - Daily Analytics API pull → revenue + uniqueViewers (the metrics Data API can't give)
- ✅ Quota accounting in `quota_log` so we know exactly where units go
- ✅ OAuth via Secret Manager (mikai shared account → all 50 channels in one token)
- ✅ Phase 0 ops runbook (10 steps, 1 day of work + 1-2 weeks waiting on Google)

## What's NOT here yet (Phases 3-5)

- ⏳ Tagging pipeline (Claude API on title + description) → Phase 3
- ⏳ Mart layer SQL (the rollups: comment velocity, KPI tables) → end of Phase 2
- ⏳ Connected Sheets dashboard wiring → Phase 4
- ⏳ Booth / Event ingestion using the same `fact_content_*` schema → Phase 5

## Critical platform constraints (will not change)

1. **No viewer user_id from Data API** — privacy. `unique_commenters` is the only user-level dedup we get; reach metrics come from Analytics API as aggregate counts.
2. **Concurrent viewers only available during live** — historical concurrent peaks must be captured in real time via `live-poll`.
3. **YouTube quota raise required** — 50ch × hybrid polling = 15-30K units/day. Default 10K won't work; see Step 3 of `docs/phase-0-ops-checklist.md`.

## Local sanity check

```bash
cd youtube-etl/ingest
python3 -m py_compile main.py handlers/*.py lib/*.py
```

## Plan reference

Full architectural plan: `/root/.claude/plans/youtube-etl-lexical-bonbon.md`
