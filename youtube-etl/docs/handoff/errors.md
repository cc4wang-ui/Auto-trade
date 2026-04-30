# Errors Playbook — 常見錯誤 → 修法

> Cross 跑 builder-steps 任何一步出錯時的對照表。看到 error message 第一行先 grep 這份。**找不到對應條目 → 直接把整段 log 貼給 Claude**，不要硬解。

## 索引

| 錯誤領域 | 跳轉 |
|---|---|
| GCP 權限 / IAM | [§1](#1-gcp-權限--iam) |
| BigQuery DDL / Query | [§2](#2-bigquery-ddl--query) |
| OAuth bootstrap | [§3](#3-oauth-bootstrap) |
| Cloud Build / Run 部署 | [§4](#4-cloud-build--run-部署) |
| YouTube API quota | [§5](#5-youtube-api-quota) |
| Cloud Scheduler | [§6](#6-cloud-scheduler) |
| 文件 vs 實際不一致 | [§7](#7-文件-vs-實際不一致) |

---

## 1. GCP 權限 / IAM

### `ERROR: Permission denied on resource project ...`
**原因**：Cross 帳號沒有 project 權限。
**修**：找 17LIVE GCP admin（Takashi 是現任 admin 之一）加 `roles/owner`，或最少這 5 個：
- `roles/bigquery.admin`
- `roles/secretmanager.admin`
- `roles/run.admin`
- `roles/cloudscheduler.admin`
- `roles/iam.serviceAccountAdmin`

### `Service account ... does not exist`
**原因**：STEP 5.1 service account 還沒建。
**修**：先跑 `gcloud iam service-accounts create youtube-etl-runtime ...`。

### `iam.serviceAccounts.actAs permission required`
**原因**：部署 Cloud Run 時，**Cross 自己的帳號** 需要對 service account 有 `actAs` 權限。
**修**：
```bash
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="user:cross@mikai.example.com" \
  --role="roles/iam.serviceAccountUser"
```

---

## 2. BigQuery DDL / Query

### `Not found: Dataset ...:youtube_raw`
**原因**：DDL 沒跑 / 跑在錯的 region。
**修**：確認 `BQ_LOCATION` 跟 TikTok dataset 一致，重跑 STEP 2.1。

### `Not found: Table ...:youtube_mart.dim_talent`
**原因**：DDL 一半跑成功一半失敗，or `02_youtube_mart.sql` 沒跑。
**修**：檢查兩個 dataset 的 table 數，缺什麼補什麼：
```bash
bq ls --project_id="$PROJECT_ID" youtube_raw    # 應 6 張
bq ls --project_id="$PROJECT_ID" youtube_mart   # 應 8 張
```

### `${PROJECT_ID} 沒被替換進 SQL`
**症狀**：query 報 `Invalid project ID: ${PROJECT_ID}`。
**原因**：忘了 `envsubst`，或環境變數沒 export。
**修**：
```bash
export PROJECT_ID="..."
envsubst < 01_youtube_raw.sql | bq query --use_legacy_sql=false
```

### Seed query 回 0 列（不是 9）
**原因**：channel CSV upload 失敗 / 路徑錯。
**修**：確認 GCS object：
```bash
gcloud storage ls "gs://${BUCKET}/seed/channels.csv"
gcloud storage cat "gs://${BUCKET}/seed/channels.csv" | head
```

---

## 3. OAuth Bootstrap

### `redirect_uri_mismatch`
**原因**：OAuth client 不是 Desktop type。
**修**：刪掉重建，application type 一定要選 **Desktop app**。

### Browser 開不起來 / `localhost refused to connect`
**原因**：Cross 在遠端 SSH / Cloud Shell 跑這段 Python，但 OAuth flow 要本機 browser。
**修**：**這段 Python 必須在 Cross 自己的 Mac/Windows 跑**，不是 Cloud Shell。拿到 refresh token 後再回 Cloud Shell push secret。

### `Token has been expired or revoked`
**原因**：mikai 共用帳號改密碼 / 開 2FA / 撤銷授權。
**修**：重跑 STEP 4.2 拿新 refresh token，更新 secret：
```bash
echo -n "$NEW_REFRESH_TOKEN" | gcloud secrets versions add youtube-etl-mikai-oauth-refresh-token --data-file=-
```
**預防**：監控 `analytics_daily` 連 2 天 0 row 就告警（`phase-0-ops-checklist.md` Step 8）。

### Scope 錯誤：`Insufficient Permission`
**原因**：refresh token 拿的 scope 沒含 monetary。
**修**：4.2 的 SCOPES 三個都要：
```
youtube.readonly
yt-analytics.readonly
yt-analytics-monetary.readonly       ← 收益必要
```

---

## 4. Cloud Build / Run 部署

### `Cloud Build API has not been used in project ... before or it is disabled`
**修**：
```bash
gcloud services enable cloudbuild.googleapis.com run.googleapis.com artifactregistry.googleapis.com
```

### `Repository ... not found`（Artifact Registry）
**原因**：Artifact Registry repo 沒建。
**修**：
```bash
gcloud artifacts repositories create youtube-etl \
  --repository-format=docker \
  --location="$REGION"
```

### Container 啟動失敗 — Cloud Run logs 看不到 root cause
**修**：
```bash
gcloud run services logs read youtube-etl-ingest --region="$REGION" --limit=100
```
常見：env var 沒設、secret 沒掛、`requirements.txt` 缺套件。

### `Permission 'secretmanager.versions.access' denied`
**原因**：runtime SA 沒拿到 secret accessor。
**修**：重跑 STEP 5.1 的 secret IAM binding 三條 for 迴圈。

---

## 5. YouTube API Quota

### `403 quotaExceeded`
**症狀**：`quota_log.error_message` 有這個字串。
**判斷**：跑這個 query 看當日已用：
```sql
SELECT SUM(units_consumed) FROM `${PROJECT_ID}.youtube_raw.quota_log`
WHERE call_date = CURRENT_DATE();
```

如果 < 10K → 有別的 project 共用 quota / quota 還沒生效。
如果 ≥ 10K 且還沒 quota raise → **正常**，停掉 channel 縮規模等 quota 通過。

**短期止血**：暫時把 50 個 channel 縮成 5 個（is_active=FALSE 其他）。

### `403 forbidden`（不是 quotaExceeded）
**原因**：API 沒 enable / OAuth scope 不夠。
**修**：
```bash
gcloud services enable youtube.googleapis.com youtubeanalytics.googleapis.com
```

### Analytics API 一直回空 array
**原因**：channel 沒有 monetization / 帳號不是 channel owner。
**判斷**：mikai 共用帳號是不是 50 個 channel 的 owner？經紀的 channel 可能是 talent 自己擁有，mikai 只是 manager。
**修**：跟 mikai 確認 ownership。如果 talent 自己擁有，需要 talent 個別授權（每個一個 OAuth client）。

---

## 6. Cloud Scheduler

### Scheduler job 跑了但 Cloud Run 沒收到
**判斷**：
```bash
gcloud scheduler jobs describe youtube-etl-daily --location="$REGION"
gcloud run services logs read youtube-etl-ingest --region="$REGION" --limit=20
```

### `403 Unauthorized`（Scheduler → Cloud Run）
**原因**：Scheduler 用的 service account 沒有 Cloud Run invoker。
**修**：
```bash
gcloud run services add-iam-policy-binding youtube-etl-ingest \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.invoker" \
  --region="$REGION"
```

### Job timeout（540s 不夠）
**症狀**：Cloud Run logs 顯示 `Container terminated by signal 15`。
**修**：分批處理或加大 timeout。最大 3600s：
```bash
gcloud run services update youtube-etl-ingest --timeout=3600 --region="$REGION"
```

---

## 7. 文件 vs 實際不一致

> 已知文件 typo / 過時，遇到時不要當 bug。

| 文件 | 寫了什麼 | 實際 |
|---|---|---|
| `youtube-etl/README.md` "mart 7 tables" | DDL 實際 8 張（fact 3 + mart_kpi 3 + dim 2） | 待 doc 修 |
| `phase-0-ops-checklist.md` Step 1 "youtube_mart 7 tables" | 同上，8 張 | 待 doc 修 |
| `youtube-etl/README.md` 提到 `/root/.claude/plans/youtube-etl-lexical-bonbon.md` | 路徑是 Claude session 內部，不在 repo | 真實設計細節在 `docs/handoff/` |
| 任何文件提到 "Takashi" 是 owner / builder | Cross 是 builder（D-001，2026-04-29 起） | 看 `docs/handoff/decisions.md` D-001 |

---

## 「我完全不知道怎麼辦」的逃生口

1. **不要 panic 刪資料**。raw 層 append-only，所有 mart 都能重算，drop 之前一定先問 Claude。
2. **不要 disable Scheduler 然後忘記**。可能燒 quota。
3. **複製整段 log** + 跑這個 query 給 Claude：
```sql
-- 給 Claude 看當日狀態
SELECT 'quota' AS metric, CAST(SUM(units_consumed) AS STRING) AS value
FROM `${PROJECT_ID}.youtube_raw.quota_log` WHERE call_date = CURRENT_DATE()
UNION ALL
SELECT 'errors', CAST(COUNT(*) AS STRING)
FROM `${PROJECT_ID}.youtube_raw.quota_log`
WHERE call_date = CURRENT_DATE() AND error_message IS NOT NULL
UNION ALL
SELECT 'snapshots', CAST(COUNT(*) AS STRING)
FROM `${PROJECT_ID}.youtube_raw.videos_snapshot` WHERE snapshot_date = CURRENT_DATE();
```
4. Cloud Run logs 抓最近 50 筆給 Claude：
```bash
gcloud run services logs read youtube-etl-ingest --region="$REGION" --limit=50
```
