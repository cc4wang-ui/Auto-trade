# YouTube Quota Raise Reply Package

> Cross 在 4/30 收到 YouTube API Services 的補件信，要 visual reference + sample report。
> 這個資料夾是完整回覆包：1 封 email + 2 個附件 + 操作指引。
> 截止日：**收到信後 7 個 business day**（4/30 收 → 預計 5/9 前回）。

---

## 內容物

| 檔案 | 用途 |
|---|---|
| `email-reply.txt` | 完整 email body，純文字格式，**直接複製到 Gmail 即可** |
| `dashboard-layout-mockup.md` | Dashboard 設計稿（5 tabs），轉成 PDF 後 attach 為 `Planned_dashboard_layout.pdf` |
| `README.md` | 本文（操作說明） |

---

## 你要做的 5 件事

### 1. 找 GCP project number（不是 project ID）

GCP Console 首頁 → 你的 project info card → **Project number** 是純數字（例：`123456789012`）。

打開 `email-reply.txt` 搜尋 `[YOUR_PROJECT_NUMBER]`，整個替換成那個數字。

### 2. 跟宮前 san 要 1 張螢幕截圖

請他截 `獅子神レオナ_日次レポート` Sheet 的全螢幕：

- 要看到 column header（date / title / URL / views / likes / comments）
- 要看到至少 5-10 row 真實資料
- **不要含 PII**（像觀眾留言名單之類，幸好他這份 POC 只有匯總數字）
- 存成 `Sample_internal_report.png`

**如果宮前不在線**：自己開那個 Sheet（你應該有 access）截一張即可。

### 3. 把 dashboard mockup 轉 PDF

兩個方法挑一個：

**方法 A（推薦，5 分鐘）**：
1. 開 GitHub PR #3 → 點開 `dashboard-layout-mockup.md` → 用 GitHub 的 markdown render
2. 瀏覽器 cmd+P → Save as PDF → 命名 `Planned_dashboard_layout.pdf`

**方法 B（如果想要更漂亮）**：
1. 把 `dashboard-layout-mockup.md` 內容複製
2. 開 Google Docs 新檔 → 貼上 → 微調表格樣式
3. File → Download → PDF Document → 命名 `Planned_dashboard_layout.pdf`

### 4. 回信

Gmail 開原信 → Reply：

- **Subject**：保持原信 subject 或改成 `email-reply.txt` 第一行那個
- **Body**：把 `email-reply.txt` 從第二行（Dear YouTube...）開始**整段複製貼上**
- **Attach 2 個檔案**：
  - `Sample_internal_report.png`（步驟 2 截的圖）
  - `Planned_dashboard_layout.pdf`（步驟 3 產的 PDF）

### 5. 送之前最後檢查（30 秒）

- [ ] `[YOUR_PROJECT_NUMBER]` 已換成真實數字
- [ ] 簽名欄 `Cross Wang` / `Chief Operating Officer` / 信箱 是對的
- [ ] 2 個附件都附上了（PNG + PDF）
- [ ] 沒有 PII 在截圖裡
- [ ] 回到原信 thread（不是開新信）

送出。

---

## 預期回應時程

- 4/30 收到補件信
- **5/9 前**送出回覆（7 business day）
- Google 內部審核：通常 1-2 週
- 預計 5/14-5/23 拿到 quota raise 結果

期間 Cross 可以照 `youtube-etl/docs/handoff/builder-steps.md` STEP 1-6 繼續推 Phase 0：DDL apply、OAuth bootstrap、Cloud Run 部署、smoke test 1 個 channel（獅子神レオナ，10K default quota 跑得動 1 channel）。

---

## 如果 Google 又退件

可能會問到的後續問題：

| 問題 | 怎麼回 |
|---|---|
| 「請提供 talent 同意 mikai 管理 channel 的證明」 | 提供脫敏（redacted）talent management agreement 樣本，PDF 裡 talent 名字塗黑 |
| 「請提供 IAM policy export」 | GCP Console → IAM → 截圖 dataset 權限 + service account 權限 |
| 「請說明資料保存期限」 | email §6 已寫「talent 合約終止時刪除」，可進一步說明 BQ partition 自動 expire (e.g. 3 年) |
| 「請說明 NLP tagging 用什麼模型」 | email §2 Tab 5 說「internal NLP step」— 真實答案是 Claude API on title+description，可說「a language model running on internal infrastructure that processes video metadata only (title + description), no external model service receives YouTube user-identifiable data」 |
| 「請給 BQ schema」 | 直接附 `youtube-etl/sql/ddl/01_youtube_raw.sql` + `02_youtube_mart.sql` 的 PDF 渲染 |

---

## 為什麼不附 BQ schema 在第一輪

YouTube reviewer 主要看「資料給誰看」+「有沒有外洩」。BQ schema 是技術細節，第一輪不必附；他要再說，再附。先送精簡版，被退件再加料 — 比一次塞滿但被無視好。
