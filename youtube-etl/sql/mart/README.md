# Mart rollup SQL

`youtube_raw` (append-only API snapshots) → `youtube_mart` (denormalized,
KPI-ready, primary source for Connected Sheets dashboard).

## Files

| File | Cadence | Purpose |
|------|---------|---------|
| `01_mart_talent_daily_rollup.sql` | Daily 04:00 UTC | One row per (channel, day) into `mart_talent_daily_kpi` |
| `02_mart_content_daily_rollup.sql` | Daily 04:15 UTC | One row per (video, day) into `mart_content_daily`; splits videos vs livestreams via `content_type` |

More rollups (weekly / monthly) come in subsequent files; the daily rollups
are the foundation everything else aggregates from.

## Path C (api_key mode) coverage

Fields populated from Data API snapshots:
- `views` (view-count delta from yesterday's snapshot)
- `comment_count`, `comment_velocity_24h`, `unique_commenters`
- `concurrent_peak` (from `live_metrics_snapshot`)
- `live_minutes`, `live_session_count`
- `new_video_count`, `new_video_published_hours`
- `content_type` (video / live_active / live_archive / live_scheduled)
- per-video `view_count_delta`, `like_count`, `comment_count`, `concurrent_peak`

Fields that stay NULL until OAuth (Analytics API) is in place:
- `revenue_usd`, `unique_viewers`
- `top_tags` (Phase 3 LLM tagging)

The MERGE supports both modes simultaneously: when `analytics_daily` rows
appear (after switching to oauth), they're picked up automatically.

## Manual run

```bash
export PROJECT_ID=mikai-yt-data
export BQ_LOCATION=US

# Talent-level rollup
envsubst < youtube-etl/sql/mart/01_mart_talent_daily_rollup.sql \
  | bq query --use_legacy_sql=false --project_id=$PROJECT_ID --location=$BQ_LOCATION

# Content-level (per-video / per-live) rollup
envsubst < youtube-etl/sql/mart/02_mart_content_daily_rollup.sql \
  | bq query --use_legacy_sql=false --project_id=$PROJECT_ID --location=$BQ_LOCATION
```

Default target_date is yesterday. To run for today (e.g. smoke testing):

```bash
envsubst < youtube-etl/sql/mart/02_mart_content_daily_rollup.sql \
  | sed 's|DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)|CURRENT_DATE()|' \
  | bq query --use_legacy_sql=false --project_id=$PROJECT_ID --location=$BQ_LOCATION
```

## Schedule

Register each as a BigQuery Scheduled Query in the Console:
1. BigQuery → Scheduled queries → Create scheduled query
2. Schedule:
   - `mart_talent_daily_rollup`: every day 04:00 UTC
   - `mart_content_daily_rollup`: every day 04:15 UTC (after talent rollup)
3. Region: `US` (must match dataset region)
4. Query: paste the rendered SQL (after envsubst)
5. Service account: `youtube-etl-runner@mikai-yt-data.iam.gserviceaccount.com`
   (already granted `bigquery.dataEditor` on `youtube_mart` in STEP 5.3)
