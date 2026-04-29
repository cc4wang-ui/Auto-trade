"""Hourly job: poll videos in 'hourly' mode for fresh stats + comment delta.
Promotes graduated videos to 'daily' once they age past the new-video window.

Endpoint: POST /jobs/hourly. Cloud Scheduler triggers every hour.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from lib.bq_writer import BqWriter
from lib.config import Config
from lib.quota_tracker import QuotaTracker
from lib.secrets import load_credentials
from lib.transforms import comment_thread_to_row, video_to_snapshot_row
from lib.youtube_client import QuotaExceededError, YouTubeDataClient

log = logging.getLogger(__name__)


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def run(cfg: Config) -> dict:
    run_id = f"hourly-{uuid.uuid4().hex[:12]}"
    snapshot_at = datetime.now(timezone.utc)
    graduate_threshold = snapshot_at - timedelta(hours=cfg.new_video_window_hours)

    bq = BqWriter(cfg)
    tracker = QuotaTracker(run_id)
    creds = load_credentials(cfg)
    yt = YouTubeDataClient(creds, tracker)

    targets = bq.list_videos_in_mode("hourly")
    if not targets:
        bq.write_quota_log(tracker)
        return {"run_id": run_id, "videos_polled": 0, "quota_units": 0}
    log.info("hourly run %s polling %d videos", run_id, len(targets))

    video_rows: list[dict] = []
    comment_rows: list[dict] = []
    poll_state_upserts: list[dict] = []

    try:
        for chunk in chunked([t["video_id"] for t in targets], 50):
            items = yt.videos_list(chunk)
            for item in items:
                video_rows.append(video_to_snapshot_row(item, snapshot_at, "hourly", run_id))

                pub = item.get("snippet", {}).get("publishedAt")
                pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00")) if pub else None
                live = item.get("liveStreamingDetails") or {}
                is_live = bool(live.get("actualStartTime")) and not live.get("actualEndTime")
                graduate = pub_dt is not None and pub_dt < graduate_threshold

                poll_state_upserts.append({
                    "video_id": item["id"],
                    "channel_id": item["snippet"]["channelId"],
                    "published_at": pub,
                    "mode": "daily" if graduate else "hourly",
                    "last_polled_at": snapshot_at.isoformat(),
                    "graduated_at": snapshot_at.isoformat() if graduate else None,
                    "is_live_active": is_live,
                    "updated_at": snapshot_at.isoformat(),
                })

        # Comments — one call per hourly video; allowed because hourly set is small
        for tgt in targets:
            threads = yt.comment_threads(tgt["video_id"], max_pages=2)
            for th in threads:
                comment_rows.append(comment_thread_to_row(th, snapshot_at, run_id))
    except QuotaExceededError as e:
        log.error("quota exceeded mid-run after %d units: %s", tracker.total_units(), e)
    finally:
        bq.write_videos_snapshots(video_rows)
        bq.write_comments_snapshots(comment_rows)
        bq.upsert_poll_state(poll_state_upserts)
        bq.write_quota_log(tracker)

    return {
        "run_id": run_id,
        "videos_polled": len(video_rows),
        "comments_written": len(comment_rows),
        "graduated": sum(1 for p in poll_state_upserts if p["mode"] == "daily"),
        "quota_units": tracker.total_units(),
    }
