"""Daily job: full sweep of all 50 channels. Writes statistics for every recent
video and assigns poll_state mode (hourly for new, daily for established).

Invoked by Cloud Scheduler at 02:00 UTC. Endpoint: POST /jobs/daily.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from googleapiclient.errors import HttpError

from lib.bq_writer import BqWriter
from lib.config import Config
from lib.quota_tracker import QuotaTracker
from lib.transforms import video_to_snapshot_row
from lib.youtube_client import QuotaExceededError, build_data_client

log = logging.getLogger(__name__)


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def run(cfg: Config) -> dict:
    run_id = f"daily-{uuid.uuid4().hex[:12]}"
    snapshot_at = datetime.now(timezone.utc)
    new_window = snapshot_at - timedelta(hours=cfg.new_video_window_hours)

    bq = BqWriter(cfg)
    tracker = QuotaTracker(run_id)
    yt = build_data_client(cfg, tracker)

    channels = bq.list_active_channels()
    log.info(
        "daily run %s starting; channels=%d auth_mode=%s",
        run_id, len(channels), cfg.auth_mode,
    )

    all_video_rows: list[dict] = []
    poll_state_upserts: list[dict] = []
    skipped_channels = 0

    try:
        for ch in channels:
            channel_id = ch["channel_id"]
            try:
                uploads = yt.list_channel_uploads_playlist(channel_id)
            except ValueError:
                log.warning("channel %s missing or removed (channels.list returned 0 items)", channel_id)
                skipped_channels += 1
                continue
            except HttpError as e:
                log.warning("channels.list HttpError for channel=%s: %s", channel_id, e)
                skipped_channels += 1
                continue

            try:
                video_ids = list(yt.iter_playlist_video_ids(uploads, max_pages=4))
            except HttpError as e:
                log.warning(
                    "playlistItems.list HttpError for channel=%s playlist=%s: %s",
                    channel_id, uploads, e,
                )
                skipped_channels += 1
                continue
            if not video_ids:
                continue

            for chunk in chunked(video_ids, 50):
                try:
                    items = yt.videos_list(chunk)
                except HttpError as e:
                    log.warning(
                        "videos.list HttpError for channel=%s chunk_size=%d: %s",
                        channel_id, len(chunk), e,
                    )
                    continue
                for item in items:
                    row = video_to_snapshot_row(item, snapshot_at, "daily", run_id)
                    all_video_rows.append(row)

                    # Decide hourly vs daily mode for this video
                    pub = item.get("snippet", {}).get("publishedAt")
                    pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00")) if pub else None
                    is_new = pub_dt is not None and pub_dt > new_window
                    live = item.get("liveStreamingDetails") or {}
                    is_live = bool(live.get("actualStartTime")) and not live.get("actualEndTime")

                    poll_state_upserts.append({
                        "video_id": item["id"],
                        "channel_id": channel_id,
                        "published_at": pub,
                        "mode": "hourly" if is_new else "daily",
                        "last_polled_at": snapshot_at.isoformat(),
                        "graduated_at": None if is_new else snapshot_at.isoformat(),
                        "is_live_active": is_live,
                        "updated_at": snapshot_at.isoformat(),
                    })
    except QuotaExceededError as e:
        log.error("quota exceeded mid-run after %d units: %s", tracker.total_units(), e)
    finally:
        try:
            bq.write_videos_snapshots(all_video_rows)
        except Exception:
            log.exception("write_videos_snapshots failed (rows=%d)", len(all_video_rows))
        try:
            bq.upsert_poll_state(poll_state_upserts)
        except Exception:
            log.exception("upsert_poll_state failed (rows=%d)", len(poll_state_upserts))
        try:
            bq.write_quota_log(tracker)
        except Exception:
            log.exception("write_quota_log failed")

    return {
        "run_id": run_id,
        "videos_written": len(all_video_rows),
        "poll_state_updates": len(poll_state_upserts),
        "channels_skipped": skipped_channels,
        "quota_units": tracker.total_units(),
    }
