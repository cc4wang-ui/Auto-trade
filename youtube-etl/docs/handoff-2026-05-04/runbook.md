# Runbook — mikai YouTube ETL daily / weekly ops

> What to check, what to do, who fixes what.

## Daily checks (5 min, ideally automated)

### 1. Cloud Run service health

```bash
gcloud run services describe youtube-etl-ingest --region=us-central1 --format='value(status.conditions[0].status)' --project=mikai-yt-data
```
Expected: `True`. If not, dive into logs:
```bash
gcloud run services logs read youtube-etl-ingest --region=us-central1 --limit=50 --project=mikai-yt-data 2>&1 | tail -40
```

### 2. Cloud Scheduler last attempts

```bash
gcloud scheduler jobs list --location=us-central1 --project=mikai-yt-data --format='table(name.basename(),schedule,state,lastAttemptTime)'
```
All 4 jobs should be ENABLED, lastAttemptTime within last cycle (e.g., live-poll within last 5 min).

### 3. Today's quota burn

```bash
bq query --use_legacy_sql=false --project_id=mikai-yt-data "SELECT api_method, SUM(units_consumed) AS units, COUNT(*) AS calls, COUNTIF(http_status >= 400) AS errors FROM \`mikai-yt-data.youtube_raw.quota_log\` WHERE call_date = CURRENT_DATE() GROUP BY api_method ORDER BY units DESC"
```
Expected: ~300-500 units/day, errors close to 0.

### 4. Dashboard refresh succeeded

Open the Sheet → Manager Summary tab → see "Last refreshed: YYYY-MM-DD HH:mm:ss". Should be from today.

If stale: open Apps Script → Triggers (left bar) → verify daily trigger exists. If exists but didn't fire, run `buildDashboard` manually.

## Weekly checks (15 min)

### 1. Path A coverage progression

```bash
bq query --use_legacy_sql=false --project_id=mikai-yt-data "SELECT report_date, COUNT(DISTINCT channel_id) AS analytics_covered_channels, ROUND(SUM(estimated_revenue_usd), 2) AS total_revenue_usd FROM \`mikai-yt-data.youtube_raw.analytics_daily\` WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) GROUP BY report_date ORDER BY report_date DESC"
```

Expected: number rises week-over-week as more talents add mikai admin as Manager.

### 2. Catch up with stragglers

From your tracking sheet, identify talents who haven't completed A.3 (加 Manager). Email their managers, follow up directly if needed.

### 3. Cost monitoring

```bash
gcloud billing accounts list
# Then via Console: Billing → Reports → filter project=mikai-yt-data
```
Expected: < $5/month at this scale. Spike investigation: check for runaway Cloud Run instances or BQ query cost.

## Failure modes & recovery

### Cloud Run returns 500 on `/jobs/daily`

1. Check logs: `gcloud run services logs read youtube-etl-ingest --region=us-central1 --limit=100 --project=mikai-yt-data 2>&1 | tail -60`
2. Look for stack trace. Common causes:
   - **413 BQ insert** → row count exceeded chunk size, increase chunking or fall back to load_table_from_json
   - **HttpError from a channel** → should be caught per-channel; if not, hit Gotcha #50 — check handler code
   - **Quota exceeded** → see Quota recovery below
   - **Memory limit** → bump `--memory=1Gi` on `gcloud run services update`

### Cloud Run returns 404 (Google edge HTML)

**Don't assume auth issue.** Check:
1. URL right? `gcloud run services describe ... --format='value(status.url)'` (Gotcha #43)
2. Ingress = `all`? `gcloud run services describe ... --format='value(metadata.annotations."run.googleapis.com/ingress")'` (Gotcha #45)
3. Container healthy? `gcloud run services describe ... --format='value(status.conditions)'` (Gotcha #44)

### BQ Scheduled Query failed

Console → BigQuery → Scheduled queries → click failing job → Run history → click failed run → see error.

Common causes:
- **Permission**: runner SA missing `roles/iam.serviceAccountTokenCreator` from Data Transfer Service Agent. Re-grant.
- **SQL error**: schema drift from raw layer changes. Re-read DDL, fix SQL.
- **Bootstrap day**: views_delta NULL is expected on first day per channel — not an error.

### Dashboard tabs empty

1. Open Apps Script → Executions (left bar) → latest `buildDashboard` run.
2. Check log for errors. Common:
   - `BigQuery is not defined` → BigQuery API service not added (Apps Script Services menu)
   - `Cannot call SpreadsheetApp.getUi() from this context` → standalone script needs `SpreadsheetApp.openById(SHEET_ID)` not `getActiveSpreadsheet()` (already fixed in current Code.gs)
   - `mart_X_daily empty` → mart rollup didn't run today; manually trigger BQ Scheduled Query

### Quota exceeded

If YouTube Data API quota gets close to 10K daily:
1. Reduce `--max-instances` on Cloud Run (less concurrent execution)
2. Reduce hourly polling: change `youtube-etl-hourly` from `5 * * * *` to `5 */2 * * *` (every 2h)
3. Disable live-poll temporarily: `gcloud scheduler jobs pause youtube-etl-live-poll --location=us-central1`
4. Apply quota increase via Google's audit form (already submitted — await response)

### Apps Script trigger stopped firing

1. Open Apps Script → Triggers (left bar)
2. Check if `buildDashboard` time trigger exists
3. If not: run `setupDailyTrigger()` manually
4. If exists but recent runs are erroring: check Executions, fix root cause, then triggers should resume next cycle

## When to escalate

**To IT** (if it's a 17LIVE/mikai org issue):
- Org policy blocking `--ingress=all` (Gotcha #45)
- Workspace account changes for `youtube-analytics@mikai.tw`
- Network/VPC issues affecting Cloud Run reachability

**To Cross** (if it's a business decision):
- Quota request response from Google
- Talent A.3 completion progress
- Cost spike outside expected $5/month range
- New requirement (e.g., add new mart table, new dashboard tab)

**To future Claude** (this archive's purpose):
- Anything novel — add to dev-guide.md as Gotcha #N+1, push, document in this runbook's failure modes section.

## Operational metrics to track over time

| Metric | Source | Target |
|--------|--------|--------|
| Daily videos ingested | `youtube_raw.videos_snapshot` row count | ~7,500 ± 500 (varies as talents publish/graduate) |
| Daily quota burn | `youtube_raw.quota_log` SUM(units_consumed) | < 1,000 (10% of 10K daily) |
| Channels skipped per daily run | response JSON `channels_skipped` | < 5 (3 was baseline at handoff) |
| Path A coverage | `youtube_raw.analytics_daily` distinct channels | Target 50, currently 0 |
| Dashboard refresh latency | Apps Script execution log time | < 60 sec |
| BQ storage growth | BQ Console → dataset size | < 100 MB / month |
