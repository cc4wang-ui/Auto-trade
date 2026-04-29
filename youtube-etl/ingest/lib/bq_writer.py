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
        self.insert(self._cfg.bq_dataset_raw, "analytics_daily", rows)

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
