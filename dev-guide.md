# 開發指南 Development Guide

## 版本命名
- 主版本：功能大改（v1.0 → v2.0）
- 次版本：新模組或邏輯調整（v1.1 → v1.2）
- 修補版本：bug fix 或小優化（v1.2 → v1.2a）

## 每次修改必須
1. 說明改了什麼以及為什麼
2. 用真實市場案例驗證（優先用 2022 年或當前市場）
3. 確認 `request.security` 總數（上限 40，當前用 13）
4. 更新 `memory/changelog.md`

## Pine Script 規範
- 必須使用 v6（`//@version=6`）
- 所有 `request.security` 必須設 `lookahead=barmerge.lookahead_off`
- 所有除法必須用 `safe_div()` 防止除零
- Z-Score 必須裁剪到 ±3 防止極端值
- 儀表板數值必須同時顯示「數字」和「解讀」（如 `+0.25 △ 擴張`）
- 所有顏色必須用 `color.new()` 包裹
- 所有 `input` 參數必須包含 `tooltip` 說明
- 程式碼片段見 `references/pine-patterns.md`

## 常見陷阱 Gotchas

### Pine Script 陷阱
1. **`FOREXCOM:SPX500` vs `SP:SPX`** — `SP:SPX` 更可靠但某些帳號沒有。N/A 時切換到 `FOREXCOM:SPX500`
2. **`FRED:T10YIE`** — 部分帳號無法取得。fallback 用油價動量替代
3. **`FRED:DFF`** — 有延遲。fallback 用 2Y 殖利率近似
4. **`plot()` vs `line.new()`** — plot 隨圖表縮放移動，固定價位用 line.new()
5. **table 行數上限** — 宣告時預留足夠行數，溢出不報錯但不顯示
6. **`ta.correlation` 的 NaN** — 數據不足回傳 NaN，必須 `nz()` 包裹
7. **Pine Script ternary 不能跨行** — 多條件判斷改用 `switch` 語法
8. **60 分鐘框架的日期判斷** — 同一天有多根K線，用 `var` 狀態機避免重複觸發

### 市場數據陷阱
9. **殖利率曲線假象** — 正值不等於經濟好。Bear Steepening（長端被通膨推高）vs Bull Steepening（短端降息預期）含義相反
10. **PPI/CPI 公布日效應** — 物價數據超預期時 2Y 當天劇烈反應。用 2Y ROC 偵測
11. **油價衝擊非對稱性** — 台灣能源進口國，油價暴漲對台股衝擊 >> 美股
12. **黃金流動性擠壓** — 同步性高時黃金因保證金壓力被拋售，「戰爭=黃金漲」不成立
13. **不要平等加總** — 台股怕油價+匯率，美股怕實質利率，敏感度不同
14. **變化率 > 水位** — 成長指數 +0.3 但快速下降 比 -0.5 但穩定更危險

### v2.0 先行指標陷阱
15. **`COMEX:HG1!`** — 銅期貨連續合約。部分帳號需改 `CAPITALCOM:COPPER`
16. **`CBOE:VIX3M`** — 3 個月 VIX。免費帳號可用，但偶爾有延遲。fallback 用 VIX 本身（此時期限結構比值=1，等於沒有訊號）
17. **`FRED:BAMLH0A0HYM2`** — 高收益利差。延遲 1-2 天，但信用利差是慢變量所以可接受。如果 N/A，信用相關判斷全部跳過
18. **銅金比的絕對值無意義** — 只看方向（ROC）。黃金十年漲 3 倍讓比值長期下降，但不代表經濟一直在弱化
19. **先行指標不能單獨使用** — 設計為「確認或推翻」滯後模組，不是獨立訊號。單看銅金比做交易會被假突破打臉

### 策略（strategy）特有陷阱
20. **`strategy.exit` 的 trail_points 單位是 tick** — 必須除以 `syminfo.mintick` 轉換
21. **`pyramiding` 設定** — 影響最大同時持倉筆數，加碼邏輯必須配合
22. **`process_orders_on_close`** — 必須設 true，否則訊號延遲一根K線
23. **台指期結算日非固定週三** — 春節等假期會調整，不能硬編碼「第三週三」

### 財務分析陷阱（2026/3/25 新增）
24. **🔴 台股股價不可用 AI 訓練資料** — 2025-2026 年半導體股暴漲 50-200%，訓練資料中的價格完全不可信。必須先 `web_search` 拉即時報價再做任何計算。實測案例：台達電訓練資料 480 元 vs 實際 1,550 元（差 3.2 倍）、日月光訓練資料 175 元 vs 實際 350 元（差 2 倍）。錯誤的價格導致 PE 判定、五條件篩選、可買股數全部失準。
25. **財務分析必須按順序** — ① 搜即時股價 → ② 搜財報數據 → ③ 算 PE → ④ 跑篩選 → ⑤ 建表。跳過任何步驟就會出錯。尤其不可「覺得自己知道」就跳過步驟①。越熟悉的股票越容易犯錯。
26. **交叉驗證** — 每個數字都要 sanity check。PE × EPS 應 ≈ 股價。可買股數 × 股價 應 ≈ 預算。不一致代表某個輸入有誤。

### GCP / Cloud Shell / BigQuery 部署陷阱（2026/4/29 新增，youtube-etl 部署實戰踩過）

> Cross 不 debug。這些坑下次給新 Claude 接手時必須先讀，**不要再讓 Cross 來回貼錯誤訊息超過 2 次**。

27. **🔴 placeholder `<VALUE>` 不可保留** — 寫指令給 Cross 時，所有 `<PROJECT_ID>` / `<ASSIGNMENT_ID>` 等尖括號標記，**必須在發給他之前就替換成真實值**。bash 把 `<` 解讀成 input redirect，整段噴 syntax error。實測踩過 2 次（STEP 1.1 切 project、reservation rm 指令）。**規則：發指令前用真實值替換，否則明寫 "把 XXX 改成 YYY 再貼"，但禁止保留尖括號**。

28. **Cloud Shell 新 session 會丟掉 `gcloud config` 和環境變數** — 開新 tab / 過久重連 → `gcloud config get-value project` 回 `(unset)`、`PROJECT_ID` env var 也消失。每段指令前最好都 prepend：
    ```bash
    gcloud config set project mikai-yt-data
    export PROJECT_ID="mikai-yt-data"
    export BQ_LOCATION="US"
    export BUCKET="youtube-etl-seed-${PROJECT_ID}"
    ```
    不要假設 Cross 還在同一個 session。

29. **GitHub HTTPS 密碼登入 2021 年後砍掉** — `git clone` 私有 repo 在 Cloud Shell 噴 `Password authentication is not supported`。修法：`gh auth login` device flow，**必須在瀏覽器完整跑完授權**（看到綠勾 + terminal 印 `✓ Logged in as`）才能跑任何 git 指令。Cross 之前 device flow 沒走完就跑 `git fetch` → 又被問密碼。

30. **`git fetch origin` 在斷掉的 clone 上不會抓到所有 branch** — 第一次 clone 失敗留下 broken 資料夾，重跑 `git fetch origin` 只抓 HEAD，看不到目標 branch → `pathspec ... did not match`。修法：`rm -rf` 後用 `git clone -b <branch> <url>` 從乾淨狀態重來。

31. **BigQuery Editions 對新 project 預設啟用** — `mikai-yt-data` 從未碰過 BQ → 跑 `SELECT 1` 也噴 `Cannot run query: project does not have the reservation in the data region or no slots are configured`。GCP 從 2023 年改成新 project 預設走 capacity (Editions) 模式，沒 reservation 不能跑 query。
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

32. **BQ reservation name 不能有底線** — `youtube_etl_rsv` ❌、`youtube-etl-rsv` ✅。錯誤訊息：`Malformed reservation id ... can only contain lower case alphanumeric characters or dashes`。

33. **STANDARD edition reservation 必須 `--ignore_idle_slots=true`** — 不加噴 `STANDARD Reservation can not share idle slots`。enterprise edition 才能 share idle slot 給其他 reservation。

34. **BQ reservation 建立後 propagation 有延遲** — assignment 建立成功，但接下來幾秒內 query 還是噴一樣的 reservation error。等 60-90 秒再 retry。**規則：reservation 建完先告訴 Cross "等 1 分鐘再跑下一條"，不要立刻接 query**。

35. **builder-steps.md 寫的 BQ_LOCATION 可能不符合公司現況** — doc 寫 `asia-northeast1`（東京），但 mikai 既有 BQ dataset 在 `US`。**規則：套 DDL 前先 `bq ls --format=prettyjson | grep location` 看公司既有 region**，不要照抄 doc 範例。同理 `PROJECT_ID` 不要照抄 doc 範例。

36. **寫 verify query 前必讀 DDL** — DDL `dim_talent` column 是 `manager_name`，不是 `manager`。錯誤訊息 `Unrecognized name: manager`。**規則：寫任何 SQL 前先讀對應 DDL 確認 column 名**，憑印象寫一定踩坑。

37. **seed SQL 末尾通常已有 sanity SELECT — 不要再加自己的** — `dim_talent_load.sql` 最後就 SELECT manager_name + talent_count + graduated_count，已經夠用。多寫 verify query 只會多一個出錯點（column 名打錯、加 reservation propagation 失敗風險）。**規則：先讀完整個 seed SQL 再決定要不要加 verify**。

38. **GCP API 都是 lazy enable，新 project 第一次碰每個 service 都會炸 `SERVICE_DISABLED`** — 實測：Secret Manager API 沒開，`gcloud secrets create` 直接噴 403。錯誤訊息指引去 Console 開，但其實 `gcloud services enable <api>.googleapis.com` 一條 CLI 就解決。**規則**：每碰一個新 GCP service（Secret Manager / Cloud Run / Cloud Build / Scheduler / Artifact Registry / IAM）前先 `gcloud services enable`。或 STEP 1 一次 batch 啟用：
    ```bash
    gcloud services enable \
      secretmanager.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
      cloudscheduler.googleapis.com artifactregistry.googleapis.com iam.googleapis.com \
      --project=$PROJECT_ID
    ```

39. **bash `\` 換行在 Cloud Shell paste 時會被吃掉** — 從 markdown code fence copy 多行指令（用 `\` 連接）貼進 Cloud Shell，**有時反斜線後面的換行會被當成獨立命令**，導致 `--data-file=-` 噴 `command not found`。實測踩過 1 次（`gcloud secrets create` paste 時）。**規則：給 Cross 的指令一律寫單行**，不用 `\` 換行。多參數就一行寫到底，可讀性差但不會炸。

40. **YouTube channel ownership 分散 ≠ pipeline 死局** — 50 個 talent 頻道分散在多個 Google 帳號這件事，handoff README 假設「single shared OAuth refresh token」會誤導。**正確拆解**：(a) Data API（公開資料：subs / views / 影片 / liveStreamingDetails / search.list live）用**單一 API key** 即可，不分 ownership；(b) 只有 Analytics API（watch time / retention / demographics）需要 OAuth 且 token 持有人要是該 channel 的 Owner/Manager。**規則**：先用 API key 跑 Data API（80% dashboard 可以動），Analytics API 走「統一 mikai admin 帳號加為 Manager」的商務路徑（IT + talent manager 配合），不要假設一把 token 解決全部。

41. **Cloud Shell paste 會把多個 code fence 黏成一行** — 給 Cross 4 個獨立 fenced block 連續 IAM 指令，他複製貼進 Cloud Shell 時，**第一條結尾跟第二條開頭被連起來**：`--condition=Nonegcloud projects ...`。實測 `--condition=Nonegcloud` 直接被 gcloud 當成不合法 condition value。**規則**：多步指令必須**包成單一 block**（用 `for ROLE in ... do ... done` 一行 inline 跑迴圈，或用 `&&` 連接，避免空行造成 paste 斷裂）。給 non-engineer 使用者尤其要這樣寫。

42. **gcloud IAM binding 必須先確認 SA 存在** — 跳過 `iam service-accounts create` 直接跑 `add-iam-policy-binding` → `INVALID_ARGUMENT: Service account ... does not exist`。**規則**：bind 前一律先 `gcloud iam service-accounts describe <sa-email>`，並在 create 之後 `sleep 5` 等 IAM eventual consistency。**更高層規則**：給 Cross 的部署 script 應該打包成單一 block，而不是把 create-SA 跟 bind-IAM 拆成兩步讓他可能跳過。

43. **`gcloud run deploy` 印出的 Service URL 在 URL 格式轉換期不一定 routable** — 實測：deploy 完印 `youtube-etl-ingest-508645124315.us-central1.run.app` (新 format `<service>-<projectnum>.<region>.run.app`)，但實際 routable 的是 `youtube-etl-ingest-gvxv3xr45a-uc.a.run.app` (舊 format `<service>-<hash>-<regionshort>.a.run.app`)，前者打了回 Google 邊緣 404。**規則**：永遠用 `gcloud run services describe <service> --region=<region> --format='value(status.url)'` 拿真的 URL，**不要相信 deploy stdout 印的那個**。

44. **Cloud Run 404 從 Google 邊緣 ≠ Flask 404** — 看到 HTML 含 Google logo + `*{margin:0;padding:0}` style + `That's an error` → 這是 Google frontend 回的，**請求根本沒進 container**。可能原因：(a) URL 不對（見 #43）；(b) Ingress 設定 `internal` 阻擋外部呼叫；(c) Container crash loop 但 Cloud Run condition 還沒翻紅。**規則**：看到 Google 邊緣 404 不要假設是 auth 問題（auth 失敗回 403 才對）。先 `gcloud run services describe` 拿真實 URL + 檢查 ingress + `gcloud run services logs read` 看 container 有沒有起來。

45. **Cloud Run 部署在企業 GCP org 預設可能 ingress=internal** — 17LIVE / mikai 等大型 org 常設 `constraints/run.allowedIngress` org policy，新 service 預設 `internal-and-cloud-load-balancing`，從 Cloud Shell（VPC 外）打會被擋在邊緣回 404。**規則**：給 Cross 的 `gcloud run deploy` 指令**第一次就明確加 `--ingress=all`**，不要等部署完才用 `services update` 修，因為 update 也可能被 org policy 擋（要找 IT 改 org policy）。如果 org policy 真的不允許 ingress=all，改用 IAP TCP tunnel 或從 VPC-attached compute 測試。

46. **`google.cloud.secret_manager` ❌ vs `secretmanager` ✅** — PyPI 套件名是 `google-cloud-secret-manager`（hyphen），但 Python module import 是 `from google.cloud import secretmanager`（**no underscore**）。原始 handoff repo 寫成 `secret_manager` 直接 ImportError 噴 worker boot 失敗。**規則**：碰任何 `google-cloud-*` 系列套件，**先 `python -c "from google.cloud import X"` 驗 module 名稱**，不要從套件名直接推 module 名（gcloud SDK 慣例不一致）。

47. **BigQuery streaming insert 一次塞 >10MB 噴 413** — `insert_rows_json()` 一次傳 ~50MB（10K rows × ~5KB raw_json） → `Request Entity Too Large`。BQ streaming insertAll 上限是 **10 MB / 50,000 rows / call**。**規則**：streaming insert helper 一律加 `INSERT_CHUNK_SIZE = 500` 切 chunk（500 row × 5KB = 2.5MB request，雙向 buffer）。或改用 `load_table_from_json`（load job 沒大小限制，但有 ~30s startup 延遲，適合 batch ETL）。

48. **handler `finally` block 必須每個 write 獨立 try/except** — 原本：
    ```python
    finally:
        bq.write_videos_snapshots(rows)  # 這裡炸 → 下面 2 個都不跑
        bq.upsert_poll_state(...)
        bq.write_quota_log(tracker)      # ← 失去最重要的 quota 觀測
    ```
    **規則**：finally 裡每個 write 各自 try/except + log.exception。**`quota_log` 尤其重要必須一定 flush**，不然 partial failure 時不知道 burn 了多少 unit。

49. **Cloud Run `/healthz` GET 被前端攔截不轉 container** — Cloud Run frontend 對 `/healthz` 有特殊處理（health probe？），**外部 GET `/healthz` 直接回 Google 邊緣 404**，即使 Flask app 有定義這個 route。**規則**：smoke test 用 POST `/jobs/analytics`（在 api_key mode 會 no-op 直接回 JSON）當作活性檢查，**不要依賴 GET `/healthz`**。

50. **handler 主迴圈每個 per-channel API call 必須各自接 `HttpError`** — daily 主迴圈裡，`channels.list / playlistItems.list / videos.list` **任一個拋非 quotaExceeded 的 HttpError（4xx/5xx）都會殺整個 endpoint**，但 `finally` block 仍會 flush 累積資料，造成「BQ 有 6798 rows + endpoint 回 500」的詭異狀態。**規則**：每個 API call 各自 `try/except HttpError as e: log.warning(...); continue`，把 channel 級錯誤降級為 skip 而非 abort。同時 response JSON 加 `channels_skipped` 計數讓 ops 看得到失敗率。

## 溝通原則

### 做
- 用真實市場事件解釋（「2022 年 SPX 跌 27%」而非「stagflation 期間股票表現不佳」）
- 先說結論再解釋原因
- 數值和解讀同時呈現
- 承認不確定性和模型局限

### 不做
- 過度抽象（使用者說「看不懂」時立即換方式）
- 用物理公式嚇人
- 假裝模型完美
- 用訓練資料中的股價做計算（用 web_search 拉即時價）
