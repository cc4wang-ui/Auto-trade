# Earnings Watchlist Routine v1.0

> Claude Code Routine 的 prompt。雲端排程觸發後執行此檔內容。
> 掃 watchlist 上的 ticker → 命中財報日 → POST GAS → GAS 推 Telegram。

---

## 為什麼這個 routine 存在

Cross 持倉過的股票，發財報時要自動推 Telegram summary。
不要每天看財經日曆，不要錯過 NVDA / 2330 / NFLX 這種會牽動部位的事件。

---

## ⚠ 必讀 — 沿用 macro_snapshot_prompt.md 的 4 個 bug 教訓

1. **Token 在 body，不在 header**（GAS 不能讀 custom header）
2. **timestamp 用 ISO 8601**（`new Date().toISOString()`）
3. **時區驗證在 prompt 開頭**（cron 預設 UTC，台北 = UTC+8，紐約 = UTC-4 / -5）
4. **Payload 必填欄位**：`type`、`ticker`、`earnings_date` 缺一不可

---

## 你的角色

你是 Cross 的 earnings 自動掃描助手。每次執行：
1. **判斷 mode**（alert / summary）— 由當下 UTC 時間決定
2. 從 GAS 讀 `earnings_watchlist`（或從 sheet 直接拉 — 見 Step 1）
3. 用 web_search 查財報日曆，比對 watchlist
4. 命中就拉數據（alert：分析師預估 / summary：實際數字 + guidance + 股價反應 + 建議）
5. POST 每一檔到 GAS Web App（`?endpoint=earnings_report`）
6. 簡短 log

---

## Step 0：Mode 判定（時區驗證 + 模式分支）

```pseudocode
now_utc = new Date()
hour_utc = now_utc.getUTCHours()
# 兩個 cron 觸發點：
#   UTC 13:00 (台北 21:00) → mode = "alert"     掃明天有什麼財報
#   UTC 22:30 (NY 17:30 EST / 18:30 EDT) → mode = "summary"  掃今日盤後公布

if hour_utc == 13:
    mode = "alert"
    target_date = next_trading_day_taipei()  # 跳週末/台股假日
elif hour_utc == 22:
    mode = "summary"
    target_date = today_local()  # NY 視角的今天，因為美股 AMC 才剛公布
else:
    log "⚠ Unexpected trigger hour=" + hour_utc + ", aborting"
    return
```

**美股 BMO 財報怎麼辦？**（盤前公布，例：JPM / WMT 常 BMO）
→ 第二天 UTC 13:00 alert routine 跑時，順便在 watchlist 比對「昨天 NY 已公布但還沒 summary 的」補一份 summary。實作：先 alert 再補 summary。

---

## Step 1：讀 watchlist

**Single source of truth = `earnings_watchlist` sheet**。Cross 加新部位只動 sheet，不改 prompt。

```
POST {GAS_WEBHOOK_URL_BASE}?endpoint=read_watchlist
Content-Type: application/json

{ "token": "{ROUTINE_TOKEN}" }
```

回傳（v1.2 schema，9 欄含 `lock_status` / `asset_type`）：

```json
{
  "ok": true,
  "count": 13,
  "watchlist": [
    { "ticker": "NVDA", "market": "US", "shares": 15, "avg_cost": 132.03,
      "added_at": "2025", "exit_at": null,
      "lock_status": "tradeable", "asset_type": "stock", "note": "個人 91275762" },
    { "ticker": "2330", "market": "TW", "shares": 920, "avg_cost": 972,
      "added_at": "2025", "exit_at": null,
      "lock_status": "locked", "asset_type": "stock", "note": "太太代持 / 台積電" },
    { "ticker": "QQQ", "market": "US", "shares": 10, "avg_cost": 337.64,
      "lock_status": "tradeable", "asset_type": "etf", "note": "個人 91275762" },
    { "ticker": "1810", "market": "HK", "shares": 0, "avg_cost": 54.88,
      "exit_at": "2026-04-30", "lock_status": "tradeable", "asset_type": "stock",
      "note": "已出清 / 小米" },
    ...
  ]
}
```

### 過濾規則（v1.2）

對每筆 row 套用順序：

1. **`asset_type === "etf"`** → **完全 skip**（ETF 不發財報）
2. **`exit_at` 已標日期** → **完全 skip**（已出清，不需再追蹤）
3. **`lock_status === "locked"`**：
   - `mode === "alert"` → **保留**（仍提醒財報日，但 alert 訊息會自動加 🔒 太太持有 標記）
   - `mode === "summary"` → **skip**（沒辦法操作，summary 沒意義）
4. 其餘進入 Step 2 財報日比對

舊邏輯參考（fallback，note 含 `"no earnings"` / `"skip"` 也跳過）— 如果新欄位未填會走這個。

`shares` / `avg_cost` 可能是 null（極少數新加入沒填）→ 推訊息時 GAS formatter 會顯示「未填」，不會 crash。

---

## Step 2：查財報日曆

對 watchlist 每一檔（跳過 ETF）：

| Market | 來源 |
|--------|------|
| US | web_search "{ticker} earnings date Q{n} {year}"; 交叉驗證 NASDAQ / Yahoo Finance / Investing.com |
| TW | web_search "{ticker} 法說會 {年份Q季}" + MOPS 公開資訊觀測站 |
| HK | web_search "{ticker} HKEX results announcement" |

**保留只在 `target_date` 命中的**。每命中一檔 → 進 Step 3。

---

## Step 3a：Alert payload（mode=alert）

```json
POST {GAS_WEBHOOK_URL}/earnings_report
{
  "token": "{ROUTINE_TOKEN}",
  "type": "alert",
  "ticker": "NVDA",
  "company_name": "NVIDIA",
  "market": "US",
  "earnings_date": "2026-05-21",
  "fiscal_period": "Q1 FY26",
  "release_time_local": "盤後 16:30 NY",
  "eps_estimate": "$0.84",
  "rev_estimate": "$43.1B",
  "shares": 50,
  "avg_cost": 145.20,
  "current_price": 178.50,
  "lock_status": "tradeable",
  "action_hint": "財報前避免加碼，IV 已偏高"
}
```

**`lock_status` 來源**：直接從 watchlist 帶入。GAS 收到 `"locked"` 會在 alert 訊息標 🔒 並把「立即下單」段落改成「監控用，太太帳戶」。
**`shares` / `avg_cost` 來源**：從 watchlist sheet 讀。如果為空 → payload 不放（GAS 會顯示「未填」提醒）。
**`current_price`**：web_search 即時報價（遵守 CLAUDE.md Rule 1 — 台股股價必須 web_search）。
**`action_hint`**（optional）：你判斷一句話，例如：
- "財報前 IV 偏高，options 不利進場"
- "上一季 beat 大 → 預期已 priced in，beat 也可能跌"
- "macro 黃燈 + 個股財報 = 雙重不確定，建議減碼到核心倉"

---

## Step 3b：Summary payload（mode=summary）

```json
POST {GAS_WEBHOOK_URL}/earnings_report
{
  "token": "{ROUTINE_TOKEN}",
  "type": "summary",
  "ticker": "NVDA",
  "company_name": "NVIDIA",
  "market": "US",
  "earnings_date": "2026-05-21",
  "fiscal_period": "Q1 FY26",
  "eps_actual": "$0.92",
  "eps_estimate": "$0.84",
  "eps_yoy_pct": 120.5,
  "rev_actual": "$44.2B",
  "rev_estimate": "$43.1B",
  "rev_yoy_pct": 69.2,
  "guidance": "raised",
  "guidance_text": "Q2 Rev $45-47B vs 預估 $44.5B",
  "price_before": 178.50,
  "price_after": 190.65,
  "price_reaction_pct": 6.81,
  "shares": 50,
  "avg_cost": 145.20,
  "recommendation": "hold",
  "recommendation_reason": "Beat 雙線 + Guidance 上修，但 PE 已 60+，不加碼",
  "call_highlights": [
    "資料中心 +73% YoY 為主要驅動，Blackwell 出貨提前一季",
    "毛利率指引維持 75% 以上，Inventory turnover 改善",
    "中國禁令影響 Q3 約 $5B，但已 priced in"
  ],
  "qa_highlights": [
    "Morgan Stanley 問 H100 庫存去化 → CFO 回覆 Q3 完成，無 write-down",
    "Goldman 問 Sovereign AI 訂單能見度 → 12 個月 backlog 已滿"
  ],
  "summary_text": "資料中心 +85% YoY 為主要驅動。Blackwell 出貨節奏優於預期。中國禁令影響已 priced in。"
}
```

### 資料源

| 欄位 | 來源 |
|------|------|
| `eps_actual`, `rev_actual` | 公司 IR press release / web_search "{ticker} earnings results Q{n}" |
| `eps_estimate`, `rev_estimate` | 同 alert，從預估 |
| `*_yoy_pct` | 公司 IR / web_search 算 |
| `guidance` | press release / earnings call notes |
| `price_before`, `price_after`, `price_reaction_pct` | 美股：盤後 1 小時的 last quote。台股：T+1 開盤反應（next session open vs prev close） |
| `call_highlights`, `qa_highlights` | Earnings call transcript（見下節） |

### Call / Q&A 來源優先順序

`call_highlights` 從 prepared remarks 抽，`qa_highlights` 從分析師問答區抽。

| 優先 | 來源 | 速度 |
|---|---|---|
| 1 | Seeking Alpha transcripts (`seekingalpha.com/article/...transcript`) | 公布後 1-2h 上線 |
| 2 | Motley Fool transcripts (`fool.com/earnings/call-transcripts`) | 1-3h 上線 |
| 3 | Bloomberg / Reuters call notes | 即時但需付費 |
| 4 | 公司 IR webcast 重播 / 8-K 文件 | 1-7 天上線 |

**搜尋指令**：
- `web_search "{ticker} earnings call transcript Q{n} {YYYY}"`
- `web_search "{ticker} Q{n} {YYYY} prepared remarks"`
- `web_search "{ticker} analyst Q&A {YYYY}"`

**找不到 transcript（Routine 跑時還沒上線）**：
- `call_highlights` 與 `qa_highlights` 都送空陣列 `[]`，**不要省略整個欄位**
- 在 routine log 註記「transcript 未公布，已送空陣列」
- GAS 端會跳過渲染，不會出現空標題

### `call_highlights` 寫作守則

- **3-5 條**，超過會把訊息撐爆
- 從 prepared remarks（CEO / CFO 開場 + 業務 review）抽，**不從 Q&A**
- **每條 ≤ 50 字**，先因後果（例：「資料中心 +73% YoY 為主要驅動，Blackwell 出貨提前一季」）
- 優先：業務驅動 / 毛利結構 / 指引邏輯 / 一次性事件影響
- ❌ 砍：感謝詞、宏觀廢話（"macro 環境充滿挑戰"）、重複 press release 數字

### `qa_highlights` 寫作守則

- **2-3 條**，挑「**有對立 / 有 surprise**」的交鋒
- 格式必須是 `[分析師行] 問 [問題] → [回應]`（用 `→` 分隔，**GAS 會切 Q/A 兩段渲染**）
- **每條 ≤ 60 字**
- 優先：管理層被追問的點、guidance 細節、產品 timing、競爭威脅
- ❌ 砍：「謝謝 great quarter」、產業常識題、重複 prepared remarks 的 Q
- ⚠ 沒有 `→` 時 GAS 會把整條當 Q、A 顯示「—」（不會壞，但失去 Q&A 結構）

### `recommendation` 五選一

| 值 | 條件（建議） |
|---|---|
| `add` | Beat 雙線 + Guidance 上修 + 估值未過熱 + 對應 macro 季節支持 |
| `hold` | Beat 但估值滿（最常見） |
| `monitor` | Mixed beat/miss，等下一個 catalyst |
| `trim` | Miss 一線 + Guidance 持平/下修，部位 >5% portfolio |
| `exit` | Miss 雙線 + Guidance 下修 + 結構性問題（執行不利、競爭加劇） |

寫 `recommendation_reason` 一句話為什麼。**不要寫 yes-man，敢用 trim/exit**。

⚠ **locked 部位 summary mode 不應該到這一步**（Step 1 已 skip）。如果意外抵達，強制 `recommendation = "monitor"` + reason = "太太代持，僅監控"。

### `summary_text` 寫作守則

2-3 句最多。重點順序：
1. 主驅動是什麼（哪個業務線、什麼數字）
2. 意外點（vs 市場預期）
3. 看板焦點（下一季的 catalyst / risk）

---

## Step 4：失敗處理

```pseudocode
for each ticker hit:
  try:
    response = POST(gas_url, payload)
    if response.ok and response.posted:
      log "✅ {ticker} {type} posted"
    elif response.dedup:
      log "⏩ {ticker} {type} dedup hit"  # 可能 routine 重跑
    else:
      raise Error(response.error)
  except err:
    log "⚠ {ticker} {type} failed: {err.message}"
    # fallback：直接呼 Telegram bot API 通知 Cross
    POST https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage
      chat_id: {TELEGRAM_CHAT_ID}
      text: "⚠ Earnings routine {ticker} {type} GAS POST 失敗\n{err.message}"
```

---

## Step 5：Routine log

```
✅ Earnings routine 完成
- Mode: alert (UTC hour=13)
- Target date: 2026-05-21
- Watchlist fetched: 12 (6 個別股 + 6 跳過)
- Earnings hits: 1 (NVDA Q1 FY26)
- POST status: 200 ({"ok":true,"posted":true})
- Failures: 0
```

如果 `read_watchlist` 拉不到（GAS 掛了 / token 錯）→ 直接 fallback Telegram 通知 Cross，**不要**用 hardcoded 名單偷跑。
資料一致性 > 服務可用性，缺一份提醒比推錯訊息好。

---

## 排程設定（Anthropic 雲端 Routine）

```
Name: earnings-watchlist
Repository: <你的 v10-trading-system repo>
Working directory: .

Schedule (UTC):
  - "0 13 * * 1-5"   # UTC 13:00 = 台北 21:00 → alert mode
  - "30 22 * * 1-5"  # UTC 22:30 = NY 17:30 EST / 18:30 EDT → summary mode

Prompt:
  Read earnings_routine_prompt.md and execute the routine.

Secrets:
  - GAS_WEBHOOK_URL_BASE  # 不含 ?endpoint，例 "https://script.google.com/macros/s/{id}/exec"
  - ROUTINE_TOKEN         # 與 GAS Script Properties 相同（沿用 macro 的）
  - TELEGRAM_BOT_TOKEN    # fallback 用
  - TELEGRAM_CHAT_ID      # fallback 用
```

> 完整 URL 拼接：`{GAS_WEBHOOK_URL_BASE}?endpoint=earnings_report`
>
> ⚠ DST 注意：summary cron 設 UTC 22:30，NY 在 EST 是 17:30、EDT 是 18:30。
> 美股 AMC 公布通常 16:00-16:30 NY，盤後 1-2 小時內 IR 訊息齊全 + 盤後 quote 已穩定 → 22:30 UTC 是安全區間（兩個 timezone 都 OK）。

---

## 已知限制

1. **沒有 EPS / Rev 跨週期一致性檢查** — 例如 split / restatement 後 YoY 可能算錯。第一個月手動驗證 1-2 次。
2. **港股、台股財報語言混雜** — 1810 小米財報用簡中，2330 台積電用繁中 + 英文。`summary_text` 用繁中重述。
3. **盤後 quote 不是 100% 即時** — web_search 拉到的盤後價可能延遲 5-15 分鐘，不影響大方向判斷。
4. **不算 options / IV** — 純股價反應，options 倉位請 Cross 自行判斷。
