-- youtube_raw: append-only snapshots from YouTube Data API + Analytics API.
-- All snapshot tables: partition by snapshot_date, cluster by channel_id (or video_id).
-- Idempotency: pipeline writes via MERGE on (snapshot_date, primary_key), so re-runs are safe.

CREATE SCHEMA IF NOT EXISTS `${PROJECT_ID}.youtube_raw`
OPTIONS (
  description = "YouTube ETL raw layer: per-call snapshots (videos / comments / live / analytics / quota)",
  location = "${BQ_LOCATION}"
);

-- =============================================================
-- videos_snapshot
-- Per-call snapshot of statistics + metadata.
-- Hourly job writes for videos in 'hourly' poll_state; daily job writes the rest.
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_raw.videos_snapshot` (
  snapshot_date          DATE      NOT NULL,
  snapshot_at            TIMESTAMP NOT NULL,
  poll_mode              STRING    NOT NULL,  -- 'hourly' | 'daily' | 'discovery'
  video_id               STRING    NOT NULL,
  channel_id             STRING    NOT NULL,
  title                  STRING,
  description            STRING,
  published_at           TIMESTAMP,
  duration_iso8601       STRING,
  duration_seconds       INT64,
  category_id            STRING,
  default_language       STRING,
  is_live_broadcast      BOOL,
  live_actual_start_time TIMESTAMP,
  live_actual_end_time   TIMESTAMP,
  live_scheduled_time    TIMESTAMP,
  view_count             INT64,
  like_count             INT64,
  comment_count          INT64,
  favorite_count         INT64,
  thumbnail_url          STRING,
  raw_json               STRING,                -- full API response for forensics
  ingest_run_id          STRING    NOT NULL
)
PARTITION BY snapshot_date
CLUSTER BY channel_id, video_id
OPTIONS (
  description = "Per-call snapshot of videos.list (statistics + contentDetails + liveStreamingDetails)"
);

-- =============================================================
-- comments_snapshot
-- Top-level comments (no replies for now); used to compute comment velocity.
-- author_channel_id is the only viewer-side user_id YouTube exposes -> commenter dedup key.
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_raw.comments_snapshot` (
  snapshot_date         DATE      NOT NULL,
  snapshot_at           TIMESTAMP NOT NULL,
  comment_id            STRING    NOT NULL,
  video_id              STRING    NOT NULL,
  channel_id            STRING    NOT NULL,
  author_channel_id     STRING,                 -- viewer dedup key (only available from commenters)
  author_display_name   STRING,
  text_original         STRING,
  text_display          STRING,
  like_count            INT64,
  reply_count           INT64,
  published_at          TIMESTAMP,
  updated_at            TIMESTAMP,
  is_pinned             BOOL,
  ingest_run_id         STRING    NOT NULL
)
PARTITION BY snapshot_date
CLUSTER BY video_id, channel_id
OPTIONS (
  description = "Per-call snapshot of commentThreads.list. Use for daily comment count delta + velocity"
);

-- =============================================================
-- live_metrics_snapshot
-- 5-minute polling during live broadcasts; only rows when actualEndTime is null.
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_raw.live_metrics_snapshot` (
  snapshot_date        DATE      NOT NULL,
  snapshot_at          TIMESTAMP NOT NULL,
  video_id             STRING    NOT NULL,
  channel_id           STRING    NOT NULL,
  concurrent_viewers   INT64,
  active_live_chat_id  STRING,
  ingest_run_id        STRING    NOT NULL
)
PARTITION BY snapshot_date
CLUSTER BY video_id, channel_id
OPTIONS (
  description = "5-min polling of liveStreamingDetails.concurrentViewers during live broadcast"
);

-- =============================================================
-- analytics_daily
-- One row per (channel, day) from YouTube Analytics API. Includes revenue + unique viewers.
-- Owner-side metrics (not Data API) -> requires OAuth via mikai shared account.
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_raw.analytics_daily` (
  report_date           DATE      NOT NULL,
  channel_id            STRING    NOT NULL,
  views                 INT64,
  unique_viewers        INT64,
  estimated_minutes_watched INT64,
  average_view_duration FLOAT64,
  estimated_revenue_usd NUMERIC,
  estimated_ad_revenue_usd NUMERIC,
  cpm_usd               NUMERIC,
  subscribers_gained    INT64,
  subscribers_lost      INT64,
  likes                 INT64,
  shares                INT64,
  comments              INT64,
  raw_json              STRING,
  ingest_run_id         STRING    NOT NULL,
  ingested_at           TIMESTAMP NOT NULL
)
PARTITION BY report_date
CLUSTER BY channel_id
OPTIONS (
  description = "YouTube Analytics API channel-level daily report (revenue, uniqueViewers, etc.)"
);

-- =============================================================
-- poll_state
-- Watermark for hybrid polling. New video (published_at <= 48h) -> 'hourly'.
-- After 48h elapses, hourly job promotes to 'daily' via graduated_at.
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_raw.poll_state` (
  video_id        STRING    NOT NULL,
  channel_id      STRING    NOT NULL,
  published_at    TIMESTAMP,
  mode            STRING    NOT NULL,  -- 'hourly' | 'daily' | 'archived'
  last_polled_at  TIMESTAMP,
  graduated_at    TIMESTAMP,           -- when transitioned hourly -> daily
  is_live_active  BOOL,                -- set true while live polling is on
  updated_at      TIMESTAMP NOT NULL
)
OPTIONS (
  description = "Per-video watermark for hybrid polling state machine"
);

-- =============================================================
-- quota_log
-- Per-API-call accounting; sum daily to verify against YouTube quota dashboard.
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_raw.quota_log` (
  call_date        DATE      NOT NULL,
  call_at          TIMESTAMP NOT NULL,
  api_method       STRING    NOT NULL,  -- 'channels.list', 'search.list', 'videos.list', 'commentThreads.list', etc.
  units_consumed   INT64     NOT NULL,
  http_status      INT64,
  result_count     INT64,
  ingest_run_id    STRING    NOT NULL,
  error_message    STRING
)
PARTITION BY call_date
CLUSTER BY api_method
OPTIONS (
  description = "Per-call quota accounting for YouTube Data API; sum daily for monitoring"
);
