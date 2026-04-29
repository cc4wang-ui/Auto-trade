"""Daily Analytics API pull. One call per channel per day → analytics_daily.

Endpoint: POST /jobs/analytics. Cloud Scheduler triggers at 03:00 UTC (after daily job).
This is the only path to revenue + uniqueViewers (Data API doesn't expose them).
"""
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from lib.analytics_client import YouTubeAnalyticsClient
from lib.bq_writer import BqWriter
from lib.config import Config
from lib.secrets import load_credentials
from lib.transforms import analytics_response_to_row

log = logging.getLogger(__name__)


def run(cfg: Config) -> dict:
    run_id = f"analytics-{uuid.uuid4().hex[:12]}"
    report_date: date = (datetime.now(timezone.utc) - timedelta(days=1)).date()

    bq = BqWriter(cfg)
    creds = load_credentials(cfg)
    client = YouTubeAnalyticsClient(creds)

    channels = bq.list_active_channels()
    log.info("analytics run %s for %s, channels=%d", run_id, report_date, len(channels))

    rows: list[dict] = []
    for ch in channels:
        try:
            resp = client.daily_report(ch["channel_id"], report_date)
        except Exception as e:
            log.warning("analytics failed for channel %s: %s", ch["channel_id"], e)
            continue
        row = analytics_response_to_row(
            ch["channel_id"], report_date.isoformat(), resp, run_id
        )
        if row is not None:
            rows.append(row)

    bq.write_analytics_daily(rows)
    return {"run_id": run_id, "report_date": report_date.isoformat(), "rows_written": len(rows)}
