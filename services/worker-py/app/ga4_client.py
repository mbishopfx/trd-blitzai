from __future__ import annotations

from datetime import date
from typing import Any

import requests

from .models import Ga4ConnectionInput


def _normalize_date(raw: str) -> str:
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
    return raw


def fetch_ga4_daily_metrics(connection: Ga4ConnectionInput, date_from: date, date_to: date) -> list[dict[str, Any]]:
    endpoint = f"https://analyticsdata.googleapis.com/v1beta/properties/{connection.property_id}:runReport"
    response = requests.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {connection.access_token}",
            "Content-Type": "application/json",
        },
        json={
            "dateRanges": [
                {
                    "startDate": date_from.isoformat(),
                    "endDate": date_to.isoformat(),
                }
            ],
            "dimensions": [{"name": "date"}],
            "metrics": [{"name": "sessions"}, {"name": "conversions"}, {"name": "totalRevenue"}],
            "keepEmptyRows": True,
        },
        timeout=60,
    )

    if response.status_code >= 400:
        raise RuntimeError(f"GA4 runReport failed ({response.status_code}): {response.text[:500]}")

    payload = response.json()
    rows = payload.get("rows") or []
    normalized: list[dict[str, Any]] = []
    for row in rows:
        dimensions = row.get("dimensionValues") or []
        metrics = row.get("metricValues") or []
        if not dimensions:
            continue

        raw_date = str(dimensions[0].get("value", ""))
        normalized.append(
            {
                "date": _normalize_date(raw_date),
                "sessions": int(float(metrics[0].get("value", 0))) if len(metrics) > 0 else 0,
                "key_events": float(metrics[1].get("value", 0)) if len(metrics) > 1 else 0,
                "conversion_value": float(metrics[2].get("value", 0)) if len(metrics) > 2 else 0,
            }
        )

    return normalized
