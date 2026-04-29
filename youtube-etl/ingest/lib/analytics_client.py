"""YouTube Analytics API v2 wrapper. Gives us revenue + uniqueViewers + watch-time.

Authentication: same OAuth refresh token as the Data API client (mikai shared account
must have access to all 50 channel backends). Per-channel reports use the channel_id
filter; one HTTP call per channel per day.
"""
from datetime import date
from typing import List

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.oauth2.credentials import Credentials
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

ANALYTICS_METRICS = ",".join(
    [
        "views",
        "uniqueViewers",
        "estimatedMinutesWatched",
        "averageViewDuration",
        "estimatedRevenue",
        "estimatedAdRevenue",
        "cpm",
        "subscribersGained",
        "subscribersLost",
        "likes",
        "shares",
        "comments",
    ]
)


class YouTubeAnalyticsClient:
    def __init__(self, credentials: Credentials):
        self._svc = build(
            "youtubeAnalytics", "v2", credentials=credentials, cache_discovery=False
        )

    @retry(
        retry=retry_if_exception_type(HttpError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        reraise=True,
    )
    def daily_report(self, channel_id: str, report_date: date) -> dict:
        """One row of (views/revenue/uniqueViewers/...) for a single channel + day."""
        resp = (
            self._svc.reports()
            .query(
                ids=f"channel=={channel_id}",
                startDate=report_date.isoformat(),
                endDate=report_date.isoformat(),
                metrics=ANALYTICS_METRICS,
            )
            .execute()
        )
        return resp

    def daily_reports_for_channels(
        self, channel_ids: List[str], report_date: date
    ) -> List[tuple[str, dict]]:
        return [(cid, self.daily_report(cid, report_date)) for cid in channel_ids]
