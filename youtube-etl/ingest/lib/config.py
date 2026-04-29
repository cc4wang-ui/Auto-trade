"""Centralised env-var config. Cloud Run injects these at deploy time."""
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    project_id: str
    bq_dataset_raw: str
    bq_dataset_mart: str
    secret_oauth_refresh_token: str
    secret_oauth_client_id: str
    secret_oauth_client_secret: str
    new_video_window_hours: int
    live_poll_max_videos: int


def load() -> Config:
    return Config(
        project_id=os.environ["GCP_PROJECT_ID"],
        bq_dataset_raw=os.environ.get("BQ_DATASET_RAW", "youtube_raw"),
        bq_dataset_mart=os.environ.get("BQ_DATASET_MART", "youtube_mart"),
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
    )
