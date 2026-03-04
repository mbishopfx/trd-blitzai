from __future__ import annotations

from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class GoogleAdsConnectionInput(BaseModel):
    developer_token: str = Field(min_length=5)
    refresh_token: str = Field(min_length=5)
    oauth_client_secrets_file: Optional[str] = None
    oauth_client_secrets_json: Optional[dict[str, Any]] = None
    login_customer_id: Optional[str] = None
    api_version: Optional[str] = None


class GoogleAdsQueryRequest(BaseModel):
    connection: GoogleAdsConnectionInput
    customer_id: str
    query: str


class GoogleAdsQueryResponse(BaseModel):
    rows: list[dict[str, Any]]


class Ga4ConnectionInput(BaseModel):
    access_token: str = Field(min_length=10)
    property_id: str = Field(min_length=3)


class GbpMetricRow(BaseModel):
    date: date
    impressions: int = 0
    website_clicks: int = 0
    calls: int = 0
    directions: int = 0


class AttributionSyncGoogleAdsInput(BaseModel):
    connection: GoogleAdsConnectionInput
    customer_id: str


class AttributionSyncRequest(BaseModel):
    organization_id: str
    client_id: str
    location_id: Optional[str] = None
    date_from: date
    date_to: date
    google_ads: Optional[AttributionSyncGoogleAdsInput] = None
    ga4: Optional[Ga4ConnectionInput] = None
    gbp_rows: list[GbpMetricRow] = Field(default_factory=list)


class AttributionDailyMetric(BaseModel):
    organization_id: str
    client_id: str
    location_id: Optional[str]
    date: date
    channel: Literal["gbp", "ga4", "google_ads"]
    impressions: int
    clicks: int
    calls: int
    directions: int
    conversions: float
    spend: float
    conversion_value: float
    source_payload: dict[str, Any]


class AttributionSyncResponse(BaseModel):
    rows: list[AttributionDailyMetric]
