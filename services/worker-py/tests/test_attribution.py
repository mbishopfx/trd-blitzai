from datetime import date

from app.attribution import map_google_ads_rows
from app.models import AttributionSyncGoogleAdsInput, AttributionSyncRequest, GoogleAdsConnectionInput


def test_map_google_ads_rows() -> None:
    request = AttributionSyncRequest(
        organization_id="org-1",
        client_id="client-1",
        location_id="loc-1",
        date_from=date(2026, 1, 1),
        date_to=date(2026, 1, 7),
        google_ads=AttributionSyncGoogleAdsInput(
            connection=GoogleAdsConnectionInput(
                developer_token="token",
                refresh_token="refresh",
                oauth_client_secrets_json={
                    "installed": {
                        "client_id": "abc",
                        "client_secret": "xyz",
                    }
                },
            ),
            customer_id="1234567890",
        ),
    )

    rows = map_google_ads_rows(
        request,
        [
            {
                "segments": {"date": "2026-01-02"},
                "metrics": {
                    "impressions": "10",
                    "clicks": "2",
                    "conversions": "1",
                    "costMicros": "2500000",
                    "conversionsValue": "123.45",
                },
            }
        ],
    )

    assert len(rows) == 1
    assert rows[0].impressions == 10
    assert rows[0].spend == 2.5
    assert rows[0].conversion_value == 123.45
