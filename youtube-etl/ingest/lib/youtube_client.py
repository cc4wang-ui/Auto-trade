"""Thin wrapper over the YouTube Data API v3 client.

Every API call goes through this wrapper so quota usage is logged consistently.
Retries on transient errors via tenacity; raises on quotaExceeded so the caller
can stop the batch instead of burning through more units.
"""
from typing import Iterator, List

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.oauth2.credentials import Credentials
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .quota_tracker import QuotaTracker


class QuotaExceededError(RuntimeError):
    """Raised when YouTube returns 403 quotaExceeded — caller must stop."""


class YouTubeDataClient:
    def __init__(self, credentials: Credentials, tracker: QuotaTracker):
        self._svc = build("youtube", "v3", credentials=credentials, cache_discovery=False)
        self._tracker = tracker

    @retry(
        retry=retry_if_exception_type(HttpError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        reraise=True,
    )
    def _execute(self, api_method: str, request) -> dict:
        try:
            resp = request.execute()
        except HttpError as exc:
            status = exc.resp.status
            if status == 403 and b"quotaExceeded" in exc.content:
                self._tracker.record(api_method, http_status=status, error_message="quotaExceeded")
                raise QuotaExceededError(api_method) from exc
            self._tracker.record(api_method, http_status=status, error_message=str(exc))
            raise
        result_count = len(resp.get("items", []))
        self._tracker.record(api_method, http_status=200, result_count=result_count)
        return resp

    def list_channel_uploads_playlist(self, channel_id: str) -> str:
        resp = self._execute(
            "channels.list",
            self._svc.channels().list(part="contentDetails", id=channel_id, maxResults=1),
        )
        items = resp.get("items", [])
        if not items:
            raise ValueError(f"Channel not found: {channel_id}")
        return items[0]["contentDetails"]["relatedPlaylists"]["uploads"]

    def iter_playlist_video_ids(
        self, playlist_id: str, max_pages: int = 4
    ) -> Iterator[str]:
        """Yield video_ids from a playlist (50 per page; default cap = 200 most recent)."""
        page_token = None
        for _ in range(max_pages):
            resp = self._execute(
                "playlistItems.list",
                self._svc.playlistItems().list(
                    part="contentDetails",
                    playlistId=playlist_id,
                    maxResults=50,
                    pageToken=page_token,
                ),
            )
            for item in resp.get("items", []):
                yield item["contentDetails"]["videoId"]
            page_token = resp.get("nextPageToken")
            if not page_token:
                return

    def videos_list(self, video_ids: List[str]) -> List[dict]:
        """Fetch full statistics + contentDetails + liveStreamingDetails for up to 50 ids."""
        if not video_ids:
            return []
        if len(video_ids) > 50:
            raise ValueError("videos.list accepts max 50 ids per call; chunk before calling")
        resp = self._execute(
            "videos.list",
            self._svc.videos().list(
                part="snippet,statistics,contentDetails,liveStreamingDetails",
                id=",".join(video_ids),
                maxResults=50,
            ),
        )
        return resp.get("items", [])

    def comment_threads(self, video_id: str, max_pages: int = 2) -> List[dict]:
        """Top-level comment threads (default cap 200 per video). Skips disabled-comments videos."""
        out: List[dict] = []
        page_token = None
        for _ in range(max_pages):
            try:
                resp = self._execute(
                    "commentThreads.list",
                    self._svc.commentThreads().list(
                        part="snippet",
                        videoId=video_id,
                        maxResults=100,
                        pageToken=page_token,
                        order="time",
                    ),
                )
            except HttpError as exc:
                if exc.resp.status == 403 and b"commentsDisabled" in exc.content:
                    return out
                raise
            out.extend(resp.get("items", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        return out
