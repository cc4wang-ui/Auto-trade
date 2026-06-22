# 即時持倉網頁 — Google Apps Script 版（最快、最美、私密）

> 免 Vercel、免 GCP service account、免公開試算表。同帳號私密讀取，部署設「僅限我自己」=
> 只有你登入看得到。約 5 分鐘上線。

## 步驟

1. 開 https://script.google.com → **新增專案**
2. 把 `Code.gs` 全部內容貼進預設的 `Code.gs`（覆蓋原本的）
3. 左側檔案列 **+ → HTML**，命名 **`Index`**（一定要叫這名字）→ 貼入 `Index.html`
4. 右上 **部署 → 新增部署作業**
   - 齒輪選 **網頁應用程式**
   - 說明：隨意
   - **執行身分：我**
   - **誰可以存取：僅限我自己**
   - **部署** → 第一次會要 **授權**（選你的 Google 帳號 → 進階 → 允許）
5. 複製 **網頁應用程式網址** → 手機開啟 → 加到主畫面

完成。之後改試算表，網頁一開（或按 ↻）就是最新。

## 想要「不用登入、開網址就看」？（接受風險版）
第 4 步「誰可以存取」改成 **任何人**。網址不可猜但等於公開可讀，淨值靠網址保密。
（不建議；「僅限我自己」其實只是多一個你本來就登入的 Google 帳號。）

## 出問題
- 一片空白 / 錯誤：確認 HTML 檔名是 `Index`、Code.gs 裡兩個 SHEET_ID 沒貼錯。
- 數字怪：檢查持倉表欄位順序沒被改（代號…損益%）。
- 換版型：改 `Index.html` 後，需 **部署 → 管理部署作業 → 編輯（鉛筆）→ 新版本 → 部署**。

## 資料來源（網頁內也有連結）
- 持倉：`1j6B-QVHOQ-4n6dIbj5-Zc-laJmGooORPSf4VUGmWTxE`
- 已實現：`1POxFcuegsTyYtgfi7RI_qpJX0fO66-314x-5679EBrM`
- 市場 Macro：`15jTuymkg5Rv-K7-6lVS8LWP7iZ_NYZmdkY6mbRfnBk0`（種子；每早 routine 的 email 會覆蓋更新）

> 授權時會多要一個 **Gmail 唯讀** 權限：dashboard 讀你每早那封宏觀信裡的市場數據區塊來顯示「市場 Regime」。
> 不想給 Gmail 權限也行——它會自動退回讀 Macro 表（但就不會每天自動更新市場數據）。

---
> Vercel 版（`dashboard/`、`api/`）保留備查但不再使用。
