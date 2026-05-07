-- mart_content_daily_rollup — ready-to-paste version (PROJECT_ID = mikai-yt-data substituted)
--
-- Where to use: BigQuery Console → Scheduled queries → + CREATE SCHEDULED QUERY
--   - Schedule: Daily 04:15 UTC
--   - Destination: do NOT set (MERGE writes target inside SQL)
--   - Service account: youtube-etl-runner@mikai-yt-data.iam.gserviceaccount.com
--
-- Idempotent: MERGE on (report_date, video_id). Safe to re-run.
-- Bootstrap day handling: view_count_delta = NULL when no prior snapshot.
--
-- Source: youtube_raw.videos_snapshot + youtube_raw.live_metrics_snapshot
-- Joined to: youtube_mart.dim_talent (denormalize talent_name + manager_name)
-- Target: youtube_mart.mart_content_daily

DECLARE target_date DATE DEFAULT DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY);

MERGE `mikai-yt-data.youtube_mart.mart_content_daily` T
USING (
  WITH
  v_today AS (
    SELECT * EXCEPT(rn) FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY snapshot_at DESC) AS rn
      FROM `mikai-yt-data.youtube_raw.videos_snapshot`
      WHERE snapshot_date = target_date
    ) WHERE rn = 1
  ),
  v_prev AS (
    SELECT video_id, view_count FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY snapshot_at DESC) AS rn
      FROM `mikai-yt-data.youtube_raw.videos_snapshot`
      WHERE snapshot_date = DATE_SUB(target_date, INTERVAL 1 DAY)
    ) WHERE rn = 1
  ),
  ccv AS (
    SELECT video_id, MAX(concurrent_viewers) AS concurrent_peak
    FROM `mikai-yt-data.youtube_raw.live_metrics_snapshot`
    WHERE snapshot_date = target_date
    GROUP BY video_id
  )
  SELECT
    target_date AS report_date,
    v.channel_id,
    dt.talent_name,
    dt.manager_name,
    v.video_id,
    v.title,
    v.published_at,
    CASE
      WHEN NOT v.is_live_broadcast THEN 'video'
      WHEN v.live_actual_end_time IS NOT NULL THEN 'live_archive'
      WHEN v.live_actual_start_time IS NOT NULL THEN 'live_active'
      ELSE 'live_scheduled'
    END AS content_type,
    v.duration_seconds,
    v.live_actual_start_time AS live_started_at,
    v.live_actual_end_time AS live_ended_at,
    CASE
      WHEN v.live_actual_end_time IS NOT NULL AND v.live_actual_start_time IS NOT NULL
      THEN TIMESTAMP_DIFF(v.live_actual_end_time, v.live_actual_start_time, MINUTE)
      ELSE NULL
    END AS live_minutes,
    v.view_count,
    IF(p.video_id IS NULL, NULL, GREATEST(v.view_count - p.view_count, 0)) AS view_count_delta,
    v.like_count,
    v.comment_count,
    ccv.concurrent_peak,
    CURRENT_TIMESTAMP() AS generated_at
  FROM v_today v
  LEFT JOIN v_prev p ON v.video_id = p.video_id
  LEFT JOIN ccv ON v.video_id = ccv.video_id
  LEFT JOIN `mikai-yt-data.youtube_mart.dim_talent` dt ON v.channel_id = dt.channel_id
) S
ON T.report_date = S.report_date AND T.video_id = S.video_id
WHEN MATCHED THEN UPDATE SET
  channel_id       = S.channel_id,
  talent_name      = S.talent_name,
  manager_name     = S.manager_name,
  title            = S.title,
  published_at     = S.published_at,
  content_type     = S.content_type,
  duration_seconds = S.duration_seconds,
  live_started_at  = S.live_started_at,
  live_ended_at    = S.live_ended_at,
  live_minutes     = S.live_minutes,
  view_count       = S.view_count,
  view_count_delta = S.view_count_delta,
  like_count       = S.like_count,
  comment_count    = S.comment_count,
  concurrent_peak  = S.concurrent_peak,
  generated_at     = S.generated_at
WHEN NOT MATCHED THEN INSERT (
  report_date, channel_id, talent_name, manager_name,
  video_id, title, published_at, content_type, duration_seconds,
  live_started_at, live_ended_at, live_minutes,
  view_count, view_count_delta, like_count, comment_count, concurrent_peak,
  generated_at
) VALUES (
  S.report_date, S.channel_id, S.talent_name, S.manager_name,
  S.video_id, S.title, S.published_at, S.content_type, S.duration_seconds,
  S.live_started_at, S.live_ended_at, S.live_minutes,
  S.view_count, S.view_count_delta, S.like_count, S.comment_count, S.concurrent_peak,
  S.generated_at
);
