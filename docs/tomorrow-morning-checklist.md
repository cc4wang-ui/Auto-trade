# 明天早上起床 Checklist（2026-05-04）

> 5/3 晚把 WF2-5 全 ship + 4-layer guard + SKILL.md inline。
> 早上 08:30 TW 應該會自動收到第一份完整 IB Macro 報告。

---

## 起床第一件事：開 Telegram 看 08:30 那條（10 秒）

**三種可能，按 Telegram 收到的內容判斷**：

### Case A — 收到完整 IB 報告 ✅
> headline + 【信號】 + 【宏觀敘事】 + 【今日新聞脈絡】 + 【持倉動作】 + 【關鍵風險】 + 【今明 48H 催化劑】 + 【關鍵價位】 + 【翻盤條件】

→ **整條 pipeline 全通**，看完當作晨報用。
→ 順便 reply 我「全通了」我把 PR #6 推 merge。

### Case B — 收到乾淨的舊版報告 🟡
> 黃燈 / 季節 / 分數構成 / 關鍵指標 / v10 四門 / 行動建議 — **沒有** headline/宏觀敘事

意思：Routine 端送了 quant 數據但**沒帶 analyst_report**。
→ 95% 是 Routine 端 prompt 沒更新到最新版（你還沒貼 5/3 inline SKILL 的 `macro_snapshot_prompt.md`）。
→ 動作：花 90 秒把新版 prompt 貼到 Anthropic Routine：
   1. 開 https://github.com/cc4wang-ui/Auto-trade/edit/claude/telegram-bot-workflows-9Xsus/macro_snapshot_prompt.md
   2. Cmd+A 全選 → 複製
   3. Anthropic Routines → daily-macro-snapshot → Edit prompt → 全選刪 → 貼上 → Save
   4. 等晚上 21:00 cron 再驗一次

### Case C — 收到「⚠ 收到空 payload」 🔴
意思：4th-layer guard 擋下空殼，**Routine 那邊根本沒撈到數據**。

→ 動作：開 Anthropic Routine logs 截最近一次 Run 的 console output 給我。3 個常見根因：
   1. Telegram bot token 401（Routine secrets 過期）
   2. Routine prompt 還是舊版（沒部署 5/3 那版）
   3. GAS Web App 部署不是 Anyone（你說已改，但再驗一次 Deploy → Manage deployments → Edit）

### Case D — Telegram 完全沒東西 🔴🔴
→ 動作 1：Apps Script → 跑 `testMacroSnapshotAnalyst` → 看 Telegram 有沒有來
   - 來了：問題在 Routine 端（網路/cron/secrets）
   - 沒來：Telegram bot token 真的死了 → BotFather → /mybots → Revoke + 取新 token → 更新 GAS Script Properties + Routine secrets
→ 動作 2：Apps Script → 跑 `dryRunDoctor` → 看哪裡 ❌

---

## 第二件事：v10 Pine 訊號驗證（5 分鐘）

如果 Case A 過了，順便驗證 Pine snapshot 在跑：

1. 打開 Telegram，搜「快照」或上滑找 `v10_state` 推送（Pine 每 60min K 線收盤推一筆）
2. 沒收到 → 進 TradingView → 確認 strategy_v10 alert 還活著（Essential 帳號 alert 60 天會過期）
3. 進 Sheet `v10_state` → 看最新時間戳是否 < 90 分鐘

---

## 第三件事（可選）：把這分支 merge 掉

明天 Telegram 收到完整報告後，告訴我「merge PR #6」我直接：
1. 確認 CI 綠
2. Squash merge → main
3. 刪分支

---

## 5/3 晚踩過的坑（避免再撞）

| # | 坑 | 教訓 |
|---|---|---|
| 1 | GAS deploy 成「Only myself」→ POST 被 302 | Web App 永遠用 `Anyone`（完全匿名） |
| 2 | Routine 無檔案系統 → 讀不到 SKILL.md | 規範必 inline 進 prompt 本體 |
| 3 | manual_test 解讀為「跳過數據」→ 空殼 payload | prompt 明文：不論 session 都跑 Steps 1-5 |
| 4 | 空 payload silent 渲染 dashes | 加 4th-layer payload completeness guard |
| 5 | guard 放 dedup 後 → 空殼占用 dedup 配額 → guard 永遠不執行 | guard 必在 dedup 之前 |
| 6 | testEmptyPayload 用固定 session 撞歷史 dedup | test 必用 `'test_empty_' + Date.now()` |
| 7 | legacy renderer 死板填 dashes 看似 bug | section-conditional：缺資料整段跳過 |
| 8 | Telegram 401 不能直接歸因 token 死 | 先 testMacroSnapshotAnalyst 隔離測試 |

完整版見 `dev-guide.md` Gotcha #27-36。

---

## 今晚已 push 的 commits（按時序）

```
9502412  Reject empty macro_snapshot payloads (4th-layer guard 第一版)
e98ffa3  Make legacy renderer forgiving + dryRunDoctor + testEmptyPayload
ba3e4d7  Move empty-payload check before dedup + unique test session
b924483  Inline analyst-report SKILL.md into macro_snapshot_prompt.md
```

如果要 rollback 到今晚之前的狀態：`git revert b924483 ba3e4d7 e98ffa3 9502412`（不過你現在已經穩定了，不該需要）。

---

## 一句話總結

**起床 → 看 Telegram 08:30 那條 → 是 Case A 就睡回去，是 Case B-D 就照上面動作做完跟我說。**
