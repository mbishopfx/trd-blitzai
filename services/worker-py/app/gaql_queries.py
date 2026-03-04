from __future__ import annotations

from datetime import date


def daily_metrics_query(date_from: date, date_to: date) -> str:
    return f"""
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros,
      metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '{date_from.isoformat()}' AND '{date_to.isoformat()}'
    ORDER BY segments.date ASC
    """.strip()
