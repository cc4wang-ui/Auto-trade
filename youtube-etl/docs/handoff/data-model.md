# Data Model — BigQuery Schema 速查

> 兩個 dataset：`youtube_raw`（API 抓進來的原始層）+ `youtube_mart`（dashboard 用的去重 / 寬表層）。
> 權威 DDL：`youtube-etl/sql/ddl/01_youtube_raw.sql` + `02_youtube_mart.sql`。本文是讀懂用的速查地圖。

## 整體流向

```
YouTube Data API ──┐
YouTube Analytics ─┼─► youtube_raw (append-only snapshots)
                   │       │
                   │       ▼ 去重 / rollup（Phase 2 待寫）
                   └─► youtube_mart (dim + fact + denormalized KPI)
                              │
                              ▼
                       Connected Sheets（Phase 4）
```

**重要**：raw 層是 append-only snapshot，每次 API 呼叫都寫一筆。mart 層才是給人看的（dashboard / 報表）。

---

## youtube_raw（6 張表）

| 表 | 寫入頻率 | Partition / Cluster | 用途 |
|---|---|---|---|
| `videos_snapshot` | daily 全掃 + hourly 新片 | partition by `snapshot_date` / cluster `channel_id` | 每次抓回的 video stats（views/likes/comments/duration etc.） |
| `comments_snapshot` | hourly + daily | partition by `snapshot_date` / cluster `video_id` | top-level comments；`author_channel_id` 是 YouTube 唯一給的 viewer-side user_id（去重 commenter 用） |
| `live_metrics_snapshot` | 5-min poll | partition by `snapshot_date` / cluster `video_id` | 直播併發觀眾。**只在 `actualEndTime IS NULL` 時寫**，因為 historical concurrent peaks 沒有 API 可拿 |
| `analytics_daily` | daily 03:00 UTC | partition by `report_date` | 一筆 per (channel, day) — revenue + uniqueViewers + avgViewDuration。**Data API 沒這些**，必須走 Analytics API + OAuth |
| `poll_state` | daily / hourly job 寫 watermark | unpartitioned | hybrid polling 狀態機：`'hourly'`（< 48h 新片）→ `graduated_at` → `'daily'` |
| `quota_log` | 每次 API call 寫 1 row | partition by `call_date` | 對帳：每天總 units 用了多少。對 YouTube quota dashboard |

### 為什麼 raw 層長這樣

- **Append-only** = 任何 ETL bug 都不會洗掉歷史。所有 mart 都從 raw 重算就能修。
- **`MERGE` on (snapshot_date, primary_key)** 寫入 → Cloud Run job 重跑 idempotent。
- **Partition by date** = BQ 跑 query 只掃當日，便宜 + 快。
- **`poll_state`** 是 hybrid polling 的核心。沒這張表，hourly job 無法只抓「最近 48h 的新片」。

### 不會有的東西（API 限制）

| 你以為有 | 實際 | 替代 |
|---|---|---|
| Viewer 個別 user_id | ❌ 隱私 | `author_channel_id` 只在留言時拿得到 |
| 歷史 concurrent viewers 高峰 | ❌ live 結束後 API 不給 | 直播時 5-min poll 自己抓最大值 |
| 每 video 收益 | ❌ Analytics API 只給 channel-level | 用 channel daily revenue × 該 video 觀看占比近似 |
| 觀眾 demographics per video | ❌ Analytics 只給 channel aggregate | 接受 channel-level only |

---

## youtube_mart（8 張表）

> 註：`youtube-etl/README.md` + `phase-0-ops-checklist.md` 寫「7 張」是文件 typo，實際 DDL 是 8 張（fact 3 grain × mart_kpi 3 grain + 2 dim）。

### Dimensions（2 張）

| 表 | 內容 | seed 來源 |
|---|---|---|
| `dim_talent` | 50 個 channel + manager + 主類別 + active flag | `data/channels.csv` → `sql/seed/dim_talent_load.sql` MERGE |
| `dim_content_tag` | 一個 video 對多個 tag（long format） | **Phase 3 才寫入**（tagging service 產出） |

### Facts（3 張，long format）

`fact_content_daily` / `fact_content_weekly` / `fact_content_monthly`，schema 一樣：

```
content_id, content_type, channel_id, report_date,
metric_name, metric_value, source
```

**為什麼 long format？** 之後 Booth / Event 進來 → 用同一張 schema 塞，`source = 'booth'` 或 `'event'`。Sheets 端再 pivot。

### Mart KPI（3 張，wide format，給 Sheets 用）

`mart_talent_daily_kpi` / `weekly_kpi` / `monthly_kpi`，每張都是：

```
channel_id, report_date, video_count, total_views, total_likes,
total_comments, unique_commenters, comment_velocity_24h,
total_revenue_usd, total_unique_viewers, avg_concurrent_live_peak, ...
```

**一筆 per (channel, period)**，Connected Sheets 直接用，不用 Sheets 端 join。

### Mart 層待辦（Phase 2 ⚠️）

DDL 已經建好但 **rollup query 還沒寫**。需要 Claude 寫的 scheduled query：
1. `videos_snapshot + comments_snapshot + live_metrics_snapshot + analytics_daily` → `mart_talent_daily_kpi`
2. `comment_velocity_24h` 計算（24h delta / 24）
3. daily → weekly → monthly 滾動聚合
4. Sheets 端 view（per-talent / per-manager / 全 mikai）

詳細在 `roadmap.md` Phase 2。

---

## Key Relationships

```
dim_talent (channel_id PK)
    │
    ├──► videos_snapshot (FK channel_id) ──┐
    ├──► comments_snapshot ────────────────┤
    ├──► live_metrics_snapshot ────────────┼──► (rollup) ──► fact_content_*
    ├──► analytics_daily ──────────────────┘                     │
    │                                                            ▼
    └──► mart_talent_*_kpi (denormalized for Sheets)         dashboard
                  ▲
                  │
              dim_content_tag (Phase 3, FK video_id)
```

**Join key**：
- channel-level：所有表都有 `channel_id`
- video-level：`videos_snapshot.video_id` ↔ `comments_snapshot.video_id` ↔ `live_metrics_snapshot.video_id` ↔ `dim_content_tag.video_id`

---

## 快速排錯 query 範本

```sql
-- 哪些 channel 還沒有資料？
SELECT t.channel_id, t.channel_handle, t.manager
FROM `${PROJECT_ID}.youtube_mart.dim_talent` t
LEFT JOIN (
  SELECT DISTINCT channel_id FROM `${PROJECT_ID}.youtube_raw.videos_snapshot`
  WHERE snapshot_date = CURRENT_DATE()
) v USING (channel_id)
WHERE t.is_active = TRUE AND v.channel_id IS NULL;

-- 今天 quota 用到哪了？
SELECT api_method, SUM(units_consumed) AS units, COUNT(*) AS calls,
       SUM(IF(error_message IS NOT NULL, 1, 0)) AS errors
FROM `${PROJECT_ID}.youtube_raw.quota_log`
WHERE call_date = CURRENT_DATE()
GROUP BY api_method
ORDER BY units DESC;

-- Analytics OAuth 是不是死了？
SELECT report_date, COUNT(DISTINCT channel_id) AS channels_with_data
FROM `${PROJECT_ID}.youtube_raw.analytics_daily`
WHERE report_date BETWEEN CURRENT_DATE() - 7 AND CURRENT_DATE() - 1
GROUP BY report_date
ORDER BY report_date DESC;

-- 哪些 video 還在 hourly polling？
SELECT video_id, channel_id, published_at, poll_mode
FROM `${PROJECT_ID}.youtube_raw.poll_state`
WHERE poll_mode = 'hourly'
  AND graduated_at IS NULL
ORDER BY published_at DESC;

-- 哪些 video 卡在 hourly 超過 48h（應該被 graduate 了）？
SELECT video_id, published_at, TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), published_at, HOUR) AS age_hours
FROM `${PROJECT_ID}.youtube_raw.poll_state`
WHERE poll_mode = 'hourly' AND graduated_at IS NULL
  AND TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), published_at, HOUR) > 48;
```

---

## Phase 5 預留（多源接入）

`fact_content_*` 設計成 source-agnostic。Booth / Event 進來：
- 新增 dim：`dim_booth_event` 或在 `dim_talent` 上加維度
- 寫入 `fact_content_*` 時帶 `source = 'booth' | 'event'`
- mart KPI 端可以 segment by source

`source` 欄位枚舉建議：`'youtube_data' | 'youtube_analytics' | 'booth' | 'event'`。
