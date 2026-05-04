# Mart rollup SQL

`youtube_raw` (append-only API snapshots) → `youtube_mart` (denormalized,
KPI-ready, primary source for Connected Sheets dashboard).

## Files

| File | Cadence | Purpose |
|------|---------|---------|
| `01_mart_talent_daily_rollup.sql` | Daily 04:00 UTC | One row per (channel, day) into `mart_talent_daily_kpi` |

More rollups (weekly / monthly / video-level) come in subsequent files; the
daily rollup is the foundation everything else aggregates from.

## Path C (api_key mode) coverage

Fields populated from Data API snapshots:
- `views` (view-count delta from yesterday's snapshot)
- `comment_count`, `comment_velocity_24h`, `unique_commenters`
- `concurrent_peak` (from `live_metrics_snapshot`)
- `live_minutes`, `live_session_count`
- `new_video_count`, `new_video_published_hours`

Fields that stay NULL until OAuth (Analytics API) is in place:
- `revenue_usd`, `unique_viewers`
- `top_tags` (Phase 3 LLM tagging)

The MERGE supports both modes simultaneously: when `analytics_daily` rows
appear (after switching to oauth), they're picked up automatically.

## Manual run

```bash
export PROJECT_ID=mikai-yt-data
export BQ_LOCATION=US

envsubst < youtube-etl/sql/mart/01_mart_talent_daily_rollup.sql \
  | bq query --use_legacy_sql=false --project_id=$PROJECT_ID --location=$BQ_LOCATION
```

Default target_date is yesterday. To run for today (e.g. smoke testing):

```bash
envsubst < youtube-etl/sql/mart/01_mart_talent_daily_rollup.sql \
  | sed 's|DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY)|CURRENT_DATE()|' \
  | bq query --use_legacy_sql=false --project_id=$PROJECT_ID --location=$BQ_LOCATION
```

## Schedule

Register as a BigQuery Scheduled Query in the Console:
1. BigQuery → Scheduled queries → Create scheduled query
2. Schedule: `every day 04:00 UTC`
3. Region: `US` (must match dataset region)
4. Query: paste the rendered SQL (after envsubst), no destination table
   (the MERGE writes to mart directly)
5. Service account: `youtube-etl-runner@mikai-yt-data.iam.gserviceaccount.com`
   (needs `bigquery.dataEditor` on `youtube_mart`, already granted in STEP 5.3)
