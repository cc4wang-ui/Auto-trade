# Self-Test Guide — 自己拉一份 Sample Report 給 Google Reviewer

> 不依靠宮前，Cross 自己跑、自己擁有資料。給你兩條路，依時間 / 完整度選一條。

## TL;DR — 哪條路適合你？

| 路徑 | 時間 | 證據強度 | 需要的東西 |
|---|---|---|---|
| **A. 快路** — API Explorer + 手填 Sheet | 30-45 分鐘 | 中：真實 API 數字 + 真 Sheet | 只要 mikai admin Google 帳號登入 |
| **B. 完整路** — Python script 自動拉 + 寫 Sheet | 1.5-2 小時 | 強：自動化證據鏈 + Analytics 收益 | OAuth client（Phase 0 STEP 4 反正要做） |

**建議**：**Path A**。reviewer 第一輪只要看「sample report 真實長什麼樣」+「資料在哪呈現」，不是要看 production pipeline 已部署。Path A 給的證據夠用、最快。

如果你已經要做 Phase 0 STEP 4 OAuth bootstrap（建 OAuth client + 拿 refresh token），順便走 Path B，可以拿 Analytics 收益數字，更完整。

---

## Path A — API Explorer + 手填 Sheet（30-45 分鐘）

### A.1 準備

- 用 **mikai admin 共用 Google 帳號**登入 Chrome（或 incognito 視窗登入，不要混到你個人帳號）
- 從 `youtube-etl/data/channels.csv` 挑 1-2 個 channel ID。建議：
  - `UCB1s_IdO-r0nUkY2mXeti-A`（獅子神レオナ，Manzoku 組）— 已知有資料
  - 再挑 1 個你想看的 channel

### A.2 拉最近 10 部影片清單

開 https://developers.google.com/youtube/v3/docs/search/list

右側 Try It：
- `part`: `snippet`
- `channelId`: `UCB1s_IdO-r0nUkY2mXeti-A`
- `type`: `video`
- `order`: `date`
- `maxResults`: `10`
- 上方 Authentication 切到 `OAuth 2.0` → Authorize → 同意 mikai 帳號授權

按 **EXECUTE** → 右下 JSON 結果會出來。

複製所有 video ID（在 `items[].id.videoId`），逗號分隔，例如：
```
abc123,def456,ghi789,...
```

### A.3 拉影片統計

開 https://developers.google.com/youtube/v3/docs/videos/list

- `part`: `snippet,statistics`
- `id`: 貼上剛才的 10 個 video ID（逗號分隔）

按 EXECUTE → 拿到每部影片的 `title` / `publishedAt` / `viewCount` / `likeCount` / `commentCount`。

### A.4 開新 Google Sheet 填表

1. https://sheets.new 開新 Sheet（用 mikai admin 帳號），命名 `mikai YouTube Internal Analytics — Sample Report`
2. 第 1 行 header：
   ```
   Date | Channel | Title | URL | Views | Likes | Comments
   ```
3. 從 JSON 抄 5-10 row 進去：
   - Date：`publishedAt` 取日期部分（YYYY-MM-DD）
   - Channel：手寫 channel 名（例：獅子神レオナ）
   - Title：`snippet.title`
   - URL：`https://www.youtube.com/watch?v=` + video ID
   - Views / Likes / Comments：對應 `statistics`

4. 加點美化：
   - Header bold + 灰底
   - 數字欄位千分位格式
   - Channel 欄位 freeze
5. 加標題列在第一列（merge across columns）：
   ```
   mikai Inc. — Internal YouTube Analytics Dashboard (Sample)
   Source: YouTube Data API v3 + YouTube Analytics API v2
   Refresh: Manual (production: daily 09:00 JST via Connected Sheets)
   Audience: ~10 internal employees, view-only via Google Workspace SSO
   ```

### A.5 截圖

- 全螢幕截圖（Cmd+Shift+4 on Mac、Snipping Tool on Windows）
- 確保看到 **header + 至少 5-10 row 資料 + 上方標題列**
- 存成 `Sample_internal_report.png`

完成。可以送了。

---

## Path B — Python script 拉 Analytics + 自動寫 Sheet（1.5-2 小時）

### B.1 前置（如果還沒做）

依照 `phase-0-ops-checklist.md` Step 4a：建 OAuth client（Desktop type）+ 下載 `client_secret.json`。

### B.2 在你筆電裝套件

```bash
pip install google-auth-oauthlib google-api-python-client gspread
```

### B.3 跑 OAuth flow（一次性）

```python
# oauth_bootstrap.py
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
]

flow = InstalledAppFlow.from_client_secrets_file("client_secret.json", SCOPES)
creds = flow.run_local_server(port=0)
print("REFRESH_TOKEN =", creds.refresh_token)
print("CLIENT_ID =", creds.client_id)
print("CLIENT_SECRET =", creds.client_secret)
```

跑：`python3 oauth_bootstrap.py` → 瀏覽器跳出 → **登入 mikai admin 帳號** → 同意 → terminal 印 token。

把 3 個值記下來。**這個 token 之後 Phase 0 OAuth bootstrap 也能直接用**，所以同時推進兩件事。

### B.4 寫 fetch script

```python
# fetch_sample.py
import os
import gspread
from datetime import date, timedelta
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials

CHANNELS = [
    ("獅子神レオナ", "UCB1s_IdO-r0nUkY2mXeti-A"),
    # 加 1-2 個你想看的 channel
]

creds = Credentials(
    token=None,
    refresh_token=os.environ["REFRESH_TOKEN"],
    client_id=os.environ["CLIENT_ID"],
    client_secret=os.environ["CLIENT_SECRET"],
    token_uri="https://oauth2.googleapis.com/token",
    scopes=[
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/yt-analytics.readonly",
        "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
        "https://www.googleapis.com/auth/spreadsheets",
    ],
)

ya = build("youtubeAnalytics", "v2", credentials=creds)
yt = build("youtube", "v3", credentials=creds)
gc = gspread.authorize(creds)

# 1. 開新 Google Sheet
sh = gc.create("mikai YouTube Internal Analytics — Sample Report")
ws = sh.sheet1
ws.update_title("Daily by channel")

# 2. Header
header = [
    "Date", "Channel", "Views", "Unique Viewers",
    "Watch Hours", "Likes", "Comments",
    "Subs Gained", "Estimated Revenue (USD)",
]
ws.append_row(header)

# 3. 拉過去 7 天 channel daily report，每 channel
for name, channel_id in CHANNELS:
    for offset in range(1, 8):
        d = (date.today() - timedelta(days=offset)).isoformat()
        resp = ya.reports().query(
            ids=f"channel=={channel_id}",
            startDate=d,
            endDate=d,
            metrics="views,uniqueViewers,estimatedMinutesWatched,likes,comments,subscribersGained,estimatedRevenue",
        ).execute()
        rows = resp.get("rows") or []
        if not rows:
            continue
        v, uv, mw, lk, cm, sg, rev = rows[0]
        ws.append_row([
            d, name, v, uv, round(mw / 60, 1), lk, cm, sg, rev,
        ])

# 4. Share with yourself
sh.share(os.environ["YOUR_EMAIL"], perm_type="user", role="writer")
print(f"Done: {sh.url}")
```

### B.5 跑

```bash
export REFRESH_TOKEN="..."
export CLIENT_ID="..."
export CLIENT_SECRET="..."
export YOUR_EMAIL="crosswang@17.media"

python3 fetch_sample.py
```

terminal 印出 Sheet URL → 開瀏覽器看 → 7 天 × N channel 資料填好。

### B.6 美化 + 截圖

開那個 Sheet：

1. Format → Number → 數字欄千分位
2. 加 conditional formatting：Views 高的綠色
3. Freeze 第 1 row
4. 加標題列（同 Path A.4 第 5 點）
5. 全螢幕截圖 → `Sample_internal_report.png`

---

## 兩條路的選擇邏輯

| 你的情況 | 走 |
|---|---|
| 還沒拿到 GCP project access、想最快搞定 quota raise 回信 | **Path A** |
| 反正這週就要做 Phase 0 OAuth bootstrap | **Path B**（順便完成 Phase 0 STEP 4） |
| 想給 reviewer 看 Analytics 收益（estimatedRevenue 有數字）證明 channel-owner 身分 | **Path B** |
| 不想碰 Python | **Path A** |

---

## 共通注意事項

- **Channel 一定要是你 mikai 有 admin 權限的**。Path B 的 Analytics API 對非 owner channel 會回空，那就穿幫 reviewer 會懷疑。`channels.csv` 裡所有 channel 都應該有，但 smoke test 用獅子神レオナ 已驗證。
- **Sheet 不要 share 給外部**。截圖前確認 share 設定 = restricted to your domain (17.media)。
- **截圖時把右上角頭像那塊裁掉**或 incognito 跑（不然會看到你個人 email）。

---

## 跟 Phase 0 STEP 4 的關係

Path B 跑出來的 `REFRESH_TOKEN` / `CLIENT_ID` / `CLIENT_SECRET` 三個值，**就是 Phase 0 STEP 4.3 推進 Secret Manager 的那 3 個 secret**。

跑 Path B = 同時完成 quota raise sample report + Phase 0 OAuth bootstrap，一石二鳥。
