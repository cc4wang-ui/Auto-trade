"""Live poll job: 5-minute trigger. For videos flagged is_live_active in poll_state,
fetch concurrentViewers and write to live_metrics_snapshot. Marks broadcast as ended
once liveStreamingDetails.actualEndTime appears.

Endpoint: POST /jobs/live-poll.
"""
import logging
import uuid
from datetime import datetime, timezone

from lib.bq_writer import BqWriter
from lib.config import Config
from lib.quota_tracker import QuotaTracker
from lib.secrets import load_credentials
from lib.transforms import live_metrics_to_row
from lib.youtube_client import QuotaExceededError, YouTubeDataClient

log = logging.getLogger(__name__)


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def run(cfg: Config) -> dict:
    run_id = f"live-{uuid.uuid4().hex[:12]}"
    snapshot_at = datetime.now(timezone.utc)

    bq = BqWriter(cfg)
    tracker = QuotaTracker(run_id)
    creds = load_credentials(cfg)
    yt = YouTubeDataClient(creds, tracker)

    targets = bq.list_videos_in_mode("hourly", only_live_active=True)
    if not targets:
        bq.write_quota_log(tracker)
        return {"run_id": run_id, "videos_polled": 0}
    if len(targets) > cfg.live_poll_max_videos:
        log.warning("clamping live poll target list from %d → %d", len(targets), cfg.live_poll_max_videos)
        targets = targets[: cfg.live_poll_max_videos]

    metrics_rows: list[dict] = []
    poll_state_upserts: list[dict] = []
    try:
        for chunk in chunked([t["video_id"] for t in targets], 50):
            items = yt.videos_list(chunk)
            for item in items:
                row = live_metrics_to_row(item, snapshot_at, run_id)
                if row is not None:
                    metrics_rows.append(row)

                live = item.get("liveStreamingDetails") or {}
                ended = bool(live.get("actualEndTime"))
                poll_state_upserts.append({
                    "video_id": item["id"],
                    "channel_id": item["snippet"]["channelId"],
                    "published_at": item.get("snippet", {}).get("publishedAt"),
                    "mode": "hourly",
                    "last_polled_at": snapshot_at.isoformat(),
                    "graduated_at": None,
                    "is_live_active": not ended,
                    "updated_at": snapshot_at.isoformat(),
                })
    except QuotaExceededError as e:
        log.error("quota exceeded mid-run after %d units: %s", tracker.total_units(), e)
    finally:
        bq.write_live_metrics(metrics_rows)
        bq.upsert_poll_state(poll_state_upserts)
        bq.write_quota_log(tracker)

    return {
        "run_id": run_id,
        "videos_polled": len(targets),
        "metrics_written": len(metrics_rows),
        "quota_units": tracker.total_units(),
    }
