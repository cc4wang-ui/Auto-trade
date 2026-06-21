// Vercel serverless function — 後端用 service account 私密讀取兩份 Google Sheet。
// 金鑰只存在 Vercel 環境變數 GOOGLE_SA_KEY，不進前端、不進 repo。
// 整個專案再用 Vercel Authentication 保護，只有 Cross 登入看得到。

const { google } = require('googleapis');

const SHEET_HOLD = '1Yl78EhCobQF4nhwna_AdqUi_fUffAfnuyoUTZ6WKhsw'; // 持倉
const SHEET_REAL = '15WIYk3ZklYg2LB1rVouoRlYDUpwK_aEjk8SQeornnV4'; // 已實現

module.exports = async (req, res) => {
  try {
    const creds = JSON.parse(process.env.GOOGLE_SA_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const [hold, real] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_HOLD, range: 'A1:N100' }),
      sheets.spreadsheets.values.get({ spreadsheetId: SHEET_REAL, range: 'A1:E100' }),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      holdings: hold.data.values || [],
      realized: real.data.values || [],
      ts: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
