"""Secret Manager helpers + OAuth credentials loader for the mikai shared account."""
from functools import lru_cache

from google.auth.transport.requests import Request
from google.cloud import secret_manager
from google.oauth2.credentials import Credentials

from lib.config import Config

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
]


@lru_cache(maxsize=8)
def _read_secret(project_id: str, name: str) -> str:
    client = secret_manager.SecretManagerServiceClient()
    path = f"projects/{project_id}/secrets/{name}/versions/latest"
    return client.access_secret_version(name=path).payload.data.decode("utf-8")


def load_credentials(cfg: Config) -> Credentials:
    """Load OAuth Credentials for the mikai shared account.

    The refresh token must have been generated once via the desktop OAuth flow
    against a client whose redirect URIs include http://localhost; see
    docs/phase-0-ops-checklist.md for the bootstrap procedure.
    """
    refresh_token = _read_secret(cfg.project_id, cfg.secret_oauth_refresh_token)
    client_id = _read_secret(cfg.project_id, cfg.secret_oauth_client_id)
    client_secret = _read_secret(cfg.project_id, cfg.secret_oauth_client_secret)

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=YOUTUBE_SCOPES,
    )
    creds.refresh(Request())
    return creds
