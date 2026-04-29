# BigQuery DDL

Two datasets:

- `youtube_raw` (file `01_youtube_raw.sql`) — append-only snapshots straight from APIs
- `youtube_mart` (file `02_youtube_mart.sql`) — deduplicated rollup for Sheets dashboard

## How to apply

Replace `${PROJECT_ID}` and `${BQ_LOCATION}` and run via `bq query`:

```bash
PROJECT_ID="project-7f1094dc-792a-4a86-85d"  # 17LIVE existing GCP project (TikTok PoC lives here)
BQ_LOCATION="asia-northeast1"                 # adjust if different

for f in 01_youtube_raw.sql 02_youtube_mart.sql; do
  envsubst < "$f" | bq query --use_legacy_sql=false --project_id="$PROJECT_ID"
done
```

Or via Terraform / dbt later. DDL is idempotent (`CREATE TABLE IF NOT EXISTS`).

## Design notes

- **Partitioning**: every snapshot/fact table partitioned by date — required for cost control on 50ch × multi-year accumulation.
- **Clustering**: cluster on `channel_id` + (where applicable) `video_id` so `WHERE channel_id IN (...)` queries skip irrelevant blocks.
- **Idempotency**: pipeline writes use `MERGE INTO ... ON (snapshot_date, primary_key)` so re-running an hour or day is safe (verified pattern from TikTok PoC).
- **Long-format `fact_content_daily`**: lets Booth / Event / future sources plug in without schema changes — see Phase 5 of the plan.
- **Pre-computed `mart_talent_*_kpi`**: Connected Sheets does poorly on multi-table joins; we ship a denormalized per-talent-per-day row.

## Viewer dedup constraint

YouTube Data API does **not** expose viewer user_id (privacy). Two derived metrics:

1. `unique_commenters` = `APPROX_COUNT_DISTINCT(author_channel_id)` over the period (commenters only — not all viewers)
2. `unique_viewers` = pulled from **YouTube Analytics API** as an aggregate count (no per-user IDs, but the count itself is correct)

Cross's "user_id 去重" requirement maps to (1) for engagement analysis and (2) for reach analysis. There is no path to per-user-id viewer log on YouTube.
