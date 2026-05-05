# Path A: mikai YouTube Analytics OAuth 啟用流程

> **目的**：取得 50 個 talent 頻道的 Analytics API 資料（revenue / unique_viewers / watch_time / demographics），補完 Path C api_key 模式拿不到的那 20%。
>
> **適用**：mikai-yt-data GCP project 已部署 youtube-etl-ingest Cloud Run service（Path C api_key 模式運作中），現在要切換到 oauth 模式以拿到 owner-side analytics 資料。

## 為什麼需要 Path A

| API | 拿到什麼 | 認證方式 |
|-----|---------|---------|
| YouTube Data API v3 | subs / views / 影片 metadata / liveStreamingDetails / search.list live | API key 即可（公開資料）|
| **YouTube Analytics API v2** | **revenue / unique_viewers / watch_time / retention / demographics** | **必須 OAuth，且 token 持有人是 channel 的 Owner 或 Manager** |

50 個 talent 頻道分散在多個 talent 個人 Google 帳號，沒有單一身分能代表全部 channel 拉 Analytics。**Path A 解法**：開 1 個 mikai admin Workspace 帳號，請每個 talent 把這個帳號加為自己頻道的 Manager，之後就能用單一 OAuth refresh_token 拉所有 talent 的 Analytics 資料。

## 總時程

| 階段 | 時程 | 負責人 |
|------|------|--------|
| A.1 IT 開 admin 帳號 | 30 分 | IT |
| A.2 OAuth bootstrap | 30 分 | Cross |
| A.3 Talent 加 Manager | 1-3 週 | Talent（Cross 催）|
| A.4 切 ETL 到 oauth | 5 分 | Cross |
| A.5 監控覆蓋率 | 每週 1 次 | Cross |

---

## A.1 IT 開 mikai admin Workspace 帳號

請 IT 建立一個共用服務帳號，**不綁特定員工**，未來不會因人離職而失效。

| 項目 | 設定 |
|------|------|
| Email | `youtube-analytics@mikai.tw`（建議命名規則 `service-name@`，可調整）|
| 2FA | 啟用 TOTP（Google Authenticator），**不用 SMS**（避免單點故障）|
| Recovery email | 加 Cross + 1 個 IT lead |
| Vacation responder | 關 |
| Auto-forward | 關 |
| 密碼 + TOTP backup codes | 存 mikai 共用 1Password vault（存取權限：Cross + IT lead）|
| License | 一般 Workspace（不需 Enterprise tier）|

**完成標準**：
- 你能用 1Password 拿到密碼 + 通過 2FA 登入該帳號
- email 後綴是 `@mikai.tw`（mikai Workspace primary domain）
- 2FA 用 TOTP，不是個人 SMS

完成後 IT 把 1Password entry 連結傳給 Cross。

---

## A.2 OAuth bootstrap（Cross 做）

### A.2.1 GCP Console 建 OAuth Client ID

1. 開 https://console.cloud.google.com/apis/credentials?project=mikai-yt-data

2. **OAuth consent screen**（若沒設過）：
   - User Type: **Internal**（mikai Workspace 內部）
   - App name: `mikai YouTube ETL`
   - Support email: `youtube-analytics@mikai.tw`
   - Authorized domains: `mikai.tw`
   - Scopes 加：
     - `https://www.googleapis.com/auth/youtube.readonly`
     - `https://www.googleapis.com/auth/yt-analytics.readonly`
     - `https://www.googleapis.com/auth/yt-analytics-monetary.readonly`
   - 儲存

3. **Credentials** → **CREATE CREDENTIALS** → **OAuth client ID**：
   - Application type: **Web application**
   - Name: `youtube-etl-bootstrap`
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground`
   - **CREATE**
   - 跳出視窗顯示 **Client ID** + **Client Secret** → **複製這兩個字串**（之後 A.2.3 要用）

### A.2.2 OAuth Playground 取 refresh_token

> ⚠️ 必須用 mikai admin (`youtube-analytics@mikai.tw`) 登入瀏覽器。建議 Chrome 無痕視窗或專用 profile，避免跟個人 Google 帳號混到。

1. 用 mikai admin 帳號登入 Google
2. 開 https://developers.google.com/oauthplayground
3. 右上 ⚙️ Settings → 勾 **Use your own OAuth credentials** → 貼 client_id + client_secret → Close
4. 左欄 Step 1 → 滑到底找這 3 個 scope **全勾**：
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`
   - `https://www.googleapis.com/auth/yt-analytics-monetary.readonly`
5. 點 **Authorize APIs** → 跳同意畫面 → **確認登入身份是 `youtube-analytics@mikai.tw`** → 按 Allow
6. Step 2 → 點 **Exchange authorization code for tokens**
7. 出現 JSON 中含 `refresh_token: "1//09..."` 那一段 → **複製整段 refresh_token 字串**

> 🔴 **refresh_token 只有這次能拿到**。如果不小心關掉視窗，必須回 OAuth Playground 重做 step 4 onward 重新授權產生新的。

### A.2.3 把 3 個 secret 存進 Secret Manager

Cloud Shell **單行貼**（取代 PASTE_XXX 為實際值）：

```bash
echo -n "PASTE_CLIENT_ID" | gcloud secrets create youtube-etl-mikai-oauth-client-id --data-file=- --replication-policy=automatic --project=mikai-yt-data
```
```bash
echo -n "PASTE_CLIENT_SECRET" | gcloud secrets create youtube-etl-mikai-oauth-client-secret --data-file=- --replication-policy=automatic --project=mikai-yt-data
```
```bash
echo -n "PASTE_REFRESH_TOKEN" | gcloud secrets create youtube-etl-mikai-oauth-refresh-token --data-file=- --replication-policy=automatic --project=mikai-yt-data
```

3 個 secret 名稱對應 `youtube-etl/ingest/lib/config.py` default，不需改 Cloud Run env var。

**驗證 3 個 secret 存好**：

```bash
for s in youtube-etl-mikai-oauth-client-id youtube-etl-mikai-oauth-client-secret youtube-etl-mikai-oauth-refresh-token; do
  echo "$s: $(gcloud secrets versions access latest --secret=$s --project=mikai-yt-data | head -c 20)..."
done
```

預期印 3 行 secret 名稱 + 前 20 char 預覽。

---

## A.3 Talent 加 Manager（Talent 做）

**告訴每個 talent 做這 5 步**（5 分鐘）：

1. 電腦開啟 https://studio.youtube.com（**手機 App 不行**）
2. 左下角點「**設定 (Settings)**」
3. 左欄選「**權限 (Permissions)**」→ 點「**邀請 (Invite)**」
4. 填：
   - Email: `youtube-analytics@mikai.tw`（IT 給的實際 email）
   - 角色 (Role) 選 **Manager**
5. **SAVE**

**完成後該 talent 的 Analytics 立刻可用，不用等其他 talent 也加完**。

### Talent 常見問題

| 問題 | 答 |
|------|---|
| 會影響我對頻道的擁有權嗎？ | 不會。Owner 還是你，mikai admin 只是 Manager（協助層級）|
| 會看到我的私訊或設定嗎？ | 不會。Manager 只能看公開資料 + Studio analytics |
| 我可以撤回嗎？ | 可以，同一個畫面隨時移除 mikai admin |
| mikai 會代我發布嗎？ | 不會。pipeline 純讀取，不寫任何 Studio 設定 |

### 進度追蹤

建一個 Sheet 列 50 個 talent，加 4 欄：`invited_at` / `accepted_at` / `analytics_first_seen` / `notes`。
每週 check 一次填寫進度，催沒做的。

---

## A.4 切 ETL 到 oauth mode

> 等至少 5 個 talent 加完 Manager 再切（測試 oauth flow 通了）。

```bash
gcloud run services update youtube-etl-ingest --region=us-central1 --update-env-vars=YOUTUBE_AUTH_MODE=oauth --project=mikai-yt-data
```

效果：
- 明天 03:00 UTC analytics scheduler 觸發 → 拉**已加 Manager** 的 talent 的 revenue / unique_viewers / watch_time
- 沒加 Manager 的 talent → 該天 analytics_daily 不會有 row（handler log warning，不會炸 endpoint）
- daily / hourly / live-poll handler 仍正常運作（OAuth credentials 也適用 Data API）

### 切換後驗證（隔天執行）

```bash
bq query --use_legacy_sql=false --project_id=mikai-yt-data "SELECT report_date, COUNT(DISTINCT channel_id) AS analytics_covered_channels, ROUND(SUM(estimated_revenue_usd), 2) AS total_revenue_usd FROM \`mikai-yt-data.youtube_raw.analytics_daily\` WHERE report_date = DATE_SUB(CURRENT_DATE(), INTERVAL 1 DAY) GROUP BY report_date"
```

預期看到 `analytics_covered_channels` = 你加完 Manager 的 talent 數量，`total_revenue_usd` 開始有數字（可能是小數點，看流量級別）。

---

## A.5 監控覆蓋率（每週看一次）

```bash
bq query --use_legacy_sql=false --project_id=mikai-yt-data "SELECT report_date, COUNT(DISTINCT channel_id) AS analytics_covered_channels FROM \`mikai-yt-data.youtube_raw.analytics_daily\` WHERE report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) GROUP BY report_date ORDER BY report_date DESC"
```

預期：數字從 0 開始，每週升高，最終接近 50（活躍 talent 數）。

---

## 失敗應對

| 症狀 | 原因 | 修法 |
|------|------|------|
| OAuth Playground 跳「Access blocked: This app's request is invalid」| consent screen 沒設好或 redirect URI 沒加 | 回 A.2.1 確認 consent screen 是 Internal、redirect URI 包含 `https://developers.google.com/oauthplayground` |
| Step 2 exchange 後沒看到 `refresh_token`，只有 `access_token` | 沒勾 `Use your own OAuth credentials` | 重做 A.2.2 step 3 |
| Cloud Run 切 oauth 後 `analytics_daily` 全空 | mikai admin 還沒被加為任何 channel 的 Manager | 等 talent 完成 A.3，或檢查 Cloud Run logs 看 OAuth refresh 是否成功 |
| Cloud Run logs 看到 `403 forbidden` from Analytics API | mikai admin 不是該 channel 的 Manager | 該 talent 沒加 mikai admin 為 Manager，跟該 talent 確認 |
| Cloud Run logs 看到 `invalid_grant` | refresh_token 過期或被撤銷 | 回 A.2.2 重新跑 OAuth Playground 取新 refresh_token，重存 Secret Manager |

---

## 切回 api_key mode（回滾）

如果 Path A 出問題要先回 Path C：

```bash
gcloud run services update youtube-etl-ingest --region=us-central1 --update-env-vars=YOUTUBE_AUTH_MODE=api_key --project=mikai-yt-data
```

Data API endpoints 立刻回到 Path C（subs / views / 影片）。analytics_daily 停止寫入但既有資料保留。
