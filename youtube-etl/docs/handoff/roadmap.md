# Roadmap — Phase 2-5

> Phase 0 已 ship（DDL + Cloud Run scaffold + ops checklist）。本文是 Phase 0 之後的工程藍圖。
> 主要是給接手 Claude 看的：知道下一步要寫什麼。Cross 看 Phase 概要 + 自己負責的部分就好。

## 路線總覽

| Phase | 範圍 | Cross 等待還是動手 | Claude 寫的東西 | 估時 |
|---|---|---|---|---|
| **2** | Raw → Mart rollup SQL | 動手跑 query 看結果 | scheduled query × 6 + comment velocity logic | 1-2 週 |
| **3** | Tagging（title + description → tag） | 部署 + review top tag list 收成 taxonomy | 第二個 Cloud Run service + Claude API client | 1 週 |
| **4** | Connected Sheets dashboard | 設 refresh + 點選 + 分享給團隊 | view + 範本 sheet + 教學 | 3-5 天 |
| **5** | Booth / Event 接入 | 給 API key + 樣本資料 | 第三個 Cloud Run + 統一 fact_content_* | 2 週 |

依賴關係：Phase 2 必須先（Phase 4 沒資料給）。Phase 3 和 Phase 2 可平行。Phase 5 等 Phase 2 schema 穩定。

---

## Phase 2 — Mart Rollup SQL（最優先）

**目標**：把 raw 層 append-only snapshot 轉成 dashboard 直接 query 的 KPI 寬表。

### 2.1 待寫的 query

| query | 寫到哪 | 排程 |
|---|---|---|
| `videos_snapshot` 最新 1 row per (video, date) → 寬表 | scheduled query | daily 04:00 UTC |
| `comments_snapshot` → `comment_velocity_24h` 計算 | scheduled query | daily 04:15 UTC |
| `live_metrics_snapshot` → `concurrent_live_peak` per video | scheduled query | daily 04:30 UTC |
| 上面三個 + `analytics_daily` JOIN → `mart_talent_daily_kpi` | scheduled query | daily 05:00 UTC |
| `mart_talent_daily_kpi` → `mart_talent_weekly_kpi` | scheduled query | Mon 06:00 UTC |
| `mart_talent_daily_kpi` → `mart_talent_monthly_kpi` | scheduled query | 1st 07:00 UTC |
| `videos_snapshot` + `comments_snapshot` → `fact_content_daily` (long format) | scheduled query | daily 04:45 UTC |

**寫入位置**：BQ scheduled queries 用 `MERGE` upsert，idempotent。**不放 Cloud Run**（純 SQL 不需要 container）。

### 2.2 comment_velocity_24h 算法

```
velocity_24h = (comment_count_at_T - comment_count_at_T_minus_24h) / 24
```

實作要點：
- `comments_snapshot` 是 append-only，每 hourly poll 寫一次當下 total
- velocity = 取 (snapshot_at = T) 和 (snapshot_at ≈ T - 24h) 兩筆相減
- T - 24h 可能沒有完全 24h 整點的 row → 取最近的（用 `ABS(TIMESTAMP_DIFF) < 1 hour` 容差）
- 影片 < 24h 上線 → velocity 用 (now_count - 0) / hours_since_publish

完整 SQL Claude 寫，這裡先記算法。

### 2.3 Pass criteria

跑完一週後：
- `mart_talent_daily_kpi` 每天每個 active channel 都有 1 row
- `total_revenue_usd` 不是 NULL（Analytics OAuth 通的話）
- `comment_velocity_24h` 數字合理（每小時 0-100 之間 normal，每小時 1000+ 是爆紅）
- weekly / monthly rollup 數字 = daily sum 驗證

### 2.4 Sheets-side view（給 Phase 4 用）

```sql
-- v_talent_summary：mikai 全 50 channel 過去 7/30/90 天
CREATE OR REPLACE VIEW `${PROJECT_ID}.youtube_mart.v_talent_summary` AS
SELECT
  t.channel_id, t.channel_name, t.manager,
  SUM(IF(k.report_date >= CURRENT_DATE() - 7,  k.total_views, 0)) AS views_7d,
  SUM(IF(k.report_date >= CURRENT_DATE() - 30, k.total_views, 0)) AS views_30d,
  SUM(IF(k.report_date >= CURRENT_DATE() - 90, k.total_views, 0)) AS views_90d,
  -- ... 其他指標同
FROM `${PROJECT_ID}.youtube_mart.dim_talent` t
LEFT JOIN `${PROJECT_ID}.youtube_mart.mart_talent_daily_kpi` k USING (channel_id)
WHERE t.is_active
GROUP BY t.channel_id, t.channel_name, t.manager;
```

類似 view 預計 3-5 個（per-talent 細項、per-manager 對比、ranking、growth delta）。

---

## Phase 3 — Tagging

**目標**：50 channel 上千部影片，自動分標籤（VTuber / 才藝 / 直播 / 開箱 / coverage 等），給 dashboard 篩選用。

### 3.1 鎖定設計

| 決策 | 鎖定值 |
|---|---|
| 輸入欄位 | **title + description only**（不抓影片內容、不抓 thumbnail） |
| Tagging engine | Claude API（Haiku 4.5 起跑、不夠精準再升 Sonnet 4.6） |
| Output 結構 | 一 video 多 tag（long format），寫入 `dim_content_tag` |
| 觸發時機 | 新影片進 `videos_snapshot` 後 → 打 Claude API → 寫 `dim_content_tag` |
| Backfill | 一次跑歷史 1-2 年所有影片 |

### 3.2 待寫的東西

| 元件 | 描述 |
|---|---|
| `tag/` 子資料夾 | 第二個 Cloud Run service |
| `tag/main.py` | Flask `/jobs/tag` endpoint |
| `tag/handlers/tag_new.py` | 抓昨日進 `videos_snapshot` 的新片，丟 Claude 拿 tag |
| `tag/handlers/backfill.py` | 一次性 historical 處理（讀 `dim_talent` × 過去 N 天） |
| `tag/lib/claude_client.py` | Anthropic SDK wrapper、prompt template、retry |
| `tag/Dockerfile` | 同 ingest 結構 |
| Scheduler | daily 06:00 UTC（在 mart rollup 後） |

### 3.3 Prompt 設計（草案）

```
You are tagging YouTube videos for a Japanese VTuber / talent agency (mikai).
Given title + description, output 1-5 tags from this taxonomy:
[初版 taxonomy by Cross — 後面 review 後 iterate]

Title: {title}
Description: {description[:500]}

Output JSON: {"tags": ["tag1", "tag2"], "confidence": 0.0-1.0, "language": "ja|zh|en"}
```

### 3.4 Cross 的工作

1. 部署 Cloud Run（指令同 STEP 5.2，改 service 名稱）
2. 跑 backfill 後，看 `SELECT tag, COUNT(*) FROM dim_content_tag GROUP BY tag ORDER BY 2 DESC LIMIT 30`
3. 砍掉雜訊 tag、合併同義 tag、補漏 → 更新 prompt taxonomy
4. 重跑 backfill（或部分重跑）

---

## Phase 4 — Connected Sheets Dashboard

**目標**：mikai 製作團隊 ~10 人在 Google Sheet 看 50 channel 表現，不用寫 SQL。

### 4.1 設計

| Tab | 內容 | Refresh |
|---|---|---|
| **Overview** | 50 channel 過去 7/30/90 天 views/likes/revenue ranking | daily 09:00 JST |
| **Per Manager** | 每個 manager 旗下 channel 對比 + manager-level total | daily 09:00 JST |
| **Per Talent** | 點選 talent → 過去 90 天 daily 走勢 + top 10 video | on-demand |
| **Live Watch** | 當下直播中影片 + 併發觀眾（live_metrics_snapshot 當天） | hourly |
| **Tag Insights**（Phase 3 後）| 各 tag 平均表現、top tag per talent | weekly |

### 4.2 Connected Sheets 設定步驟（Cross 做）

1. 開新 Google Sheet → `Data` → `Data connectors` → `Connect to BigQuery`
2. 選 project + dataset = `youtube_mart`
3. 每個 view（v_talent_summary、v_manager_compare 等）連一個 Sheet tab
4. `Schedule refresh` → 設每日 09:00 JST
5. 分享給 mikai 製作團隊（view-only，他們不能改 query）

### 4.3 待 Claude 做

- 寫所有 view（Phase 2.4 已有起點）
- 寫 Sheet 端 formula 範本（ranking、growth delta、conditional formatting 規則）
- 寫一份 Sheets 設定 walkthrough（給 Cross + 之後 onboarding 製作團隊）

---

## Phase 5 — Booth / Event 接入

**目標**：mikai 不只 YouTube，還跑 Booth（虛擬商品）+ offline event（見面會、簽名會）。把這兩個源接進同一個 mart，做整合 talent KPI。

### 5.1 重複利用 schema

`fact_content_*` 已經是 long format `(content_id, content_type, source, metric_name, metric_value)`。Booth / Event 進來：

| 平台 | content_type | source | 範例 metric |
|---|---|---|---|
| YouTube | `video` / `live` | `youtube_data` / `youtube_analytics` | views, revenue, concurrent_peak |
| Booth | `product` | `booth` | sales_count, revenue_jpy, refund_count |
| Event | `event_session` | `event` | attendance, ticket_revenue, merch_revenue |

新增 `dim_product`（Booth 商品）+ `dim_event`（Event 場次），FK 都指 `dim_talent.channel_id`（or 一個更廣義的 `talent_id`）。

### 5.2 待寫

| 元件 | 描述 |
|---|---|
| `booth/` Cloud Run | 同 ingest 結構，daily 拉 Booth API |
| `event/` 不一定 Cloud Run | 可能直接 manual upload CSV → BQ（看 mikai 怎麼記錄 event） |
| 新 dim DDL | `dim_product`, `dim_event` |
| mart KPI 升級 | `mart_talent_daily_kpi` 加 booth_revenue、event_revenue 欄位 |
| Sheets dashboard 升級 | Overview tab 加「總收益 (YT + Booth + Event)」 |

### 5.3 Cross 提供

- Booth API key + endpoint 文件
- Event 資料的真實格式（excel / 後台 export / 手動表單？）
- Event 的 talent ↔ session 對應關係

---

## 不在 roadmap 的東西（明確劃線）

- ❌ 即時 push 通知（爆紅警示等）— Phase 6+ 才考慮，先讓 dashboard 穩
- ❌ 抓影片內容（OCR / ASR 字幕）— 算力 + 隱私 + 成本都不划算
- ❌ 抓 thumbnail 視覺特徵 — 同上
- ❌ 跨平台 viewer 去重 — YouTube / Booth user_id 完全不通，做不到
- ❌ Talent 個人 OAuth（每人一個 token）— 除非 Phase 0 STEP 4 證明 mikai 共用帳號不是 owner 才回頭考慮
- ❌ 預測模型（next-week views forecast）— 基本 KPI 都還沒 stable，太早

---

## Phase 結束的 success criteria

| Phase | 「完成」定義 |
|---|---|
| 2 | dashboard 能 query 任何 talent 過去 90 天 KPI，數字有意義（手算抽查 1-2 channel 對得上） |
| 3 | top 30 tag 收斂成 < 50 個合理 taxonomy；mikai 內部認可分類有用 |
| 4 | mikai 製作團隊 ≥ 5 人每週主動打開 Sheet 看（不是被催才看） |
| 5 | Talent Total Revenue (YT + Booth + Event) 在 dashboard 一張圖看到 |
