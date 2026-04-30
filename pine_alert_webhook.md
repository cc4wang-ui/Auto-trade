# v10 Pine Alert Message — Webhook 改寫指引 v1.1

> 把 v10 strategy 的 alert message 從純文字改成 JSON，讓 GAS endpoint 能直接解析推 Telegram。
> 修正點 vs v1.0：用 Pine `input.string` 而非 hardcode placeholder（避免忘記替換）。

---

## 改寫流程

### Step 1：在 strategy_v10.pine 「═══ 顯示 ═══」群組下方加 Webhook 群組

```pine
// ═══ Webhook（推 Telegram bot 用）═══
g_webhook = "═══ Webhook（推 Telegram bot 用）═══"
useWebhook   = input.bool(true, "啟用 webhook 推送", group=g_webhook)
pineSecret   = input.string("", "Webhook secret", group=g_webhook,
                  tooltip="必填：與 GAS Script Property PINE_ALERT_SECRET 相同的隨機字串", confirm=true)
rrTarget     = input.float(1.5, "R:R 目標倍數", options=[1.0, 1.5, 2.0], group=g_webhook,
                  tooltip="目標價 = 進場 ± (進場-停損) × R:R。預設 1.5 表示停損距離的 1.5 倍。")
```

`confirm=true` 讓 secret 在套用 strategy 時跳出確認框，避免儲存空值。
`rrTarget` 用來算 alert payload 裡的 `target` 欄位（GAS 把它渲染成「目標: XXX (R:R = X.X)」，純參考用，不影響策略退場邏輯）。

### Step 2：在 Layer 5 進場區塊加 alert_message 拼接

替換原本的 `if longSignal` / `if shortSignal` 區塊：

```pine
// ═══ 進場 ═══
if longSignal
    float longStop   = close - atr14 * stopAtrMult
    float longTarget = close + (close - longStop) * rrTarget
    string alertMsg = '{"secret":"' + pineSecret + '",' +
       '"action":"buy",' +
       '"ticker":"' + syminfo.ticker + '",' +
       '"timeframe":"' + timeframe.period + '",' +
       '"price":' + str.tostring(close, "#.##") + ',' +
       '"pattern":"' + topName + '",' +
       '"quality":' + str.tostring(topQ, "#") + ',' +
       '"macro_score":' + str.tostring(total_score, "#.#") + ',' +
       '"stop":' + str.tostring(longStop, "#.##") + ',' +
       '"trail_start":' + str.tostring(close + atr14 * trailStartAtr, "#.##") + ',' +
       '"target":' + str.tostring(longTarget, "#.##") + ',' +
       '"target_r":' + str.tostring(rrTarget, "#.#") + ',' +
       '"timestamp":"' + str.tostring(time, "#") + '"}'
    strategy.entry("Long", strategy.long, alert_message=alertMsg)
    lastEntryBar := bar_index
    entryPrice := close
    entryBar := bar_index
    entryAtr := atr14
    peakHigh := close
    troughLow := na
    trailActive := false

if shortSignal
    float shortStop   = close + atr14 * stopAtrMult
    float shortTarget = close - (shortStop - close) * rrTarget
    string alertMsg = '{"secret":"' + pineSecret + '",' +
       '"action":"sell",' +
       '"ticker":"' + syminfo.ticker + '",' +
       '"timeframe":"' + timeframe.period + '",' +
       '"price":' + str.tostring(close, "#.##") + ',' +
       '"pattern":"' + topName + '",' +
       '"quality":' + str.tostring(topQ, "#") + ',' +
       '"macro_score":' + str.tostring(total_score, "#.#") + ',' +
       '"stop":' + str.tostring(shortStop, "#.##") + ',' +
       '"trail_start":' + str.tostring(close - atr14 * trailStartAtr, "#.##") + ',' +
       '"target":' + str.tostring(shortTarget, "#.##") + ',' +
       '"target_r":' + str.tostring(rrTarget, "#.#") + ',' +
       '"timestamp":"' + str.tostring(time, "#") + '"}'
    strategy.entry("Short", strategy.short, alert_message=alertMsg)
    lastEntryBar := bar_index
    entryPrice := close
    entryBar := bar_index
    entryAtr := atr14
    troughLow := close
    peakHigh := na
    trailActive := false
```

### Step 2.1：target 計算公式速查

| 方向 | stop 公式 | target 公式 |
|---|---|---|
| 做多 | `close - atr × stopAtrMult` | `entry + (entry - stop) × R` |
| 做空 | `close + atr × stopAtrMult` | `entry - (stop - entry) × R` |

`R` 從 `rrTarget` input 讀（預設 1.5），可選 1.0 / 1.5 / 2.0。
GAS 端只用 `target` 渲染顯示，**不會**改 strategy 的退場邏輯（仍用 1.5×ATR 停損 + 23% 拉回 + OBV 翻轉）。
舊版 Pine（沒帶 target / target_r）GAS 仍正常運作，只是訊息少一行「目標」。

### Step 3：alertcondition 改用 placeholder

替換 strategy_v10.pine 結尾的 alertcondition：

```pine
alertcondition(longSignal,  title="V10 做多訊號", message="{{strategy.order.alert_message}}")
alertcondition(shortSignal, title="V10 做空訊號", message="{{strategy.order.alert_message}}")
```

`{{strategy.order.alert_message}}` 會被 TradingView 替換成 Step 2 拼好的完整 JSON。

### Step 4：v10 State Snapshot（給 macro routine 自動取得 D2/D3）

加在 `strategy_v10.pine` 最末（不影響 strategy 邏輯，純 push 當下狀態）。
這段是**自包含**的：不依賴 `obvUp`/`obvDown` 等 v10 內部變數，OBV 自己算。

```pine
// ═══ Daily snapshot（每 bar close 把 D2/D3 推給 GAS，macro routine 取代手動 TV check）═══
if useWebhook and barstate.isconfirmed
    // OBV 方向自己算（self-contained，不依賴 v10 內部命名）
    float snapObv     = ta.obv
    float snapObvSma  = ta.sma(snapObv, 20)
    string snapObvDir = na(snapObv) or na(snapObvSma) ? "flat" :
                       snapObv > snapObvSma ? "up" :
                       snapObv < snapObvSma ? "down" : "flat"

    // 沒型態時 topName=na、topQ=na → 必須 fallback，不然 JSON 會壞掉（"NaN" 不是 valid number）
    string snapPattern = na(topName) ? "none" : topName
    float  snapQ       = na(topQ) ? 0.0 : topQ
    float  snapAtr     = na(atr14) ? 0.0 : atr14

    string snapMsg = '{"secret":"' + pineSecret + '",' +
       '"ticker":"' + syminfo.ticker + '",' +
       '"timeframe":"' + timeframe.period + '",' +
       '"price":' + str.tostring(close, "#.##") + ',' +
       '"pattern":"' + snapPattern + '",' +
       '"quality":' + str.tostring(snapQ, "#") + ',' +
       '"obv_direction":"' + snapObvDir + '",' +
       '"atr":' + str.tostring(snapAtr, "#.##") + ',' +
       '"timestamp":"' + str.tostring(time, "#") + '"}'
    alert(snapMsg, alert.freq_once_per_bar_close)
```

關鍵防呆：
- `na(topName)` / `na(topQ)` 必須 fallback — 沒型態的 K 棒會送 `pattern="none", quality=0`，GAS 會解析成 `quality=0` 視為 D2 fail（合理）
- `obv_direction="flat"` 時 GAS 渲染 ⚪（中性），不會誤判成 ❌
- `topName` / `topQ` / `atr14` 變數名必須對得上 v10 主檔（雙重底/反轉頭肩底/上升三角…的 detector 變數）。若你 v10 命名不同，把上面 3 個變數換成你的版本

---

## TradingView Alert 設定

### A. 進場訊號 Alert（既有，2 個：long + short）

1. 套用 v10 strategy 到 TXF1! 60 分鐘圖
2. **在 Settings → Webhook 群組填 secret**（與 GAS PINE_ALERT_SECRET 相同字串）
3. 右上角 ⏰ Alert 圖標 → Add alert
4. Condition: 選 `小台宏觀策略 v10.0` → `V10 做多訊號`（再建一個給空頭）
5. **Trigger: Once Per Bar Close**（極重要，避免重複觸發）
6. **Message: 留 `{{strategy.order.alert_message}}`，不要改**
7. **Webhook URL**: `https://script.google.com/macros/s/{你的 deployment id}/exec?endpoint=v10_signal`
8. Expiration: ⚠ Essential 60 天上限，設日曆每 2 個月重設

### B. State Snapshot Alert（新增，1 個）

給 macro routine 自動取得 D2/D3，免 Cross 手動進 TV 看圖。

1. 同一張 TXF1! 60 分鐘圖
2. Add alert
3. **Condition**: 選 `小台宏觀策略 v10.0` → **`Any alert() function call`**（注意：不是「V10 做多訊號」那種 alertcondition）
4. Trigger: Once Per Bar Close
5. Message: 留空（Step 4 的 `alert()` 會把 JSON 帶過來）
6. **Webhook URL**: `https://script.google.com/macros/s/{你的 deployment id}/exec?endpoint=v10_state` ← endpoint 不一樣
7. Expiration: 60 天上限，**和進場 alert 一起重設**

⚠ 共 3 個 active alerts（long + short + snapshot），Essential 20 格還有 17 格剩餘。
⚠ 若 TradingView 連續 >90 分鐘沒推 snapshot（網路或 TV 掛），routine 會自動 fallback 到 `needs_tradingview_check: true`，不阻斷推播。

---

## Secret 管理

`PINE_ALERT_SECRET` 是防外部偽造 webhook 的共享密鑰。

### 生成
```bash
openssl rand -hex 16
```

得到類似：`9f8e7d6c5b4a39281706f5e4d3c2b1a0`

### 兩處設定（必須相同）

| 位置 | 怎麼設 |
|------|------|
| **GAS Script Properties** | `PINE_ALERT_SECRET = 9f8e7d6c...` |
| **Pine Settings 視窗** | Webhook secret 欄位填 `9f8e7d6c...` |

### ⚠ 安全提醒

- TradingView 把 alert message 包含 `{{strategy.order.alert_message}}`，**secret 會在 webhook payload 裡明文傳輸**
- TradingView 自己看不到你的 alert webhook 內容（只是轉發）
- GAS 用 HTTPS，傳輸過程加密
- **不要把 secret 寫死在 Pine code 然後 commit**：用 `confirm=true` input + 套用 strategy 時填入即可

---

## 測試流程

### 單元測試（webhook.site）
1. 暫時把 webhook URL 改成 `https://webhook.site/{隨機 ID}`
2. 在 TradingView 用 Bar Replay 重播一段歷史 K 線觸發訊號
3. 在 webhook.site 看到完整 JSON：
   ```json
   {
     "secret": "9f8e7d6c...",
     "action": "buy",
     "ticker": "TAIFEX:TXF1!",
     "timeframe": "60",
     "price": 21580.00,
     "pattern": "雙重底",
     "quality": 92,
     "macro_score": 18.5,
     "stop": 21430.00,
     "trail_start": 21680.00,
     "target": 21805.00,
     "target_r": 1.5,
     "timestamp": "1714281600000"
   }
   ```
4. JSON 格式正確 → 切回 GAS URL

### 端到端測試
1. 在 Apps Script 編輯器點 `testV10Signal()` 函數 → Run
2. Telegram 應該收到模擬訊號訊息
3. 用 Bar Replay 真實觸發一次 → Telegram 收到真訊號

### 故障排查

| 症狀 | 可能原因 |
|------|--------|
| Telegram 沒收到 | 1) Pine secret 沒填或填錯 2) GAS 沒部署最新版 3) Webhook URL 沒含 `?endpoint=v10_signal` |
| GAS log 看到 "Invalid secret" | Pine secret 與 GAS Script Properties 不一致 |
| GAS log 看到 "no_body" | TradingView Message 欄位空，沒填 `{{strategy.order.alert_message}}` |
| GAS log 看到 "invalid_json" | Pine 拼 JSON 時某欄位含未 escape 的引號（檢查 `topName` 是否含特殊字元） |
| Telegram 連續收到 3-5 次相同訊號 | TradingView Alert frequency 沒設 "Once Per Bar Close" |
| `v10_state` sheet 沒更新 | 1) Snapshot alert 沒設成 "Any alert() function call" 2) Webhook URL 沒含 `?endpoint=v10_state` 3) Pine `useWebhook` 設成 false |
| Routine 一直 fallback `needs_tradingview_check: true` | `read_v10_state` 回傳 `age_sec > 5400` → 檢查 snapshot alert 是否還在跑（60 天過期重設？）|

---

## Payload schema 完整版

```json
{
  "secret": "string (32 hex chars)",
  "action": "buy" | "sell",
  "ticker": "TAIFEX:TXF1!",
  "timeframe": "60",
  "price": 21580.00,
  "pattern": "雙重底",
  "quality": 92,
  "macro_score": 18.5,
  "stop": 21430.00,
  "trail_start": 21680.00,
  "target": 21805.00,
  "target_r": 1.5,
  "timestamp": "1714281600000"
}
```

| 欄位 | 必填 | 說明 |
|---|:---:|---|
| `secret` / `action` / `ticker` / `price` / `pattern` / `quality` | ✅ | GAS 驗證必要欄位 |
| `stop` / `trail_start` | ⚠ | 沒帶就不渲染那行（不報錯） |
| `target` | ⚠ | 沒帶就不渲染「目標」行（向後相容舊 Pine 版本） |
| `target_r` | ⚠ | 帶 `target` 時建議一起帶；只帶 `target` 不帶 `target_r` 也支援，訊息只顯示「目標: XXX」不顯示 R:R |
| `macro_score` / `timestamp` | ⚠ | 純參考 |

GAS handler `handleV10Signal()` 解析欄位、驗證 secret、推 Telegram、寫 log。

---

## State Snapshot Payload schema（endpoint = `v10_state`）

```json
{
  "secret": "string (32 hex chars)",
  "ticker": "TAIFEX:TXF1!",
  "timeframe": "60",
  "price": 21820.00,
  "pattern": "雙重底",
  "quality": 78,
  "obv_direction": "up",
  "atr": 145.50,
  "timestamp": "1714281600000"
}
```

| 欄位 | 必填 | 說明 |
|---|:---:|---|
| `secret` / `ticker` / `price` / `pattern` / `quality` | ✅ | 缺一即拒 |
| `obv_direction` | ⚠ | `"up"` / `"down"` / `"flat"`，沒帶 fallback 到 `"flat"` |
| `timeframe` / `atr` / `timestamp` | ⚠ | 純參考 |

GAS handler `handleV10State()`：
- 不發 Telegram（避免每 60 分鐘狂推）
- upsert 到 `v10_state` sheet（一個 ticker 一列，新值覆蓋舊值）
- macro routine 用 `read_v10_state` endpoint 拉這張 sheet 的最新值

### Routine 端如何用

```text
POST {GAS_WEBHOOK_URL_BASE}?endpoint=read_v10_state
{ "token": "{ROUTINE_TOKEN}", "ticker": "TAIFEX:TXF1!" }
```

回傳：

```json
{
  "ok": true,
  "states": [{
    "ticker": "TAIFEX:TXF1!",
    "timestamp": "2026-04-30T03:00:00.000Z",
    "age_sec": 312,
    "timeframe": "60",
    "price": 21820,
    "pattern": "雙重底",
    "quality": 78,
    "obv_direction": "up",
    "atr": 145.5
  }],
  "count": 1
}
```

Routine 端決策（見 `macro_snapshot_prompt.md` Step 5）：
- `age_sec > 5400`（>90 min）→ 視為 stale，`needs_tradingview_check: true` 不變
- `quality >= 70` → D2 pass
- D1=long_ok 且 `obv_direction == "up"` → D3 pass；D1=short_ok 且 `obv_direction == "down"` → D3 pass

---

## 已知限制

1. **Pine 拼 JSON 是字串拼接** — 沒有原生 JSON 序列化。如果 `topName` 含 `"` 或 `\`，會破 JSON 結構。我們的 6 個型態名稱（雙重底/反轉頭肩底/上升三角/雙重頂/頭肩頂/下降三角）都安全。
2. **Pine `time` 是 epoch ms** — handleV10Signal 沒解析 timestamp，所以這個欄位只是給人看的，不影響運作。
3. **Alert frequency 只能設 "Once Per Bar Close"** — 不要選 "Once Per Bar"（會在每根 K 線多次觸發）。
4. **TradingView 60 天 alert 過期** — Essential 帳號限制，無解，必須日曆 reminder 重設。
