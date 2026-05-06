# Gotchas — mikai YouTube ETL deployment

> 25 documented traps (#27-51) from `dev-guide.md`, ETL-relevant section.
> Each one cost Cross at least 1 round of debug. **Read these before
> writing any deployment command, code patch, or Cloud Shell instruction.**
>
> Numbers correspond to `dev-guide.md` for cross-reference.

## Quick category index

| Category | Gotchas |
|----------|---------|
| Cloud Shell paste & command bundling | #27, #39, #41 |
| Cloud Shell session state | #28 |
| GitHub auth in Cloud Shell | #29, #30 |
| BigQuery setup (reservation, location, naming) | #31, #32, #33, #34, #35, #36, #37, #47 |
| GCP API / IAM / Service Account setup | #38, #42 |
| Cloud Run deployment & ingress | #43, #44, #45 |
| Python / service code bugs | #46, #48, #50 |
| YouTube API & ownership | #40, #49 |
| Cross-Claude collaboration | #51 |

---

## 27. 🔴 placeholder `<VALUE>` 不可保留

寫指令給 Cross 時，所有 `<PROJECT_ID>` / `<ASSIGNMENT_ID>` 等尖括號標記，**必須在發給他之前就替換成真實值**。bash 把 `<` 解讀成 input redirect，整段噴 syntax error。

**規則**：發指令前用真實值替換，否則明寫 "把 XXX 改成 YYY 再貼"，但禁止保留尖括號。

## 28. Cloud Shell 新 session 會丟掉 `gcloud config` 和環境變數

開新 tab / 過久重連 → `gcloud config get-value project` 回 `(unset)`、`PROJECT_ID` env var 也消失。

**規則**：每段指令前都 prepend：
```bash
gcloud config set project mikai-yt-data
export PROJECT_ID="mikai-yt-data"
export BQ_LOCATION="US"
```
不要假設 Cross 還在同一個 session。

## 29. GitHub HTTPS 密碼登入 2021 年後砲掉

`git clone` 私有 repo 在 Cloud Shell 噴 `Password authentication is not supported`。

**規則**：`gh auth login` device flow，必須在瀏覽器完整跑完授權（看到綠勾 + terminal 印 `✓ Logged in as`）才能跑任何 git 指令。

## 30. `git fetch origin` 在斷掉的 clone 上不會抓到所有 branch

第一次 clone 失敗留下 broken 資料夾，重跑 `git fetch origin` 只抓 HEAD，看不到目標 branch → `pathspec ... did not match`。

**修法**：`rm -rf` 後用 `git clone -b <branch> <url>` 從乾淨狀態重來。

## 31. BigQuery Editions 對新 project 預設啟用

新 project 跑 `SELECT 1` 也噴 `Cannot run query: project does not have the reservation in the data region or no slots are configured`。

**修法**：建 0-baseline autoscale STANDARD reservation：
```bash
bq mk --reservation --project_id="$PROJECT_ID" --location=US \
  --slots=0 --edition=STANDARD --autoscale_max_slots=100 \
  --ignore_idle_slots=true \
  youtube-etl-rsv

bq mk --reservation_assignment --project_id="$PROJECT_ID" --location=US \
  --reservation_id="${PROJECT_ID}:US.youtube-etl-rsv" \
  --assignee_type=PROJECT --assignee_id="$PROJECT_ID" --job_type=QUERY
```
成本：autoscale only on actual query → ETL 量小月費 < $5。

## 32. BQ reservation name 不能有底線

`youtube_etl_rsv` ❌、`youtube-etl-rsv` ✅。錯誤訊息：`Malformed reservation id ... can only contain lower case alphanumeric characters or dashes`。

## 33. STANDARD edition reservation 必須 `--ignore_idle_slots=true`

不加噴 `STANDARD Reservation can not share idle slots`。enterprise edition 才能 share idle slot。

## 34. BQ reservation 建立後 propagation 有延遲

assignment 建立成功，但接下來幾秒內 query 還是噴一樣的 reservation error。

**規則**：reservation 建完先告訴 Cross "等 1 分鐘再跑下一條"，不要立刻接 query。

## 35. builder-steps.md 寫的 BQ_LOCATION 可能不符合公司現況

Doc 寫 `asia-northeast1`（東京），但 mikai 既有 BQ dataset 在 `US`。

**規則**：套 DDL 前先 `bq ls --format=prettyjson | grep location` 看公司既有 region，不要照抄 doc 範例。同理 `PROJECT_ID` 不要照抄。

## 36. 寫 verify query 前必讀 DDL

DDL `dim_talent` column 是 `manager_name`，不是 `manager`。錯誤訊息 `Unrecognized name: manager`。

**規則**：寫任何 SQL 前先讀對應 DDL 確認 column 名，憑印象寫一定踩坑。

## 37. seed SQL 末尾通常已有 sanity SELECT — 不要再加自己的

`dim_talent_load.sql` 最後就 SELECT manager_name + talent_count + graduated_count，已經夠用。多寫 verify query 只會多一個出錯點。

**規則**：先讀完整個 seed SQL 再決定要不要加 verify。

## 38. GCP API 都是 lazy enable，新 project 第一次碰每個 service 都會噴 `SERVICE_DISABLED`

實測：Secret Manager API 沒開，`gcloud secrets create` 直接噴 403。

**規則**：STEP 1 一次 batch 啟用：
```bash
gcloud services enable \
  secretmanager.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com artifactregistry.googleapis.com iam.googleapis.com \
  bigquery.googleapis.com bigquerydatatransfer.googleapis.com \
  --project=$PROJECT_ID
```

## 39. bash `\` 換行在 Cloud Shell paste 時會被吃掉

從 markdown code fence copy 多行指令（用 `\` 連接）貼進 Cloud Shell，**有時反斜線後面的換行會被當成獨立命令**，導致 `--data-file=-` 噴 `command not found`。

**規則**：給 Cross 的指令一律寫單行，不用 `\` 換行。多參數就一行寫到底，可讀性差但不會炸。

## 40. YouTube channel ownership 分散 ≠ pipeline 死局

50 個 talent 頻道分散在多個 Google 帳號，hoandoff README 假設「single shared OAuth refresh token」會誤導。

**正確拆解**：
- (a) Data API（公開資料：subs / views / 影片 / liveStreamingDetails / search.list live）用**單一 API key** 即可，不分 ownership。
- (b) 只有 Analytics API（watch time / retention / demographics）需要 OAuth 且 token 持有人要是該 channel 的 Owner/Manager。

**規則**：先用 API key 跑 Data API（80% dashboard 可以動），Analytics API 走「統一 mikai admin 帳號加為 Manager」的商務路徑（IT + talent manager 配合）。

## 41. Cloud Shell paste 會把多個 code fence 黏成一行

給 Cross 4 個獨立 fenced block 連續 IAM 指令，他複製貼進 Cloud Shell 時，**第一條結尾跟第二條開頭被連起來**：`--condition=Nonegcloud projects ...`。

**規則**：多步指令必須**包成單一 block**（用 `for ROLE in ... do ... done` 一行 inline 跑迴圈，或用 `&&` 連接，避免空行造成 paste 斷裂）。

## 42. gcloud IAM binding 必須先確認 SA 存在

跳過 `iam service-accounts create` 直接跑 `add-iam-policy-binding` → `INVALID_ARGUMENT: Service account ... does not exist`。

**規則**：bind 前一律先 `gcloud iam service-accounts describe <sa-email>`，並在 create 之後 `sleep 5` 等 IAM eventual consistency。**更高層規則**：部署 script 包成單一 block，不要拆成兩步讓他可能跳過。

## 43. `gcloud run deploy` 印出的 Service URL 在 URL 格式轉換期不一定 routable

實測：deploy 完印 `youtube-etl-ingest-508645124315.us-central1.run.app`，但實際 routable 的是 `youtube-etl-ingest-gvxv3xr45a-uc.a.run.app`，前者打了回 Google 邊緣 404。

**規則**：永遠用 `gcloud run services describe <service> --region=<region> --format='value(status.url)'` 拿真的 URL，不要相信 deploy stdout。

## 44. Cloud Run 404 從 Google 邊緣 ≠ Flask 404

看到 HTML 含 Google logo + `*{margin:0;padding:0}` style + `That's an error` → 這是 Google frontend 回的，**請求根本沒進 container**。

**可能原因**：
- (a) URL 不對（見 #43）
- (b) Ingress 設定 `internal` 阻擋外部呼叫（見 #45）
- (c) Container crash loop 但 Cloud Run condition 還沒翻紅

**規則**：看到 Google 邊緣 404 不要假設是 auth 問題（auth 失敗回 403 才對）。先 `gcloud run services describe` 拿真實 URL + 檢查 ingress + `gcloud run services logs read` 看 container 有沒有起來。

## 45. Cloud Run 部署在企業 GCP org 預設可能 ingress=internal

17LIVE / mikai 等大型 org 常設 `constraints/run.allowedIngress` org policy，新 service 預設 `internal-and-cloud-load-balancing`，從 Cloud Shell（VPC 外）打會被擋在邊緣回 404。

**規則**：`gcloud run deploy` 指令**第一次就明確加 `--ingress=all`**，不要等部署完才用 `services update` 修（update 也可能被 org policy 擋）。如果 org policy 不允許 ingress=all，改用 IAP TCP tunnel 或從 VPC-attached compute 測試。

## 46. `google.cloud.secret_manager` ❌ vs `secretmanager` ✅

PyPI 套件名是 `google-cloud-secret-manager`（hyphen），但 Python module import 是 `from google.cloud import secretmanager`（**no underscore**）。原始 handoff repo 寫成 `secret_manager` 直接 ImportError 噴 worker boot 失敗。

**規則**：碰任何 `google-cloud-*` 系列套件，先 `python -c "from google.cloud import X"` 驗 module 名稱，不要從套件名直接推 module 名。

## 47. BigQuery streaming insert 一次塞 >10MB 噴 413

`insert_rows_json()` 一次傳 ~50MB（10K rows × ~5KB raw_json）→ `Request Entity Too Large`。BQ streaming insertAll 上限是 **10 MB / 50,000 rows / call**。

**規則**：streaming insert helper 一律加 `INSERT_CHUNK_SIZE = 500` 切 chunk（500 row × 5KB = 2.5MB request，雙向 buffer）。或改用 `load_table_from_json`（load job 沒大小限制，但有 ~30s startup 延遲，適合 batch ETL）。

## 48. handler `finally` block 必須每個 write 獨立 try/except

原本：
```python
finally:
    bq.write_videos_snapshots(rows)  # 這裡炸 → 下面 2 個都不跑
    bq.upsert_poll_state(...)
    bq.write_quota_log(tracker)      # ← 失去最重要的 quota 觀測
```

**規則**：finally 裡每個 write 各自 try/except + log.exception。**`quota_log` 尤其重要必須一定 flush**，不然 partial failure 時不知道 burn 了多少 unit。

## 49. Cloud Run `/healthz` GET 被前端攜截不轉 container

Cloud Run frontend 對 `/healthz` 有特殊處理（health probe？），**外部 GET `/healthz` 直接回 Google 邊緣 404**，即使 Flask app 有定義這個 route。

**規則**：smoke test 用 POST `/jobs/analytics`（在 api_key mode 會 no-op 直接回 JSON）當作活性檢查，不要依賴 GET `/healthz`。

## 50. handler 主迴圈每個 per-channel API call 必須各自接 `HttpError`

daily 主迴圈裡，`channels.list / playlistItems.list / videos.list` **任一個拋非 quotaExceeded 的 HttpError（4xx/5xx）都會殺整個 endpoint**，但 `finally` block 仍會 flush 累積資料，造成「BQ 有 6798 rows + endpoint 回 500」的詭異狀態。

**規則**：每個 API call 各自 `try/except HttpError as e: log.warning(...); continue`，把 channel 級錯誤降級為 skip 而非 abort。同時 response JSON 加 `channels_skipped` 計數讓 ops 看得到失敗率。

## 51. 給 Cross 的 code 一律給完整檔，不給 patch

Cross 從訊息複製 GAS / Python / SQL patch 進編輯器容易漏行、縮排錯、整合錯誤函式名（特別是 `function buildDashboard()` 結尾要在 `notify(...)` 前加 1 行這種微調），最終讓他自己 debug。

**規則**：每次更新給整段檔，他清空整個 file 全貼一次。即使只改 1 行也給完整檔。`learnings.md` 主要原則之一。

---

## Meta重新概括

由高到低重要性。未來有限記憶必記得這 5 條：

1. **規則 #51**：給完整檔，不給 patch
2. **規則 #41**：多步 gcloud 包成單一 block（for-loop / && chain）
3. **規則 #43**：Cloud Run URL 一律從 `services describe` 拿，不信 deploy stdout
4. **規則 #45**：Cloud Run 首次 deploy 就加 `--ingress=all`
5. **規則 #38**：碰新 GCP service 先 `gcloud services enable`，STEP 1 一次 batch 啟用
