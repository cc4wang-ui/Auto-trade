"""Secret Manager helpers + auth loaders for the mikai shared account.

Two auth modes (selected by Config.auth_mode):
- "oauth"  : OAuth refresh token from the mikai shared admin account.
             Required for YouTube Analytics API (revenue, demographics, retention).
- "api_key": Single API key. Works for YouTube Data API only — Analytics calls
             will be skipped. Used when no single OAuth identity has manager
             access to all channels yet (Path C in deployment plan).
"""
from functools import lru_cache

from google.auth.transport.requests import Request
from google.cloud import secretmanager
from google.oauth2.credentials import Credentials

from lib.config import Config

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
]


@lru_cache(maxsize=8)
def _read_secret(project_id: str, name: str) -> str:
    client = secretmanager.SecretManagerServiceClient()
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


def load_api_key(cfg: Config) -> str:
    """Load YouTube Data API key from Secret Manager. Used when auth_mode=='api_key'."""
    return _read_secret(cfg.project_id, cfg.secret_api_key)
