"""API response → BigQuery row transforms. Pure functions, easy to unit-test."""
import json
from datetime import datetime, timezone
from typing import Optional


def _to_int(v) -> Optional[int]:
    if v is None or v == "":
        return None
    return int(v)


def _iso_to_seconds(iso8601_duration: Optional[str]) -> Optional[int]:
    """PT1H2M3S -> 3723. Returns None for unparseable input."""
    if not iso8601_duration or not iso8601_duration.startswith("PT"):
        return None
    s = iso8601_duration[2:]
    total = 0
    num = ""
    for ch in s:
        if ch.isdigit():
            num += ch
        elif ch == "H":
            total += int(num) * 3600
            num = ""
        elif ch == "M":
            total += int(num) * 60
            num = ""
        elif ch == "S":
            total += int(num)
            num = ""
    return total


def video_to_snapshot_row(
    item: dict, snapshot_at: datetime, poll_mode: str, run_id: str
) -> dict:
    snippet = item.get("snippet", {})
    stats = item.get("statistics", {})
    content = item.get("contentDetails", {})
    live = item.get("liveStreamingDetails") or {}
    return {
        "snapshot_date": snapshot_at.date().isoformat(),
        "snapshot_at": snapshot_at.isoformat(),
        "poll_mode": poll_mode,
        "video_id": item["id"],
        "channel_id": snippet.get("channelId"),
        "title": snippet.get("title"),
        "description": snippet.get("description"),
        "published_at": snippet.get("publishedAt"),
        "duration_iso8601": content.get("duration"),
        "duration_seconds": _iso_to_seconds(content.get("duration")),
        "category_id": snippet.get("categoryId"),
        "default_language": snippet.get("defaultLanguage") or snippet.get("defaultAudioLanguage"),
        "is_live_broadcast": bool(live),
        "live_actual_start_time": live.get("actualStartTime"),
        "live_actual_end_time": live.get("actualEndTime"),
        "live_scheduled_time": live.get("scheduledStartTime"),
        "view_count": _to_int(stats.get("viewCount")),
        "like_count": _to_int(stats.get("likeCount")),
        "comment_count": _to_int(stats.get("commentCount")),
        "favorite_count": _to_int(stats.get("favoriteCount")),
        "thumbnail_url": (snippet.get("thumbnails", {}).get("high") or {}).get("url"),
        "raw_json": json.dumps(item, ensure_ascii=False),
        "ingest_run_id": run_id,
    }


def comment_thread_to_row(item: dict, snapshot_at: datetime, run_id: str) -> dict:
    top = item["snippet"]["topLevelComment"]
    s = top["snippet"]
    return {
        "snapshot_date": snapshot_at.date().isoformat(),
        "snapshot_at": snapshot_at.isoformat(),
        "comment_id": top["id"],
        "video_id": item["snippet"]["videoId"],
        "channel_id": item["snippet"]["channelId"],
        "author_channel_id": (s.get("authorChannelId") or {}).get("value"),
        "author_display_name": s.get("authorDisplayName"),
        "text_original": s.get("textOriginal"),
        "text_display": s.get("textDisplay"),
        "like_count": _to_int(s.get("likeCount")),
        "reply_count": _to_int(item["snippet"].get("totalReplyCount")),
        "published_at": s.get("publishedAt"),
        "updated_at": s.get("updatedAt"),
        "is_pinned": False,
        "ingest_run_id": run_id,
    }


def live_metrics_to_row(
    item: dict, snapshot_at: datetime, run_id: str
) -> Optional[dict]:
    """Returns None if the video is not currently live (no concurrentViewers)."""
    live = item.get("liveStreamingDetails") or {}
    cv = live.get("concurrentViewers")
    if cv is None:
        return None
    return {
        "snapshot_date": snapshot_at.date().isoformat(),
        "snapshot_at": snapshot_at.isoformat(),
        "video_id": item["id"],
        "channel_id": item["snippet"]["channelId"],
        "concurrent_viewers": _to_int(cv),
        "active_live_chat_id": live.get("activeLiveChatId"),
        "ingest_run_id": run_id,
    }


def analytics_response_to_row(
    channel_id: str, report_date_iso: str, response: dict, run_id: str
) -> Optional[dict]:
    """Convert YouTube Analytics v2 query response into a single analytics_daily row."""
    rows = response.get("rows") or []
    if not rows:
        return None
    headers = [h["name"] for h in response["columnHeaders"]]
    by_name = dict(zip(headers, rows[0]))
    return {
        "report_date": report_date_iso,
        "channel_id": channel_id,
        "views": _to_int(by_name.get("views")),
        "unique_viewers": _to_int(by_name.get("uniqueViewers")),
        "estimated_minutes_watched": _to_int(by_name.get("estimatedMinutesWatched")),
        "average_view_duration": by_name.get("averageViewDuration"),
        "estimated_revenue_usd": by_name.get("estimatedRevenue"),
        "estimated_ad_revenue_usd": by_name.get("estimatedAdRevenue"),
        "cpm_usd": by_name.get("cpm"),
        "subscribers_gained": _to_int(by_name.get("subscribersGained")),
        "subscribers_lost": _to_int(by_name.get("subscribersLost")),
        "likes": _to_int(by_name.get("likes")),
        "shares": _to_int(by_name.get("shares")),
        "comments": _to_int(by_name.get("comments")),
        "raw_json": json.dumps(response, ensure_ascii=False),
        "ingest_run_id": run_id,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }
