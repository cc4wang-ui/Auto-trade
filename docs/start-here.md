# 高中生看得懂版 — IB 自動交易上線步驟

> 給 Cross 用的白話版。每一步都告訴你「點哪裡 → 填什麼 → 看到什麼算成功」。
> 完整版見 `ib-deployment-runbook.md`，那份是給工程師參考的。

---

## 紅色按鈕（出事先按這個）

**TradersPost 暫停 strategy** = 一鍵止血。新單會被擋下，現有持倉不動。

操作：TradersPost 網站 → 你的 strategy 頁面 → **右上角「Pause Strategy」按鈕**

**先去找這顆按鈕在哪、按一次再取消，熟悉位置**。出事 30 秒內要按到。

---

## 整套流程一句話

```
TradingView 圖表上的型態訊號
   ↓ 自動發 webhook（你不用做事）
TradersPost 收到、轉給 IB
   ↓ 自動下單 + 自動掛停損停利
你的 IB paper 帳戶有交易紀錄
```

---

## STEP 1：註冊 TradersPost + 接 IB（一次性，10 分鐘）

**前提**：IB paper 帳戶已開好（你正在等入金）

1. 打開 https://traderspost.io → 點右上「Sign Up」
   - 用 Email + 密碼註冊（不用信用卡）

2. 登入後 → 左側選單點 **Brokers** → **Add Broker**

3. 在 broker 列表選 **Interactive Brokers**

4. 點 **Connect** → 跳到 IB 登入頁
   - **重要**：用你的 **paper 帳號密碼**（不是 live）
   - 授權 TradersPost 讀寫權限 → 點同意

5. 跳回 TradersPost → broker 狀態應該變成 **綠色「Connected」**

✅ **看到綠燈 = 成功**
❌ 看到紅色 / disconnected → 80% 是 IB Web API 沒開，到 IB 後台 Settings → API → Web API → enable

---

## STEP 2：建一個 Strategy + 拿 Webhook URL（5 分鐘）

**Strategy 在 TradersPost 是「收 webhook 的箱子」，每個箱子一個 URL。**

1. 左側選單 **Strategies** → 右上 **New Strategy**

2. 填寫表單：
   - **Name**: `pattern-detector-v2-paper`
   - **Broker**: 剛剛接的 IB paper（會出現在下拉選單）
   - **Asset Class**: **Stocks**
   - **Time In Force**: **Day**
   - **Extended Hours**: **OFF**（盤後不要交易）
   - 找到 **Order Behavior** → 選 **First Triggered Signal Wins**
   - 找到 **Bracket Orders** → **Enabled**（極重要！沒開的話停損停利不會掛）
   - 其他欄位留預設

3. 點 **Save**

4. 進入 strategy 詳情頁 → 找到 **Webhook URL**，長這樣：
   ```
   https://webhooks.traderspost.io/trading/webhook/abc123-uuid/xyz789-secret
   ```

5. **複製這串 URL，貼到密碼管理器或筆記**（這串 = 你的下單密碼，洩漏=別人能用你帳戶下單）

⚠️ **絕對不要把這串貼到 GitHub、Discord、截圖、聊天群**

---

## STEP 3：測 Webhook 通不通（3 分鐘）

**還沒接 TradingView 之前，先用 TradersPost 的測試器送一筆假單，確認 IB 真的會收。**

1. Strategy 頁面 → 找 **Submit Signal** 按鈕（或叫 Webhook Tester）

2. 在 JSON 框貼這段：
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
   （這是「買 1 股 SOFI、$14.50 停損、$17.00 停利」的指令）

3. 點 **Submit**

4. 切到 strategy 的 **Activity** tab → 應該看到一筆紀錄

5. 打開 **IB paper 帳戶**（TWS 或 Web）→ Trades 頁
   - 應該看到 SOFI 1 股的 market order
   - 同時有 stop $14.50、limit $17.00 兩筆 child order

✅ **三筆 order 都在 = 成功**
❌ 只有 entry 沒 stop/limit → 回頭檢查 Strategy 的 **Bracket Orders 是不是 enabled**
❌ 完全沒 order → IB 連線可能斷了，回 TradersPost 的 Brokers 頁看狀態

6. 測完去 IB **取消那筆 paper order**（不然你會莫名持有 1 股）

---

## STEP 4：設 TradingView Alert（每個股票 5 分鐘）

**先做 SOFI 一檔。等順了再加其他。**

1. TradingView 打開 SOFI 1 小時圖（Symbol 搜「SOFI」、左下時間框選 1H）

2. Pine Editor → 把最新版 `pattern_detector_v2.pine` 整段貼進去 → 點 **Add to chart**
   （指標跑起來會顯示型態、儀表板、cyan 菱形）

3. 在指標的 **Settings**（齒輪圖示）→ 找到 **TradersPost / IB Automation** 群組：
   - **啟用 TradersPost webhook**：✅ 打勾
   - **Watchlist**：填 `SOFI`
   - **單筆風險金額 ($)**：`25`（$500 帳戶風險 5%）
   - **最低品質分 (live trading)**：`70`
   - **最低 R:R 比 (live trading)**：`1.5`
   - **啟用做多訊號**：✅
   - **啟用做空訊號**：⬜（cash 帳戶不能 short）
   - 點 **OK**

4. 點圖表右上角的 **鬧鐘 icon** → **Add Alert**

5. 在 alert 設定：
   - **Condition**：上面選「技術型態偵測器 v2.0」→ 下面選 **「Any alert() function call」**
   - **Options**：「Once Per Bar Close」**不要勾**（我已經在 code 裡控制了）
   - **Expiration**：**Open-ended**（Premium 才能選；Pro 設最遠日期）
   - **Notifications** → **Webhook URL**：✅ 勾選 + 貼 STEP 2 拿到的 URL
   - **Message** 欄位：填 `{{ticker}} {{interval}} v2 alert`（會被 code 內的 JSON 蓋掉，這只是備註）
   - **Alert Name**：`SOFI 1H pattern v2`

6. 點 **Create**

✅ **alert 出現在右側 alert 列表 = 成功**

---

## STEP 5：每天 EOD（盤後）對帳 5 分鐘

**美股 16:30 ET 收盤後，每天花 5 分鐘做這個**。連續 5 個交易日全對 = 可考慮切 live。

對三個地方的紀錄，看數字一不一致：

| 看哪裡 | 看什麼 |
|---|---|
| TradingView | 鬧鐘列表 → 點 alert → Logs：今天觸發幾次、什麼時間 |
| TradersPost | Strategy → Activity tab：今天收到幾筆 webhook |
| IB Paper | Trades 頁：今天成交幾筆（含 stop/limit child） |

**對帳表**（每天填一行，5 天全綠就過關）：

| 日期 | TV 觸發 | TP 收到 | IB 成交 entry | bracket 也掛了？ | 量對嗎？ | 備註 |
|---|---|---|---|---|---|---|
| 04/30 | 1 | 1 | 1 | ✅ | ✅ | — |
| 05/01 | 0 | 0 | 0 | — | — | 沒訊號 |

### 紅旗（看到任一個 → 立刻按 Pause Strategy 排查）

- TradingView 觸發了，TradersPost 沒收到 → webhook URL 拼錯或 TP 服務掛
- TradersPost 收到了，IB 沒下單 → IB 連線斷
- IB 下了 entry，沒掛 stop/limit → Strategy 設定的 Bracket Orders 沒打開
- 同一根 K 棒觸發 2 次 → 找我（不該發生，code 有擋）
- 股數不是預期值（25 / risk 距離） → 找我

---

## STEP 6：切 Live（嚴格門檻，不過就不切）

**過得了下面**所有**門檻才能切，缺一不可**：

- [ ] STEP 5 對帳：**連續 5 個交易日**，每天都全綠（不是 5 筆，是 5 天）
- [ ] 單筆 risk = $25（已經設好，別動）
- [ ] IB 帳戶 daily loss limit ≤ $50（在 IB 後台設）
- [ ] watchlist 同時不超過 3 檔
- [ ] 你能在 30 秒內按到 Pause Strategy（演練過）

### 切的步驟

1. TradersPost → Strategies → 把現有 paper strategy **複製一份**
2. 新 strategy 的 broker **改成 IB Live**
3. 拿到**新的** webhook URL（和 paper 不同）
4. 回 TradingView → 你的 alert → Edit → **更新 webhook URL** 為新的（**不要刪 alert 重建，保留歷史 logs**）
5. 第一週 risk 砍半（$12.5）跑 5 天無事再恢復 $25
6. **paper strategy 不要刪**，未來改邏輯都先回 paper 跑

### 回到 paper 的條件（出現任一個就切回去）

- 連 3 筆執行異常
- 單日損失 > $50
- TradersPost 或 IB 掛掉 ≥ 2 次/週
- 任何 code 變動（連改 minQuality 都要回 paper 重新驗）

---

## 卡住時看這個

| 我卡在哪 | 看哪一節 |
|---|---|
| TradersPost 註冊不過 / IB 連不上 | STEP 1 |
| 不知道 webhook URL 在哪拿 | STEP 2 第 4 步 |
| 測試 JSON 送出去 IB 沒動靜 | STEP 3 ❌ 那兩行 |
| TradingView alert 設了沒收到 | STEP 4 第 5 步檢查 webhook URL 有沒有貼錯 |
| 對帳數字對不起來 | STEP 5 紅旗 |
| 想切 live | STEP 6 必須先全部打勾 |
| 想知道 JSON 每個欄位什麼意思 | 看 `traderspost_json_cheatsheet.md` |
| 急要找 Claude 看 | 在 PR #1 留言、或開新 chat 把對帳表貼給我 |

---

## 常見錯誤翻譯表

| TradersPost / IB 顯示的英文 | 中文意思 + 怎麼辦 |
|---|---|
| `ticker required` | JSON 缺 ticker。Code 有自動帶，看 alert 是不是設錯 condition |
| `invalid action` | action 拼錯，應該是小寫 `buy`、`sell`、`exit` |
| `quantity is 0` | risk_dollar_amount ÷ 停損距離 = 0，通常是 stop 等於 entry |
| `bracket order failed` | Strategy 的 Bracket Orders 沒 enable，回 STEP 2 設定 |
| `broker disconnected` | IB 連線斷，回 TradersPost Brokers 頁重新 OAuth |
| `strategy is paused` | 你之前按了 Pause，去 strategy 頁面點 Resume |

---

## 你不用懂、但出事我會問你的東西

如果出狀況，我可能會請你：
- 把 TradersPost Activity tab 的 raw payload 截圖給我
- 把 TradingView alert log 那段 JSON 文字複製給我
- 把 IB Trades 頁那筆異常交易截圖
- 告訴我「型態名 / 進場價 / 停損 / 停利 / 結果」這 5 個欄位

不要自己改 code 試。改了我看不到，反而難 debug。
