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

---

## TradingView Alert 設定

1. 套用 v10 strategy 到 TXF1! 60 分鐘圖
2. **在 Settings → Webhook 群組填 secret**（與 GAS PINE_ALERT_SECRET 相同字串）
3. 右上角 ⏰ Alert 圖標 → Add alert
4. Condition: 選 `小台宏觀策略 v10.0` → `V10 做多訊號`（再建一個給空頭）
5. **Trigger: Once Per Bar Close**（極重要，避免重複觸發）
6. **Message: 留 `{{strategy.order.alert_message}}`，不要改**
7. **Webhook URL**: `https://script.google.com/macros/s/{你的 deployment id}/exec?endpoint=v10_signal`
8. Expiration: ⚠ Essential 60 天上限，設日曆每 2 個月重設

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

## 已知限制

1. **Pine 拼 JSON 是字串拼接** — 沒有原生 JSON 序列化。如果 `topName` 含 `"` 或 `\`，會破 JSON 結構。我們的 6 個型態名稱（雙重底/反轉頭肩底/上升三角/雙重頂/頭肩頂/下降三角）都安全。
2. **Pine `time` 是 epoch ms** — handleV10Signal 沒解析 timestamp，所以這個欄位只是給人看的，不影響運作。
3. **Alert frequency 只能設 "Once Per Bar Close"** — 不要選 "Once Per Bar"（會在每根 K 線多次觸發）。
4. **TradingView 60 天 alert 過期** — Essential 帳號限制，無解，必須日曆 reminder 重設。
