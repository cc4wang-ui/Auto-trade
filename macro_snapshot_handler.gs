/**
 * GAS Web App endpoint for Macro Snapshot from Claude Code Routine
 * + v10 Pine alert webhook receiver
 *
 * Version: 1.1（已修 13 個已知 bug）
 *
 * 加進你現有的 GAS bot（v5，1003 行），在 doPost 裡多兩個 endpoint 分支。
 *
 * ⚠ 環境要求：GAS V8 runtime（Project Settings → Runtime version → V8）
 *   舊 Rhino runtime 不支援 const/let/template literal/arrow function。
 *
 * 設計原則：
 * - Routine 算數據，GAS 只負責訊息格式化（沿用你既有 1003 行的設計）
 * - 三層冪等防護：token 驗證 + timestamp 防 replay + LockService 互斥 + Sheet 記錄
 * - 失敗永遠回 200（避免 Routine 重試造成重複推播）
 * - 所有動態字串都 escape HTML（Telegram parseMode=HTML 會被 < > & 破壞）
 */


// ============================================================
// 路由（請替換你既有的 doPost 第一段）
// ============================================================
function doPost(e) {
  const endpoint = e.parameter.endpoint;

  if (endpoint === 'macro_snapshot')  return handleMacroSnapshot(e);
  if (endpoint === 'v10_signal')      return handleV10Signal(e);
  if (endpoint === 'earnings_report') return handleEarningsReport(e);
  if (endpoint === 'read_watchlist')  return handleReadWatchlist(e);

  // ↓ 這裡接你既有的 Telegram update 處理（v5 bot 那 1003 行的 entry）
  return handleTelegramUpdate(e);
}


// ============================================================
// SETUP — 部署前的一次性設定檢查
// ============================================================
/**
 * 部署前在 Apps Script 編輯器點選此函數 → Run（會跳權限授予）。
 * 會把所需的 Script Properties key 列出、驗證 V8 runtime、自動建 sheet。
 */
function setupCheck() {
  const props = PropertiesService.getScriptProperties();
  const required = ['ROUTINE_TOKEN', 'PINE_ALERT_SECRET', 'MACRO_SHEET_ID', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
  const missing = [];
  required.forEach(k => {
    if (!props.getProperty(k)) missing.push(k);
  });

  if (missing.length > 0) {
    console.log('⚠ 缺少 Script Properties:');
    missing.forEach(k => console.log('  - ' + k));
    console.log('\n設定方法：Project Settings → Script properties → Add property');
    return;
  } else {
    console.log('✅ 所有 Script Properties 已設定');
  }

  // 驗證 sheet 結構
  const sheetId = props.getProperty('MACRO_SHEET_ID');
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    const sheets = ['macro_log', 'signal_log', 'dedup_state', 'earnings_watchlist', 'earnings_log', 'earnings_dedup'];
    sheets.forEach(name => {
      let sh = ss.getSheetByName(name);
      if (!sh) {
        console.log(`⚠ Sheet "${name}" 不存在 → 建立中`);
        sh = ss.insertSheet(name);
        if (name === 'macro_log') {
          sh.appendRow(['timestamp', 'session', 'light', 'score', 'season', 'summary', 'warnings']);
        } else if (name === 'signal_log') {
          sh.appendRow(['timestamp', 'ticker', 'action', 'price', 'pattern', 'quality', 'macro_score']);
        } else if (name === 'dedup_state') {
          sh.appendRow(['key_type', 'last_key', 'updated_at']);
          sh.appendRow(['macro_session', '', '']);
          sh.appendRow(['v10_signal', '', '']);
        } else if (name === 'earnings_watchlist') {
          sh.appendRow(['ticker', 'market', 'shares', 'avg_cost', 'added_at', 'exit_at', 'lock_status', 'asset_type', 'note']);
          sh.appendRow(['NVDA', 'US', 15, 132.03, '2025', '', 'tradeable', 'stock', '個人 91275762']);
          console.log('  💡 earnings_watchlist 已建立，請依照持倉更新內容');
        } else if (name === 'earnings_log') {
          sh.appendRow(['timestamp', 'type', 'ticker', 'earnings_date', 'fiscal_period', 'recommendation']);
        } else if (name === 'earnings_dedup') {
          sh.appendRow(['dedup_key', 'posted_at']);
        }
      } else {
        console.log(`✅ Sheet "${name}" OK`);
      }
    });
  } catch (err) {
    console.log(`⚠ 開 sheet 失敗: ${err.message}`);
  }
}


// ============================================================
// Macro Snapshot endpoint handler
// ============================================================
function handleMacroSnapshot(e) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    // ─── 第 0 層：互斥鎖 ───
    if (!lock.tryLock(5000)) {
      console.warn('[macro_snapshot] Failed to acquire lock');
      return jsonResp({ ok: false, error: 'lock_timeout' });
    }
    lockAcquired = true;

    // ─── 解析 payload ───
    if (!e.postData || !e.postData.contents) {
      return jsonResp({ ok: false, error: 'no_body' });
    }
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonResp({ ok: false, error: 'invalid_json' });
    }

    // ─── 第 1 層：token 驗證（必須在 body，GAS 不能讀 HTTP custom headers）───
    const expectedToken = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
    if (!expectedToken) {
      return jsonResp({ ok: false, error: 'server_misconfigured' });
    }
    if (payload.token !== expectedToken) {
      console.warn('[macro_snapshot] Invalid token');
      return jsonResp({ ok: false, error: 'unauthorized' });
    }

    // ─── 第 2 層：timestamp 防 replay ───
    if (!payload.timestamp) {
      return jsonResp({ ok: false, error: 'missing_timestamp' });
    }
    const ts = new Date(payload.timestamp);
    if (isNaN(ts.getTime())) {
      console.warn('[macro_snapshot] Invalid timestamp:', payload.timestamp);
      return jsonResp({ ok: false, error: 'invalid_timestamp' });
    }
    const ageMs = Date.now() - ts.getTime();
    if (ageMs > 5 * 60 * 1000) {
      console.warn(`[macro_snapshot] Stale, age=${ageMs}ms`);
      return jsonResp({ ok: false, error: 'stale_payload' });
    }
    if (ageMs < -2 * 60 * 1000) {
      console.warn(`[macro_snapshot] Future timestamp, age=${ageMs}ms`);
      return jsonResp({ ok: false, error: 'future_timestamp' });
    }

    // ─── 第 3 層：Sheet 去重 ───
    const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
    if (!sheetId) {
      return jsonResp({ ok: false, error: 'sheet_id_missing' });
    }
    const ss = SpreadsheetApp.openById(sheetId);
    const dedupSheet = ss.getSheetByName('dedup_state');
    if (!dedupSheet) {
      throw new Error('dedup_state sheet missing — run setupCheck()');
    }

    const dateStr = Utilities.formatDate(ts, 'Asia/Taipei', 'yyyy-MM-dd');
    const sessionKey = `${payload.session || 'unknown'}_${dateStr}`;
    const lastSession = dedupSheet.getRange('B2').getValue();
    if (lastSession === sessionKey) {
      console.warn(`[macro_snapshot] Duplicate session: ${sessionKey}`);
      return jsonResp({ ok: true, dedup: true });
    }
    dedupSheet.getRange('B2').setValue(sessionKey);
    dedupSheet.getRange('C2').setValue(new Date());

    // ─── 格式化訊息 + 推送 ───
    const message = formatMacroMessage(payload);
    const sendResult = sendTelegramHtml(message);
    if (!sendResult.ok) {
      throw new Error(`Telegram send failed: ${sendResult.error}`);
    }

    // ─── 記 log ───
    const logSheet = ss.getSheetByName('macro_log');
    if (logSheet) {
      logSheet.appendRow([
        ts,
        payload.session || '',
        safe(() => payload.light.label),
        safe(() => payload.macro_score.total),
        safe(() => payload.season.name),
        safe(() => payload.actionable.summary),
        safe(() => JSON.stringify(payload.data_quality.warnings))
      ]);
    }

    return jsonResp({ ok: true, posted: true });

  } catch (err) {
    console.error('[macro_snapshot]', err.message, err.stack);
    try {
      sendTelegramHtml(`⚠ <b>Macro snapshot 處理失敗</b>\n${escapeHtml(err.message)}`);
    } catch (_) {}
    return jsonResp({ ok: false, error: err.message });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}


// ============================================================
// v10 Pine alert webhook handler
// ============================================================
function handleV10Signal(e) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    if (!lock.tryLock(5000)) {
      return jsonResp({ ok: false, error: 'lock_timeout' });
    }
    lockAcquired = true;

    if (!e.postData || !e.postData.contents) {
      return jsonResp({ ok: false, error: 'no_body' });
    }
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      console.warn('[v10_signal] Invalid JSON:', e.postData.contents);
      return jsonResp({ ok: false, error: 'invalid_json' });
    }

    // ─── 驗證 secret ───
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('PINE_ALERT_SECRET');
    if (!expectedSecret) {
      return jsonResp({ ok: false, error: 'server_misconfigured' });
    }
    if (payload.secret !== expectedSecret) {
      console.warn('[v10_signal] Invalid secret');
      return jsonResp({ ok: false, error: 'unauthorized' });
    }

    // ─── 驗證必要欄位 ───
    const required = ['action', 'ticker', 'price', 'pattern', 'quality'];
    const missing = required.filter(k => payload[k] === undefined || payload[k] === null);
    if (missing.length > 0) {
      throw new Error('Missing fields: ' + missing.join(', '));
    }

    // ─── Dedup（防同一 K 線多次觸發）───
    const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const dedupSheet = ss.getSheetByName('dedup_state');
    const dedupKey = `${payload.ticker}_${payload.action}_${Math.round(Number(payload.price))}`;
    const lastKey = dedupSheet.getRange('B3').getValue();
    const lastTime = dedupSheet.getRange('C3').getValue();
    if (lastKey === dedupKey && lastTime instanceof Date) {
      const ageMs = Date.now() - lastTime.getTime();
      if (ageMs < 5 * 60 * 1000) {
        console.warn(`[v10_signal] Dedup hit: ${dedupKey} (age=${ageMs}ms)`);
        return jsonResp({ ok: true, dedup: true });
      }
    }
    dedupSheet.getRange('B3').setValue(dedupKey);
    dedupSheet.getRange('C3').setValue(new Date());

    // ─── 格式化訊息 ───
    const action = payload.action;  // "buy" or "sell"
    const icon = action === 'buy' ? '🟢🚀' : '🔴⚠';
    const dirText = action === 'buy' ? '做多' : '做空';

    let msg = `${icon} <b>v10 訊號觸發 — ${dirText}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `<b>${escapeHtml(String(payload.ticker))}</b>  ${escapeHtml(String(payload.timeframe || ''))}\n`;
    msg += `價格: <code>${fmt(payload.price)}</code>\n`;
    msg += `型態: <b>${escapeHtml(String(payload.pattern))}</b> (Q=${fmt(payload.quality, 0)})\n`;
    if (payload.macro_score !== undefined) {
      msg += `Macro Score: <code>${fmt(payload.macro_score, 1)}</code>\n`;
    }
    msg += `\n`;
    if (payload.stop !== undefined)        msg += `停損: <code>${fmt(payload.stop)}</code>\n`;
    if (payload.trail_start !== undefined) msg += `啟動點: <code>${fmt(payload.trail_start)}</code>（浮盈 1×ATR）\n`;
    msg += `\n⚡ <b>立即下單檢查清單</b>\n`;
    msg += `1. 確認 TXF 近月合約\n`;
    msg += `2. 開倉 1 口（→ 看狀況加碼至 2 口）\n`;
    msg += `3. IB 設停損${payload.stop !== undefined ? ' <code>' + fmt(payload.stop) + '</code>' : ''}\n`;
    msg += `4. <i>不需手動設停利</i>，靠 Pine 訊號退場\n`;

    const sendResult = sendTelegramHtml(msg);
    if (!sendResult.ok) {
      throw new Error(`Telegram send failed: ${sendResult.error}`);
    }

    // ─── 記 log ───
    const logSheet = ss.getSheetByName('signal_log');
    if (logSheet) {
      logSheet.appendRow([
        new Date(),
        payload.ticker,
        action,
        payload.price,
        payload.pattern,
        payload.quality,
        payload.macro_score || ''
      ]);
    }

    return jsonResp({ ok: true });

  } catch (err) {
    console.error('[v10_signal]', err.message, err.stack);
    try {
      sendTelegramHtml(`⚠ <b>v10 訊號處理失敗</b>\n${escapeHtml(err.message)}`);
    } catch (_) {}
    return jsonResp({ ok: false, error: err.message });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}


// ============================================================
// Macro Snapshot 訊息格式化
// ============================================================
function formatMacroMessage(p) {
  const sessionLabel = {
    'tw_pre_open': '🌅 台股盤前',
    'us_pre_open': '🌃 美股盤前'
  }[p.session] || '快照';

  const time = Utilities.formatDate(new Date(p.timestamp), 'Asia/Taipei', 'MM/dd HH:mm');

  // 安全存取 nested fields
  const light  = p.light || {};
  const score  = p.macro_score || {};
  const season = p.season || {};
  const indi   = p.key_indicators || {};
  const gates  = p.v10_gates || {};
  const action = p.actionable || {};
  const dq     = p.data_quality || {};

  let msg = `<b>${sessionLabel} ${time}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;

  // ─── 燈號 + 分數（force_yellow 不重複顯示燈號）───
  if (light.force_yellow) {
    msg += `⚠ <b>強制黃燈</b>（穩定度 ${fmt(light.stability_pct, 0)}%，偏低）\n`;
    msg += `Score=<code>${fmt(score.total, 1)}</code>\n`;
  } else if (light.stagflation_override) {
    msg += `🚨 <b>${escapeHtml(String(light.label || '🔴 紅燈'))}</b>（Stagflation Override）\n`;
    msg += `Score=<code>${fmt(score.total, 1)}</code>\n`;
  } else {
    msg += `<b>${escapeHtml(String(light.label || '🟡 黃燈'))}</b>  Score=<code>${fmt(score.total, 1)}</code>\n`;
  }
  msg += `\n`;

  // ─── 四季 ───
  msg += `<b>季節</b>: ${escapeHtml(String(season.name || '—'))}\n`;
  msg += `成長軸 <code>${fmt(season.g_score)}</code>  通膨軸 <code>${fmt(season.i_score)}</code>\n\n`;

  // ─── 分數構成 ───
  msg += `<b>分數構成</b>\n`;
  msg += `基礎 <code>${fmt(score.base)}</code>`;
  msg += ` / 估值 <code>${fmt(score.val_adj)}</code>`;
  msg += ` / 信用 <code>${fmt(score.credit_adj)}</code>`;
  msg += ` / 逆向 <code>${fmt(score.contrarian)}</code>\n\n`;

  // ─── 關鍵指標 ───
  msg += `<b>關鍵指標</b>\n`;
  msg += `VIX <code>${fmt(indi.vix)}</code>`;
  if (indi.vix_term !== undefined && indi.vix_term !== null) {
    msg += `  期限 <code>${fmt(indi.vix_term)}</code>`;
    if (indi.vix_term > 1.05) msg += `⚠倒掛`;
  }
  msg += `\n`;

  if (indi.erp !== undefined && indi.erp !== null) {
    msg += `ERP <code>${fmt(indi.erp)}%</code>`;
    if (indi.erp < 0) msg += `⚠負值`;
  }
  if (indi.real_rate !== undefined && indi.real_rate !== null) {
    msg += `  實質利率 <code>${fmt(indi.real_rate)}%</code>`;
  }
  msg += `\n`;

  if (indi.yield_curve !== undefined && indi.yield_curve !== null) {
    msg += `殖利率曲線 <code>${fmt(indi.yield_curve)}</code>`;
    if (indi.bear_steepening) msg += `⚠Bear Steep`;
    msg += `\n`;
  }

  if (indi.oil_roc_20d !== undefined || indi.hy_spread !== undefined) {
    if (indi.oil_roc_20d !== undefined) msg += `油 ROC <code>${fmt(indi.oil_roc_20d)}%</code>  `;
    if (indi.hy_spread !== undefined) msg += `HY <code>${fmt(indi.hy_spread)}%</code>`;
    msg += `\n`;
  }
  msg += `\n`;

  // ─── v10 四門 ───
  msg += `<b>v10 四門</b>\n`;
  msg += `D1 方向 ${gateIcon(gates.d1_direction)}  D4 冷卻 ${gateIcon(gates.d4_cooldown)}\n`;
  if (gates.needs_tradingview_check) {
    msg += `D2 型態 / D3 量能 → 📊 開 TradingView 看\n`;
  }
  msg += `\n`;

  // ─── 行動建議 ───
  if (action.recommended_action) {
    msg += `<b>行動</b>: ${escapeHtml(String(action.recommended_action))}\n`;
  }
  if (action.summary) {
    msg += `${escapeHtml(String(action.summary))}\n`;
  }

  if (action.key_risks && Array.isArray(action.key_risks) && action.key_risks.length > 0) {
    msg += `\n<b>風險</b>:\n`;
    action.key_risks.forEach(r => {
      msg += `• ${escapeHtml(String(r))}\n`;
    });
  }

  // ─── 數據品質警告 ───
  if (dq.warnings && Array.isArray(dq.warnings) && dq.warnings.length > 0) {
    msg += `\n⚠ <i>數據警告</i>: ${escapeHtml(dq.warnings.join(', '))}`;
  }

  return msg;
}


// ============================================================
// 工具函數
// ============================================================

/** 數字格式化。null/undefined/NaN/Infinity → "—"，正數加 + */
function fmt(n, decimals) {
  if (n === null || n === undefined) return '—';
  if (typeof n !== 'number') {
    const parsed = Number(n);
    if (isNaN(parsed)) return '—';
    n = parsed;
  }
  if (isNaN(n) || !isFinite(n)) return '—';
  const d = (decimals === undefined) ? 2 : decimals;
  return n >= 0 ? `+${n.toFixed(d)}` : n.toFixed(d);
}

/** HTML escape — 防 < > & 破壞 Telegram parseMode=HTML */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 安全執行（避免 nested undefined access 噴 error 中斷流程） */
function safe(fn, fallback) {
  try { return fn(); } catch (_) { return fallback || ''; }
}

function gateIcon(state) {
  const map = {
    'long_ok': '✅多',
    'short_ok': '✅空',
    'no_entry': '❌',
    'ok': '✅',
    'blocked': '⏳'
  };
  return map[state] || '?';
}

function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
// Telegram 發送（自包含實作，不依賴你既有 sendTelegramMessage 簽名）
// 如果你既有 v5 bot 的 sendTelegramMessage 簽名相容，可改回叫它。
// ============================================================
function sendTelegramHtml(text) {
  const props = PropertiesService.getScriptProperties();
  const botToken = props.getProperty('TELEGRAM_BOT_TOKEN');
  const chatId = props.getProperty('TELEGRAM_CHAT_ID');

  if (!botToken || !chatId) {
    return { ok: false, error: 'telegram_credentials_missing' };
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    if (code !== 200) {
      return { ok: false, error: `http_${code}: ${resp.getContentText().substring(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}


// ============================================================
// 測試函數（部署後手動跑）
// ============================================================

/** 模擬 Routine 送 macro_snapshot 過來，驗證 endpoint 行為 */
function testMacroSnapshot() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ROUTINE_TOKEN');

  const fakeEvent = {
    parameter: { endpoint: 'macro_snapshot' },
    postData: {
      contents: JSON.stringify({
        token: token,
        version: 'v10.0',
        timestamp: new Date().toISOString(),
        session: 'tw_pre_open',
        macro_score: { total: -15.9, base: 0, val_adj: -15.9, credit_adj: 0, contrarian: 0 },
        season: { name: '🟡 轉換期', g_score: 0.30, i_score: 1.90 },
        light: { color: 'yellow', label: '🟡 黃燈', stability_pct: 57, force_yellow: false, stagflation_override: false },
        key_indicators: {
          yield_curve: 0.51, bear_steepening: false,
          vix: 19.23, vix_term: 0.89,
          erp: -0.77, real_rate: 1.84,
          oil_roc_20d: 27.5, hy_spread: 4.5
        },
        raw_inputs: { ism_mfg: 52.7, core_pce_yoy: 3.1 },
        v10_gates: { d1_direction: 'no_entry', d4_cooldown: 'ok', needs_tradingview_check: true },
        actionable: {
          summary: '黃燈待機。轉換期、PE 偏高、ERP 負值、VIX 平靜。',
          key_risks: ['通膨軸接近 Stagflation 觸發', 'ERP 負值', '5/15 Powell 風險'],
          recommended_action: '等綠燈或 Stagflation Override；不主動進場'
        },
        data_quality: { all_indicators_fresh: true, warnings: [] }
      })
    }
  };

  const result = doPost(fakeEvent);
  console.log('Result:', result.getContent());
}

/** 模擬 Pine 送 v10_signal 過來 */
function testV10Signal() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('PINE_ALERT_SECRET');

  const fakeEvent = {
    parameter: { endpoint: 'v10_signal' },
    postData: {
      contents: JSON.stringify({
        secret: secret,
        action: 'buy',
        ticker: 'TAIFEX:TXF1!',
        timeframe: '60',
        price: 21580.00,
        pattern: '雙重底',
        quality: 92,
        macro_score: 18.5,
        stop: 21430.00,
        trail_start: 21680.00,
        timestamp: String(Date.now())
      })
    }
  };

  const result = doPost(fakeEvent);
  console.log('Result:', result.getContent());
}

/** 測試 escapeHtml 邊界 */
function testEscape() {
  console.log(escapeHtml('<b>bold</b>'));         // &lt;b&gt;bold&lt;/b&gt;
  console.log(escapeHtml('A & B'));                // A &amp; B
  console.log(escapeHtml(null));                   // ''
  console.log(escapeHtml(undefined));              // ''
  console.log(escapeHtml(123));                    // 123
}

/** 測試 fmt 邊界 */
function testFmt() {
  console.log(fmt(15.9));         // +15.90
  console.log(fmt(-15.9));        // -15.90
  console.log(fmt(0));            // +0.00
  console.log(fmt(null));         // —
  console.log(fmt(undefined));    // —
  console.log(fmt(NaN));          // —
  console.log(fmt(Infinity));     // —
  console.log(fmt('not a num'));  // —
  console.log(fmt('15.9'));       // +15.90 (string parse)
  console.log(fmt(15.9, 0));      // +16
}


// ============================================================
// Earnings Report endpoint handler
// ============================================================
function handleEarningsReport(e) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  let payload;

  try {
    if (!lock.tryLock(5000)) {
      return jsonResp({ ok: false, error: 'lock_timeout' });
    }
    lockAcquired = true;

    if (!e.postData || !e.postData.contents) {
      return jsonResp({ ok: false, error: 'no_body' });
    }
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (_) {
      return jsonResp({ ok: false, error: 'invalid_json' });
    }

    // ─── token 驗證（必須在 body，GAS 不能讀 HTTP custom headers）───
    const expectedToken = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
    if (!expectedToken || payload.token !== expectedToken) {
      console.warn('[earnings_report] Invalid token');
      return jsonResp({ ok: false, error: 'unauthorized' });
    }

    // ─── 必填欄位 ───
    const missing = ['type', 'ticker', 'earnings_date'].filter(k => !payload[k]);
    if (missing.length > 0) {
      return jsonResp({ ok: false, error: 'missing_fields: ' + missing.join(', ') });
    }
    if (payload.type !== 'alert' && payload.type !== 'summary') {
      return jsonResp({ ok: false, error: 'invalid_type: must be alert or summary' });
    }

    // ─── Dedup（key = ticker_date_type，23h 窗口）───
    const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
    if (!sheetId) return jsonResp({ ok: false, error: 'sheet_id_missing' });
    const ss = SpreadsheetApp.openById(sheetId);
    const dedupSheet = ss.getSheetByName('earnings_dedup');
    if (!dedupSheet) throw new Error('earnings_dedup sheet missing — run setupCheck()');

    const dedupKey = `${payload.ticker}_${payload.earnings_date}_${payload.type}`;
    if (checkAndSetDedup(dedupSheet, dedupKey, 23 * 60 * 60 * 1000)) {
      console.warn(`[earnings_report] Dedup: ${dedupKey}`);
      return jsonResp({ ok: true, dedup: true });
    }

    // ─── 格式化 + 推送 ───
    const message = payload.type === 'alert'
      ? formatEarningsAlert(payload)
      : formatEarningsSummary(payload);

    const sendResult = sendTelegramHtml(message);
    if (!sendResult.ok) throw new Error('Telegram send failed: ' + sendResult.error);

    // ─── 記 log ───
    const logSheet = ss.getSheetByName('earnings_log');
    if (logSheet) {
      logSheet.appendRow([
        new Date(),
        payload.type,
        payload.ticker,
        payload.earnings_date,
        payload.fiscal_period || '',
        payload.recommendation || ''
      ]);
    }

    return jsonResp({ ok: true, posted: true });

  } catch (err) {
    console.error('[earnings_report]', err.message, err.stack);
    try {
      const t  = payload ? payload.ticker : '?';
      const tp = payload ? payload.type   : '?';
      sendTelegramHtml(`⚠ <b>Earnings ${escapeHtml(tp)} ${escapeHtml(t)} 失敗</b>\n${escapeHtml(err.message)}`);
    } catch (_) {}
    return jsonResp({ ok: false, error: err.message });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}


// ============================================================
// Read Watchlist endpoint handler
// ============================================================
function handleReadWatchlist(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonResp({ ok: false, error: 'no_body' });
    }
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (_) {
      return jsonResp({ ok: false, error: 'invalid_json' });
    }

    const expectedToken = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
    if (!expectedToken || payload.token !== expectedToken) {
      console.warn('[read_watchlist] Invalid token');
      return jsonResp({ ok: false, error: 'unauthorized' });
    }

    const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
    if (!sheetId) return jsonResp({ ok: false, error: 'sheet_id_missing' });
    const ss = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName('earnings_watchlist');
    if (!sheet) {
      return jsonResp({ ok: false, error: 'earnings_watchlist not found — run setupCheck()' });
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return jsonResp({ ok: true, count: 0, watchlist: [] });

    // row 0 = header: ticker|market|shares|avg_cost|added_at|exit_at|lock_status|asset_type|note
    const watchlist = [];
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r[0]) continue;  // skip blank rows
      const exitAt = r[5];
      watchlist.push({
        ticker:      String(r[0]),
        market:      String(r[1] || 'US'),
        shares:      (r[2] !== '' && r[2] !== null) ? Number(r[2]) : null,
        avg_cost:    (r[3] !== '' && r[3] !== null) ? Number(r[3]) : null,
        added_at:    r[4] ? String(r[4]) : null,
        exit_at:     exitAt instanceof Date
                       ? Utilities.formatDate(exitAt, 'Asia/Taipei', 'yyyy-MM-dd')
                       : (exitAt ? String(exitAt) : null),
        lock_status: String(r[6] || 'tradeable'),
        asset_type:  String(r[7] || 'stock'),
        note:        String(r[8] || '')
      });
    }

    return jsonResp({ ok: true, count: watchlist.length, watchlist: watchlist });

  } catch (err) {
    console.error('[read_watchlist]', err.message, err.stack);
    return jsonResp({ ok: false, error: err.message });
  }
}


// ============================================================
// Earnings 訊息格式化
// ============================================================
function formatEarningsAlert(p) {
  const lockBadge = p.lock_status === 'locked' ? ' 🔒' : '';
  const mktIcon   = { US: '🇺🇸', TW: '🇹🇼', HK: '🇭🇰' }[p.market] || escapeHtml(p.market || '');

  let msg = `📅 <b>財報提醒 — ${escapeHtml(p.ticker)} ${escapeHtml(p.fiscal_period || '')}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>${escapeHtml(p.company_name || p.ticker)}</b>  ${mktIcon}${lockBadge}\n`;
  msg += `公布日: <code>${escapeHtml(p.earnings_date)}</code>`;
  if (p.release_time_local) msg += `  ${escapeHtml(String(p.release_time_local))}`;
  msg += `\n\n`;

  msg += `📊 <b>分析師預估</b>\n`;
  if (p.eps_estimate) msg += `EPS: <code>${escapeHtml(String(p.eps_estimate))}</code>\n`;
  if (p.rev_estimate) msg += `營收: <code>${escapeHtml(String(p.rev_estimate))}</code>\n`;
  msg += `\n`;

  const hasPos = p.shares != null || p.avg_cost != null;
  if (hasPos) {
    msg += `💼 <b>部位</b>\n`;
    msg += `持股: <code>${p.shares != null ? p.shares : '未填'}</code> 股`;
    if (p.avg_cost != null) msg += `  均成本: <code>${p.avg_cost}</code>`;
    if (p.current_price != null) msg += `  現價: <code>${p.current_price}</code>`;
    msg += `\n\n`;
  }

  if (p.action_hint) {
    msg += `💡 ${escapeHtml(String(p.action_hint))}\n`;
  }

  if (p.lock_status === 'locked') {
    msg += `\n🔒 <i>太太代持帳戶，僅監控用</i>\n`;
  }

  return msg;
}

function formatEarningsSummary(p) {
  const mktIcon  = { US: '🇺🇸', TW: '🇹🇼', HK: '🇭🇰' }[p.market] || escapeHtml(p.market || '');
  const guidIcon = { raised: '⬆', maintained: '➡', lowered: '⬇', withdrawn: '❓' }[p.guidance] || '';
  const recIcon  = { add: '📈', hold: '📊', monitor: '👀', trim: '✂️', exit: '🚪' }[p.recommendation] || '';

  let msg = `📋 <b>財報結果 — ${escapeHtml(p.ticker)} ${escapeHtml(p.fiscal_period || '')}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>${escapeHtml(p.company_name || p.ticker)}</b>  ${mktIcon}\n`;
  msg += `公布日: <code>${escapeHtml(p.earnings_date)}</code>\n\n`;

  // EPS & Rev
  msg += `📊 <b>實際 vs 預估</b>\n`;
  if (p.eps_actual || p.eps_estimate) {
    msg += `EPS: <code>${escapeHtml(String(p.eps_actual || '—'))}</code>`;
    if (p.eps_estimate) msg += ` est <code>${escapeHtml(String(p.eps_estimate))}</code>`;
    msg += beatMissIcon(p.eps_actual, p.eps_estimate);
    if (p.eps_yoy_pct != null) msg += `  YoY <code>${fmtPct(p.eps_yoy_pct)}</code>`;
    msg += `\n`;
  }
  if (p.rev_actual || p.rev_estimate) {
    msg += `營收: <code>${escapeHtml(String(p.rev_actual || '—'))}</code>`;
    if (p.rev_estimate) msg += ` est <code>${escapeHtml(String(p.rev_estimate))}</code>`;
    msg += beatMissIcon(p.rev_actual, p.rev_estimate);
    if (p.rev_yoy_pct != null) msg += `  YoY <code>${fmtPct(p.rev_yoy_pct)}</code>`;
    msg += `\n`;
  }
  msg += `\n`;

  // Guidance
  if (p.guidance) {
    msg += `📈 <b>指引</b>: ${guidIcon} <b>${escapeHtml(p.guidance)}</b>`;
    if (p.guidance_text) msg += `\n${escapeHtml(String(p.guidance_text))}`;
    msg += `\n\n`;
  }

  // Price reaction
  if (p.price_before != null && p.price_after != null) {
    const pct = p.price_reaction_pct != null
      ? ` (<code>${p.price_reaction_pct >= 0 ? '+' : ''}${Number(p.price_reaction_pct).toFixed(2)}%</code>)`
      : '';
    msg += `📉 <b>股價反應</b>: <code>${p.price_before}</code> → <code>${p.price_after}</code>${pct}\n\n`;
  }

  // Call highlights（3-5 條，≤ 50 字每條）
  if (Array.isArray(p.call_highlights) && p.call_highlights.length > 0) {
    msg += `📝 <b>財報重點</b>\n`;
    p.call_highlights.forEach(h => { msg += `• ${escapeHtml(String(h))}\n`; });
    msg += `\n`;
  }

  // Q&A（格式必須含 → 分隔，GAS 會切 Q/A 兩段渲染）
  if (Array.isArray(p.qa_highlights) && p.qa_highlights.length > 0) {
    msg += `❓ <b>Q&amp;A 亮點</b>\n`;
    p.qa_highlights.forEach(qa => {
      const parts = String(qa).split('→');
      if (parts.length >= 2) {
        msg += `Q: ${escapeHtml(parts[0].trim())}\n→ ${escapeHtml(parts.slice(1).join('→').trim())}\n`;
      } else {
        msg += `• ${escapeHtml(String(qa))}\n`;
      }
    });
    msg += `\n`;
  }

  // Position
  if (p.shares != null || p.avg_cost != null) {
    msg += `💼 <b>部位</b>\n`;
    msg += `持股: <code>${p.shares != null ? p.shares : '未填'}</code> 股`;
    if (p.avg_cost != null) msg += `  均成本: <code>${p.avg_cost}</code>`;
    msg += `\n\n`;
  }

  // Recommendation
  if (p.recommendation) {
    msg += `🎯 <b>建議</b>: ${recIcon} <b>${escapeHtml(p.recommendation.toUpperCase())}</b>\n`;
    if (p.recommendation_reason) msg += `${escapeHtml(String(p.recommendation_reason))}\n`;
    msg += `\n`;
  }

  if (p.summary_text) {
    msg += `📌 ${escapeHtml(String(p.summary_text))}\n`;
  }

  return msg;
}


// ============================================================
// 輔助函數（Earnings 用）
// ============================================================

/**
 * 在 earnings_dedup sheet 查找 key（col A = key, col B = posted_at, row 1 = header）。
 * 命中且在 windowMs 內 → 回傳 true（呼叫方應 skip）。
 * 否則寫入/更新 → 回傳 false（繼續處理）。
 */
function checkAndSetDedup(sheet, key, windowMs) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      const posted = data[i][1];
      if (posted instanceof Date && (Date.now() - posted.getTime()) < windowMs) {
        return true;
      }
      sheet.getRange(i + 1, 1, 1, 2).setValues([[key, new Date()]]);
      return false;
    }
  }
  sheet.appendRow([key, new Date()]);
  return false;
}

/** 剝離 $、B、M、K、% 等符號後解析數字；解析失敗回 NaN */
function parseAmount(str) {
  if (str == null) return NaN;
  return parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
}

/** 比對 actual vs estimate，回傳 ' ✅' / ' ❌' / ''（無法解析時靜默回空）*/
function beatMissIcon(actual, estimate) {
  const a = parseAmount(actual);
  const e = parseAmount(estimate);
  if (isNaN(a) || isNaN(e)) return '';
  return a >= e ? ' ✅' : ' ❌';
}

/** 百分比格式，帶正負號，例 +120.5% */
function fmtPct(n) {
  if (n == null || isNaN(Number(n))) return '—';
  const v = Number(n);
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}


// ============================================================
// 測試函數（Earnings）
// ============================================================

/** 模擬 alert mode — 推財報提醒（用遠期日期避免 dedup 衝突）*/
function testEarningsAlert() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ROUTINE_TOKEN');

  const fakeEvent = {
    parameter: { endpoint: 'earnings_report' },
    postData: {
      contents: JSON.stringify({
        token: token,
        type: 'alert',
        ticker: 'NVDA',
        company_name: 'NVIDIA',
        market: 'US',
        earnings_date: '2099-01-01',
        fiscal_period: 'Q1 FY26',
        release_time_local: '盤後 16:30 NY',
        eps_estimate: '$0.84',
        rev_estimate: '$43.1B',
        shares: 15,
        avg_cost: 132.03,
        current_price: 178.50,
        lock_status: 'tradeable',
        action_hint: '財報前 IV 偏高，options 不利進場'
      })
    }
  };

  const result = doPost(fakeEvent);
  console.log('testEarningsAlert:', result.getContent());
}

/** 模擬 summary mode — 推財報結果 */
function testEarningsSummary() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ROUTINE_TOKEN');

  const fakeEvent = {
    parameter: { endpoint: 'earnings_report' },
    postData: {
      contents: JSON.stringify({
        token: token,
        type: 'summary',
        ticker: 'NVDA',
        company_name: 'NVIDIA',
        market: 'US',
        earnings_date: '2099-01-02',
        fiscal_period: 'Q1 FY26',
        eps_actual: '$0.92',
        eps_estimate: '$0.84',
        eps_yoy_pct: 120.5,
        rev_actual: '$44.2B',
        rev_estimate: '$43.1B',
        rev_yoy_pct: 69.2,
        guidance: 'raised',
        guidance_text: 'Q2 Rev $45-47B vs 預估 $44.5B',
        price_before: 178.50,
        price_after: 190.65,
        price_reaction_pct: 6.81,
        shares: 15,
        avg_cost: 132.03,
        recommendation: 'hold',
        recommendation_reason: 'Beat 雙線 + Guidance 上修，但 PE 已 60+，不加碼',
        call_highlights: [
          '資料中心 +73% YoY 為主要驅動，Blackwell 出貨提前一季',
          '毛利率指引維持 75% 以上，Inventory turnover 改善',
          '中國禁令影響 Q3 約 $5B，但已 priced in'
        ],
        qa_highlights: [
          'Morgan Stanley 問 H100 庫存去化 → CFO 回覆 Q3 完成，無 write-down',
          'Goldman 問 Sovereign AI 訂單能見度 → 12 個月 backlog 已滿'
        ],
        summary_text: '資料中心 +85% YoY 為主要驅動。Blackwell 出貨節奏優於預期。中國禁令影響已 priced in。'
      })
    }
  };

  const result = doPost(fakeEvent);
  console.log('testEarningsSummary:', result.getContent());
}

/** 讀 earnings_watchlist sheet 並印出 JSON */
function testReadWatchlist() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ROUTINE_TOKEN');

  const fakeEvent = {
    parameter: { endpoint: 'read_watchlist' },
    postData: {
      contents: JSON.stringify({ token: token })
    }
  };

  const result = doPost(fakeEvent);
  console.log('testReadWatchlist:', result.getContent());
}
