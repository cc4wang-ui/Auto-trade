-- Load channels.csv into youtube_mart.dim_talent.
-- Run after the DDL has been applied.
--
-- Step 1 (one-off): upload data/channels.csv to GCS:
--   gsutil cp youtube-etl/data/channels.csv gs://${BUCKET}/seed/channels.csv
--
-- Step 2: run this script (substitute ${PROJECT_ID} and ${BUCKET}).

-- 2a. Create staging external table pointing at the CSV
CREATE OR REPLACE EXTERNAL TABLE `${PROJECT_ID}.youtube_mart._stg_channels_csv` (
  talent_name        STRING,
  channel_id         STRING,
  channel_title_api  STRING,
  match_ok           STRING,
  manager_name       STRING,
  channel_type       STRING,
  is_active          STRING
)
OPTIONS (
  format = 'CSV',
  uris = ['gs://${BUCKET}/seed/channels.csv'],
  skip_leading_rows = 1,
  field_delimiter = ',',
  encoding = 'UTF-8'
);

-- 2b. MERGE into dim_talent (upsert by channel_id; idempotent across re-runs)
MERGE `${PROJECT_ID}.youtube_mart.dim_talent` T
USING (
  SELECT
    channel_id,
    talent_name,
    channel_title_api,
    manager_name,
    channel_type,
    UPPER(is_active) = 'TRUE'                                         AS is_active,
    LOWER(manager_name) = 'graduated'                                  AS graduated_flag,
    CURRENT_TIMESTAMP()                                                AS loaded_at
  FROM `${PROJECT_ID}.youtube_mart._stg_channels_csv`
  WHERE match_ok = 'ok'
) S
ON T.channel_id = S.channel_id
WHEN MATCHED THEN UPDATE SET
  talent_name        = S.talent_name,
  channel_title_api  = S.channel_title_api,
  manager_name       = S.manager_name,
  channel_type       = S.channel_type,
  is_active          = S.is_active,
  graduated_flag     = S.graduated_flag,
  loaded_at          = S.loaded_at
WHEN NOT MATCHED THEN INSERT (
  channel_id, talent_name, channel_title_api, manager_name,
  channel_type, is_active, graduated_flag, loaded_at
) VALUES (
  S.channel_id, S.talent_name, S.channel_title_api, S.manager_name,
  S.channel_type, S.is_active, S.graduated_flag, S.loaded_at
);

-- 2c. Drop the staging external table (clean up)
DROP TABLE IF EXISTS `${PROJECT_ID}.youtube_mart._stg_channels_csv`;

-- 2d. Sanity check
SELECT
  manager_name,
  COUNT(*) AS talent_count,
  COUNTIF(graduated_flag) AS graduated_count
FROM `${PROJECT_ID}.youtube_mart.dim_talent`
GROUP BY manager_name
ORDER BY talent_count DESC;
