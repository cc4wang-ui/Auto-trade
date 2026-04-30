"""BigQuery write helpers. Always streaming inserts for snapshots (low-volume, sub-MB/day);
MERGE-via-job for poll_state upserts.
"""
from datetime import datetime, timezone
from typing import Iterable, List

from google.cloud import bigquery

from lib.config import Config
from lib.quota_tracker import QuotaEvent, QuotaTracker


class BqWriter:
    def __init__(self, cfg: Config):
        self._client = bigquery.Client(project=cfg.project_id)
        self._cfg = cfg

    def _ref(self, dataset: str, table: str) -> str:
        return f"{self._cfg.project_id}.{dataset}.{table}"

    def insert(self, dataset: str, table: str, rows: List[dict]) -> None:
        if not rows:
            return
        ref = self._ref(dataset, table)
        errors = self._client.insert_rows_json(ref, rows)
        if errors:
            raise RuntimeError(f"BQ insert errors for {ref}: {errors}")

    def write_videos_snapshots(self, rows: List[dict]) -> None:
        self.insert(self._cfg.bq_dataset_raw, "videos_snapshot", rows)

    def write_comments_snapshots(self, rows: List[dict]) -> None:
        self.insert(self._cfg.bq_dataset_raw, "comments_snapshot", rows)

    def write_live_metrics(self, rows: List[dict]) -> None:
        self.insert(self._cfg.bq_dataset_raw, "live_metrics_snapshot", rows)

    def write_analytics_daily(self, rows: List[dict]) -> None:
        """MERGE upsert on (report_date, channel_id).

        YouTube Analytics numbers backfill for ~7 days after the event,
        so the handler re-fetches the past N days each run; idempotency
        is enforced here via a staging-table MERGE.
        """
        if not rows:
            return
        staging = self._ref(
            self._cfg.bq_dataset_raw,
            f"_stg_analytics_daily_{int(datetime.now(timezone.utc).timestamp())}",
        )
        schema = [
            bigquery.SchemaField("report_date", "DATE", mode="REQUIRED"),
            bigquery.SchemaField("channel_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("views", "INT64"),
            bigquery.SchemaField("unique_viewers", "INT64"),
            bigquery.SchemaField("estimated_minutes_watched", "INT64"),
            bigquery.SchemaField("average_view_duration", "FLOAT64"),
            bigquery.SchemaField("estimated_revenue_usd", "NUMERIC"),
            bigquery.SchemaField("estimated_ad_revenue_usd", "NUMERIC"),
            bigquery.SchemaField("cpm_usd", "NUMERIC"),
            bigquery.SchemaField("subscribers_gained", "INT64"),
            bigquery.SchemaField("subscribers_lost", "INT64"),
            bigquery.SchemaField("likes", "INT64"),
            bigquery.SchemaField("shares", "INT64"),
            bigquery.SchemaField("comments", "INT64"),
            bigquery.SchemaField("raw_json", "STRING"),
            bigquery.SchemaField("ingest_run_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("ingested_at", "TIMESTAMP", mode="REQUIRED"),
        ]
        load_job = self._client.load_table_from_json(
            rows,
            staging,
            job_config=bigquery.LoadJobConfig(
                schema=schema, write_disposition="WRITE_TRUNCATE"
            ),
        )
        load_job.result()

        target = self._ref(self._cfg.bq_dataset_raw, "analytics_daily")
        merge = f"""
        MERGE `{target}` T
        USING `{staging}` S
        ON T.report_date = S.report_date AND T.channel_id = S.channel_id
        WHEN MATCHED THEN UPDATE SET
          views                     = S.views,
          unique_viewers            = S.unique_viewers,
          estimated_minutes_watched = S.estimated_minutes_watched,
          average_view_duration     = S.average_view_duration,
          estimated_revenue_usd     = S.estimated_revenue_usd,
          estimated_ad_revenue_usd  = S.estimated_ad_revenue_usd,
          cpm_usd                   = S.cpm_usd,
          subscribers_gained        = S.subscribers_gained,
          subscribers_lost          = S.subscribers_lost,
          likes                     = S.likes,
          shares                    = S.shares,
          comments                  = S.comments,
          raw_json                  = S.raw_json,
          ingest_run_id             = S.ingest_run_id,
          ingested_at               = S.ingested_at
        WHEN NOT MATCHED THEN INSERT (
          report_date, channel_id, views, unique_viewers,
          estimated_minutes_watched, average_view_duration,
          estimated_revenue_usd, estimated_ad_revenue_usd, cpm_usd,
          subscribers_gained, subscribers_lost,
          likes, shares, comments,
          raw_json, ingest_run_id, ingested_at
        ) VALUES (
          S.report_date, S.channel_id, S.views, S.unique_viewers,
          S.estimated_minutes_watched, S.average_view_duration,
          S.estimated_revenue_usd, S.estimated_ad_revenue_usd, S.cpm_usd,
          S.subscribers_gained, S.subscribers_lost,
          S.likes, S.shares, S.comments,
          S.raw_json, S.ingest_run_id, S.ingested_at
        )
        """
        self._client.query(merge).result()
        self._client.delete_table(staging, not_found_ok=True)

    def write_quota_log(self, tracker: QuotaTracker) -> None:
        rows = [self._quota_event_to_row(e, tracker.run_id) for e in tracker.events]
        self.insert(self._cfg.bq_dataset_raw, "quota_log", rows)

    @staticmethod
    def _quota_event_to_row(e: QuotaEvent, run_id: str) -> dict:
        return {
            "call_date": e.call_at.date().isoformat(),
            "call_at": e.call_at.isoformat(),
            "api_method": e.api_method,
            "units_consumed": e.units,
            "http_status": e.http_status,
            "result_count": e.result_count,
            "ingest_run_id": run_id,
            "error_message": e.error_message,
        }

    def upsert_poll_state(self, rows: Iterable[dict]) -> None:
        """MERGE rows into poll_state using a temporary load job + DML."""
        rows = list(rows)
        if not rows:
            return
        # Stream into a session-scoped staging table, then MERGE.
        staging = self._ref(self._cfg.bq_dataset_raw, f"_stg_poll_state_{int(datetime.now(timezone.utc).timestamp())}")
        schema = [
            bigquery.SchemaField("video_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("channel_id", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("published_at", "TIMESTAMP"),
            bigquery.SchemaField("mode", "STRING", mode="REQUIRED"),
            bigquery.SchemaField("last_polled_at", "TIMESTAMP"),
            bigquery.SchemaField("graduated_at", "TIMESTAMP"),
            bigquery.SchemaField("is_live_active", "BOOL"),
            bigquery.SchemaField("updated_at", "TIMESTAMP", mode="REQUIRED"),
        ]
        job = self._client.load_table_from_json(
            rows,
            staging,
            job_config=bigquery.LoadJobConfig(
                schema=schema, write_disposition="WRITE_TRUNCATE"
            ),
        )
        job.result()

        target = self._ref(self._cfg.bq_dataset_raw, "poll_state")
        merge = f"""
        MERGE `{target}` T
        USING `{staging}` S
        ON T.video_id = S.video_id
        WHEN MATCHED THEN UPDATE SET
          channel_id     = S.channel_id,
          published_at   = S.published_at,
          mode           = S.mode,
          last_polled_at = S.last_polled_at,
          graduated_at   = COALESCE(S.graduated_at, T.graduated_at),
          is_live_active = S.is_live_active,
          updated_at     = S.updated_at
        WHEN NOT MATCHED THEN INSERT (
          video_id, channel_id, published_at, mode,
          last_polled_at, graduated_at, is_live_active, updated_at
        ) VALUES (
          S.video_id, S.channel_id, S.published_at, S.mode,
          S.last_polled_at, S.graduated_at, S.is_live_active, S.updated_at
        )
        """
        self._client.query(merge).result()
        self._client.delete_table(staging, not_found_ok=True)

    def list_active_channels(self) -> List[dict]:
        """Read dim_talent for the channels we should poll (is_active = TRUE)."""
        sql = f"""
          SELECT channel_id, talent_name, manager_name, graduated_flag
          FROM `{self._ref(self._cfg.bq_dataset_mart, 'dim_talent')}`
          WHERE is_active = TRUE
        """
        return [dict(r) for r in self._client.query(sql).result()]

    def list_videos_in_mode(
        self, mode: str, only_live_active: bool = False
    ) -> List[dict]:
        sql = f"""
          SELECT video_id, channel_id, published_at, is_live_active
          FROM `{self._ref(self._cfg.bq_dataset_raw, 'poll_state')}`
          WHERE mode = @mode
            { 'AND is_live_active = TRUE' if only_live_active else '' }
        """
        job = self._client.query(
            sql,
            job_config=bigquery.QueryJobConfig(
                query_parameters=[bigquery.ScalarQueryParameter("mode", "STRING", mode)]
            ),
        )
        return [dict(r) for r in job.result()]
