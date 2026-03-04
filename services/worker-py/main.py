from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException

from app.attribution import coerce_date_range, map_ga4_rows, map_gbp_rows, map_google_ads_rows
from app.config import load_settings, resolve_oauth_client_secrets_file
from app.ga4_client import fetch_ga4_daily_metrics
from app.gaql_queries import daily_metrics_query
from app.google_ads_client import GoogleAdsAPIError, GoogleAdsClient
from app.models import (
    AttributionSyncRequest,
    AttributionSyncResponse,
    GoogleAdsConnectionInput,
    GoogleAdsQueryRequest,
    GoogleAdsQueryResponse,
)

settings = load_settings()
app = FastAPI(title="TRD Blitz Worker PY", version="0.1.0")


def _build_google_ads_client(connection: GoogleAdsConnectionInput) -> GoogleAdsClient:
    oauth_payload = connection.oauth_client_secrets_json
    oauth_file: Path | None = None
    if oauth_payload is None:
        oauth_file = resolve_oauth_client_secrets_file(connection.oauth_client_secrets_file)
        if not oauth_file.exists():
            raise HTTPException(
                status_code=400,
                detail=f"OAuth client secrets file not found: {oauth_file}",
            )

    return GoogleAdsClient(
        developer_token=connection.developer_token,
        refresh_token=connection.refresh_token,
        oauth_client_secrets_file=oauth_file,
        oauth_client_secrets_payload=oauth_payload,
        api_version=connection.api_version or settings.default_google_ads_api_version,
        login_customer_id=connection.login_customer_id,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/google-ads/query", response_model=GoogleAdsQueryResponse)
def google_ads_query(request: GoogleAdsQueryRequest) -> GoogleAdsQueryResponse:
    try:
        client = _build_google_ads_client(request.connection)
        rows = client.search_stream(request.customer_id, request.query)
        return GoogleAdsQueryResponse(rows=rows)
    except GoogleAdsAPIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:  # pragma: no cover - defensive fallback
        raise HTTPException(status_code=500, detail=f"Google Ads query failed: {error}") from error


@app.post("/v1/attribution/sync", response_model=AttributionSyncResponse)
def attribution_sync(request: AttributionSyncRequest) -> AttributionSyncResponse:
    date_from, date_to = coerce_date_range(request.date_from, request.date_to)
    rows = []

    if request.google_ads is not None:
        try:
            query = daily_metrics_query(date_from, date_to)
            client = _build_google_ads_client(request.google_ads.connection)
            ads_rows = client.search_stream(request.google_ads.customer_id, query)
            rows.extend(map_google_ads_rows(request, ads_rows))
        except GoogleAdsAPIError as error:
            raise HTTPException(status_code=502, detail=f"Google Ads sync failed: {error}") from error

    if request.ga4 is not None:
        try:
            ga4_rows = fetch_ga4_daily_metrics(request.ga4, date_from, date_to)
            rows.extend(map_ga4_rows(request, ga4_rows))
        except Exception as error:
            raise HTTPException(status_code=502, detail=f"GA4 sync failed: {error}") from error

    rows.extend(map_gbp_rows(request))
    rows.sort(key=lambda row: (str(row.date), row.channel))

    return AttributionSyncResponse(rows=rows)
