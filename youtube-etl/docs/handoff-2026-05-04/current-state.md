# Current State — mikai YouTube ETL (snapshot 2026-05-04 UTC, updated 2026-05-06)

## GCP project

- **Project ID**: `mikai-yt-data`
- **Project Number**: `508645124315`
- **BQ Location**: `US`
- **BQ Reservation**: `youtube-etl-rsv` (STANDARD edition, 0 baseline / 100 max autoscale, ignore_idle_slots=true)

## Repo / PR

- **Repo**: `cc4wang-ui/auto-trade`
- **Active branch**: `claude/youtube-etl-data-api-mode`
- **PR**: #14 (state=closed, not merged — branch lives on with handoff commits past PR head)
- **Gotcha branch (separate)**: `claude/youtube-etl-review-KUnqD` (PR #4, has `dev-guide.md` updates #38-51)

### Commit history on claude/youtube-etl-data-api-mode (this session, 2026-05-04 → 2026-05-06)

In chronological order (older → newer):

| Commit (short) | Date (UTC) | Subject | What it changed |
|----------------|------------|---------|------------------|
| `20047cb` | 2026-05-04 | Add API-key auth mode for Data-API-only deployments | 7 files: `lib/config.py` + `secrets.py` + `youtube_client.py` + 4 handlers. Adds `YOUTUBE_AUTH_MODE` env, `build_data_client()`, no-op analytics in api_key mode. |
| `190662a` | 2026-05-04 | Fix import: `google.cloud.secret_manager` → `secretmanager` | 1-line fix to module name (Gotcha #46). Without this, container worker fails to boot. |
| `98ceae7` | 2026-05-04 | Fix BQ 413 + make finally blocks resilient | `bq_writer.py` chunks streaming inserts at 500 rows. Handlers wrap each finally write in independent try/except (Gotcha #47, #48). |
| `adadcba` | 2026-05-04 | Catch HttpError per channel/chunk so one bad call doesn't 500 the run | `handlers/{daily,hourly,live_poll}.py` add per-call `try/except HttpError` (Gotcha #50). |
| `b3ba0f0` | 2026-05-04 | Phase 2: `mart_talent_daily_kpi` rollup SQL | `sql/mart/01_mart_talent_daily_rollup.sql` + README. MERGE on (report_date, channel_id), idempotent. Schedule: BQ scheduled query 04:00 UTC. |
| `14b34d7` | 2026-05-04 | Phase 2.5: per-content (video / livestream) mart layer | DDL adds `mart_content_daily` table. `sql/mart/02_mart_content_daily_rollup.sql` does per-(video, day) MERGE. Splits content_type for Videos / Lives drill-down. |
| `563e7af` | 2026-05-04 | Add Path A (OAuth bootstrap) walkthrough doc | `youtube-etl/docs/path-a-oauth-bootstrap.md`. A.1 IT → A.5 monitoring. Note: was overwritten in subsequent push, recopied as `f742c44`. |
| `90c0b12` | 2026-05-06 | Handoff Stage 1 step 1+2: README + gotchas | New `youtube-etl/docs/handoff-2026-05-04/` folder. README.md (entry, file index, current state). gotchas.md (#27-51, 25 traps). |
| `c35535f` | 2026-05-06 | Handoff Stage 1 step 3-6: learnings + current-state + runbook + continuation-prompt | learnings.md (THE critical doc, Dos/Don'ts), current-state.md (system snapshot — this file), runbook.md (daily/weekly ops), continuation-prompt.md (10-question quiz for new Claude). |
| `f742c44` | 2026-05-06 | Handoff Stage 1 step 8: copy path-a-oauth-bootstrap.md into handoff folder | Re-pushes path-a into `handoff-2026-05-04/` since `youtube-etl/docs/path-a-oauth-bootstrap.md` was lost in earlier tree operation. |

Total: **10 commits** since branch fork from `claude/youtube-etl-review-i4TIH` at `261a586`.

### Commit history on claude/youtube-etl-review-KUnqD (gotcha-only branch, PR #4)

| Commit (short) | Date (UTC) | Subject |
|----------------|------------|---------|
| `3e048e1` | 2026-05-04 | Log gotchas #38-40 from STEP 4-C deployment |
| `1f016e3` | 2026-05-04 | Log gotchas #41-45 from Cloud Run STEP 5+6 deployment |
| `9bb8d4c` | 2026-05-04 | Log gotchas #46-50 from STEP 6 smoke test debug |
| `233446c` | 2026-05-06 | Add Gotcha #51: give Cross complete files, not patches |

Total: **4 commits** on top of fork point.

## Cloud Run service

| Field | Value |
|-------|-------|
| Service name | `youtube-etl-ingest` |
| Region | `us-central1` |
| Current revision | `youtube-etl-ingest-00004-q8l` |
| Service URL (routable) | `https://youtube-etl-ingest-gvxv3xr45a-uc.a.run.app` |
| Service URL (deploy stdout, may not work) | `https://youtube-etl-ingest-508645124315.us-central1.run.app` — don't use |
| Auth mode | `--no-allow-unauthenticated` |
| Ingress | `all` |
| Service account | `youtube-etl-runner@mikai-yt-data.iam.gserviceaccount.com` |
| Memory | 512Mi |
| CPU | 1 |
| Timeout | 900s |
| Max instances | 3 |
| Env: `YOUTUBE_AUTH_MODE` | `api_key` (Path C) |
| Env: `GCP_PROJECT_ID` | `mikai-yt-data` |
| Env: `BQ_DATASET_RAW` | `youtube_raw` |
| Env: `BQ_DATASET_MART` | `youtube_mart` |
| Env: `SECRET_API_KEY` | `yt-api-key` |

### Endpoints

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/healthz` | GET | (intercepted by Cloud Run frontend, returns Google 404 — don't use for liveness) | 🔴 unusable |
| `/jobs/daily` | POST | Full sweep all 50 channels | ✅ verified (7,595 videos written) |
| `/jobs/hourly` | POST | Update <48h videos | ✅ verified (no targets when ran) |
| `/jobs/live-poll` | POST | 5-min concurrent viewer polling | ✅ verified (Scheduler firing every 5 min) |
| `/jobs/analytics` | POST | YouTube Analytics pull | ✅ returns `{skipped: true}` in api_key mode |

## Cloud Scheduler (region us-central1)

| Job name | Schedule (UTC) | Endpoint | Status | Last attempt |
|----------|----------------|----------|--------|--------------|
| `youtube-etl-daily` | `0 2 * * *` | `/jobs/daily` | ENABLED | (waiting for first natural fire 02:00 UTC) |
| `youtube-etl-hourly` | `5 * * * *` | `/jobs/hourly` | ENABLED | (auto-fires every hour at :05) |
| `youtube-etl-live-poll` | `*/5 * * * *` | `/jobs/live-poll` | ENABLED | ✅ verified 14:25 + 14:30 UTC 2026-05-04 |
| `youtube-etl-analytics` | `0 3 * * *` | `/jobs/analytics` | ENABLED | (no-op until oauth mode) |

All use OIDC auth with `youtube-etl-runner@...` SA + audience = service URL. `attempt-deadline=600s` (300s for live-poll), `max-retry-attempts=2`.

## Secrets (Secret Manager)

| Secret name | Purpose | Status |
|-------------|---------|--------|
| `yt-api-key` | YouTube Data API v3 key (Path C) | ✅ set |
| `youtube-etl-mikai-oauth-client-id` | OAuth client ID (Path A) | ⛔ not yet created |
| `youtube-etl-mikai-oauth-client-secret` | OAuth client secret (Path A) | ⛔ not yet created |
| `youtube-etl-mikai-oauth-refresh-token` | OAuth refresh token (Path A) | ⛔ not yet created |

IAM: `youtube-etl-runner@...` SA has `roles/secretmanager.secretAccessor` on the project.

## BigQuery datasets

### `mikai-yt-data.youtube_raw` (append-only API snapshots)

| Table | Today's row count | Schema |
|-------|-------------------|--------|
| `videos_snapshot` | 7,599 | per-call snapshot of `videos.list` (statistics + contentDetails + liveStreamingDetails) |
| `comments_snapshot` | 0 today | top-level comments (no replies) |
| `live_metrics_snapshot` | varies | 5-min `concurrent_viewers` polling for active lives |
| `analytics_daily` | 0 today | YouTube Analytics API daily report (🟡 empty until Path A done) |
| `poll_state` | 7,595 | per-video watermark for hybrid polling state machine |
| `quota_log` | 339 | per-API-call accounting (~385 units total burned today) |

All partitioned by `snapshot_date`, clustered by `channel_id` / `video_id`.

### `mikai-yt-data.youtube_mart` (denormalized for dashboard)

| Table | Today's row count | Purpose |
|-------|-------------------|---------|
| `dim_talent` | 50 (10 manager groups) | Seeded from `dim_talent_load.sql` |
| `dim_content_tag` | 0 | Phase 3 LLM tagging (not started) |
| `mart_talent_daily_kpi` | 50 | Channel-level KPI rollup |
| `mart_content_daily` | 7,599 (5,791 live_archive + 1,734 video) | **Per-content drill-down** — splits videos vs livestreams via `content_type` |
| `fact_content_daily/weekly/monthly` | 0 | Long-format multi-source fact (Booth/Event-ready, not yet used) |
| `mart_talent_weekly_kpi/monthly_kpi` | 0 | Weekly/monthly rollup (not yet built) |

## BQ Scheduled Queries

| Name | Schedule (UTC) | Status | Notes |
|------|----------------|--------|-------|
| `mart_talent_daily_rollup` | every day 04:00 | ✅ active | Cross set up via Console UI |
| `mart_content_daily_rollup` | every day 04:15 | 🟡 **NOT YET REGISTERED** | Cross to do via Console UI — SQL ready in `youtube-etl/sql/mart/02_mart_content_daily_rollup.sql` |

Both use `youtube-etl-runner@...` SA. The runner SA has `roles/iam.serviceAccountTokenCreator` granted to the BQ Data Transfer Service Agent.

## Connected Sheets dashboard

- **Sheet ID**: `1A5ynk0IoQ9UpV9AP5OiplsAsL3rbAl-38-2R-kYovbo`
- **Sheet name**: `mikai YouTube Talent Dashboard`
- **Apps Script GCP project**: `508645124315` (mikai-yt-data)
- **BigQuery service**: enabled in Apps Script
- **Time trigger**: daily at 13:00 (Asia/Taipei) — calls `buildDashboard()`

### Tabs (when full Code.gs runs)

| Tab | Source | Header color | Purpose |
|-----|--------|--------------|---------|
| Talent Dashboard | mart_talent_daily_kpi | blue #1a73e8 | 50 talents × channel-level KPIs |
| Manager Summary | aggregated | blue #1a73e8 | 10 manager groups + chart + last refresh |
| Top 10 | sorted | green #34a853 | top 10 talents by views |
| Trend | last 30 days, skip bootstrap | yellow #fbbc04 | time-series (will populate from May 5+) |
| Videos | mart_content_daily content_type='video' | red #ea4335 | per-video drill-down |
| Lives | mart_content_daily content_type LIKE 'live_%' | purple #9c27b0 | per-livestream drill-down |

### Status

🟡 At handoff, Cross has not yet pasted the full Code.gs and run buildDashboard. Apps Script source is in `dashboard-code.gs` in this folder. Cross will paste-and-run on first new Claude session.

## Path A status

| Step | Status |
|------|--------|
| A.1 IT provision `youtube-analytics@mikai.tw` | 🔴 not started — Cross plans to ticket IT 2026-05-05 |
| A.2 OAuth bootstrap | 🔴 not started |
| A.3 Talent Manager invitations | 🔴 not started |
| A.4 Cloud Run env flip to `oauth` | 🔴 not started |
| A.5 Coverage monitoring | 🔴 not started |

Manual: `path-a-oauth-bootstrap.md` (in this folder, also at `youtube-etl/docs/path-a-oauth-bootstrap.md`).

## Phase 3 (LLM tagging) status

🔴 Not started. Plan: Claude API + title + description → `dim_content_tag` rows → mart_talent_daily_kpi.top_tags column.

## Quota status (today, 2026-05-04 UTC)

| API | Burned | Default daily quota | % used |
|-----|--------|---------------------|--------|
| YouTube Data API v3 | 385 units | 10,000 | 3.85% |
| YouTube Analytics API | 0 | 500 | 0% |

Quota increase request: pending Google audit (form submitted, follow-up email sent with architecture diagram + dashboard mockup + BQ schema). Response time: 7 business days from Google.

## Outstanding mikai-side tasks (non-engineering)

1. Cross to ticket IT for `youtube-analytics@mikai.tw` provisioning (Path A.1)
2. Cross to plan talent communication strategy for Path A.3
3. (optional) Cross to pursue contract addition for talent data sharing if not already in contracts

## Cost estimate (steady state, post-handoff)

| Service | Monthly estimate |
|---------|------------------|
| Cloud Run (3 instances max, ~5 min/day active) | < $1 |
| BQ storage (raw 1 GB/month + mart 100MB) | < $0.05 |
| BQ query (mart rollup + dashboard reads) | < $1 (Editions autoscale, ETL volume small) |
| Secret Manager | < $0.10 |
| Cloud Scheduler (4 jobs) | $0 (free tier covers 3 jobs; 4th = $0.10) |
| Cloud Build (image rebuilds) | < $1 (free tier 120 build-min/day) |
| **Total** | **< $5 / month** |

Excludes Workspace license for `youtube-analytics@mikai.tw` (~$10/month) when provisioned.
