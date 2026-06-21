# 即時持倉網頁 — 一次性設定（安全版）

> 目標：網頁即時顯示持倉，但 **Sheet 全程私密**、頁面只有你登入看得到。
> 程式碼都寫好了，你只需做這三段一次性設定（約 20–30 分）。之後零維護。

架構：`你的瀏覽器(需登入) → Vercel 網頁 → /api/portfolio 後端 → service account 私密讀 Sheet`
金鑰只存在 Vercel 環境變數，永遠不進前端、不進 GitHub。

---

## 第 1 段：Google Cloud 建 service account（讓後端能私密讀表）

1. 開 https://console.cloud.google.com → 上方建立一個新專案（名稱隨意，如 `cross-portfolio`）
2. 搜尋列打「**Google Sheets API**」→ 進去按 **啟用 (Enable)**
3. 左選單 **IAM 與管理 → 服務帳戶 → 建立服務帳戶**
   - 名稱：`portfolio-reader` → 建立並繼續 → 角色可略過 → 完成
4. 點進剛建的服務帳戶 → **金鑰 (Keys) → 新增金鑰 → 建立 → JSON** → 會下載一個 `.json` 檔
5. 記下那個服務帳戶的 email（長得像 `portfolio-reader@cross-portfolio.iam.gserviceaccount.com`）

## 第 2 段：把兩份表共用給 service account

兩份表各做一次：右上「共用」→ 貼上上面那個 `...iam.gserviceaccount.com` email → 設**檢視者** → 傳送。
- 持倉表：`1j6B-QVHOQ-4n6dIbj5-Zc-laJmGooORPSf4VUGmWTxE`
- 已實現表：`1POxFcuegsTyYtgfi7RI_qpJX0fO66-314x-5679EBrM`

## 第 3 段：Vercel 部署 + 保護

1. 開 https://vercel.com → 用 GitHub 登入 → **Add New → Project** → 匯入 `cc4wang-ui/Auto-trade`
2. 部署前展開 **Environment Variables**，新增一個：
   - Name：`GOOGLE_SA_KEY`
   - Value：**把第 1 段下載的 .json 檔整個內容貼進去**（整段大括號 JSON）
3. 按 **Deploy**，等好
4. 進專案 **Settings → Deployment Protection → Vercel Authentication → 開啟（All Deployments）**
   - 這樣只有你（Vercel 登入帳號）能打開這個網頁

完成後網址就是你的私人即時 dashboard。手機把它加到主畫面即可。

---

## 出問題時
- 網頁顯示 `⚠`：多半是 `GOOGLE_SA_KEY` 沒貼好，或兩份表還沒共用給 service account email。
- 數字怪怪的：檢查試算表欄位順序沒被改動（代號…損益%…）。
- 要改密碼/權限：Vercel Settings → Deployment Protection。

> 嫌這段設定麻煩？隨時可改用「私密 Sheets App」方案（手機開 Google Sheets 直接看即時數字，零設定）。告訴我即可。
