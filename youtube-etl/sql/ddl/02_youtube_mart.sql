-- youtube_mart: deduplicated, denormalized layer for Sheets dashboard.
-- All grain-specific facts use the same shape so Booth / Event sources can plug in later.

CREATE SCHEMA IF NOT EXISTS `${PROJECT_ID}.youtube_mart`
OPTIONS (
  description = "YouTube ETL mart layer: dim_talent, dim_content_tag, fact_content_*, mart_talent_*",
  location = "${BQ_LOCATION}"
);

-- =============================================================
-- dim_talent (seed from data/channels.csv via sql/seed/dim_talent_load.sql)
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_mart.dim_talent` (
  channel_id          STRING    NOT NULL,
  talent_name         STRING    NOT NULL,
  channel_title_api   STRING,
  manager_name        STRING,
  channel_type        STRING,
  is_active           BOOL,
  graduated_flag      BOOL,
  loaded_at           TIMESTAMP NOT NULL
)
CLUSTER BY channel_id
OPTIONS (
  description = "Talent dimension. Seeded from CSV; refreshed when roster changes"
);

-- =============================================================
-- dim_content_tag (Phase 3 output)
-- One video can have multiple tags (long format).
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_mart.dim_content_tag` (
  video_id          STRING    NOT NULL,
  channel_id        STRING    NOT NULL,
  tag               STRING    NOT NULL,
  confidence        FLOAT64,
  taxonomy_version  STRING    NOT NULL,
  tagged_at         TIMESTAMP NOT NULL,
  llm_model         STRING,
  source_signal     STRING                 -- 'title+description'
)
CLUSTER BY video_id, tag
OPTIONS (
  description = "AI-generated tags per video (Phase 3, Claude API on title+description)"
);

-- =============================================================
-- fact_content_daily (multi-source unified)
-- Long format: one row per (date, content, metric).
-- Lets Booth / Event / other-platform plug in via the same schema.
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_mart.fact_content_daily` (
  report_date    DATE      NOT NULL,
  source         STRING    NOT NULL,  -- 'youtube' | 'booth' | 'event' | ...
  content_id     STRING    NOT NULL,  -- video_id for youtube
  channel_id     STRING,              -- talent / channel / merchant id
  metric_type    STRING    NOT NULL,  -- 'views' | 'likes' | 'comments' | 'concurrent_peak'
                                       -- 'revenue_usd' | 'unique_viewers'
                                       -- 'comment_velocity_per_hour_24h' | 'live_minutes'
  metric_value   FLOAT64,
  generated_at   TIMESTAMP NOT NULL
)
PARTITION BY report_date
CLUSTER BY source, channel_id, metric_type
OPTIONS (
  description = "Unified daily fact across YouTube / Booth / Event / future platforms (long format)"
);

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_mart.fact_content_weekly` (
  iso_week_start_date DATE      NOT NULL,
  source              STRING    NOT NULL,
  content_id          STRING    NOT NULL,
  channel_id          STRING,
  metric_type         STRING    NOT NULL,
  metric_value        FLOAT64,
  generated_at        TIMESTAMP NOT NULL
)
PARTITION BY iso_week_start_date
CLUSTER BY source, channel_id, metric_type;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_mart.fact_content_monthly` (
  month_start_date DATE      NOT NULL,
  source           STRING    NOT NULL,
  content_id       STRING    NOT NULL,
  channel_id       STRING,
  metric_type      STRING    NOT NULL,
  metric_value     FLOAT64,
  generated_at     TIMESTAMP NOT NULL
)
PARTITION BY month_start_date
CLUSTER BY source, channel_id, metric_type;

-- =============================================================
-- mart_talent_daily_kpi (denormalized for Connected Sheets)
-- One row per (channel_id, report_date). Pre-computed KPIs to avoid Sheets-side joins.
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_mart.mart_talent_daily_kpi` (
  report_date              DATE      NOT NULL,
  channel_id               STRING    NOT NULL,
  talent_name              STRING,
  manager_name             STRING,
  channel_type             STRING,
  -- KPIs (依變量)
  revenue_usd              NUMERIC,
  views                    INT64,
  unique_viewers           INT64,
  comment_count            INT64,
  comment_velocity_24h     FLOAT64,    -- new comments / hour over last 24h
  unique_commenters        INT64,
  concurrent_peak          INT64,
  -- 操控變量
  live_minutes             INT64,
  live_session_count       INT64,
  new_video_count          INT64,
  new_video_published_hours STRING,    -- comma-separated hours-of-day for new videos
  top_tags                 STRING,     -- comma-separated top 3 tags from Phase 3
  --
  generated_at             TIMESTAMP NOT NULL
)
PARTITION BY report_date
CLUSTER BY channel_id
OPTIONS (
  description = "Daily talent KPI rollup; the primary source for Connected Sheets dashboard"
);

-- =============================================================
-- mart_talent_weekly_kpi / mart_talent_monthly_kpi
-- Same shape, weekly/monthly rollup with user-id dedup at boundary.
-- =============================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_mart.mart_talent_weekly_kpi` (
  iso_week_start_date      DATE      NOT NULL,
  channel_id               STRING    NOT NULL,
  talent_name              STRING,
  manager_name             STRING,
  channel_type             STRING,
  revenue_usd              NUMERIC,
  views                    INT64,
  unique_viewers           INT64,
  comment_count            INT64,
  unique_commenters        INT64,     -- APPROX_COUNT_DISTINCT over week
  concurrent_peak          INT64,
  live_minutes             INT64,
  live_session_count       INT64,
  new_video_count          INT64,
  generated_at             TIMESTAMP NOT NULL
)
PARTITION BY iso_week_start_date
CLUSTER BY channel_id;

CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.youtube_mart.mart_talent_monthly_kpi` (
  month_start_date         DATE      NOT NULL,
  channel_id               STRING    NOT NULL,
  talent_name              STRING,
  manager_name             STRING,
  channel_type             STRING,
  revenue_usd              NUMERIC,
  views                    INT64,
  unique_viewers           INT64,
  comment_count            INT64,
  unique_commenters        INT64,
  concurrent_peak          INT64,
  live_minutes             INT64,
  live_session_count       INT64,
  new_video_count          INT64,
  generated_at             TIMESTAMP NOT NULL
)
PARTITION BY month_start_date
CLUSTER BY channel_id;
