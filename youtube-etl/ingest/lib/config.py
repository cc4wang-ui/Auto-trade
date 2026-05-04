"""Centralised env-var config. Cloud Run injects these at deploy time."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    project_id: str
    bq_dataset_raw: str
    bq_dataset_mart: str
    auth_mode: str
    secret_api_key: str
    secret_oauth_refresh_token: str
    secret_oauth_client_id: str
    secret_oauth_client_secret: str
    new_video_window_hours: int
    live_poll_max_videos: int
    analytics_backfill_days: int


def load() -> Config:
    auth_mode = os.environ.get("YOUTUBE_AUTH_MODE", "oauth").lower()
    if auth_mode not in ("oauth", "api_key"):
        raise ValueError(
            f"YOUTUBE_AUTH_MODE must be 'oauth' or 'api_key', got: {auth_mode}"
        )
    return Config(
        project_id=os.environ["GCP_PROJECT_ID"],
        bq_dataset_raw=os.environ.get("BQ_DATASET_RAW", "youtube_raw"),
        bq_dataset_mart=os.environ.get("BQ_DATASET_MART", "youtube_mart"),
        auth_mode=auth_mode,
        secret_api_key=os.environ.get("SECRET_API_KEY", "yt-api-key"),
        secret_oauth_refresh_token=os.environ.get(
            "SECRET_OAUTH_REFRESH_TOKEN", "youtube-etl-mikai-oauth-refresh-token"
        ),
        secret_oauth_client_id=os.environ.get(
            "SECRET_OAUTH_CLIENT_ID", "youtube-etl-mikai-oauth-client-id"
        ),
        secret_oauth_client_secret=os.environ.get(
            "SECRET_OAUTH_CLIENT_SECRET", "youtube-etl-mikai-oauth-client-secret"
        ),
        new_video_window_hours=int(os.environ.get("NEW_VIDEO_WINDOW_HOURS", "48")),
        live_poll_max_videos=int(os.environ.get("LIVE_POLL_MAX_VIDEOS", "20")),
        analytics_backfill_days=int(os.environ.get("ANALYTICS_BACKFILL_DAYS", "7")),
    )
