"""Daily Analytics API pull. One call per (channel, day) → analytics_daily.

Endpoint: POST /jobs/analytics. Cloud Scheduler triggers at 03:00 UTC (after daily job).
This is the only path to revenue + uniqueViewers (Data API doesn't expose them).

YouTube Analytics numbers backfill / adjust for ~7 days after the event date,
so each run re-fetches the past `analytics_backfill_days` days and MERGE-upserts
into `analytics_daily`. Idempotent — safe to re-run.
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
    today_utc = datetime.now(timezone.utc).date()
    backfill_dates: list[date] = [
        today_utc - timedelta(days=offset)
        for offset in range(1, cfg.analytics_backfill_days + 1)
    ]

    bq = BqWriter(cfg)
    creds = load_credentials(cfg)
    client = YouTubeAnalyticsClient(creds)

    channels = bq.list_active_channels()
    log.info(
        "analytics run %s for %s..%s, channels=%d, backfill_days=%d",
        run_id,
        backfill_dates[-1],
        backfill_dates[0],
        len(channels),
        cfg.analytics_backfill_days,
    )

    rows: list[dict] = []
    failures = 0
    for ch in channels:
        for report_date in backfill_dates:
            try:
                resp = client.daily_report(ch["channel_id"], report_date)
            except Exception as e:
                failures += 1
                log.warning(
                    "analytics failed for channel=%s date=%s: %s",
                    ch["channel_id"],
                    report_date,
                    e,
                )
                continue
            row = analytics_response_to_row(
                ch["channel_id"], report_date.isoformat(), resp, run_id
            )
            if row is not None:
                rows.append(row)

    bq.write_analytics_daily(rows)
    return {
        "run_id": run_id,
        "date_range": {
            "start": backfill_dates[-1].isoformat(),
            "end": backfill_dates[0].isoformat(),
            "days": cfg.analytics_backfill_days,
        },
        "channels": len(channels),
        "rows_written": len(rows),
        "api_failures": failures,
    }
