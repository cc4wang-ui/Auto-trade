# Automation Pipeline v1.1

> 兩條獨立 pipeline：每日 Macro 推播（cron）+ v10 訊號即時推播（event）。
> 都終結於同一個 Telegram bot。

## 架構

```
┌─ 路徑 A：每日 Macro（08:30 + 21:00）──────────────────────┐
│  Claude Code Routine (cloud, Pro plan)                  │
│    ↓ cron UTC 00:30 / 13:00 (Mon-Fri)                  │
│    ↓ 拉 FRED/TradingView/web → 算 Macro Score v3        │
│    ↓ POST {token, payload} → GAS endpoint=macro_snapshot│
│  GAS Web App                                            │
│    ↓ 三層冪等（lock + token + 5min stale + sheet dedup）│
│    ↓ formatMacroMessage() → Telegram                    │
└─────────────────────────────────────────────────────────┘

┌─ 路徑 B：v10 訊號（事件觸發）─────────────────────────────┐
│  TradingView strategy_v10.pine                          │
│    ↓ 四門全過 → strategy.entry alert_message=JSON       │
│    ↓ Pine alert webhook → endpoint=v10_signal           │
│  GAS Web App                                            │
│    ↓ secret 驗證 → dedup → format → Telegram            │
└─────────────────────────────────────────────────────────┘
```

## 檔案

```
automation/
├── README.md                        ← 你正在讀
├── routine/
│   └── macro_snapshot_prompt.md     ← Routine 雲端 prompt
└── gas-endpoint/
    ├── macro_snapshot_handler.gs    ← 加進你 GAS bot 的新 endpoints
    └── pine_alert_webhook.md        ← Pine alert 改 JSON 指引
```

---

## 部署 SOP（首次設定，總計約 35 分鐘）

### Phase 1：GAS 端準備（10 min）

1. 確認 GAS 專案 V8 runtime（Project Settings → Runtime version → V8）⚠ 舊 Rhino 不支援
2. 把 `gas-endpoint/macro_snapshot_handler.gs` **全部**複製貼進 Code.gs **底部**
3. 把你既有的 `doPost(e)` **第一行**前加：
   ```js
   const endpoint = e.parameter.endpoint;
   if (endpoint === 'macro_snapshot') return handleMacroSnapshot(e);
   if (endpoint === 'v10_signal')     return handleV10Signal(e);
   ```
4. Project Settings → Script properties → 加 5 個：
   - `ROUTINE_TOKEN` ← `openssl rand -hex 16` 生成
   - `PINE_ALERT_SECRET` ← 再生成一次（**與 ROUTINE_TOKEN 不同**）
   - `MACRO_SHEET_ID` ← 你 logging Sheet 的 ID（從 sheet URL 抓）
   - `TELEGRAM_BOT_TOKEN` ← 你既有 bot 的 token
   - `TELEGRAM_CHAT_ID` ← 你的 chat id
5. 在 Apps Script 編輯器選 `setupCheck` 函數 → Run（會自動建 sheet：macro_log / signal_log / dedup_state）
6. Deploy → New deployment → Web app → Execute as: Me / Who has access: Anyone
7. 拿到新的 Web App URL，記下來（Phase 2 + Phase 3 會用）

### Phase 2：Claude Code Routine（15 min）

需要 Pro plan + Claude Code on the web 啟用。

1. https://claude.ai/code/routines → New routine
2. 連這個 v10-trading-system repo（建議先 git push 到 GitHub）
3. 設定：
   ```
   Name: daily-macro-snapshot
   Repository: v10-trading-system
   Working directory: .

   Schedule (cron, UTC):
     - "30 0 * * 1-5"   # 台北 08:30 台股盤前
     - "0 13 * * 1-5"   # 台北 21:00 美股盤前

   Prompt:
     Read automation/routine/macro_snapshot_prompt.md and execute the routine.
   ```
4. Secrets：
   - `GAS_WEBHOOK_URL` = `<Phase 1 拿到的 URL>?endpoint=macro_snapshot`
   - `ROUTINE_TOKEN` = Phase 1 同值
   - `TELEGRAM_BOT_TOKEN` = Phase 1 同值（fallback 通知用）
   - `TELEGRAM_CHAT_ID` = Phase 1 同值
5. 點 "Run Now" 測試一次 → Telegram 應該收到第一則完整 macro 訊息
6. 確認後 Activate schedule

### Phase 3：TradingView Pine alert（10 min）

1. 看 `gas-endpoint/pine_alert_webhook.md`（已預先把改動寫進 strategy_v10.pine）
2. 套用最新 strategy_v10.pine 到 TXF1! 60 分鐘圖
3. 在 Strategy Settings → "Webhook（推 Telegram bot 用）" 群組：
   - useWebhook: ✅
   - Webhook secret: 貼你的 `PINE_ALERT_SECRET`（與 GAS 同值）
4. 建 2 個 alert：
   - Condition: `小台宏觀策略 v10.0` → `V10 做多訊號`
   - Trigger: **Once Per Bar Close**（極重要）
   - Message: `{{strategy.order.alert_message}}`（不要改）
   - Webhook URL: `<Phase 1 URL>?endpoint=v10_signal`
   - Expiration: 寫日曆 60 天提醒
5. 重複建 V10 做空訊號 alert

### Phase 4：驗證（即時）

#### A. Routine
- claude.ai/code/routines → 你的 routine → "Run Now"
- 1-2 分鐘後 → Telegram 收到完整 macro snapshot

#### B. GAS endpoint 單測
- Apps Script 編輯器 → 選 `testMacroSnapshot` 函數 → Run → Telegram 收到模擬訊息
- 選 `testV10Signal` → Run → Telegram 收到模擬訊號

#### C. webhook.site 測 Pine alert
- 暫改 alert webhook URL 為 `https://webhook.site/<id>`
- 用 Bar Replay 重播歷史訊號
- 看 webhook.site 接到完整 JSON 即 OK，再切回 GAS URL

#### D. End-to-end log 檢查
- Apps Script → Executions → 看每次 endpoint 呼叫
- Sheet `macro_log` / `signal_log` 應有紀錄

---

## v1.1 修了哪些 bug（vs v1.0）

| # | 嚴重性 | 問題 | 修法 |
|---|--------|------|------|
| 1 | 🔴 Critical | GAS 不能讀 HTTP custom headers，token 拿不到 | Token 改放 body，prompt 與 handler 同步修 |
| 2 | 🔴 Critical | `getSheetId()` 函數不存在 | 改從 `MACRO_SHEET_ID` Script Property 讀 |
| 3 | 🔴 Critical | `sendTelegramMessage(msg, opts)` 簽名假設 | 自包含 `sendTelegramHtml()`，不依賴既有函數 |
| 4 | 🟠 High | Routine cron 時區不確定 | 用 UTC + Step 0 做時區驗證 |
| 5 | 🟠 High | `handleV10Signal` 沒 dedup | 加 ticker+action+price 5min 去重 |
| 6 | 🟠 High | Sheet B2 dedup race condition | 加 `LockService.tryLock()` |
| 7 | 🟠 High | Pine secret hardcode placeholder 易忘記 | 改用 `input.string` + `confirm=true` |
| 8 | 🟡 Medium | 動態字串未 escape HTML | 加 `escapeHtml()`，所有用戶數據都過濾 |
| 9 | 🟡 Medium | nested field access 沒防 undefined | 加 `safe()` 包裝、淺拷貝物件 |
| 10 | 🟡 Medium | Invalid Date stale check 會繞過 | 加 `isNaN(ts.getTime())` 檢查 |
| 11 | 🟢 Low | NaN 顯示醜 | `fmt()` 加 `isFinite()` 檢查 |
| 12 | 🟢 Low | force_yellow 訊息重複顯示燈號 | 三分支判斷只印一次 |
| 13 | 🟢 Low | sessionKey 用英文 toDateString | 改用 `Utilities.formatDate(yyyy-MM-dd)` |

驗證：fmt / escapeHtml / safe 跑 24 個 unit test 全過；Pine JSON 拼接跑 6 個型態 + 邊界值全過。

---

## 容量規劃

| 資源 | 限制 | 用量 | 狀態 |
|------|------|------|------|
| Routine runs/day | Pro: 5 | 2（08:30+21:00） | 安全（剩 3 quota） |
| Routine cron 最短間隔 | 1 hour | 12.5 hour | 安全 |
| TradingView active alerts | Essential: 20 | 2（v10 多空） | 安全 |
| TradingView alert 過期 | 60 天 | — | ⚠ 日曆 reminder |
| GAS 執行時間/次 | 6 分鐘 | < 5 秒 | 安全 |
| GAS 配額 | 6 hour/day | < 10 min | 安全 |

---

## 故障排查

### Routine 沒推 Telegram
1. claude.ai/code/routines → Logs → 看本次 run 結果
2. 看 GAS Executions → 找對應時間的 doPost call
3. 確認 4 件事：
   - GAS 收到 POST？（Executions 有紀錄）
   - Token 一致？（GAS log 沒 "unauthorized"）
   - Telegram 推送成功？（GAS log 沒 "Telegram send failed"）
   - dedup 沒打中？（GAS log 沒 "Duplicate session"）

### Pine alert 沒推 Telegram
1. TradingView Alert manager → 看 alert 是否被 trigger
2. webhook.site 測一次（暫改 URL）→ 看 JSON 完整性
3. GAS Executions → 看 v10_signal endpoint 紀錄
4. Apps Script 跑 `testV10Signal` 函數 → 隔離測試

### GAS log 看到 "invalid_json"
- Pine alert message 沒設 `{{strategy.order.alert_message}}`
- 或 message 前後加了文字（破壞 JSON 結構）

### GAS log 看到 "stale_payload"
- Routine 端 timestamp 寫錯（不是 ISO 8601）
- 或本地時間漂移 >5 分鐘

### Telegram 重複收到相同訊息
- TradingView Alert frequency 不是 "Once Per Bar Close"
- 或 GAS dedup_state sheet 被誤改

---

## 維護 SOP

### 每月初 Macro input 校準
NFP / ISM 公布日（月第 1 週五前後）人工檢查 sheet `macro_log`。
若發現異常數據，回 Routine 端可能拉錯資料源 → 修 prompt。

### Pine alert 重設（每 60 天）
日曆 reminder：
- TradingView → Alert manager
- 看到「Expires in 7 days」的 v10 alert
- 點 Edit → Save（重新計時 60 天）

### Routine 失敗排查
- 連續失敗 3 次會自動暫停
- 重啟：手動 Run Now → 通過後 Resume schedule
- Pro plan 5 runs/day，跑超量會被 throttle（顯示在 quota usage）

### Telegram 訊息格式調整
全部在 `gas-endpoint/macro_snapshot_handler.gs` 的 `formatMacroMessage()` / `handleV10Signal()` 訊息建構區
不需動 Routine prompt（職責分離）

---

## 已知限制

1. **D2/D3 雲端算不到**：型態品質和 OBV 需 Pine chart context → Routine 訊息標 `needs_tradingview_check: true`
2. **Pine alert 60 天過期**：Essential 帳號限制，無解 → 日曆 reminder
3. **Pine 字串 JSON 拼接**：6 個型態名稱安全，未來新增需確認不含 `"` `\`
4. **Routine UTC 限制**：cron 不支援 timezone keyword → Step 0 補做時區驗證
5. **週末不推播**：cron 設 `1-5`（一到五）→ 想週末推改 `*` 並調 prompt

---

## 下一步擴充（不急）

- [ ] Routine：weekly review（週日推一週回顧 + 風險日曆）
- [ ] Routine：每月初自動拉 FRED 校準 macro input
- [ ] GAS endpoint：portfolio update（Snowball CSV 解析）
- [ ] v11 訊號加版號區分
