# Phase 0 Ops Checklist

Deployment runbook executed by **Cross + Claude Code pair** against the existing 17LIVE GCP project (Cross runs gcloud + GCP Console, Claude reads logs and gives the next command). None of these need code changes — they're console + CLI ops. Estimated total: 1 day of work + 1-2 weeks of waiting for the YouTube quota raise. See `docs/handoff/decisions.md` D-001 for the builder assignment history.

> **GCP project**: `project-7f1094dc-792a-4a86-85d` (TikTok PoC lives here; reuse the same project for YouTube ETL)
> **BQ location**: `asia-northeast1` (verify against TikTok dataset's location and match)

---

## Step 1 — Apply BigQuery DDL (~10 min)

```bash
PROJECT_ID="project-7f1094dc-792a-4a86-85d"
BQ_LOCATION="asia-northeast1"   # or whatever the TikTok dataset uses

cd youtube-etl/sql/ddl
for f in 01_youtube_raw.sql 02_youtube_mart.sql; do
  envsubst < "$f" | bq query --use_legacy_sql=false --project_id="$PROJECT_ID"
done
```

Verify:
```bash
bq ls --project_id="$PROJECT_ID" youtube_raw
bq ls --project_id="$PROJECT_ID" youtube_mart
```

Expected: `youtube_raw` has 6 tables, `youtube_mart` has 7 tables.

---

## Step 2 — Load channel list into `dim_talent` (~5 min)

```bash
BUCKET="youtube-etl-seed-${PROJECT_ID}"

# 2a. Create bucket (one-off)
gcloud storage buckets create "gs://${BUCKET}" --project="$PROJECT_ID" --location="$BQ_LOCATION"

# 2b. Upload CSV
gcloud storage cp youtube-etl/data/channels.csv "gs://${BUCKET}/seed/channels.csv"

# 2c. Run the MERGE script
envsubst < youtube-etl/sql/seed/dim_talent_load.sql \
  | bq query --use_legacy_sql=false --project_id="$PROJECT_ID"
```

Expected last query result: per-manager talent count (Manzoku: 7, Kamata: 6, Heimao: 6, Nagai: 6, etc.).

---

## Step 3 — Apply for YouTube Data API quota raise ⚠️ **BLOCKER** (1-2 weeks)

50 channels with hourly polling on new content → estimated 15K-30K units/day. **Default quota is 10K/day**. Must raise before any production runs.

### 3a. Verify current usage
- Console: `APIs & Services` → `YouTube Data API v3` → `Quotas & System Limits`
- Note current `Queries per day` value (should be 10,000 default)

### 3b. Submit Audit & Quota form
- Click `EDIT QUOTA` → `Apply for higher quota`
- Form URL: https://support.google.com/youtube/contact/yt_api_form
- Use **GCP project number** (not project ID) — find it on the project home page

### 3c. Form field draft

> Use this verbatim, only swap the bracketed values.

| Field | Value |
|---|---|
| Project number | `[GCP project number]` |
| Project name | `[GCP project name]` |
| Application home page | `https://17.live` (or the parent corporate URL) |
| Application description | "Internal data analytics pipeline for our talent agency, mikai. We aggregate public statistics for ~50 YouTube channels we operate or manage on behalf of contracted talent. Data is stored in BigQuery and surfaced via Google Sheets dashboards used by our content production team for performance analysis (views, likes, comments, concurrent live viewers). Strictly internal; no public-facing product." |
| API services used | `YouTube Data API v3`, `YouTube Analytics API v2` |
| End-user audience | "Internal employees only (~10 production team members). No public access." |
| Authentication method | "OAuth 2.0 against the channel-owner Google account managed by mikai." |
| Daily query estimate | "We estimate 15,000-30,000 units/day across daily sweeps, hourly polling for newly published videos (≤48h old), and 5-minute live broadcast polling. We request **100,000 units/day** to leave headroom for growth and retries." |
| Compliance | Confirm we will not display API data in a competitive product, will not redistribute, and will respect Terms of Service. |

### 3d. While waiting

Continue with Steps 4-6. The pipeline can be deployed and smoke-tested against 1-2 channels under default quota; production rollout to all 50 is gated on this approval.

---

## Step 4 — OAuth credentials for the mikai shared account (~30 min)

mikai has a shared Google account that has admin access to all 50 channels. We need a **single OAuth refresh token** for this account, scoped for Data + Analytics + Analytics-Monetary read-only.

### 4a. Create OAuth client
- Console (logged in as the **mikai shared account**, not your personal one):
  `APIs & Services` → `Credentials` → `+ CREATE CREDENTIALS` → `OAuth client ID`
- Application type: **Desktop app**
- Name: `youtube-etl-mikai-desktop`
- Download JSON (contains client_id and client_secret)

### 4b. Generate refresh token (one-off, on Cross's laptop — must run in a browser session logged into the mikai shared account)

```bash
pip install google-auth-oauthlib

python3 - <<'PY'
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
]

flow = InstalledAppFlow.from_client_secrets_file("client_secret.json", SCOPES)
creds = flow.run_local_server(port=0)
print("REFRESH_TOKEN =", creds.refresh_token)
PY
```

Browser opens → log in as **mikai shared account** → grant. Copy the refresh token printed at the end.

### 4c. Push secrets to Secret Manager

```bash
echo -n "$CLIENT_ID"      | gcloud secrets create youtube-etl-mikai-oauth-client-id      --data-file=- --project="$PROJECT_ID"
echo -n "$CLIENT_SECRET"  | gcloud secrets create youtube-etl-mikai-oauth-client-secret  --data-file=- --project="$PROJECT_ID"
echo -n "$REFRESH_TOKEN"  | gcloud secrets create youtube-etl-mikai-oauth-refresh-token  --data-file=- --project="$PROJECT_ID"
```

### 4d. Sanity test

```bash
gcloud secrets versions access latest --secret=youtube-etl-mikai-oauth-refresh-token --project="$PROJECT_ID" | wc -c
# Expect ~100+ chars (refresh tokens are typically ~100-200 bytes)
```

> **Risk**: if the mikai shared account changes its password or enables 2FA in a way that invalidates existing OAuth grants, the refresh token dies and the pipeline breaks. Add a dashboard alert (Step 7) on `analytics_daily` row-count = 0.

---

## Step 5 — Create runtime service account + IAM (~10 min)

```bash
SA="youtube-etl-runtime"
SA_EMAIL="${SA}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "$SA" \
  --display-name="YouTube ETL Cloud Run runtime" \
  --project="$PROJECT_ID"

# BigQuery: data editor + job user (no admin)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/bigquery.dataEditor"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/bigquery.jobUser"

# Secret access for the 3 OAuth secrets
for s in youtube-etl-mikai-oauth-client-id youtube-etl-mikai-oauth-client-secret youtube-etl-mikai-oauth-refresh-token; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID"
done
```

---

## Step 6 — Build + deploy Cloud Run service (~20 min)

```bash
REGION="asia-northeast1"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/youtube-etl/ingest:latest"

# Build (from youtube-etl/ingest/ directory)
cd youtube-etl/ingest
gcloud builds submit --tag "$IMAGE" --project="$PROJECT_ID"

# Deploy
gcloud run deploy youtube-etl-ingest \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SA_EMAIL" \
  --no-allow-unauthenticated \
  --memory=512Mi \
  --timeout=540 \
  --max-instances=2 \
  --set-env-vars="GCP_PROJECT_ID=${PROJECT_ID},BQ_DATASET_RAW=youtube_raw,BQ_DATASET_MART=youtube_mart,NEW_VIDEO_WINDOW_HOURS=48,LIVE_POLL_MAX_VIDEOS=20,ANALYTICS_BACKFILL_DAYS=7" \
  --project="$PROJECT_ID"
```

### Schedulers (after smoke test passes)

```bash
SVC_URL=$(gcloud run services describe youtube-etl-ingest --region="$REGION" --format='value(status.url)' --project="$PROJECT_ID")

gcloud scheduler jobs create http youtube-etl-daily \
  --schedule="0 2 * * *" --time-zone="UTC" \
  --uri="${SVC_URL}/jobs/daily" --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" --location="$REGION" --project="$PROJECT_ID"

gcloud scheduler jobs create http youtube-etl-hourly \
  --schedule="0 * * * *" --time-zone="UTC" \
  --uri="${SVC_URL}/jobs/hourly" --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" --location="$REGION" --project="$PROJECT_ID"

gcloud scheduler jobs create http youtube-etl-live \
  --schedule="*/5 * * * *" --time-zone="UTC" \
  --uri="${SVC_URL}/jobs/live-poll" --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" --location="$REGION" --project="$PROJECT_ID"

gcloud scheduler jobs create http youtube-etl-analytics \
  --schedule="0 3 * * *" --time-zone="UTC" \
  --uri="${SVC_URL}/jobs/analytics" --http-method=POST \
  --oidc-service-account-email="$SA_EMAIL" --location="$REGION" --project="$PROJECT_ID"
```

---

## Step 7 — Smoke test (~30 min)

```bash
# Get an ID token to call the authenticated service
TOKEN=$(gcloud auth print-identity-token --audiences="$SVC_URL")

# Test daily on 1 channel by temporarily setting is_active=FALSE for the other 49
# (or just trigger and watch quota_log)
curl -X POST "${SVC_URL}/jobs/daily" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json"
```

Verify in BQ:

```sql
SELECT poll_mode, COUNT(*) AS rows, MIN(snapshot_at) AS min_ts, MAX(snapshot_at) AS max_ts
FROM `project-7f1094dc-792a-4a86-85d.youtube_raw.videos_snapshot`
GROUP BY poll_mode;

SELECT api_method, SUM(units_consumed) AS units, COUNT(*) AS calls
FROM `project-7f1094dc-792a-4a86-85d.youtube_raw.quota_log`
WHERE call_date = CURRENT_DATE()
GROUP BY api_method
ORDER BY units DESC;
```

Pass criteria:
- `videos_snapshot` has rows for every active channel
- `quota_log` total < daily limit
- No `403 quotaExceeded` in `quota_log.error_message`

---

## Step 8 — Monitoring alerts (when promoting to prod)

Add Cloud Monitoring alerts on:
1. `quota_log` daily sum > 80% of approved quota → email on-call (Cross by default)
2. `analytics_daily` row count = 0 for any channel for 2 consecutive days → likely OAuth token revoked
3. Cloud Run 5xx error rate > 1% in any 5-minute window
4. Live poll job 5xx rate > 5% (more tolerant — live broadcasts come and go)

---

## Out of scope for Phase 0

- Phase 3 tagging service (separate Cloud Run; deploy after Phase 1-2 stable)
- Connected Sheets dashboard (Phase 4)
- Booth / Event ingestion (Phase 5)
