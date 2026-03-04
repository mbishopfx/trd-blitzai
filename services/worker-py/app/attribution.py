from __future__ import annotations

from datetime import date
from typing import Any

from .models import AttributionDailyMetric, AttributionSyncRequest


def _as_int(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    try:
        return int(float(value))
    except Exception:
        return 0


def _as_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, bool):
        return float(value)
    try:
        return float(value)
    except Exception:
        return 0.0


def map_google_ads_rows(input_data: AttributionSyncRequest, rows: list[dict[str, Any]]) -> list[AttributionDailyMetric]:
    mapped: list[AttributionDailyMetric] = []
    for row in rows:
        segments = row.get("segments") or {}
        metrics = row.get("metrics") or {}
        row_date = segments.get("date")
        if not row_date:
            continue

        mapped.append(
            AttributionDailyMetric(
                organization_id=input_data.organization_id,
                client_id=input_data.client_id,
                location_id=input_data.location_id,
                date=row_date,
                channel="google_ads",
                impressions=_as_int(metrics.get("impressions")),
                clicks=_as_int(metrics.get("clicks")),
                calls=0,
                directions=0,
                conversions=_as_float(metrics.get("conversions")),
                spend=_as_float(metrics.get("costMicros")) / 1_000_000,
                conversion_value=_as_float(metrics.get("conversionsValue")),
                source_payload=row,
            )
        )

    return mapped


def map_ga4_rows(input_data: AttributionSyncRequest, rows: list[dict[str, Any]]) -> list[AttributionDailyMetric]:
    mapped: list[AttributionDailyMetric] = []
    for row in rows:
        mapped.append(
            AttributionDailyMetric(
                organization_id=input_data.organization_id,
                client_id=input_data.client_id,
                location_id=input_data.location_id,
                date=row.get("date"),
                channel="ga4",
                impressions=0,
                clicks=_as_int(row.get("sessions")),
                calls=0,
                directions=0,
                conversions=_as_float(row.get("key_events")),
                spend=0.0,
                conversion_value=_as_float(row.get("conversion_value")),
                source_payload=row,
            )
        )

    return mapped


def map_gbp_rows(input_data: AttributionSyncRequest) -> list[AttributionDailyMetric]:
    mapped: list[AttributionDailyMetric] = []
    for row in input_data.gbp_rows:
        mapped.append(
            AttributionDailyMetric(
                organization_id=input_data.organization_id,
                client_id=input_data.client_id,
                location_id=input_data.location_id,
                date=row.date,
                channel="gbp",
                impressions=row.impressions,
                clicks=row.website_clicks,
                calls=row.calls,
                directions=row.directions,
                conversions=float(row.calls + row.directions),
                spend=0.0,
                conversion_value=0.0,
                source_payload=row.model_dump(mode="json"),
            )
        )
    return mapped


def coerce_date_range(date_from: date, date_to: date) -> tuple[date, date]:
    if date_from <= date_to:
        return date_from, date_to
    return date_to, date_from
