# Decisions Log — 不要重新討論的決策

> 這份是給接手 Claude 看的決策日誌。每條都是 Cross 已決定 + 經過 audit / 對外資料驗證的結論。**新 session 進來不要 re-debate**。

## D-001｜Cross 是 ETL builder（不是 Takashi）

| 屬性 | 值 |
|---|---|
| 決策日 | 2026-04-29 |
| 取代 | 4/17 weekly OKR 上 Takashi 列為 ETL owner（30% 進度） |
| 現況 | Cross 親自當 builder + Claude Code 當 pair |
| Cross 的角色 | GCP Console 點選 / 貼 gcloud / OAuth 授權 / 看結果做決策 / 出錯丟 log 給 Claude |
| Claude 的角色 | 寫所有 code、SQL、shell、debug，看截圖 / log → 給下一條指令 |

**Cross 不需要會 Python / SQL**，只要會 copy-paste + 看 GCP Console + 把錯誤丟 Claude。

repo 內歷史文件還有殘留的 "Takashi" 字樣，下次 session 看到不要當成 active assignment — 就是過時文字。Builder = Cross 直到 Cross 親口換人。

---

## D-002｜Channel 來源 + tagging 策略

| 問 | 答 |
|---|---|
| Channel 名單從哪來？ | mikai Drive，已抽成 `youtube-etl/data/channels.csv`（**50 talents、9 manager groups**） |
| Analytics API 用哪個帳號？ | mikai 共用 admin Google account → **單一 OAuth refresh token cover 全 50 channel** |
| Polling 頻率？ | **Hybrid**：daily 02:00 UTC 全掃 / hourly 過去 48h 新片 / 5-min 直播中 / daily 03:00 拉 Analytics（含 7 天 backfill） |
| Tagging 用什麼欄位？ | **只用 title + description**（不抓影片內容、不抓 thumbnail）→ Phase 3 才動工 |

---

## D-003｜不外包，Cross + Claude 自己做

### 背景
2026-04-30 收到 vendor 報價單 `データ基盤構築単価表.xlsx`（Drive file ID `14F7Cvu1D4CAiOxUlsVvrbffNqJvnuvSO`）。

### 報價內容
| 範圍 | scope | 工時 | 費用 | 完工 |
|---|---|---|---|---|
| 要件定義 + GCP infra | Lead Eng | 48h | ¥360,000 | — |
| Security + API auth | Lead Eng | 80h | ¥600,000 | — |
| Backend（**10ch**）+ 自動化 | Impl Eng | 80h | ¥450,000 | — |
| 實機測試 + 修錯 | Impl Eng | 64h | ¥360,000 | — |
| 引き継ぎ + 手冊 | Impl Eng | 48h | ¥270,000 | — |
| **合計** | | **320h / 2 人月** | **¥2,040,000** | 翌 1 月（折扣價） / 11 月（適正單價 ≈¥3-4M） |

### 為什麼不簽

| 理由 | 細節 |
|---|---|
| Scope 對不上 | Vendor 報 **10ch**，Cross 實際 **50ch + Booth + Event + Tagging + Dashboard**。等比例外推 ≈ ¥10-15M / 1.5-2 年 |
| PR #3 已交付 5/5 主要項目 | Vendor 5 個工作大項（infra、auth、backend、test、handoff）PR #3 全部已 ship。詳細覆蓋表見 commit `e5eb1ef` 前面的 chat 紀錄 |
| 時程差 | Vendor: 8-9 個月；Cross + Claude: scaffold 1 天（已完成） |
| 多出來的 Phase 2-5 | mart rollup / Claude API tagging / Connected Sheets / Booth/Event 完全不在 vendor 報價內，但是 Cross 要的核心價值 |

### Vendor 報價單留下的 audit value（已採納 2 條）

vendor 文案大量 FUD（「クラウド破産」「複雑怪奇」等），但點出 5 個真實風險，PR #3 audit 結果：

| 風險 | PR #3 狀態 |
|---|---|
| 冪等性（重跑 double） | ✅ 全 raw 表 MERGE on (snapshot_date, primary_key) |
| BQ partition + cluster 設計 | ✅ 全表 partition by date + cluster by channel_id |
| Token 過期 → pipeline 死 | ✅ refresh token 自動更新；建議加 alert（ops checklist Step 8）|
| **Analytics 數字延遲（数日遅延）** | ✅ **commit `e5eb1ef` 已修**：`ANALYTICS_BACKFILL_DAYS=7`，`write_analytics_daily` 換成 staging-table MERGE |
| **YouTube Studio 數字突合** | ✅ **commit `e5eb1ef` 已加**：`builder-steps.md` STEP 6.4 是 STEP 7 全 50 開的 gate |

### 折衷選項（如果未來想用）

需要 vendor 介入時，可以單買「**實機測試 + YouTube Studio 對帳**」一塊：估 30-50K 日幣，跑 1 個 channel 對帳，比 Cross 自己 debug 便宜。但目前不需要 — STEP 6.4 流程已寫進文件，Cross 跑得起來。

---

## D-004｜宮前 san GAS POC 是 OAuth working sample

### 背景
4/9 share 進來的 Google Doc `Youtube数値取得コード`（Drive file ID `1hhq-hJvJXx1xVJHmKBKpa7NuzpKR6IkjHYjRkrmjjMY`），owner: kenta_miyamae@17.media。

### 內容
- GAS（Google Apps Script）POC，用 OAuth2 + `yt-analytics.readonly` scope 拿 video-level Analytics
- 寫死 1 個 channel：**獅子神レオナ**（`UCB1s_IdO-r0nUkY2mXeti-A`）— 已確認在 `channels.csv` Manzoku 組
- 抓 3 天前 top 20 video 的 views/likes/comments，寫進 Sheet `獅子神レオナ_日次レポート`

### 對 Phase 0 的價值

1. **OAuth + Analytics API 路徑已驗證可行** — STEP 4 OAuth bootstrap 不會卡。
2. **獅子神レオナ 是 smoke test 首選** — 已知能拉到資料的 channel。`builder-steps.md` STEP 6.1 用這個 channel 做 smoke test。
3. **`access_type=offline` + `prompt=consent`** 是拿到 refresh token 的關鍵 — 我們的 Python InstalledAppFlow 預設就是這組。
4. **video-level Analytics query pattern**（`dimensions=video`）給 **Phase 2 mart KPI** 算單片 revenue 占比時可以借鑑。現有 `analytics_client.py` 是 channel-level only。

### 不取代什麼
- POC 寫死 channel + sheet，不是 production grade
- 沒有 BQ、沒有 quota log、沒有 hourly poll、沒有 live metrics、沒有 50ch scale
- Re-architect 是必要的（早就決定的）

---

## D-005｜不在 scope 的東西（明確劃線，不要再提）

| 不做的東西 | 理由 |
|---|---|
| 即時 push 通知（爆紅警示） | Phase 6+ 才考慮，dashboard 穩了再說 |
| 抓影片內容（OCR / ASR 字幕） | 算力 + 隱私 + 成本不划算 |
| 抓 thumbnail 視覺特徵 | 同上 |
| 跨平台 viewer 去重 | YouTube / Booth user_id 完全不通 |
| Talent 個人 OAuth（每人一 token） | 除非 STEP 4 證明 mikai 共用帳號不是 owner 才回頭考慮 |
| 預測模型（次週 views forecast）| 基本 KPI 都還沒 stable |

---

## 變更歷史

| 日期 | 決策 | 來源 |
|---|---|---|
| 2026-04-28 | 50ch / hybrid polling / mikai admin / title+description tagging | initial planning |
| 2026-04-29 | Cross 自己當 builder（取代 Takashi 假設） | Cross 在 session 中宣告 |
| 2026-04-30 | 不簽 vendor 報價 + 採納 2 個 audit 點（7 天 backfill + Studio 對帳） | vendor xlsx 收到後 audit |
| 2026-04-30 | 獅子神レオナ 確認在 channels.csv → smoke test 首選 channel | grep 驗證 |
