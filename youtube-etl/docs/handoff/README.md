# YouTube ETL — Builder Handoff

> **如果你是接手的 Claude（不是人）**：先讀完這個 README，再依需要進子文件。不要重新提問已鎖定的決策。Cross 的時間是 COO 級昂貴。

## 1. 接手對象

**Cross**（34 歲、台灣、17LIVE 子公司 mikai 的 COO、INTJ、非工程師、永遠不會是）。Builder 是 Cross 自己 + Claude Code（你）pair。Cross 出手做 GCP Console 點選、貼 gcloud 指令、OAuth 授權；你做所有 code、SQL、debug。

操作風格：
- 繁中 + English（依當下訊息切換）
- 先結論後解釋；表格 > 牆面文字；options > 開放題
- 講邏輯就接受推回，**不要 yes-man**
- 不開「這是個好問題！」、不過度道歉、不在 5 個澄清問題前先做事

完整 profile：repo 根的 `CLAUDE.md` + `context/cross-financial-profile.md`。

## 2. 專案是什麼

17LIVE 子公司 **mikai** 經紀 ~50 個 YouTube 頻道（VTuber / 才藝藝人）。要把所有頻道每日數據、新片表現、直播併發觀眾、Analytics 收益匯進 BigQuery，做給內部製作團隊看的 Connected Sheets dashboard。

**這不是台指期 v10 系統**。同一個 repo，不同子目錄：`youtube-etl/`。

## 3. 鎖定決策（不要再問）

| 問題 | 答案 |
|---|---|
| Channel 名單從哪來？ | mikai Drive，已抽成 `youtube-etl/data/channels.csv`（50 talents、9 manager groups），DDL seed 已寫 |
| Analytics API 用誰的帳號？ | mikai 共用 admin Google account，**單一 OAuth refresh token cover 全 50 channel**。token 推 Secret Manager（3 個 secret：client_id / client_secret / refresh_token） |
| 多久 poll 一次？ | **Hybrid**：daily 02:00 UTC 全掃 / hourly poll 過去 48h 新片 / 5-min poll 直播中影片 / daily 03:00 拉 Analytics |
| Tagging 用什麼欄位？ | **只用 title + description**（不抓影片內容、不抓 thumbnail）。Phase 3 才開工 |

## 4. 當前狀態

| 項目 | 值 |
|---|---|
| Repo | `cc4wang-ui/auto-trade` |
| Branch | `claude/youtube-etl-review-i4TIH` |
| HEAD SHA | `72b7c5a` (scaffold commit) — 之後 handoff doc commits 在後面 |
| PR | **#3 (draft)** |
| Phase | **Phase 0 code 已 ship，等部署 + quota raise** |

**已交付**（在 PR #3 裡）：
- BQ DDL（raw 6 tables + mart 7 tables，idempotent）
- `dim_talent` seed CSV + load script（50 talents）
- Cloud Run ingest service（Python 3.12 / Flask / 4 endpoints）
- Quota tracker、OAuth secret loader、retry 邏輯、純 transform 函式
- Phase 0 ops checklist（Console + gcloud 跑得起來的指令）

**未交付**（待 Phase 1+）：
- Mart 層 rollup SQL（comment velocity、daily/weekly/monthly KPI）
- Phase 3 tagging（Claude API on title+description）
- Phase 4 Connected Sheets dashboard
- Phase 5 Booth / Event ingestion 用同一張 `fact_content_*` schema

## 5. Blocker（最重要）

**YouTube Data API quota raise**：50ch hybrid polling 估 15-30K units/day，default 10K 不夠。**Cross 必須最早送出申請**（Google 審 1-2 週）。送出 form 在 `phase-0-ops-checklist.md` Step 3，欄位範本已經寫好給他複製。

期間做什麼：smoke test 1-2 channel + 你（接手 Claude）寫 mart 層 SQL。

## 6. Index 子文件

| 想做什麼 | 讀哪份 |
|---|---|
| Cross 從零執行到 Cloud Run 部署 | `builder-steps.md` |
| 看 BQ 表長什麼樣、欄位意義 | `data-model.md` |
| 部署或 smoke test 出錯 | `errors.md` |
| 規劃 Phase 2-5 | `roadmap.md` |

## 7. 原始參考（不在 handoff 資料夾內，但同 repo）

| 檔案 | 用途 |
|---|---|
| `youtube-etl/README.md` | scaffold 概覽 |
| `youtube-etl/docs/phase-0-ops-checklist.md` | Cross 部署時逐步操作（**權威來源**，handoff `builder-steps.md` 是給 Cross 的白話版本） |
| `youtube-etl/sql/ddl/01_youtube_raw.sql` | Raw 層 DDL（6 表）|
| `youtube-etl/sql/ddl/02_youtube_mart.sql` | Mart 層 DDL（7 表，但 rollup query 還沒寫） |
| `youtube-etl/sql/seed/dim_talent_load.sql` | 50 channel MERGE |
| `youtube-etl/ingest/main.py` | Flask 4 endpoints |
| `youtube-etl/ingest/handlers/` | daily / hourly / live_poll / analytics |
| `youtube-etl/ingest/lib/` | 7 個 lib 模組（OAuth、BQ writer、quota tracker、transform、config 等）|
| `youtube-etl/data/channels.csv` | 50 talent seed |

## 8. 你（接手 Claude）的第一步

1. 跟 Cross 確認他現在卡在哪個 step（`builder-steps.md` STEP 1-8 或 Phase 1+）
2. 如果他在 STEP 1-2 → 等他貼 GCP project ID + BQ location 回來再繼續
3. 如果他在 STEP 3 quota raise → 提醒他送 form，期間平行做 STEP 4-5
4. 如果他在 STEP 4 OAuth → 截圖式逐步引導（OAuth flow 是非工程師最容易卡的點）
5. 如果他在 STEP 7 smoke test → 看 quota_log + videos_snapshot 結果，決定是放全 50ch 還是先修
6. 如果 Phase 0 已過 → 讀 `roadmap.md`，從 Phase 2 mart SQL 開始

**重要**：Cross 任何錯誤訊息都會直接貼整段給你，**不要叫他自己 debug**。看 log → 給下一條指令。
