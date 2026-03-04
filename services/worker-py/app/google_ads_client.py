from __future__ import annotations

import json
import random
import re
import time
from pathlib import Path
from typing import Any

import requests


class GoogleAdsAPIError(RuntimeError):
    """Raised when a Google Ads API request fails after retries."""


class GoogleAdsClient:
    """
    Transplanted and adapted from trd-googleads/src/ads_reporter/google_ads_client.py.
    Preserves the proven token refresh and retry/backoff behavior used in production.
    """

    def __init__(
        self,
        *,
        developer_token: str,
        refresh_token: str,
        oauth_client_secrets_file: Path | None,
        oauth_client_secrets_payload: dict[str, Any] | None,
        api_version: str,
        login_customer_id: str | None = None,
    ) -> None:
        self._developer_token = developer_token
        self._refresh_token = refresh_token
        self._api_version = api_version
        self._login_customer_id = login_customer_id.replace("-", "") if login_customer_id else None

        self._client_id, self._client_secret = self._load_client_secrets(
            oauth_client_secrets_file=oauth_client_secrets_file,
            oauth_client_secrets_payload=oauth_client_secrets_payload,
        )
        self._access_token: str | None = None
        self._access_token_expires_at: float = 0.0
        self._version_candidates = self._build_version_candidates(api_version)
        self._session = requests.Session()
        self._last_request_at: float = 0.0
        self._min_request_spacing_seconds: float = 0.20

    @staticmethod
    def _extract_retry_delay_seconds(response_text: str) -> int | None:
        try:
            payload = json.loads(response_text)
        except Exception:
            payload = None

        if isinstance(payload, list) and payload:
            payload = payload[0]
        if isinstance(payload, dict):
            try:
                details = payload.get("error", {}).get("details", []) or []
                for detail in details:
                    if isinstance(detail, dict) and "errors" in detail:
                        for err in detail.get("errors", []) or []:
                            quota_details = (err.get("details") or {}).get("quotaErrorDetails") or {}
                            retry = str(quota_details.get("retryDelay") or "").strip()
                            if retry.endswith("s") and retry[:-1].isdigit():
                                return int(retry[:-1])
            except Exception:
                pass

        match = re.search(r"Retry in (\\d+) seconds", response_text)
        if match:
            return int(match.group(1))
        match = re.search(r'retryDelay"\\s*:\\s*"(\\d+)s', response_text)
        if match:
            return int(match.group(1))
        return None

    @staticmethod
    def _normalize_version(version: str) -> str:
        version = version.strip().lower()
        if not version:
            return "v22"
        if version.startswith("v"):
            return version
        if version.isdigit():
            return f"v{version}"
        return version

    @classmethod
    def _build_version_candidates(cls, preferred: str) -> list[str]:
        preferred_norm = cls._normalize_version(preferred)
        fallback = ["v22", "v21", "v20", "v19"]
        versions: list[str] = []
        for version in [preferred_norm, *fallback]:
            if version not in versions:
                versions.append(version)
        return versions

    @staticmethod
    def _load_client_secrets(
        *, oauth_client_secrets_file: Path | None, oauth_client_secrets_payload: dict[str, Any] | None
    ) -> tuple[str, str]:
        if oauth_client_secrets_payload:
            payload = oauth_client_secrets_payload
        else:
            if oauth_client_secrets_file is None:
                raise ValueError("oauth_client_secrets_file is required when oauth_client_secrets_payload is not provided")
            payload = json.loads(oauth_client_secrets_file.read_text(encoding="utf-8"))

        installed = payload.get("installed") or payload.get("web")
        if not installed:
            raise ValueError("OAuth client secrets JSON must contain either 'installed' or 'web'.")

        client_id = installed.get("client_id")
        client_secret = installed.get("client_secret")
        if not client_id or not client_secret:
            raise ValueError("OAuth client secrets missing client_id/client_secret")
        return str(client_id), str(client_secret)

    def _refresh_access_token(self) -> None:
        response = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "refresh_token": self._refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=30,
        )

        if response.status_code >= 400:
            raise GoogleAdsAPIError(f"OAuth refresh failed ({response.status_code}): {response.text[:500]}")

        payload = response.json()
        self._access_token = payload["access_token"]
        expires_in = int(payload.get("expires_in", 3600))
        self._access_token_expires_at = time.time() + max(60, expires_in - 120)

    def _get_access_token(self) -> str:
        if not self._access_token or time.time() >= self._access_token_expires_at:
            self._refresh_access_token()
        return self._access_token

    def _sleep_for_spacing(self) -> None:
        now = time.time()
        delta = now - self._last_request_at
        if delta < self._min_request_spacing_seconds:
            time.sleep(self._min_request_spacing_seconds - delta)
        self._last_request_at = time.time()

    def _post_with_retries(self, *, url: str, headers: dict[str, str], payload: dict[str, Any]) -> requests.Response:
        max_attempts = 6
        retryable_statuses = {429, 500, 502, 503, 504}
        last_response: requests.Response | None = None

        for attempt in range(max_attempts):
            self._sleep_for_spacing()
            response = self._session.post(url, headers=headers, json=payload, timeout=120)
            last_response = response

            if response.status_code < 400:
                return response

            if response.status_code == 401 and attempt < max_attempts - 1:
                self._refresh_access_token()
                headers["Authorization"] = f"Bearer {self._get_access_token()}"
                continue

            should_retry = response.status_code in retryable_statuses
            is_last = attempt >= (max_attempts - 1)
            if should_retry and not is_last:
                if response.status_code == 429:
                    retry_delay = self._extract_retry_delay_seconds(response.text)
                    if retry_delay is not None and retry_delay >= 60:
                        return response

                retry_after = response.headers.get("Retry-After", "").strip()
                if retry_after.isdigit():
                    delay = max(1.0, float(retry_after))
                else:
                    base = min(30.0, 1.5 * (2**attempt))
                    delay = base + random.random()
                time.sleep(delay)
                continue

            return response

        return last_response  # pragma: no cover

    def search_stream(self, customer_id: str, query: str) -> list[dict[str, Any]]:
        customer_id_digits = customer_id.replace("-", "")
        headers = {
            "Authorization": f"Bearer {self._get_access_token()}",
            "developer-token": self._developer_token,
            "Content-Type": "application/json",
        }
        if self._login_customer_id:
            headers["login-customer-id"] = self._login_customer_id

        last_error: str | None = None
        for version in self._version_candidates:
            url = f"https://googleads.googleapis.com/{version}/customers/{customer_id_digits}/googleAds:searchStream"
            response = self._post_with_retries(url=url, headers=headers, payload={"query": query})

            if response.status_code == 404:
                last_error = (
                    f"Google Ads query failed ({response.status_code}) for customer {customer_id_digits}: "
                    f"{response.text[:1200]}"
                )
                continue

            if response.status_code >= 400:
                retry_delay = None
                if response.status_code == 429:
                    retry_delay = self._extract_retry_delay_seconds(response.text)
                raise GoogleAdsAPIError(
                    f"Google Ads query failed ({response.status_code}) for customer {customer_id_digits}: "
                    f"{response.text[:1200]}"
                    + (f" | retry_after_seconds={retry_delay}" if retry_delay else "")
                )

            self._api_version = version
            payload = response.json()
            chunks = payload if isinstance(payload, list) else [payload]
            rows: list[dict[str, Any]] = []
            for chunk in chunks:
                rows.extend(chunk.get("results", []))
            return rows

        raise GoogleAdsAPIError(last_error or "Google Ads query failed with an unknown error.")
