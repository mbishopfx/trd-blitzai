from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(slots=True)
class Settings:
    host: str
    port: int
    default_google_ads_api_version: str
    request_timeout_seconds: int


def load_settings() -> Settings:
    load_dotenv(override=False)
    return Settings(
        host=os.getenv("WORKER_PY_HOST", "0.0.0.0"),
        port=int(os.getenv("WORKER_PY_PORT", "8001")),
        default_google_ads_api_version=os.getenv("GOOGLE_ADS_API_VERSION", "v22"),
        request_timeout_seconds=int(os.getenv("REQUEST_TIMEOUT_SECONDS", "120")),
    )


def resolve_oauth_client_secrets_file(path_hint: str | None) -> Path:
    if path_hint:
        return Path(path_hint).expanduser()

    env = os.getenv("GOOGLE_OAUTH_CLIENT_SECRETS_FILE")
    if env:
        return Path(env).expanduser()

    return Path("newclawads.json").expanduser()
