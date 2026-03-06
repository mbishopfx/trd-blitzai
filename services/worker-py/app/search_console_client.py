from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import requests

from .models import SearchConsoleConnectionInput


def fetch_search_console_daily_metrics(
    connection: SearchConsoleConnectionInput, date_from: date, date_to: date
) -> list[dict[str, Any]]:
    endpoint = (
        "https://searchconsole.googleapis.com/webmasters/v3/sites/"
        f"{requests.utils.quote(connection.property_url, safe='')}/searchAnalytics/query"
    )

    current = date_from
    rows: list[dict[str, Any]] = []
    while current <= date_to:
        response = requests.post(
            endpoint,
            headers={
                "Authorization": f"Bearer {connection.access_token}",
                "Content-Type": "application/json",
            },
            json={
                "startDate": current.isoformat(),
                "endDate": current.isoformat(),
                "dimensions": ["date"],
                "rowLimit": 25000,
                "dataState": "final",
            },
            timeout=60,
        )

        if response.status_code >= 400:
            raise RuntimeError(
                f"Search Console query failed ({response.status_code}): {response.text[:500]}"
            )

        payload = response.json()
        payload_rows = payload.get("rows") or []
        if payload_rows:
            for row in payload_rows:
                keys = row.get("keys") or []
                rows.append(
                    {
                        "date": keys[0] if keys else current.isoformat(),
                        "clicks": int(float(row.get("clicks", 0))),
                        "impressions": int(float(row.get("impressions", 0))),
                    }
                )
        else:
            rows.append(
                {
                    "date": current.isoformat(),
                    "clicks": 0,
                    "impressions": 0,
                }
            )

        current = current + timedelta(days=1)

    return rows
