# One-shot Fix — 空 payload Dashes 問題

> 03/05 22:32 Telegram 收到全 dashes 那次的修補。
>
> **介入時間：4 分鐘**。手機可完成。

---

## 為什麼壞了

`handleMacroSnapshot` 過了 token + timestamp + dedup 三層，但**沒驗證 payload 有沒有真實數據**。
Routine ▶ Run Now 在非排程時間觸發 → Claude 跳過數據撈取 → 送出空殼 payload → GAS 渲染一堆 `'—'`。

## 修了什麼（已 push 到 `claude/telegram-bot-workflows-9Xsus`）

1. **空殼 payload 拒收**：handleMacroSnapshot 加第 4 層檢查 — 沒 `analyst_report.headline` 也沒 `light/macro_score/season` → 直接回 `{ok:false, error:'empty_payload'}` 並推 ⚠ 警告
2. **舊版渲染變寬鬆**：partial payload 不再死板填 dashes — 哪段沒數據哪段就跳過
3. **Routine prompt 補 Bug 5 警告**：明確規定 `manual_test` 不能跳過 Steps 1-5
4. **2 個自診斷函數**：`dryRunDoctor()` + `testEmptyPayload()`

---

## 你只要做這 4 步（手機）

### 1. 貼新版 GAS（90 秒）

1. 開 https://script.google.com/home → 你的 telegram bot 專案
2. 左側 `macro_snapshot_handler.gs` → 編輯區全選刪掉
3. 開新分頁貼這個 URL（GitHub edit 視圖，私 repo 也行）：
   `https://github.com/cc4wang-ui/Auto-trade/edit/claude/telegram-bot-workflows-9Xsus/macro_snapshot_handler.gs`
4. 編輯框內全選複製 → 回 Apps Script 貼上 → 💾 儲存

### 2. 跑 `dryRunDoctor()`（30 秒）

1. Apps Script 上方函數下拉選單 → 選 `dryRunDoctor`
2. ▶ Run（手機可能跳授權，按 OK）
3. 看 console（執行紀錄）—**全 ✅ 才算 OK**。任何 ❌ 我來修

### 3. 跑 `testEmptyPayload()`（30 秒）

1. 函數下拉選 `testEmptyPayload`
2. ▶ Run
3. **預期 console**：`{"ok":false,"error":"empty_payload",...}`
4. **預期 Telegram**：收到一條「⚠ 收到空 payload」警告 — 證明擋下成功

### 4. 部署新版本（30 秒）

右上 **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**
（Web App URL **不變**，Routine 不用改）

---

## 驗證下次正常時段（08:30 / 21:00）

明天 08:30 TW 自動 cron 觸發 → 應該收到完整 IB 分析師報告（有 headline、信號、宏觀敘事）。

如果還是看到「⚠ 收到空 payload」 → **不是 GAS 問題**，是 Anthropic Routine 端 prompt 沒部署或斷網 → 開 Routine logs 查最近一次 Run 發了什麼，傳給我。

---

## Rollback（萬一）

`git revert 9502412` 然後重貼 `macro_snapshot_handler.gs`（雖然應該不會需要）。
