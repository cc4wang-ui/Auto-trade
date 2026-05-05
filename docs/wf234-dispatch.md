# Telegram Bot WF2-4 Dispatch Spec

> 給接手的 Claude session 用的 self-contained 規格。Cross 用遠端 dispatch 把這 3 個工作流跑完。
>
> **不需要再問 Cross**——所有需求、欄位、檔案、訊息範本變化都列在這。

---

## 0. Context（必讀）

### 0.1 你接手的狀態

- Branch：`claude/telegram-bot-progress-HUX8o`（已 push 到 origin，PR #5 開著 draft）
- 上一個工作流（WF1）已完成 commit `c41a059`：`earnings_watchlist` 加 `lock_status` (tradeable/locked) + `asset_type` (stock/etf) 兩欄
- 你要做的是 WF2 / WF3 / WF4。**不要重做 WF1**。

### 0.2 4 個工作流的整體目標

| 工作流 | 主旨 | 狀態 |
|---|---|---|
| WF1 | 持倉加 lock_status / asset_type，可動 vs 太太代持分組 | ✅ 已完成 (c41a059) |
| **WF2** | Macro snapshot 加當日財經新聞輔助敘事 | 🔲 待做 |
| **WF3** | V10 訊號加目標價 | 🔲 待做 |
| **WF4** | Earnings summary 加 earnings call 簡報 + 分析師 Q&A | 🔲 待做 |

### 0.3 關鍵檔案

| 檔 | 角色 | 在 WF2-4 要碰嗎 |
|---|---|---|
| `macro_snapshot_handler.gs` | GAS Web App 全部 endpoint + 訊息渲染 | WF2 / WF3 / WF4 都會碰 |
| `macro_snapshot_prompt.md` | Anthropic Routine 算 macro 的 prompt | WF2 |
| `earnings_routine_prompt.md` | Routine 拉財報的 prompt | WF4 |
| `pine_alert_webhook.md` | Pine alert webhook 規格 | WF3 |
| `.claude/skills/macro-daily-analyst-report/SKILL.md` | 分析師寫作風格 | WF2 |

### 0.4 工作守則（每個工作流都遵守）

1. **一個工作流 = 一個 commit**（WF2 / WF3 / WF4 各一）
2. **commit 完就 push** 到 `claude/telegram-bot-progress-HUX8o`，不要新開 PR（追加到 PR #5）
3. **不要動 WF1 改的東西**（lock_status / asset_type 邏輯）
4. 每個改動跑 `cp file.gs /tmp/x.js && node --check /tmp/x.js` 確認 syntax
5. 改完每個 wf 補 1 個 mock test function（範本參照既有 `testMacroSnapshot` / `testV10Signal` / `testEarningsSummary`）
6. 訊息渲染要 escape HTML（既有 `escapeHtml()` helper）
7. **不要新增依賴 / 不要重構未要求的東西**

---

## 1. WF2: Macro snapshot 加當日財經新聞輔助敘事

### 1.1 為什麼

現在 macro 訊息只有量化指標 + 持倉動作，缺**當日具體事件**的脈絡。Cross 想看「今天為什麼 ERP 這樣動 / 為什麼台股盤前氣氛變差」的 narrative anchors。

### 1.2 需求

在 `analyst_report` 加新欄位 `news_pulse`：當日 **4-6 條** 最重要的財經新聞，每條含：

```json
{
  "headline": "Powell 偏鷹發言暗示 6 月不降息",
  "source": "Bloomberg",
  "category": "monetary_policy",
  "implication": "DXY 短彈、SPX 跌 0.8%；對 00632R 加碼有利",
  "impacted_tickers": ["00632R", "SPX"]
}
```

**過濾守則**（routine 端執行）：
- 只留會影響 macro / Cross 持倉 / 台美中半導體 / Fed 央行 / 油價地緣的
- 用 web_search "today financial news US Asia macro" / "今日財經新聞 台股"
- 來源優先：Bloomberg / Reuters / WSJ / 鉅亨網 / 工商時報 / 中央社
- 不要：個股零碎財報新聞（除非對 macro 有暗示）、八卦、生活
- **headline ≤ 30 字**、**implication ≤ 40 字**

`category` 列舉值：`monetary_policy` / `geopolitics` / `inflation` / `growth` / `semis` / `oil_energy` / `fx_rates` / `china_macro` / `tech_regulation`

### 1.3 訊息渲染（GAS）

在 `formatAnalystReport()` 的 **「宏觀敘事」之後、「持倉動作」之前**插一段：

```
【今日新聞脈絡】
🏦 [貨幣] Powell 偏鷹發言暗示 6 月不降息 (Bloomberg)
   → DXY 短彈、SPX 跌 0.8%；對 00632R 加碼有利
🛢 [油氣] OPEC+ 6 月會議延後決議產量 (Reuters)
   → 油價平週橫盤；IXC 短期無 catalyst
💻 [半導體] 美擬擴大對中 HBM 出口管制 (WSJ)
   → 2330 / 9660 短期承壓，長期份額不變
🌏 [地緣] 以色列伊朗停火延長 30 天 (中央社)
   → IXC 平倉訊號正在積分
```

`category` → emoji 對應表：

| category | emoji | 中文 |
|---|---|---|
| monetary_policy | 🏦 | 貨幣 |
| geopolitics | 🌏 | 地緣 |
| inflation | 📈 | 通膨 |
| growth | 🏭 | 成長 |
| semis | 💻 | 半導體 |
| oil_energy | 🛢 | 油氣 |
| fx_rates | 💱 | 匯率 |
| china_macro | 🇨🇳 | 中國 |
| tech_regulation | ⚖ | 科技法規 |
| _other_ | 📰 | 一般 |

### 1.4 改動清單

#### 1.4.1 `macro_snapshot_handler.gs`

- 在 `formatAnalystReport()` 「持倉動作」**之前**新增章節（找到 `// 4. 持倉動作` 那段插入前面）
- 防呆：`a.news_pulse` 為空陣列或 undefined 時跳過整個章節，不要印「【今日新聞脈絡】」空標題
- 加 `NEWS_CATEGORY_ICON` 常數對應表（放在 `formatAnalystReport` 函數**外面**頂部）
- 每條 news 渲染：`{emoji} [{category中文}] {headline} ({source})\n   → {implication}`
- escape: headline / source / implication / category 全部 escapeHtml

#### 1.4.2 `macro_snapshot_prompt.md`

- 在 Step 5.5（IB 分析師寫作）之前加 **Step 5.4：拉今日新聞**（含 web_search 指令範例 / 來源優先順序 / 4-6 條限制）
- 在 payload schema 範例的 `analyst_report` 物件加 `news_pulse` 範例（4 條）
- 必填／可選表格加一列：`news_pulse` 必填（找不到就空陣列 `[]`，**不要省略**整個欄位）

#### 1.4.3 `.claude/skills/macro-daily-analyst-report/SKILL.md`

- 「必填輸出（JSON Schema）」加 `news_pulse` 物件
- 「必填／可選」表格加 `news_pulse` 必填
- 「章節寫作風格指南」加 `news_pulse[]` 寫作守則（headline ≤ 30 字 / implication ≤ 40 字 / 過濾規則）
- 「出報前自檢清單」加：`news_pulse` 4-6 條且每條有 implication

#### 1.4.4 加 mock test

- `testMacroSnapshot()` 既有 mock payload 加 `news_pulse` 4 條範例（Powell / OPEC / HBM / 停火），重跑能看到 Telegram 出現新章節

### 1.5 Acceptance

- [ ] `formatAnalystReport()` 對 `news_pulse=[]` / `undefined` 不渲染章節
- [ ] `news_pulse` 9 個 category 都有 emoji 對應，未知 category 預設 📰
- [ ] `testMacroSnapshot()` Telegram 收到後在「宏觀敘事」與「持倉動作」之間有「【今日新聞脈絡】」段
- [ ] node --check syntax pass
- [ ] commit message: `Add news_pulse narrative section to macro snapshot (workflow 2)`

### 1.6 不要做

- ❌ 不要存新聞到 sheet（每天即時拉就好，不要 dedup 也不要歷史 archive）
- ❌ 不要做 source URL link（Telegram 會展開預覽搶版面）
- ❌ 不要超過 6 條（會超 Telegram 訊息上限）
- ❌ 不要做新聞情緒分析（只要過濾 + implication）

---

## 2. WF3: V10 訊號加目標價

### 2.1 為什麼

現在 v10 訊號訊息只有「停損」和「啟動點」（trail_start = 浮盈 1×ATR 啟動拉回），缺**參考目標價**。Cross 想看「這次大概朝哪去」做心理錨。

### 2.2 需求

Pine 端在 webhook payload 加 `target` 欄位（絕對價格）。GAS 端訊息加一行「目標: XXX (R:R = X.X)」。

**`target` 計算**（Pine 端）：
- 做多：`target = entry + (entry - stop) * R`，預設 `R = 1.5`
- 做空：`target = entry - (stop - entry) * R`
- `R` 從 Pine input 讀（預設 1.5），可選 1.0 / 1.5 / 2.0

**新 payload 欄位**（`target` / `target_r` 為新增欄位）：

```json
{
  "secret": "...",
  "action": "buy",
  "ticker": "TXF1!",
  "timeframe": "60",
  "price": 21820,
  "pattern": "春雷型態",
  "quality": 82,
  "macro_score": -17.6,
  "stop": 21580,
  "trail_start": 22060,
  "target": 22180,
  "target_r": 1.5
}
```

### 2.3 訊息渲染（GAS）

在 `handleV10Signal()` 訊息「啟動點」**之後** 加：

```
停損: 21,580
啟動點: 22,060（浮盈 1×ATR）
目標: 22,180 (R:R = 1.5)         ← 新
```

如果 payload 沒帶 `target`（向後相容舊 Pine 版本），不渲染這行，**不要**報錯。

### 2.4 改動清單

#### 2.4.1 `macro_snapshot_handler.gs`

- `handleV10Signal()` 在 `trail_start` 渲染那行**之後**加：
  ```js
  if (payload.target !== undefined) {
    const rText = payload.target_r ? ` (R:R = ${fmt(payload.target_r, 1)})` : '';
    msg += `目標: <code>${fmt(payload.target)}</code>${rText}\n`;
  }
  ```

#### 2.4.2 `pine_alert_webhook.md`

- payload schema 範例加 `target` / `target_r`
- 加一節「Pine 端如何算 target」短說明 + Pine code snippet：
  ```pine
  rrTarget = input.float(1.5, "R:R Target", options=[1.0, 1.5, 2.0])
  longTarget  = entry + (entry - stop) * rrTarget
  shortTarget = entry - (stop - entry) * rrTarget
  // 加進 alert_message JSON 拼接：
  // ..."target": ' + str.tostring(direction == 1 ? longTarget : shortTarget) + ', "target_r": ' + str.tostring(rrTarget)
  ```

#### 2.4.3 `strategy_v10.pine`（Pine 主檔）

- ⚠ **不要**直接改 Pine 主檔（避免動 strategy 邏輯）。**只改 webhook 文件**。
- Pine alert message 拼接由 Cross 在 TradingView UI 套（webhook md 已說明）。

#### 2.4.4 加 mock test

- `testV10Signal()` mock payload 加 `target: 22180, target_r: 1.5`，跑一次看 Telegram 多「目標: 22,180 (R:R = 1.5)」行

### 2.5 Acceptance

- [ ] `handleV10Signal()` 對沒帶 `target` 的舊 payload 仍正常運作
- [ ] 帶 `target` 但沒 `target_r` 時，只顯示「目標: XXX」不顯示 R:R
- [ ] `testV10Signal()` Telegram 收到的訊息有「目標」行
- [ ] `pine_alert_webhook.md` 範例 JSON 含 target / target_r
- [ ] node --check syntax pass
- [ ] commit message: `Add target price to v10 signal message (workflow 3)`

### 2.6 不要做

- ❌ 不要動 `strategy_v10.pine` 主檔（只改 webhook md）
- ❌ 不要做動態 R:R（從 macro / pattern quality 自適應）— 固定 1.5 就好
- ❌ 不要在訊息加「預期獲利 NTD」（避免心理錨偏差）

---

## 3. WF4: Earnings summary 加 earnings call 簡報 + 分析師 Q&A

### 3.1 為什麼

現在 earnings summary 只有 EPS/Rev/Guidance/盤後反應/建議/2-3 句重點。缺**管理層 commentary 重點** + **分析師問答關鍵交鋒**——這兩塊才是真正驅動股價隔日走勢的東西。

### 3.2 需求

在 summary payload 加兩個新欄位：

```json
{
  "call_highlights": [
    "資料中心 +73% YoY 為主要驅動，Blackwell 出貨提前一季",
    "毛利率指引維持 75% 以上，Inventory turnover 改善",
    "中國禁令影響 Q3 約 $5B，但已 priced in"
  ],
  "qa_highlights": [
    "Morgan Stanley 問 H100 庫存去化 → CFO 回覆 Q3 完成，無 write-down",
    "Goldman 問 Sovereign AI 訂單能見度 → 12 個月 backlog 已滿"
  ]
}
```

**寫作守則**（routine 端）：
- `call_highlights`：3-5 條，從 prepared remarks 抽出，每條 ≤ 50 字，**先因後果**
- `qa_highlights`：2-3 條，挑**有對立 / 有 surprise** 的交鋒，格式 `[分析師行] 問 [問題] → [回應]`，每條 ≤ 60 字
- 來源：Seeking Alpha transcripts / Motley Fool transcripts / Bloomberg call notes / 公司 IR
- 找不到（Routine 跑時 transcript 還沒上）→ 兩個欄位送空陣列 `[]`

### 3.3 訊息渲染（GAS）

在 `formatEarningsSummary()` 的 「**重點**」段**之前**插入兩段：

```
建議: 🟢 加碼
若 Q2 指引高於共識 5%+ 且資料中心 YoY >55%，加 5 股至 20 股總部位

【Call 重點】                                          ← 新
• 資料中心 +73% YoY 為主要驅動，Blackwell 出貨提前一季
• 毛利率指引維持 75% 以上，Inventory turnover 改善
• 中國禁令影響 Q3 約 $5B，但已 priced in

【分析師 Q&A】                                          ← 新
Q · MS 問 H100 庫存去化
A · CFO 回覆 Q3 完成，無 write-down

Q · GS 問 Sovereign AI 訂單能見度
A · 12 個月 backlog 已滿

重點
資料中心 +73% YoY 超出市場 +65% 預期，AI capex 故事仍在...
```

`qa_highlights` 渲染拆 Q/A：用 `→` 切字串，前面 = Q，後面 = A。如果沒有 `→`，整條當作 Q 顯示，A 顯示「—」。

### 3.4 改動清單

#### 3.4.1 `macro_snapshot_handler.gs`

- `formatEarningsSummary()` 在「建議」之後 / 「重點」之前插入兩個 conditional block：
  - `Array.isArray(p.call_highlights) && p.call_highlights.length > 0` → 渲染【Call 重點】
  - `Array.isArray(p.qa_highlights) && p.qa_highlights.length > 0` → 渲染【分析師 Q&A】
- Q&A 拆字串：用 `'→'` split，trim，escape HTML
- 全部欄位走 escapeHtml

#### 3.4.2 `earnings_routine_prompt.md`

- Step 3b 的 summary payload 範例加 `call_highlights` / `qa_highlights`
- 在「資料源」表格後加新節「### Call / Q&A 來源優先順序」（Seeking Alpha / Motley Fool / Bloomberg / IR）
- 加寫作守則（字數限制 / 先因後果 / 對立交鋒優先）
- 「找不到 transcript」場景：兩欄送空陣列 `[]`，加進 `data_quality.warnings`（如果 prompt 有的話）或註解

#### 3.4.3 加 mock test

- `testEarningsSummary()` mock payload 加 NVDA 範例：
  - `call_highlights`: 3 條（資料中心 / 毛利率 / 中國禁令）
  - `qa_highlights`: 2 條（MS H100 / GS Sovereign AI）
- 跑一次看 Telegram 兩段都出現

### 3.5 Acceptance

- [ ] `formatEarningsSummary()` 對 `call_highlights=[]` / `qa_highlights=[]` 不渲染章節
- [ ] Q&A 字串沒有 `→` 時 A 段顯示「—」不報錯
- [ ] `testEarningsSummary()` Telegram 收到的訊息含【Call 重點】+【分析師 Q&A】
- [ ] node --check syntax pass
- [ ] commit message: `Add call_highlights + qa_highlights to earnings summary (workflow 4)`

### 3.6 不要做

- ❌ 不要做 earnings call audio 即時轉錄（依賴 transcript 站，不要自己跑 ASR）
- ❌ 不要做情緒分析（管理層用詞偏好）— 只要事實 + Q&A 重點
- ❌ 不要把 transcript 全文存到 sheet（只保留 highlights）
- ❌ 不要加超過 5 條 call_highlights / 3 條 qa_highlights（訊息會太長）

---

## 4. 工作完成後

### 4.1 Push

每個 wf commit 完跑：

```bash
git push -u origin claude/telegram-bot-progress-HUX8o
```

如果失敗（網路）→ 退避重試 2s / 4s / 8s / 16s，最多 4 次。

### 4.2 PR 更新

PR #5 的 description 已經寫了 WF1 的內容。WF2-4 完成後，**追加** sections 到 PR description（不要覆蓋 WF1 段）：

```markdown
---

## WF2: News pulse narrative

(改動摘要 + 訊息範本變化截圖式)

## WF3: Target price

(同上)

## WF4: Earnings call + Q&A

(同上)
```

用 `mcp__github__update_pull_request` 工具，注意 body 要含原本 WF1 段全文 + 新增段。

### 4.3 Final report

最後一個 commit 後跟 Cross 報：
1. 4 個 wf 全部完成的 commit hash
2. PR #5 link
3. 部署順序提醒（先把 macro_snapshot_handler.gs 整個檔貼進 GAS、New deployment、跑 testMacroSnapshot/testV10Signal/testEarningsSummary 三個 mock）

---

## 附錄 A：既有 mock test 函數位置（參照）

```bash
grep -n "^function testMacro\|^function testV10\|^function testEarning\|^function testRead" macro_snapshot_handler.gs
```

跑這個會找到 5 個 mock test，照同樣風格加 mock payload。

## 附錄 B：訊息上限

Telegram 單則訊息上限 **4096 字元**。Macro 訊息加 news_pulse + WF1 已經滿了，估算總長 ≤ 1800 中文字 = 約 5400 byte UTF-8 → **可能會逼近上限**。
- 若 WF2 加完發現總長 > 3000 字元，砍 news_pulse 從 6 條 → 4 條
- 不要砍 portfolio_implications（那是 Cross 最在意的）

## 附錄 C：禁用詞（沿用 WF1）

從 `.claude/skills/macro-daily-analyst-report/SKILL.md` 的禁用詞庫繼續用：
- ❌ "可能" / "或許" / "預期可能" → 用 "若 X 則 Y"
- ❌ "建議謹慎" → 用具體門檻
- ❌ "整體而言" / "綜合來看" → 直接結論

news_pulse 的 implication 也適用。
