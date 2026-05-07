# mikai YouTube ETL — Handoff Archive (2026-05-04)

> Snapshot of the YouTube ETL project state at end of session 2026-05-04 UTC.
> For continuation in a new Claude conversation. Self-contained: read all
> files in this folder and you will have ~95% of context.

## What this is

mikai (17LIVE subsidiary, talent agency) operates ~50 YouTube channels owned
by individual talents. This pipeline pulls metadata + analytics into BigQuery,
exposes via Connected Sheets dashboard for talent managers.

- **GCP project**: `mikai-yt-data` (location US, project number 508645124315)
- **Repo**: `cc4wang-ui/auto-trade` branch `claude/youtube-etl-data-api-mode`
- **Active PR**: #14 (state=closed, not merged — branch lives past PR head with handoff commits)
- **User**: Cross Wang (`crosswang@17.media`), COO of mikai. **Non-engineer.** Hates debugging.

## Files in this folder

| File | Purpose | Read order |
|------|---------|------------|
| `README.md` | This file | 0 |
| `current-state.md` | Deployed system snapshot — what's running, what's not, full commit history | 1st |
| `learnings.md` | Dos / Don'ts from this session — collaboration rules with Cross | 2nd — **CRITICAL** |
| `gotchas.md` | 25 documented deployment traps (#27-51) | 3rd |
| `path-a-oauth-bootstrap.md` | Manual to unlock Analytics API (revenue / unique_viewers) | When starting Path A |
| `runbook.md` | Daily / weekly ops + failure recovery | When something breaks |
| `dashboard-code.gs` | Apps Script for Connected Sheets dashboard — full file, paste-and-run | When dashboard needs rebuild |
| `02_mart_content_daily_rollup.sql` | Ready-to-paste BQ Scheduled Query SQL (PROJECT_ID already substituted) | When registering the mart_content_daily 04:15 UTC scheduled query |
| `continuation-prompt.md` | Suggested first prompt for new Claude session | First thing Cross gives new Claude |

## How to use

### Option 1: Project Knowledge upload (recommended)
Cross zips this folder, uploads to Claude Project Knowledge. New Claude reads
all files automatically when relevant.

### Option 2: Inline context
Cross pastes content of these files at the start of new conversation.

## Critical reading

The single most important file is **`learnings.md`** — it captures meta rules
about Cross-Claude collaboration that were learned the hard way in this
session. Failing to follow them will cause Cross to debug Claude's mistakes,
which violates the project's #1 rule ("Cross 不 debug").

## Key state at handoff

- **Path C (api_key mode)** ETL fully operational — 7,599 content rows ingested daily, 4 Cloud Scheduler jobs auto-run
- **6-tab Connected Sheets dashboard** functional (Talent / Manager / Top10 / Trend / Videos / Lives) — awaiting Cross to paste full Code.gs and run buildDashboard
- **mart_content_daily_rollup BQ Scheduled Query** awaiting registration — SQL provided in `02_mart_content_daily_rollup.sql`
- **Path A (oauth mode for Analytics API revenue)** NOT YET STARTED
  - Blocked on IT provisioning + 50 talents adding mikai admin as Manager
  - 1-3 weeks expected timeline once started
  - Manual: `path-a-oauth-bootstrap.md`
- **Phase 3 LLM tagging** not started (lowest priority)

## Session counter (at handoff)

- Gotchas documented: 25 (#27-51 in `dev-guide.md` and copied in `gotchas.md`)
- PRs created this session: 1 main (#14, closed, 10 commits) + 1 gotcha-only (#4, 4 commits)
- Cloud Run revisions deployed: 4 (current = 00004)
- BQ tables populated: 6 raw + 4 mart
- Dashboard tabs: 6
- Total YouTube API quota burned 2026-05-04: 385 units (3.85% of 10K daily default)

## Verification

Before continuing work, new Claude session should run the verification
protocol described in `continuation-prompt.md` to confirm context parity
with the previous session.
