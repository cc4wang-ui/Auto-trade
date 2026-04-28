# IB Automation Deployment Runbook

從 Pine Script 訊號到 IB 自動下單的完整部署流程。對應 `pattern-detector-status.md` 裡「待完成」的 Step 1/3/4/5（Step 2 已直接整合到 `pattern_detector_v2.pine` 的 LAYER 6）。

**前提**：
- TradingView Pro 以上方案（webhook alert 需付費方案；Essential 不支援 webhook）
- IB 帳戶（paper account 即可開始）
- 已用本 repo 最新版的 `pattern_detector_v2.pine`（含 LAYER 6 TradersPost webhook）

**架構**：
```
pattern_detector_v2.pine (LAYER 6: alert() + TradersPost JSON)
        │ webhook (HTTPS POST, JSON)
        ▼
TradersPost (broker bridge)
        │ IB API
        ▼
Interactive Brokers (paper / live)
```

**JSON 範例**（v2.0 LAYER 6 alert() 自動組出）：

```json
{
  "ticker": "SOFI",
  "action": "buy",
  "orderType": "market",
  "quantityType": "risk_dollar_amount",
  "quantity": 25,
  "stopLoss": {"type": "stop", "stopPrice": 14.50},
  "takeProfit": {"limitPrice": 17.00},
  "signalPrice": 15.50,
  "timeInForce": "day",
  "extras": {
    "pattern": "雙重底",
    "quality": 78,
    "rr": 1.67,
    "interval": "60",
    "version": "v2.0"
  }
}
```

TradersPost 收到後：用 `risk_dollar_amount` $25 ÷ (entry $15.50 - stop $14.50) = 25 股，送 IB market buy + bracket OCO（stop $14.50 / limit $17.00）。

---

## Phase 1 — TradersPost 設定（IB 入金後做）

### 1.1 註冊 + 連 IB

1. 到 https://traderspost.io 註冊
2. Dashboard → **Brokers** → Add Broker → 選 **Interactive Brokers**
3. 認證流程：TradersPost 用 IB 的 Web API（不是 TWS / IB Gateway）
   - 點 "Connect" → 跳轉 IB OAuth → 用 IB 帳密登入 → 授權 TradersPost 讀寫
   - **重要**：先選 **paper account**，不要急著連 live
4. 連線狀態應顯示 "Connected" 綠燈

### 1.2 建立 Strategy

Strategies 是 TradersPost 用來收 webhook 的單位，每個 strategy 一個 webhook URL。

1. Dashboard → **Strategies** → New Strategy
2. 設定建議：
   - **Name**：`pattern-detector-v2-paper`
   - **Broker**：選剛剛接的 IB paper
   - **Asset Class**：Stocks
   - **Position Sizing**：留空（讓 webhook JSON 的 `quantityType` 控制）
   - **Time In Force**：Day
   - **Extended Hours**：Off（盤後流動性差，避開）
   - **Order Behavior** → **First Triggered Signal Wins**（避免 double-fire）
   - **Bracket Orders**：Enabled（webhook 帶 stopLoss + takeProfit 時自動掛 OCO）
3. 儲存後拿到 **Webhook URL**：
   ```
   https://webhooks.traderspost.io/trading/webhook/{uuid}/{password}
   ```
   **這串等同密碼，不要外流、不要 push 到公開 repo**。

### 1.3 用 TradersPost 內建測試器送一筆假訊號

不用等型態出現，先驗證 webhook 通路。

1. Strategy 頁面 → **Submit Signal**（或 Webhook Tester）
2. 貼測試 JSON：
   ```json
   {
     "ticker": "SOFI",
     "action": "buy",
     "orderType": "market",
     "quantityType": "fixed_quantity",
     "quantity": 1,
     "stopLoss": {"type": "stop", "stopPrice": 14.50},
     "takeProfit": {"limitPrice": 17.00}
   }
   ```
3. Submit → 看 Strategy 的 **Activity** tab 有沒有收到、Order 有沒有送 IB
4. 登 IB paper TWS / Web → 確認 SOFI 1 股 + 14.50 stop + 17.00 limit 三筆 order 都在
5. 取消 IB 上的 paper order，準備接真訊號

### 1.4 Pause 開關（kill switch 預演）

熟悉這個操作 — live 出狀況時要在 30 秒內按下：

- Strategy 頁面右上 → **Pause Strategy** → 之後 webhook 進來會被擋下，現有持倉不動
- 確認自己會找到這顆按鈕的位置

---

## Phase 3 — TradingView Alert 設定

每個 watchlist ticker 各做一次（一個 ticker = 一個 alert quota）。

### 3.1 確認 indicator 設定正確

1. 在目標 ticker（先做 SOFI）打開 1H 圖表
2. Add Indicator → `技術型態偵測器 v2.0`（含 LAYER 6 webhook）
3. 設定面板捲到 `═══ TradersPost / IB Automation ═══` 群組：
   - **啟用 TradersPost webhook**：✅ 打開
   - **Watchlist**：`SOFI`（或 `SOFI,SOXL,...` 多檔；每個圖表 alert 還是要分別設）
   - **單筆風險金額 ($)**：`25`（$500 帳戶 5%）
   - **最低品質分 (live trading)**：`70`（高於主面板 minQuality；live 加嚴）
   - **最低 R:R 比 (live trading)**：`1.5`
   - **啟用做多訊號**：✅
   - **啟用做空訊號**：⬜（cash 帳戶不能 short）

### 3.2 建立 Alert

1. 圖表右上 鬧鐘 → **Add Alert**
2. **Condition**：選 `Pattern Detector v2` → 子選項選 **`Any alert() function call`**
3. **Options** → **Once Per Bar Close** ❌ **不要勾**（snippet 已用 `alert.freq_once_per_bar_close` 控制；勾了會雙重限制）
4. **Expiration**：勾 "Open-ended"（Premium 才有；Pro 設最遠日期）
5. **Notifications** → **Webhook URL**：✅ 勾選 + 貼 Phase 1.2 拿到的 URL
6. **Message** 欄位：貼以下備用標籤（會被 alert() 內 JSON 覆寫，但留著方便 TradingView 後台找）：
   ```
   {{ticker}} {{interval}} pattern_detector_v2 alert
   ```
7. **Alert Name**：`SOFI 1H pattern v2`（自己看得懂就好）
8. **Create**

### 3.3 alert quota 對照

| TradingView 方案 | Server-side alert 上限 |
|---|---|
| Free / Essential | 1 alert（且不支援 webhook）|
| Pro | 20 alerts |
| Pro+ | 100 alerts |
| Premium | 400 alerts |

Watchlist 大小 = 你想同時掛 alert 的 ticker × 時間框數（1 個 ticker 1 個 timeframe = 1 alert）。

### 3.4 別漏的細節

- **TradingView 免費方案 / Essential 不支援 webhook** — 必須升 Pro 以上
- TradingView 在 server-side 跑 alert，**電腦關機 / 瀏覽器關掉都會繼續發**
- IB ticker 對齊：TradingView 上的 `SOFI` 要對得到 IB 的 `SOFI` (NASDAQ)。多重交易所掛牌的股票要在 TradingView 圖表先選對交易所（symbol 後綴 `:NASDAQ`）

---

## Phase 4 — Paper Trading 對帳 Checklist（≥ 1 週）

切 live 前的把關。**沒對帳完零誤差，不切 live**。

### 4.1 每日 EOD（盤後 16:30 ET 後）對帳流程

三方對帳，缺一不可：

| 來源 | 撈什麼 |
|---|---|
| TradingView | Manage Alerts → 點該 alert → Logs：每筆觸發的時間、message |
| TradersPost | Strategy → Activity tab：每筆收到的 webhook、parsed JSON、送出去的 order |
| IB Paper | TWS / Web → Trades 頁：實際成交紀錄（含 bracket child orders）|

### 4.2 對帳表範本

每天填一行，連續 5 個交易日全綠 = 通過：

| Date | TV alerts | TP received | IB orders | Bracket OK? | Quantity 正確? | 備註 |
|---|---|---|---|---|---|---|
| 2026-04-29 | 2 | 2 | 6 (2 entry + 2 stop + 2 target) | ✅ | ✅ | — |
| 2026-04-30 | 1 | 1 | 3 | ✅ | ✅ | — |
| ... | | | | | | |

### 4.3 紅旗 — 一旦看到立刻 Pause Strategy 排查

| 紅旗 | 可能原因 |
|---|---|
| TV 觸發 alert，TP 沒收到 | webhook URL 錯 / TP 服務中斷 / TV 端 webhook 沒勾 |
| TP 收到，IB 沒下單 | IB 連線斷 / asset class 設錯 / paper 帳戶 token 過期 |
| IB 下了 entry 但沒 bracket child | Strategy 的 Bracket Orders 沒 enabled / JSON 缺 stopLoss 或 takeProfit |
| Quantity 不是 floor($25 / risk) | risk_dollar_amount 沒帶到 / stopPrice 錯 / TP strategy 有覆寫 sizing 設定 |
| 同一個型態出現 2 次 entry | snippet `barstate.isconfirmed` 沒生效 / Strategy 沒設 First Triggered Signal Wins |
| Stop 和 entry 同方向（long 但 stop > entry）| ADAPT 黏合點變數對錯了；snippet 有檢查 (`tp_stopPrice < close`) 應該擋掉，但要再驗 |

### 4.4 模擬演練（可選但建議）

開盤前用 TradersPost 內建 Submit Signal 手動送 1 筆，模擬 alert 觸發 → 對帳全流程，確認對帳表填法熟悉。

---

## Phase 5 — 切 Live 風控門檻

### 5.1 上線前必過的硬條件（缺一不可）

- [ ] Phase 4 對帳：**連續 5 個交易日全綠**（不是 5 筆，是 5 天）
- [ ] 單筆 risk ≤ $25（5% × $500）— 已用 `risk_dollar_amount: 25` 鎖死
- [ ] 帳戶 daily loss limit ≤ $50（10%）— 在 IB 帳戶設 daily loss 自動平倉
- [ ] Watchlist 不超過 3 檔（資金分散有限制，一次同時 3 個 active position 已是上限）
- [ ] 自己能在 30 秒內找到並按下 TradersPost Pause Strategy 按鈕（演練過）

### 5.2 切換步驟

1. TradersPost：Strategies → 複製 paper strategy → 改 broker 為 **IB Live**
2. 拿新的 webhook URL（**和 paper 不同**）
3. TradingView：去既有 alert → Edit → **更新 webhook URL**（不要刪重建，保留 alert 歷史 logs 對帳）
4. **單獨開一個小資金試水**：第一週 risk 砍半（$12.5/筆），跑 5 個交易日無異常再回 $25
5. Paper strategy **保留不刪** — 之後改邏輯都先回 paper 跑一輪

### 5.3 切回 paper 的觸發條件

任一發生 → **立刻 Pause Live Strategy + 切回 paper 排查**：

- 連續 3 筆執行異常（quantity 錯、bracket 沒掛上、滑價 > 1%）
- 單日損失 > $50（含未平倉浮損）
- TradersPost 或 IB 連線出狀況 ≥ 2 次/週
- 程式碼有任何修改（包含 v2.0 indicator 邏輯、snippet 參數、TP strategy 設定）

### 5.4 第一週 live 心法

- **只看不調**：第一週不要改 minQuality / minRR / riskDollar 任何參數
- 寫 trading journal：每筆記下進場原因、品質分、實際結果、心情
- 一週後回顧：紀律有沒有破？有沒有手動干預？有沒有把 strategy 暫停手動下單？

---

## 附錄 A — 常見錯誤排錯

| 症狀 | 排查順序 |
|---|---|
| TradingView alert 觸發但 TP 沒收到 | 1. TV alert log 有沒有「webhook delivered」字樣 2. webhook URL 拼字 3. TP 平台 status page 4. 換另一條 webhook URL 測 |
| TP 收到但解析錯誤 | TP activity log 看 raw payload → 貼 jsonlint.com 驗 → 對 `docs/traderspost_json_cheatsheet.md` 逐欄檢查 |
| IB 沒下單 | 1. Strategy → Broker connection 是不是 disconnected 2. paper 帳戶 token 過期（重新 OAuth）3. asset class 是不是 stocks 4. ticker 在 IB 找不到 |
| Quantity 是 1（不是預期股數） | `quantityType` 沒設 / 設成 fixed_quantity / `stopPrice` 等於 entry 導致 risk distance = 0 |
| Bracket child 沒掛 | Strategy 設定的 Bracket Orders 沒打開；或 JSON 缺 stopLoss / takeProfit |
| 同一根 K 棒觸發 2 次 | snippet 沒含 `barstate.isconfirmed`（檢查 ADAPT 後的版本）|

## 附錄 B — Sources

TradersPost 文件（schema 來源）：
- https://docs.traderspost.io/docs/core-concepts/signals/webhooks
- https://github.com/TradersPost/docs/blob/main/core-concepts/webhooks.md
- https://docs.traderspost.io/docs/learn/platform-concepts/position-sizing

切 live 前再 fetch 一次確認 schema 沒變動（若發現變動，更新 `pine/traderspost_alert_snippet.pine` 的 JSON builder + `docs/traderspost_json_cheatsheet.md`）。
