# Builder Steps — Cross 的部署操作手冊

> 這是 Cross 從零跑到 production 的逐步指南。**白話版本**，每步註明「Cross 動手」或「Claude 接手」。
> 所有 gcloud 指令都跑在 GCP **Cloud Shell**（瀏覽器內建 terminal，不用裝任何東西）。Cloud Shell 入口：Console 右上角 `>_` 圖示。
> 權威指令出處：`../phase-0-ops-checklist.md`。本文是給 Cross 的白話導航。

## 角色分工

| 動作類型 | 誰做 |
|---|---|
| GCP Console 點選、貼 gcloud 指令 | **Cross** |
| OAuth 登入 mikai 帳號（一次性、要授權） | **Cross**（只有他能登 mikai shared account） |
| 填 quota raise form、做產品決策 | **Cross** |
| 寫 / 改 code、SQL、shell 指令 | **Claude** |
| 看錯誤訊息、debug、設計 schema | **Claude** |

**Cross 不需要會 Python**。只要會 copy-paste、看 GCP Console、把錯誤丟給 Claude。

## 整體地圖

```
[本週]                 [等 Google 1-2 週]      [Quota 通過後]
1. GCP setup    ────►  4. OAuth bootstrap ───► 6. 全 50 ch 上線
2. DDL apply           5. Deploy + smoke      7. Connected Sheets
3. Quota raise 送出 ⚠️  （並行：Claude 寫        8. Tagging
                          mart SQL）             9. Booth / Event
```

---

## STEP 1 — 確認 GCP 環境（30 分鐘 / Cross）

### 1.1 切到正確的 project

Cloud Shell 跑：
```bash
gcloud config set project project-7f1094dc-792a-4a86-85d
gcloud config get-value project   # 確認顯示同一個 ID
```

回 permission denied → 跟 Takashi 或 IT 要 `roles/owner`，或至少：
- `roles/bigquery.admin`
- `roles/secretmanager.admin`
- `roles/run.admin`
- `roles/cloudscheduler.admin`
- `roles/iam.serviceAccountAdmin`

### 1.2 確認 BigQuery location

```bash
bq ls --format=prettyjson | grep location
```

記下這個值（例：`asia-northeast1`）。**之後所有 `BQ_LOCATION` 都用這個**。

### 1.3 把 PR 拉到 Cloud Shell

```bash
git clone https://github.com/cc4wang-ui/auto-trade.git
cd auto-trade
git checkout claude/youtube-etl-review-i4TIH
ls youtube-etl/   # 應看到 data / docs / ingest / sql / README.md
```

**Cross 回 Claude 的內容**：`BQ_LOCATION` 的值（例如 `asia-northeast1`）。

---

## STEP 2 — 套 BigQuery DDL + 載 channel（1 小時 / Cross）

### 2.1 套 DDL

```bash
export PROJECT_ID="project-7f1094dc-792a-4a86-85d"
export BQ_LOCATION="asia-northeast1"   # 改成 1.2 確認的值

cd youtube-etl/sql/ddl
for f in 01_youtube_raw.sql 02_youtube_mart.sql; do
  envsubst < "$f" | bq query --use_legacy_sql=false --project_id="$PROJECT_ID"
done
```

驗證：
```bash
bq ls --project_id="$PROJECT_ID" youtube_raw    # 應 6 個 table
bq ls --project_id="$PROJECT_ID" youtube_mart   # 應 7 個 table
```

### 2.2 載 50 channel 進 dim_talent

```bash
export BUCKET="youtube-etl-seed-${PROJECT_ID}"
gcloud storage buckets create "gs://${BUCKET}" --location="$BQ_LOCATION"

cd ../..   # 回到 youtube-etl/ 根
gcloud storage cp data/channels.csv "gs://${BUCKET}/seed/channels.csv"

envsubst < sql/seed/dim_talent_load.sql \
  | bq query --use_legacy_sql=false --project_id="$PROJECT_ID"
```

最後一個 query 應該回 9 列（一個 manager 一列）。看到就 ✅。

**Cross 出錯回 Claude**：把整段 error log 貼給 Claude，**不要硬解**。

---

## STEP 3 — Quota Raise Form ⚠️ **BLOCKER**（20 分鐘 / Cross）

**這個沒填好，後面 1-2 週都不能 production rollout。最早送。**

### 3.1 確認當前 quota
Console → `APIs & Services` → `YouTube Data API v3` → `Quotas & System Limits`。default 是 10,000/day。

### 3.2 送出申請
- 點 `EDIT QUOTA` → `Apply for higher quota`
- Form URL: https://support.google.com/youtube/contact/yt_api_form
- 欄位範本：**`../phase-0-ops-checklist.md` Step 3c 已寫好，直接複製**

關鍵欄位：
- **Project number**（不是 project ID，去 Console 首頁找）
- Daily query estimate：申請 **100,000 units/day**
- End-user audience：強調「internal employees only, ~10 production team」

### 3.3 同時 enable 兩個 API

```bash
gcloud services enable youtube.googleapis.com youtubeanalytics.googleapis.com
```

送出 form 後 → 等 1-2 週。**期間做 STEP 4-5**。

---

## STEP 4 — OAuth Bootstrap（2 小時 / Cross + Claude）

**Cross 親自做，因為要登入 mikai 共用 admin Google account**。Claude 沒辦法替你登。

### 4.1 建 OAuth client（10 分鐘）
- Console **登入 mikai 共用 admin ID**（不是 Cross 個人帳號）
- `APIs & Services` → `Credentials` → `+ CREATE CREDENTIALS` → `OAuth client ID`
- Type: **Desktop app**
- Name: `youtube-etl-mikai-desktop`
- 下載 JSON（裡面有 client_id + client_secret）

### 4.2 跑一次 Python 拿 refresh token（在你筆電）

完整 script 在 `phase-0-ops-checklist.md` Step 4b。簡述：
```bash
pip install google-auth-oauthlib
python3 -c "<那段 7 行 script>"
```

跑完瀏覽器跳出 → **登入 mikai 共用 admin ID** → 同意授權 → terminal 印出 refresh token。

**Cross 卡關 → 截圖丟 Claude**。OAuth flow 是非工程師最容易出錯的點，Claude 看截圖就知道是哪步歪掉。

### 4.3 推 3 個 secret 進 Secret Manager

回 Cloud Shell：
```bash
echo -n "$CLIENT_ID"     | gcloud secrets create youtube-etl-mikai-oauth-client-id     --data-file=-
echo -n "$CLIENT_SECRET" | gcloud secrets create youtube-etl-mikai-oauth-client-secret --data-file=-
echo -n "$REFRESH_TOKEN" | gcloud secrets create youtube-etl-mikai-oauth-refresh-token --data-file=-
```

驗證：
```bash
gcloud secrets versions access latest --secret=youtube-etl-mikai-oauth-refresh-token | wc -c
# 預期 ~100+ 字元
```

---

## STEP 5 — Service Account + IAM + 部署 Cloud Run（2 小時 / Cross）

整段指令在 `phase-0-ops-checklist.md` Step 5-6。Cross 只要 export 變數然後貼。

### 5.1 建 service account
```bash
SA="youtube-etl-runtime"
SA_EMAIL="${SA}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "$SA" \
  --display-name="YouTube ETL Cloud Run runtime"

# BQ + Secret 權限
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA_EMAIL}" --role="roles/bigquery.dataEditor"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${SA_EMAIL}" --role="roles/bigquery.jobUser"

for s in youtube-etl-mikai-oauth-client-id youtube-etl-mikai-oauth-client-secret youtube-etl-mikai-oauth-refresh-token; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor"
done
```

### 5.2 build + deploy

```bash
REGION="asia-northeast1"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/youtube-etl/ingest:latest"

cd youtube-etl/ingest
gcloud builds submit --tag "$IMAGE"

gcloud run deploy youtube-etl-ingest \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SA_EMAIL" \
  --no-allow-unauthenticated \
  --memory=512Mi --timeout=540 --max-instances=2 \
  --set-env-vars="GCP_PROJECT_ID=${PROJECT_ID},BQ_DATASET_RAW=youtube_raw,BQ_DATASET_MART=youtube_mart,NEW_VIDEO_WINDOW_HOURS=48,LIVE_POLL_MAX_VIDEOS=20,ANALYTICS_BACKFILL_DAYS=7"
```

**先不要建 Scheduler**，等 STEP 6 smoke test 過再開排程。

---

## STEP 6 — Smoke Test 1 個 Channel（30 分鐘 / Cross + Claude）

### 6.1 把其他 49 個關掉

BQ Console 跑：
```sql
UPDATE `project-7f1094dc-792a-4a86-85d.youtube_mart.dim_talent`
SET is_active = FALSE
WHERE channel_id != 'UC4OeUf_KfYRrwksschtRYow';   -- 留 花鋏キョウ 一個試
```

### 6.2 手動 trigger daily

```bash
SVC_URL=$(gcloud run services describe youtube-etl-ingest --region=asia-northeast1 --format='value(status.url)')
TOKEN=$(gcloud auth print-identity-token --audiences="$SVC_URL")

curl -X POST "${SVC_URL}/jobs/daily" -H "Authorization: Bearer $TOKEN"
curl -X POST "${SVC_URL}/jobs/analytics" -H "Authorization: Bearer $TOKEN"
```

### 6.3 看資料

```sql
-- 應該有東西
SELECT poll_mode, COUNT(*) FROM `project-7f1094dc-792a-4a86-85d.youtube_raw.videos_snapshot`
GROUP BY poll_mode;

-- Quota 用了多少
SELECT api_method, SUM(units_consumed) AS units
FROM `project-7f1094dc-792a-4a86-85d.youtube_raw.quota_log`
WHERE call_date = CURRENT_DATE()
GROUP BY api_method;

-- Analytics API 通了嗎（有 estimated_revenue_usd 數字 = 通了）
-- 注意：handler 會 backfill 過去 7 天，所以這裡看到 7 row（不是 1 row）
SELECT report_date, views, unique_viewers, estimated_revenue_usd, ingest_run_id
FROM `project-7f1094dc-792a-4a86-85d.youtube_raw.analytics_daily`
WHERE channel_id = 'UC4OeUf_KfYRrwksschtRYow'
ORDER BY report_date DESC;
```

**結果丟 Claude**。Claude 看了會回 (a) 進 6.4 對帳 / (b) 哪裡要修。

### 6.4 YouTube Studio 對帳（vendor 點到的關鍵驗收）

> 為什麼要做：BQ 有數字 ≠ 數字對。實機驗證 BQ 跑出來的 views/likes/comments 跟 YouTube Studio 後台**完全一致**才算 pipeline 通。差超過 5% 就有 bug，不能放全 50 ch 上線。

**步驟**：

1. 用 mikai 共用 admin 登入 https://studio.youtube.com
2. 切到 smoke test 用的那個 channel（花鋏キョウ）
3. 左欄 `Analytics` → `Advanced mode` → 時間範圍選**前天**（`CURRENT_DATE() - 2`，因為 Analytics 數字會 backfill，前天比昨天穩）
4. 記下 4 個數字：**Views / Watch time (hours) / Likes / Comments**
5. 跑這個 BQ query，跟 Studio 對：

```sql
-- 拿 BQ 的數字
SELECT
  report_date,
  views                              AS bq_views,
  ROUND(estimated_minutes_watched / 60.0, 1) AS bq_watch_hours,
  likes                              AS bq_likes,
  comments                           AS bq_comments,
  estimated_revenue_usd              AS bq_revenue
FROM `project-7f1094dc-792a-4a86-85d.youtube_raw.analytics_daily`
WHERE channel_id = 'UC4OeUf_KfYRrwksschtRYow'
  AND report_date = CURRENT_DATE() - 2;
```

**Pass 標準**：

| 指標 | 容差 | 不過 → 怎麼辦 |
|---|---|---|
| Views | < 1% diff | 看 raw_json，可能 Analytics scope 不夠 |
| Watch hours | < 5% diff | 單位轉換錯（API 給秒、Studio 顯示時/分） |
| Likes / Comments | < 1% diff | 同 views 排查 |
| Revenue | < 5% diff | 確認 `yt-analytics-monetary.readonly` scope 在 OAuth |

**4 個都過 → 進 STEP 7 全 50 開**。任何一個不過 → 把 Studio 截圖 + BQ query 結果丟 Claude。

---

## STEP 7 — Quota 通過後全開（半天 / Cross）

Google 回信 quota 拿到 100K 後：

### 7.1 重啟所有 channel
```sql
UPDATE `project-7f1094dc-792a-4a86-85d.youtube_mart.dim_talent`
SET is_active = TRUE
WHERE channel_type = 'main';
```

### 7.2 開 4 個 Scheduler
指令在 `phase-0-ops-checklist.md` Step 6 後半（4 個 `gcloud scheduler jobs create http`）。

### 7.3 24h 後驗證
- `quota_log` daily sum 應該 15K-30K
- `videos_snapshot` 每 channel 都有 row
- 沒有 `403 quotaExceeded` 錯誤

---

## STEP 8 — Phase 1+（之後 / Claude 主動）

Phase 0 過了之後，由 Claude 主導：

| Phase | Claude 寫 | Cross 做 |
|---|---|---|
| Phase 2: mart rollup SQL | `mart_talent_daily_kpi` / weekly / monthly views + comment velocity | 跑 query 看結果是否合理 |
| Phase 3: tagging | 第二個 Cloud Run service + Claude API client | 部署 + review top 20 tag 收成 taxonomy |
| Phase 4: dashboard | 給 view + 教 Connected Sheets | 點選 + 設 refresh schedule |
| Phase 5: Booth / Event | Booth ETL + 統一進 `fact_content_*` | 給 Booth API key + 樣本資料 |

詳細在 `roadmap.md`。

---

## 出錯三守則

1. **不要硬 debug** — 把整個 error log 貼給 Claude，不要剪。
2. **不要刪資料** — 任何「要不要 drop table 重來」的念頭，先問 Claude。
3. **不要關 Cloud Scheduler 就跑去吃飯** — Cron 還在跑，意外可能燒 quota。

常見錯誤對照：`errors.md`。
