# worker-py

FastAPI service for heavy adapters in Blitz AI Agent v1.

## Endpoints

- `GET /health`
- `POST /v1/google-ads/query`
- `POST /v1/attribution/sync`

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```
