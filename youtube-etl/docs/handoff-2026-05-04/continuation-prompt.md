# Continuation Prompt — first message to new Claude session

> Cross pastes this as the FIRST message to a new Claude conversation
> after uploading this folder to Project Knowledge.
>
> The prompt forces new Claude to (a) read the handoff archive, (b) report
> back its understanding via a 10-question quiz, and (c) wait for Cross's
> approval before doing any work. This catches misalignment before
> Claude takes irreversible actions on the live ETL.

---

## Suggested prompt (paste as-is)

```
你接手 mikai YouTube ETL 專案，接續上一個 session 2026-05-04 的工作。
Project Knowledge 裡面有 handoff archive 退交文件 8 份，請順序讀：

1. README.md — 入口、檔案索引、階段狀況
2. learnings.md — 最重要，Dos / Don'ts 跟 collaboration meta 規則
3. gotchas.md — 25 條記錄在案的部署陷阱（#27-51）
4. current-state.md — 系統現況快照
5. runbook.md — 每日/每週 ops + 失敗復原手冊
6. path-a-oauth-bootstrap.md — 拉 revenue 資料的手動部署手冊（Path A）
7. dashboard-code.gs — Apps Script 完整檔

讀完之後，請回答下面 10 個驗證問題以證明你了解這個專案。**不要猜，不知道就說「需 Cross 補充」**，這樣我能看出 Project Knowledge 讀到哪裡需要補。

## 驗證問題

1. 目前 Cloud Run service 名稱 / region / revision / ingress / YOUTUBE_AUTH_MODE 是什麼？
2. 存在哪 4 個 Cloud Scheduler job？各自 cron schedule？
3. mart_talent_daily_kpi 跟 mart_content_daily 粒度不同點？各用途？
4. content_type 這個欄位可能的值跟推導邏輯？
5. Path C vs Path A 區別？現在在哪一個？下一步是？
6. Path A.2.3 完成後 Secret Manager 裡要有哪 3 個 secret？
7. 「Bootstrap day」是什麼？mart 層怎麼處理？
8. 當 Cross 貼出 Cloud Shell 的錯誤 `--condition=Nonegcloud` 根本原因是什麼？對應 Gotcha #？
9. 寫 code 給 Cross 的規則是什麼？為什麼？對應 Gotcha #？
10. 現在主要 PR # 跟 branch 名稱？這個 PR 里有哪些重要 commit？

## 回答完之後

不要主動仕何動作。等我對照 gold-standard 答案表驗證你的認知上一個 session 是否一致，確認後才請你接著做下一件事。
```

---

## After Claude answers — Cross's checklist

1. **Compare against gold-standard** (provided separately by previous Claude in chat, not in this archive to prevent leak).
2. **8/10 correct = aligned**. Below = drift detected.
3. **If drift**: identify which docs Claude missed / mis-read. Re-prompt to read those docs again and re-answer just the wrong items.
4. **Once aligned**: tell Claude what to do next. Suggested first task is one of:
   - Apply `dashboard-code.gs` to Apps Script + run `buildDashboard` (verify 6 tabs)
   - Schedule `mart_content_daily_rollup` BQ Scheduled Query at 04:15 UTC
   - Begin Path A.1 (ticket IT to provision `youtube-analytics@mikai.tw`)

## Variant prompts for specific tasks

### Variant 1 — "快速接手 Path A"

```
讀 README.md / learnings.md / gotchas.md / path-a-oauth-bootstrap.md。
接下來幫我走完 Path A.1 到 A.5。IT 這邊已經協助開好 youtube-analytics@mikai.tw 帳號，
安全資訊在 1Password 裡。你需要指引我一步一步跳。
記住：我不 debug、你一律給完整指令 / 檔案 / SQL，不給 patch。
```

### Variant 2 — "代我跑今日例行檢查"

```
讀 README.md / runbook.md / current-state.md。
跑 runbook 裡「Daily checks」4 條，看是否都按預期運作。
有任何異常告訴我 + 提供修法建議，不要自己動去改。
```

### Variant 3 — "接著走 Phase 3 LLM tagging"

```
讀完整個 handoff archive。
Phase 0/2/2.5 都完成了，下一階段是 Phase 3：用 Claude API 對影片標題 + 簡介做 LLM tagging 寫進 dim_content_tag。
先給我 architecture proposal：prompt design / token 成本估算 / 批次處理策略 / 寫回 BQ 的 schema。
不要開始寫 code，先討論 design。
```

## What new Claude should NOT do automatically

- Run `gcloud run deploy` or any IAM mutation
- Modify Cloud Scheduler jobs
- Touch BQ data (no DDL changes, no DELETE/UPDATE/MERGE)
- Push directly to `main` branch (always PR)
- Change Apps Script triggers
- Reply to YouTube quota audit team
- Email talents

## What new Claude CAN do without confirmation

- Read source code, schema, logs, status
- Write SQL to query existing tables
- Draft new mart rollup SQL (push to PR for review)
- Draft email templates for talent communication
- Update markdown docs in this folder
- Add new gotchas to dev-guide.md as they're discovered

## On handoff drift

If this archive is more than 7 days old at the time of new session start, Cross
should treat current-state.md as approximate — Path A status / quota numbers
/ Cloud Run revisions may have changed. Run runbook "Daily checks" to refresh
actual state before doing any work.
