# Telegram Bot Deployment Runbook

把 PR #2 加的兩個 endpoint（earnings_report、read_watchlist）+ macro_snapshot + v10_signal 全部接起來，從零到 Telegram 收到第一條訊息。

**前提**：
- 你已有 Telegram bot（v5，1003 行的那個）+ bot token + 私聊過至少一次
- 你有 Google 帳號（GAS + Sheets）
- 你有 Anthropic claude.ai/code 帳號（跑 Routine 用）
- 已 merge PR #2（或至少 checkout 到 `claude/update-telegram-bot-IZMsS` branch）

**架構**：

```
                     ┌──────────────────┐
Anthropic Routine ──>│                  │
TradingView Pine ──> │  GAS Web App     │──> Telegram Bot ──> Cross
你的 /指令 ────────>│  (4 endpoints)   │
                     └──────────────────┘
                            │
                            └──> Google Sheet (5 tabs)
```

**4 個 endpoint**：
| URL query | 來源 | 用途 |
|-----------|------|------|
| `?endpoint=macro_snapshot` | Anthropic Routine | 每日宏觀燈號 |
| `?endpoint=v10_signal` | TradingView Pine alert | 即時進場訊號 |
| `?endpoint=earnings_report` | Anthropic Routine | 財報提醒 + summary |
| `?endpoint=read_watchlist` | Anthropic Routine | 拉 watchlist |
| 其他 | Telegram update | 你既有 v5 bot |

**估時**：約 60-90 分鐘（含等 GAS 授權對話框）。

---

## Phase 1 — 產生 secrets（5 min）

開 terminal：

```bash
echo "ROUTINE_TOKEN     = $(openssl rand -hex 16)"
echo "PINE_ALERT_SECRET = $(openssl rand -hex 16)"
```

複製兩串 hex。**不要 commit**。先存 1Password / Bitwarden / iCloud Keychain。

---

## Phase 2 — 建 Google Sheet（2 min）

1. 開 https://sheets.google.com → 新空白試算表
2. 名稱：`v10-bot-state`（隨意，但要記得）
3. 從 URL 複製 sheet ID：
   ```
   https://docs.google.com/spreadsheets/d/【這一串就是 ID】/edit
   ```
4. 暫存到剛才那個 secrets 區，標 `MACRO_SHEET_ID = ...`

**不用建 tab**，下面 setupCheck() 自動建。

---

## Phase 3 — GAS 專案設定（10 min）

### 3.1 開既有 v5 bot 的 Apps Script project

去 https://script.google.com → 找你既有那個 1003 行 v5 bot project（或從你 Telegram bot 連到的 sheet 點 Extensions → Apps Script）。

### 3.2 確認 V8 runtime

⚠ **必做**。Project Settings 齒輪 → Runtime version → **V8**（不是 Rhino）。
舊 Rhino 不支援 const/let/template literal/arrow function，本檔會直接噴錯。

### 3.3 貼 code

選項 A（推薦）：**新檔**
- 點 Code.gs 旁邊 `+` → Script → 命名 `macro_snapshot_handler`
- 把 repo 裡 `macro_snapshot_handler.gs` **整個檔案**複製貼上

選項 B：併入既有 `Code.gs`
- 把 `macro_snapshot_handler.gs` 內容貼到 Code.gs **最底下**
- ⚠ 你既有 Code.gs 應該有 `function doPost(e)` — **改名**成 `function handleTelegramUpdate(e)`，讓本檔的 `doPost` 接管路由

### 3.4 Script Properties（5 個 key）

Project Settings → Script properties → Add script property，貼 5 組：

| Key | Value |
|-----|-------|
| `ROUTINE_TOKEN` | Phase 1 第一串 hex |
| `PINE_ALERT_SECRET` | Phase 1 第二串 hex |
| `MACRO_SHEET_ID` | Phase 2 的 sheet ID |
| `TELEGRAM_BOT_TOKEN` | 你既有 v5 bot 的 token（從 @BotFather 取） |
| `TELEGRAM_CHAT_ID` | 下個小節拿 |

### 3.5 拿 TELEGRAM_CHAT_ID

如果你不知道你自己的 chat_id：

1. 用 Telegram 私訊你的 bot，發任何訊息（例：`hi`）
2. 開瀏覽器：
   ```
   https://api.telegram.org/bot【你的 bot token】/getUpdates
   ```
3. 找 `"chat":{"id":【數字】}` — 這就是 chat_id（如果是個人聊天通常是正整數，群組是負整數）
4. 貼回 Script Properties

---

## Phase 4 — 跑 setupCheck()（2 min）

1. Apps Script 編輯器頂部 function 下拉選 `setupCheck`
2. 點 ▶ **Run**
3. 第一次跑會跳**權限授予**對話框：Continue → 你的 Google 帳號 → Advanced → Go to ... (unsafe) → Allow
4. 看 Execution log（底部）。**期待輸出**：
   ```
   ✅ 所有 Script Properties 已設定
   ⚠ Sheet "macro_log" 不存在 → 建立中
   ⚠ Sheet "signal_log" 不存在 → 建立中
   ⚠ Sheet "dedup_state" 不存在 → 建立中
   ⚠ Sheet "earnings_watchlist" 不存在 → 建立中
     → 已預填 12 列（請自行補 shares / avg_cost）
   ⚠ Sheet "earnings_log" 不存在 → 建立中
   ```
5. 開 Phase 2 那個 sheet → 應該看到 5 個 tab + watchlist 已有 12 行

**如果報錯 "缺少 Script Properties"** → 回 Phase 3.4 補齊。
**如果報錯 "開 sheet 失敗"** → MACRO_SHEET_ID 貼錯，重貼。

---

## Phase 5 — Web App deploy（3 min）

1. Apps Script 右上 **Deploy** → **New deployment**
2. ⚙ 圖示 → 選 type **Web app**
3. 設定：
   - **Description**：`v10 bot v1.1 - earnings + macro + signal`
   - **Execute as**：**Me**（你自己的帳號）
   - **Who has access**：**Anyone**（必須，Routine 和 TradingView 才能 POST）
4. **Deploy** → 跳授權（如果 Phase 4 已授權，這步可能 skip）
5. **複製 Web app URL**：
   ```
   https://script.google.com/macros/s/AKfycb【一串】/exec
   ```
6. 暫存到 secrets 區，標 `GAS_WEBHOOK_URL_BASE`

⚠ **每次改 code 都要 New deployment 或 Manage deployments → Edit → New version**，不然舊版繼續跑。

---

## Phase 6 — 跑 5 個 test 函數（5 min）

每個 function 在編輯器跑一次（function 下拉 → ▶）。每跑一次，Telegram 應該收到一條訊息。

| Function | 預期 Telegram 收到 |
|----------|-------------------|
| `testMacroSnapshot` | 🟡 黃燈快照（範例數值） |
| `testV10Signal` | 🟢🚀 v10 做多訊號 — TXF1!（範例） |
| `testEarningsAlert` | 📅 明日財報提醒 NVDA Q1 FY26 |
| `testEarningsSummary` | 📊 NVDA Q1 FY26 財報公布（含建議） |
| `testReadWatchlist` | **不會推 Telegram**，但 console 會 log 12 筆 JSON |

**5 條都收到 = bot 端完工**。

**如果某條沒收到**：開 Apps Script 左邊 Executions → 點失敗那次 → 看 stack trace。常見：
- `telegram_credentials_missing` → Phase 3.4 token / chat_id 沒填
- `sheet_id_missing` → MACRO_SHEET_ID 沒填
- `unauthorized` → token 不一致（Phase 3.4 的 ROUTINE_TOKEN）

---

## Phase 7 — 補 watchlist shares / avg_cost（10 min）

開 Phase 2 sheet → `earnings_watchlist` tab。預填了 12 行，shares / avg_cost 是空的。

對你**現持**的部位填上：

| ticker | shares | avg_cost | exit_at |
|--------|-------:|---------:|---------|
| 2330 | 你台積電 X 股 | 你的均價 | 留空 |
| 2382 | | | |
| 9660 | | | |
| 1810 | (-43% 還在) | | |
| NFLX | | | |
| NVDA | | | |
| IXC | | | (4/21 新建) |

**已平倉**的（如果有）：`exit_at` 填日期（YYYY-MM-DD），routine 6 個月後會自動跳過。

**ETF（006208 / 00632R / QQQ / VOO / VTI / IXC）**：`note` 欄已標 `ETF (no earnings) — skip`，不用填 shares。

---

## Phase 8 — 接 Anthropic Routine（macro 推播，15 min）

去 https://claude.ai/code/routines。

### 8.1 Macro snapshot routine

```
Name:        daily-macro-snapshot
Repository:  cc4wang-ui/Auto-trade   # Macro Routine prompt 留在 Auto-trade（trading source of truth）
Branch:      main
Working dir: .

Schedule (UTC):
  30 0 * * 1-5    # 台北 08:30 — 台股盤前
  0 13 * * 1-5    # 台北 21:00 — 美股盤前

Prompt:
  Read macro_snapshot_prompt.md and execute the routine.

Secrets:
  GAS_WEBHOOK_URL    = <Phase 5 URL>?endpoint=macro_snapshot
  ROUTINE_TOKEN      = <Phase 1 第一串>
  TELEGRAM_BOT_TOKEN = <你 bot token>
  TELEGRAM_CHAT_ID   = <Phase 3.5>
```

### 8.2 手動 Run Now 一次驗證

Routine 頁面點 **Run now** → 等 1-2 min → Telegram 收到當下時間的宏觀快照。
（會被標「🌅 台股盤前」或「🌃 美股盤前」或「快照」依當下 UTC hour 決定）

**沒收到**：看 Routine 的 logs tab。常見：
- 401 unauthorized → ROUTINE_TOKEN 不一致
- 404 → URL 沒含 `?endpoint=macro_snapshot`
- timeout → GAS Web app permissions 沒設 Anyone

---

## Phase 9 — 接 Anthropic Routine（earnings 推播，5 min）

```
Name:        earnings-watchlist
Repository:  同上
Working dir: .

Schedule (UTC):
  0 13 * * 1-5    # 台北 21:00 — 明日財報 alert
  30 22 * * 1-5   # NY 17:30 EST / 18:30 EDT — 當日盤後 summary

Prompt:
  Read earnings_routine_prompt.md and execute the routine.

Secrets:
  GAS_WEBHOOK_URL_BASE = <Phase 5 URL>   # 不含 ?endpoint
  ROUTINE_TOKEN        = <同 8.1>
  TELEGRAM_BOT_TOKEN   = <同 8.1>
  TELEGRAM_CHAT_ID     = <同 8.1>
```

### 9.1 Run now 驗證

Routine 會：
1. POST `?endpoint=read_watchlist` 拉 12 筆
2. 過濾 ETF（6 筆 skip）→ 剩 6 個別股
3. 對每個 web_search 財報日 → 比對 target_date
4. 命中就 POST `?endpoint=earnings_report`

**今天可能 0 筆命中**（沒有人剛好今天/明天發財報）→ Routine 會 log `Earnings hits: 0`，不推 Telegram。**這是正常**。

要強制看到一條：暫時改 prompt Step 0 的 `target_date = today_local()` 為「未來 7 天內任何一檔有財報的」→ Run now → 看到後改回。

---

## Phase 10 — 接 v10 Pine alert（10 min）

詳細在 `pine_alert_webhook.md`，這裡列大綱：

1. 編輯 `strategy_v10.pine`：依 webhook md 加 `useWebhook` + `pineSecret` input + alert_message JSON 拼接
2. TradingView 上套用 strategy 到 TXF1! 60min
3. Settings → Webhook 群組 → secret 欄填 `PINE_ALERT_SECRET`（Phase 1 第二串）
4. 右上 ⏰ → Add alert：
   - Condition: `小台宏觀策略 v10.0` → `V10 做多訊號`
   - Trigger: **Once Per Bar Close**
   - Message: `{{strategy.order.alert_message}}`
   - Webhook URL: `<Phase 5 URL>?endpoint=v10_signal`
5. 再建一個 `V10 做空訊號`
6. **Expiration**：Essential 60 天上限 → 設日曆 reminder 每 2 個月重設

### 10.1 用 Bar Replay 驗證

TradingView Bar Replay 倒回一段歷史 K 線觸發過訊號的位置 → Telegram 應收到 `🟢🚀 v10 訊號觸發`。

---

## 故障排查表

| 症狀 | 檢查 |
|------|------|
| 全部 endpoint 沒回應 | Web app deploy 沒設 "Anyone" / 沒 New deployment 用舊版 |
| `unauthorized` | ROUTINE_TOKEN / PINE_ALERT_SECRET 兩邊不一致 |
| `lock_timeout` | 同時觸發太多 — 等 5 sec 重試 |
| `stale_payload` | Routine cron 設錯時區（macro endpoint 有 ±5 min 視窗） |
| Telegram 收到但格式亂碼 | parse_mode=HTML 但訊息含 `<` `>` `&` 沒 escape — 看 `escapeHtml()` 是否套用到該欄位 |
| earnings routine 跑了但沒推 | 今天剛好沒命中（log 會顯示 hits=0）— 正常 |
| GAS execution log 看到 13 個 bug ... | 看本檔頂註解「Version: 1.1（已修 13 個已知 bug）」— 確認你貼的是新版 |
| `dedup_state sheet missing` | 沒跑 setupCheck() — 跑一次 |

---

## 完工驗收清單

- [ ] Phase 4：5 個 sheet tab 都建好
- [ ] Phase 6：5 個 test function 都收到 Telegram（除 testReadWatchlist 看 log）
- [ ] Phase 7：watchlist 至少現持部位的 shares 補完
- [ ] Phase 8：daily-macro-snapshot routine 手動 Run now 收到訊息
- [ ] Phase 9：earnings-watchlist routine 手動 Run now log 顯示 watchlist=12
- [ ] Phase 10：Pine alert Bar Replay 觸發收到訊號
- [ ] 日曆 reminder：60 天後重設 TradingView alert（Essential 限制）

7 個都打勾 = 整套上線。
