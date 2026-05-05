# Mobile Deploy Runbook — WF2-5

> 手機操作部署 PR #6（WF2 news_pulse + WF3 target + WF4 earnings call/Q&A + WF5 v10_state 自動 D2/D3）
>
> **不適用初次部署** — 這份是「現有 v1.1 GAS bot 已上線，只更新 delta」用。初次部署看 `docs/telegram-bot-deploy-runbook.md`（桌面版）。
>
> **預期手機時間**：12-15 分鐘
> **預期介入點**：GAS paste-save-deploy（1 次）、TradingView 加 alert（1 次）、Anthropic Routine 更新 prompt（1 次）、Telegram 看 mock 訊息（1 次）

---

## Pre-flight（1 分鐘）

打開這 3 個 raw URL 預先存到手機備忘錄 / 剪貼簿，部署時直接複製：

| 用在哪 | Raw URL（長按複製） |
|---|---|
| GAS 主檔 | `https://raw.githubusercontent.com/cc4wang-ui/telegram-trade-bot/main/gas/macro_snapshot_handler.gs` |
| Earnings handler | `https://raw.githubusercontent.com/cc4wang-ui/telegram-trade-bot/main/gas/earnings_report_handler.gs` |
| Pine alert webhook 設定 | `https://raw.githubusercontent.com/cc4wang-ui/Auto-trade/main/automation/gas-endpoint/pine_alert_webhook.md` |
| Routine prompt（macro）| `https://raw.githubusercontent.com/cc4wang-ui/Auto-trade/main/automation/routine/macro_snapshot_prompt.md` |
| Routine prompt（earnings）| `https://raw.githubusercontent.com/cc4wang-ui/telegram-trade-bot/main/prompts/earnings_routine_prompt.md` |

> 💡 GAS 主檔 + earnings handler 在 `telegram-trade-bot` repo。Pine 訊號設定 + Macro Routine prompt 在 `Auto-trade` repo（Pine 屬於交易策略 source of truth）。

---

## Phase 1：GAS 更新（~5 分鐘）

### 1.1 開 Apps Script

手機瀏覽器（Chrome / Safari）開 → https://script.google.com/home

→ 找你既有的 macro/telegram bot 專案 → 點進去

### 1.2 替換 `macro_snapshot_handler.gs` 全文

1. 左側檔案列表 → 點 `macro_snapshot_handler.gs`
2. 點編輯區任一處 → ⌘A / Ctrl+A 全選（手機長按 → 全選）
3. 開新分頁 → 貼上 Pre-flight 的 GAS Raw URL → **長按頁面 → 全選 → 複製**
4. 回 Apps Script → 貼上覆蓋
5. 右上角 💾 儲存（或 ⌘S）

> 📱 **手機小撇步**：iOS Safari 有 reader mode 看 raw 較難全選，**用 Chrome** 比較順。Android 的 GitHub mobile app「Edit file」按鈕直接給 raw text。

### 1.3 跑 `setupCheck()` 驗證 + 自動建 sheet

1. 編輯區頂部 → 函數下拉選單 → 選 `setupCheck`
2. 點 **▶ Run**（首次跑可能跳授權對話框 → Review permissions → 授權）
3. 看 console（編輯區下方 Execution log）：
   - 預期看到 `✅ 所有 Script Properties 已設定`
   - 預期看到 `✅ Sheet "v10_state" OK`（首次跑會看到 `→ 建立中`）
   - 若看到 `⚠ 缺少 Script Properties` → 你 v1.1 已上線就應該有，去 Project Settings 補

### 1.4 跑 5 個 mock tests

依序在函數下拉選 → ▶ Run（每個跑完看 Telegram 是否收到訊息）：

| 函數 | 預期 Telegram 收到 |
|---|---|
| `testMacroSnapshotAnalyst` | 含【今日新聞脈絡】+【信用壓力】🟠 WARNING + D2 Q=78 ✅ + D3 OBV up ⚪ |
| `testV10Signal` | 含「目標: 21,805 (R:R = 1.5)」+「Regime: 🟠 WARNING (由 NORMAL 升級)」+「↳ HY 信用壓力 (3.62%)」 |
| `testEarningsSummary` | NVDA 財報含【Call 重點】+【分析師 Q&A】 |
| `testV10State` | 不發 Telegram，console 看 `{"ok":true,"upserted":"TAIFEX:TXF1!"}` |
| `testReadV10State` | console 看 `states[0]` 含 regime / hy_pressure_level 欄位 |

5 個都過 → Phase 1 完成。

### 1.5 重新部署 Web App

1. 右上角 **Deploy** → **Manage deployments**
2. 找到既有的 Web App deployment → 右側 ✏️ 編輯
3. **Version** 下拉 → 選 **New version**
4. Description 填：`WF2-5 news_pulse + target + earnings call + v10_state`
5. **Deploy**
6. 複製 Web App URL（如果改變要更新 Routine secret，**通常不會變**）

> ⚠ 如果你之前選 `Anyone` access，Manage deployments 會保留設定。如果選 `Anyone within Google account` 要確認 Anthropic Routine 還能 hit。

---

## Phase 2：TradingView 加 v10_state snapshot alert（~5 分鐘）

### 2.1 加 Pine snapshot snippet 到 strategy_v10.pine

1. TradingView 手機 app（或瀏覽器版）開 → TXF1! 60min 圖
2. 底部工具列 **{} Pine Editor**
3. 開現有的 `strategy_v10.pine`
4. 拉到檔案最末（`alertcondition` 那兩行下面）
5. 貼上以下 snippet（從 `pine_alert_webhook.md` Step 4 複製，已自包含、已防 na）：

```pine
// ═══ Daily snapshot（每 bar close 把 D2/D3 推給 GAS）═══
if useWebhook and barstate.isconfirmed
    float snapObv     = ta.obv
    float snapObvSma  = ta.sma(snapObv, 20)
    string snapObvDir = na(snapObv) or na(snapObvSma) ? "flat" :
                       snapObv > snapObvSma ? "up" :
                       snapObv < snapObvSma ? "down" : "flat"

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

6. 右上 **Save**（或 ⌘S）→ 出現 ✅ Compiled successfully
7. 點 **Add to chart**（會用新版本覆蓋既有 strategy）

> ⚠ 如果 compile 出現 `Could not find function or function reference 'topName'` 之類錯誤 → 你 v10 主檔的型態 detector 變數命名不同。在 Pine Editor 上方 Find（🔍）`topName` 看實際命名是 `bestPattern` / `patternName` / 其他，把 snippet 內 3 個變數（topName / topQ / atr14）替換成你的命名。

### 2.2 加 TradingView Alert（snapshot 用）

1. 圖上右上角 ⏰ Alert 圖示 → **+ Create Alert**
2. **Condition**：選 `小台宏觀策略 v10.0` → 從下拉找 **`Any alert() function call`**
   - ⚠ 不是「V10 做多訊號」「V10 做空訊號」那兩個
3. **Frequency**：Once Per Bar Close
4. **Expiration**：Open-ended（Essential 60 天上限會自動擋；行事曆設 6/30 提醒重設）
5. **Alert actions**：
   - ✅ Webhook URL → 貼 `<你的 GAS Web App URL>?endpoint=v10_state`
   - 其他 notification 全關（不需要）
6. **Message**：留空（Pine alert() 會帶 JSON 來）
7. **Create**

### 2.3 等 1 根 K 線（最多 60 分鐘）然後驗證

1. 等到下一根 60-min K 線 close（或用 TradingView Bar Replay 觸發一根）
2. 回 Apps Script 編輯器 → Run `testReadV10State`
3. console 應該看到 `states[0]` 含 `quality / obv_direction / age_sec < 3600`
4. 也可以在 Google Sheet 看 `v10_state` 分頁有一列資料

> 🚨 **如果 30 分鐘還沒進來**：
> - TradingView Settings → 群組 Webhook → 確認 secret 跟 GAS PINE_ALERT_SECRET 一致
> - Alert 列表確認是 "Any alert() function call" 不是 alertcondition
> - Webhook URL 確認 query string 是 `?endpoint=v10_state`（不是 v10_signal）

---

## Phase 3：Anthropic Routine 更新（~2 分鐘）

### 3.1 開 Routine

claude.ai 手機 → 左側 menu → **Routines** → 找 `daily-macro-snapshot`

### 3.2 更新 prompt 全文

1. Routine 編輯頁 → System prompt / Instructions 區塊
2. 全選刪除舊版
3. 從 Pre-flight 的 `macro_snapshot_prompt.md` Raw URL 複製全文 → 貼上
4. **Save**

### 3.3（選用）順便更新 earnings routine

如果你也在用 earnings routine（明日提醒 / 當日 summary），順便：
- 開 `earnings-report-routine`
- 更新 prompt（用 `earnings_routine_prompt.md` 的 raw URL）
- Save

---

## Phase 4：明早驗證（自動）

明天 08:30 台北時間 macro snapshot Routine 自動跑：

預期 Telegram 收到的訊息會多 2 段：

```
🌅 台股盤前 05/01 08:30
━━━━━━━━━━━━━━━━━━

🟡 黃燈待機 — 估值頂 + 消費信心歷史新低

【信號】中性偏防禦 · HIGH · 1-2 weeks
ERP 已負值無估值安全邊際；消費信心 49.8 暗示需求面崩盤

【宏觀敘事】
成長：邊界訊號 g=+0.5...
通膨：ISM 物價 78.3 近 4 年高...
估值：SPX PE 28.1...

【信用壓力】 🟠 WARNING · HY 3.62% · 週Δ +0.42%   ← v10.1 新（NORMAL 不顯示）
HY 升至 3.62%，私人信貸限贖風險升溫
⚠ regime 強制 WARNING

【今日新聞脈絡】               ← WF2 新
🏦 [貨幣] Powell 偏鷹發言... (Bloomberg)
   → DXY 短彈、SPX 跌 0.8%
🛢 [油氣] OPEC+ 6 月決議延後 (Reuters)
   → 油價橫盤；IXC 短期無 catalyst
...

【持倉動作】
...

【量化參考】
🟡 黃燈 · 總分 -17.6 · 穩定度 57%
g=0.5  i=0.6  Base=0 Val=-17.6
D1 ❌ D4 ✅ · D2 Q=78 ✅ · D3 OBV up ⚪   ← WF5 新（不再「D2/D3 看 TV」）
```

如果 D2/D3 還是顯示「D2/D3 看 TV」 → snapshot alert 沒進來，回 Phase 2.3 troubleshoot。

---

## Rollback（如果出包）

每一段都可獨立 rollback，不影響其他段：

| 出包 | 怎麼 rollback |
|---|---|
| GAS 部署後 Telegram 不發 | Apps Script → Manage deployments → 編輯 → Version 選回前一版 → Deploy |
| Pine compile 錯 | TradingView Pine Editor → Save 前的版本還在歷史 → File → Recent → 選舊版 |
| Routine 推爆 | Anthropic Routines → 暫停 routine（不要刪），改回舊 prompt 即可恢復 |
| 太多 alerts 用完 | TradingView Alerts → 刪掉一兩個沒用的舊 alert |

---

## 還想再省力？（未來改善）

**GitHub Actions + clasp 自動同步 GAS**（一次性 30 min 設定，往後 0 介入）：

1. 桌面跑 `npm install -g @google/clasp` + `clasp login` → 拿到 `~/.clasprc.json`
2. `.clasprc.json` 內容存成 GitHub Repo Secret `CLASP_RC`
3. 加 `.github/workflows/deploy-gas.yml`：on push to main → restore .clasprc.json → `clasp push`
4. 此後 PR merge 即自動同步 GAS，不用再手動 paste

**TV 跟 Routine 永遠要手動**（沒有公開 API）。

要不要我把 GitHub Actions clasp 那一套也設好？要的話告訴我「設 clasp」，我會：
1. 加 `.github/workflows/deploy-gas.yml`
2. 加 `.clasp.json` 範本
3. 寫一份「桌面 5 分鐘設定 once」的指引
