// Cross 即時持倉 — Google Apps Script Web App（後端）
// 同帳號私密讀兩份試算表，不需共用、不需 service account、不需 Vercel。
//
// 部署步驟：
//   1. script.google.com → 新增專案，把這支貼進 Code.gs
//   2. 左邊 + → HTML，命名 Index，貼入 Index.html
//   3. 右上「部署 → 新增部署作業 → 類型:網頁應用程式」
//      執行身分：我　｜　誰可以存取：僅限我自己（=只有你登入看得到）
//   4. 部署 → 授權 → 複製網址，手機加到主畫面

const SHEET_HOLD = '1j6B-QVHOQ-4n6dIbj5-Zc-laJmGooORPSf4VUGmWTxE'; // 持倉
const SHEET_REAL = '1POxFcuegsTyYtgfi7RI_qpJX0fO66-314x-5679EBrM'; // 已實現

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Cross 即時持倉')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function getData() {
  function read(id) {
    return SpreadsheetApp.openById(id).getSheets()[0].getDataRange().getValues();
  }
  return {
    holdings: read(SHEET_HOLD),
    realized: read(SHEET_REAL),
    ts: new Date().toISOString(),
  };
}
