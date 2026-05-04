-- Phase 2 mart rollup: youtube_raw -> mart_talent_daily_kpi
--
-- One row per (channel_id, report_date). Joins dim_talent + raw snapshots.
-- Idempotent via MERGE on (report_date, channel_id) — safe to re-run.
--
-- Path C (api_key mode) caveats:
--   - revenue_usd / unique_viewers: NULL (Analytics API only)
--   - top_tags: NULL (Phase 3 LLM tagging)
-- Everything else (views, comments, live metrics, new videos) is populated
-- from Data API snapshots.
--
-- Schedule: run daily at 04:00 UTC (2 hours after the 02:00 daily ETL).
-- Default target = yesterday so we capture a full-day window of snapshots.

DECLARE target_date DATE DEFAULT DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY);

MERGE `${PROJECT_ID}.youtube_mart.mart_talent_daily_kpi` T
USING (
  WITH
  -- Latest snapshot per video on the target day
  v_today AS (
    SELECT * EXCEPT(rn) FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY snapshot_at DESC) AS rn
      FROM `${PROJECT_ID}.youtube_raw.videos_snapshot`
      WHERE snapshot_date = target_date
    )
    WHERE rn = 1
  ),
  -- Yesterday's last snapshot per video, for view-delta calc
  v_prev AS (
    SELECT video_id, view_count, like_count, comment_count FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY snapshot_at DESC) AS rn
      FROM `${PROJECT_ID}.youtube_raw.videos_snapshot`
      WHERE snapshot_date = DATE_SUB(target_date, INTERVAL 1 DAY)
    )
    WHERE rn = 1
  ),
  -- Per-channel view delta. GREATEST(0, ...) guards against API correction
  -- where view_count goes down (rare but happens on demonetization etc.)
  ch_view_delta AS (
    SELECT
      v.channel_id,
      SUM(GREATEST(v.view_count - COALESCE(p.view_count, 0), 0)) AS views_delta
    FROM v_today v
    LEFT JOIN v_prev p ON v.video_id = p.video_id
    GROUP BY v.channel_id
  ),
  -- Per-channel basics from videos_snapshot
  ch_basics AS (
    SELECT
      channel_id,
      SUM(comment_count)                    AS total_comment_count_latest,
      COUNTIF(DATE(published_at) = target_date)                    AS new_video_count,
      STRING_AGG(
        DISTINCT CAST(EXTRACT(HOUR FROM published_at) AS STRING),
        ',' ORDER BY CAST(EXTRACT(HOUR FROM published_at) AS STRING)
      ) AS new_video_published_hours_csv,
      COUNTIF(DATE(live_actual_end_time) = target_date)            AS live_session_count,
      SUM(IF(
        DATE(live_actual_end_time) = target_date
          AND live_actual_start_time IS NOT NULL,
        TIMESTAMP_DIFF(live_actual_end_time, live_actual_start_time, MINUTE),
        0
      )) AS live_minutes
    FROM v_today
    GROUP BY channel_id
  ),
  -- Live concurrent peak from 5-minute polling
  ch_live_peak AS (
    SELECT channel_id, MAX(concurrent_viewers) AS concurrent_peak
    FROM `${PROJECT_ID}.youtube_raw.live_metrics_snapshot`
    WHERE snapshot_date = target_date
    GROUP BY channel_id
  ),
  -- Comments published on target_date: count + unique commenters
  ch_comments AS (
    SELECT
      channel_id,
      COUNT(DISTINCT comment_id)        AS comments_today,
      COUNT(DISTINCT author_channel_id) AS unique_commenters
    FROM `${PROJECT_ID}.youtube_raw.comments_snapshot`
    WHERE DATE(published_at) = target_date
    GROUP BY channel_id
  ),
  -- Optional: Analytics API rows if auth_mode=oauth has been switched on
  ch_analytics AS (
    SELECT
      channel_id,
      ANY_VALUE(estimated_revenue_usd) AS revenue_usd,
      ANY_VALUE(unique_viewers)        AS unique_viewers
    FROM `${PROJECT_ID}.youtube_raw.analytics_daily`
    WHERE report_date = target_date
    GROUP BY channel_id
  )
  SELECT
    target_date AS report_date,
    dt.channel_id,
    dt.talent_name,
    dt.manager_name,
    dt.channel_type,
    -- Analytics-only fields (NULL until OAuth is in place)
    ca.revenue_usd,
    cvd.views_delta              AS views,
    ca.unique_viewers,
    chb.total_comment_count_latest AS comment_count,
    -- Comment velocity = comments_today / 24h
    SAFE_DIVIDE(cc.comments_today, 24.0) AS comment_velocity_24h,
    cc.unique_commenters,
    clp.concurrent_peak,
    chb.live_minutes,
    chb.live_session_count,
    chb.new_video_count,
    chb.new_video_published_hours_csv AS new_video_published_hours,
    CAST(NULL AS STRING)              AS top_tags,  -- Phase 3 fills this
    CURRENT_TIMESTAMP()               AS generated_at
  FROM `${PROJECT_ID}.youtube_mart.dim_talent` dt
  LEFT JOIN ch_view_delta cvd  ON dt.channel_id = cvd.channel_id
  LEFT JOIN ch_basics      chb ON dt.channel_id = chb.channel_id
  LEFT JOIN ch_live_peak   clp ON dt.channel_id = clp.channel_id
  LEFT JOIN ch_comments    cc  ON dt.channel_id = cc.channel_id
  LEFT JOIN ch_analytics   ca  ON dt.channel_id = ca.channel_id
  WHERE dt.is_active = TRUE
) S
ON T.report_date = S.report_date AND T.channel_id = S.channel_id
WHEN MATCHED THEN UPDATE SET
  talent_name               = S.talent_name,
  manager_name              = S.manager_name,
  channel_type              = S.channel_type,
  revenue_usd               = S.revenue_usd,
  views                     = S.views,
  unique_viewers            = S.unique_viewers,
  comment_count             = S.comment_count,
  comment_velocity_24h      = S.comment_velocity_24h,
  unique_commenters         = S.unique_commenters,
  concurrent_peak           = S.concurrent_peak,
  live_minutes              = S.live_minutes,
  live_session_count        = S.live_session_count,
  new_video_count           = S.new_video_count,
  new_video_published_hours = S.new_video_published_hours,
  top_tags                  = S.top_tags,
  generated_at              = S.generated_at
WHEN NOT MATCHED THEN INSERT (
  report_date, channel_id, talent_name, manager_name, channel_type,
  revenue_usd, views, unique_viewers, comment_count,
  comment_velocity_24h, unique_commenters, concurrent_peak,
  live_minutes, live_session_count, new_video_count,
  new_video_published_hours, top_tags, generated_at
) VALUES (
  S.report_date, S.channel_id, S.talent_name, S.manager_name, S.channel_type,
  S.revenue_usd, S.views, S.unique_viewers, S.comment_count,
  S.comment_velocity_24h, S.unique_commenters, S.concurrent_peak,
  S.live_minutes, S.live_session_count, S.new_video_count,
  S.new_video_published_hours, S.top_tags, S.generated_at
);
