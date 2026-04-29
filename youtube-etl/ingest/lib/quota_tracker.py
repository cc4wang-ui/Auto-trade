"""YouTube Data API v3 quota cost table + accumulator.

Costs per https://developers.google.com/youtube/v3/determine_quota_cost
(only the methods we actually call are listed).
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import List

QUOTA_COSTS = {
    "channels.list": 1,
    "playlistItems.list": 1,
    "videos.list": 1,
    "search.list": 100,
    "commentThreads.list": 1,
    "comments.list": 1,
}


@dataclass
class QuotaEvent:
    api_method: str
    units: int
    http_status: int
    result_count: int
    error_message: str = ""
    call_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class QuotaTracker:
    """Accumulates quota events for the duration of one Cloud Run invocation."""

    def __init__(self, run_id: str):
        self.run_id = run_id
        self.events: List[QuotaEvent] = []

    def record(
        self,
        api_method: str,
        http_status: int = 200,
        result_count: int = 0,
        error_message: str = "",
    ) -> None:
        units = QUOTA_COSTS.get(api_method)
        if units is None:
            raise KeyError(f"Unknown API method '{api_method}' — add it to QUOTA_COSTS")
        self.events.append(
            QuotaEvent(
                api_method=api_method,
                units=units,
                http_status=http_status,
                result_count=result_count,
                error_message=error_message,
            )
        )

    def total_units(self) -> int:
        return sum(e.units for e in self.events)
