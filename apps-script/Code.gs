// Cross 即時持倉 + 市場 — Google Apps Script Web App（後端）
// 同帳號私密讀三份試算表，資料直接注入頁面（不靠非同步呼叫，較不會空白）。
//
// 部署：script.google.com → 貼 Code.gs + 新增 HTML 檔「Index」貼 Index.html
//   → 部署 → 網頁應用程式 → 執行身分:我、存取:僅限我自己 → 授權 → 複製網址
// 改版型後要：部署 → 管理部署作業 → 編輯(鉛筆) → 版本:新版本 → 部署

const SHEET_HOLD  = '1j6B-QVHOQ-4n6dIbj5-Zc-laJmGooORPSf4VUGmWTxE'; // 持倉
const SHEET_REAL  = '1POxFcuegsTyYtgfi7RI_qpJX0fO66-314x-5679EBrM'; // 已實現
const SHEET_MACRO = '15jTuymkg5Rv-K7-6lVS8LWP7iZ_NYZmdkY6mbRfnBk0'; // 市場 Macro

function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  t.payload = JSON.stringify(getData());
  return t.evaluate()
    .setTitle('Cross 即時持倉')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function getData() {
  function read(id) {
    try { return SpreadsheetApp.openById(id).getSheets()[0].getDataRange().getValues(); }
    catch (e) { return []; }
  }
  // 市場數據優先讀「每早 email 內的 <!--MACRO--> 區塊」（routine 自動產生），
  // 讀不到才退回 Macro 表（種子資料）。
  var macro = readMacroFromGmail() || read(SHEET_MACRO);
  return {
    holdings: read(SHEET_HOLD),
    realized: read(SHEET_REAL),
    macro:    macro,
    ts: new Date().toLocaleString('zh-TW', { hour12: false }),
  };
}

function readMacroFromGmail() {
  try {
    var th = GmailApp.search('subject:宏觀 newer_than:3d', 0, 5);
    for (var i = 0; i < th.length; i++) {
      var msgs = th[i].getMessages();
      var body = msgs[msgs.length - 1].getBody();
      var mt = body.match(/&lt;!--MACRO([\s\S]*?)--&gt;/) || body.match(/<!--MACRO([\s\S]*?)-->/);
      if (mt) {
        var rows = [['項目', '數值', '燈號', '說明']];
        mt[1].replace(/<[^>]+>/g, '').split('\n').forEach(function (line) {
          var p = line.split('|');
          if (p.length >= 2) rows.push([p[0].trim(), (p[1] || '').trim(), (p[2] || '').trim(), (p[3] || '').trim()]);
        });
        if (rows.length > 1) return rows;
      }
    }
  } catch (e) {}
  return null;
}
