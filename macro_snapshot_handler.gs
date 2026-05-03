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
  if (endpoint === 'v10_state')       return handleV10State(e);
  if (endpoint === 'read_v10_state')  return handleReadV10State(e);
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

  // 選用 properties — 沒設不會掛，但對應功能不會 work
  const optional = ['SNOWBALL_FOLDER_ID'];
  optional.forEach(k => {
    if (!props.getProperty(k)) {
      console.log('ℹ Optional Property "' + k + '" 未設定（syncFromSnowball 會跳過）');
    }
  });

  // 驗證 sheet 結構
  const sheetId = props.getProperty('MACRO_SHEET_ID');
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    const sheets = ['macro_log', 'signal_log', 'dedup_state', 'earnings_watchlist', 'earnings_log', 'v10_state'];
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
          // v1.2: 加 lock_status (tradeable/locked) + asset_type (stock/etf)
          sh.appendRow(['ticker', 'market', 'shares', 'avg_cost', 'added_at', 'exit_at',
                        'lock_status', 'asset_type', 'note']);
          // 預填 Cross 13 檔（8 tradeable + 3 locked + 2 exited）
          // 帳戶分布：個人美股 91275762、國泰港股、國泰美股、國泰台股、太太代持
          const seed = [
            // tradeable — 個人美股 91275762
            ['NFLX',   'US',     50, 22.19,  '2025',       '',           'tradeable', 'stock', '個人 91275762'],
            ['NVDA',   'US',     15, 132.03, '2025',       '',           'tradeable', 'stock', '個人 91275762'],
            ['QQQ',    'US',     10, 337.64, '2025',       '',           'tradeable', 'etf',   '個人 91275762'],
            ['VTI',    'US',     10, 182.91, '2025',       '',           'tradeable', 'etf',   '個人 91275762'],
            // tradeable — 國泰證券
            ['9660',   'HK',  16800, 6.587,  '2025',       '',           'tradeable', 'stock', '國泰港股 / 地平線機器人'],
            ['IXC',    'US',     60, 53.12,  '2026-04-21', '',           'tradeable', 'etf',   '國泰美股 / 能源對沖'],
            ['VOO',    'US',     10, 624.26, '2025',       '',           'tradeable', 'etf',   '國泰美股'],
            ['00632R', 'TW',  15000, 13.33,  '2025',       '',           'tradeable', 'etf',   '國泰台股 / 反一'],
            // locked — 太太代持
            ['2330',   'TW',    920, 972,    '2025',       '',           'locked',    'stock', '太太代持 / 台積電'],
            ['006208', 'TW',   3500, 100.7,  '2025',       '',           'locked',    'etf',   '太太代持 / 富邦台 50'],
            ['2382',   'TW',   2188, 264,    '2025',       '',           'locked',    'stock', '太太代持 / 廣達'],
            // exited — 已出清
            ['1810',   'HK',      0, 54.88,  '2025',       '2026-04-30', 'tradeable', 'stock', '已出清 / 小米'],
            ['00956',  'TW',      0, 37,     '2025',       '2026-04-30', 'locked',    'etf',   '太太代持 / 已出清 / CTBC TOPIX']
          ];
          seed.forEach(row => sh.appendRow(row));
          console.log('  → 已預填 13 列（8 tradeable + 3 locked + 2 exited）');
        } else if (name === 'earnings_log') {
          sh.appendRow(['timestamp', 'ticker', 'type', 'earnings_date',
                        'eps_actual', 'eps_estimate', 'rev_actual', 'rev_estimate',
                        'price_reaction_pct', 'summary_text']);
        } else if (name === 'v10_state') {
          // Pine 每 bar close 推一筆 D2/D3 snapshot；upsert by ticker（一個 ticker 一列）
          // v10.1+ 加 regime / HY credit stress 欄位（v10.0 Pine 不送這些值就留空）
          sh.appendRow(['ticker', 'timestamp', 'timeframe', 'price', 'pattern', 'quality',
                        'obv_direction', 'atr',
                        'regime', 'regime_base', 'regime_upgrade_reason',
                        'hy_pressure_level', 'hy_weekly_jump', 'hy_acute_event']);
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
// Migration v1.1 → v1.2：earnings_watchlist 加 lock_status / asset_type 兩欄
// ============================================================
/**
 * 既有 sheet（v1.1，7 欄）→ v1.2（9 欄）。
 * 對 Cross 已上線的 sheet 跑一次：在 'exit_at' 後插入 'lock_status' / 'asset_type'。
 *
 * 跑法：Apps Script 編輯器選 migrateWatchlistSchema → ▶ Run
 * 冪等：已是 9 欄會 noop。
 */
function migrateWatchlistSchema() {
  const props = PropertiesService.getScriptProperties();
  const SHEET_ID = props.getProperty('MACRO_SHEET_ID');
  if (!SHEET_ID) throw new Error('MACRO_SHEET_ID 未設定');

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('earnings_watchlist');
  if (!sh) throw new Error('earnings_watchlist sheet 不存在 → 先跑 setupCheck()');

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf('lock_status') >= 0 && headers.indexOf('asset_type') >= 0) {
    console.log('✅ Schema 已是 v1.2，無需 migration');
    return;
  }

  const exitIdx = headers.indexOf('exit_at');
  const noteIdx = headers.indexOf('note');
  if (exitIdx < 0 || noteIdx < 0) {
    throw new Error('既有 sheet 缺 exit_at 或 note 欄，無法 migrate');
  }

  // 在 'note' 前插 2 欄
  sh.insertColumnsBefore(noteIdx + 1, 2);
  sh.getRange(1, noteIdx + 1).setValue('lock_status');
  sh.getRange(1, noteIdx + 2).setValue('asset_type');
  console.log('✅ 已插入 lock_status / asset_type 兩欄（在 note 前）');

  // 對既有列推斷預設值
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    let stocks = 0, etfs = 0;
    for (let i = 0; i < data.length; i++) {
      const ticker = String(data[i][0] || '').trim();
      const market = String(data[i][1] || '').trim();
      if (!ticker) continue;
      const inferred = inferAssetType(ticker, market);
      sh.getRange(i + 2, noteIdx + 1).setValue('tradeable');  // 預設都 tradeable
      sh.getRange(i + 2, noteIdx + 2).setValue(inferred);
      if (inferred === 'etf') etfs++; else stocks++;
    }
    console.log(`✅ 預設值已寫入：${stocks} 個 stock / ${etfs} 個 etf，全部 lock_status=tradeable`);
    console.log('⚠ 接下來請手動把太太代持的部位 lock_status 改為 "locked"（預期：2330 / 006208 / 2382 / 00956）');
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

    // ─── 第 3 層：payload completeness（防止空殼推 dashes 出去）───
    // 必須在 dedup 之前檢查：空殼若先寫進 dedup 會卡住未來相同 session 的測試
    // 必須至少有 analyst_report.headline 或 (light + macro_score + season) 三者其一
    const hasAnalyst = payload.analyst_report && payload.analyst_report.headline;
    const hasQuant   = payload.light || payload.macro_score || payload.season;
    if (!hasAnalyst && !hasQuant) {
      console.warn('[macro_snapshot] Empty payload — no analyst_report and no quant fields');
      const sess = String(payload.session || 'unknown');
      const warnMsg =
        `⚠ <b>收到空 payload</b>\n` +
        `Session: <code>${escapeHtml(sess)}</code>\n` +
        `Timestamp: <code>${escapeHtml(String(payload.timestamp))}</code>\n` +
        `\n可能原因：\n` +
        `• Routine ▶ Run Now 在非排程視窗觸發，Claude 跳過了數據撈取\n` +
        `• Routine prompt 沒部署完整（Phase 3 未完成）\n` +
        `• 手動 curl 測試只送 auth 欄位\n` +
        `\n動作：開 Anthropic Routine logs 看最近一次 Run 的內容`;
      try { sendTelegramHtml(warnMsg); } catch (_) {}
      return jsonResp({ ok: false, error: 'empty_payload', session: sess });
    }

    // ─── 第 4 層：Sheet 去重（payload 有效時才占用 dedup 配額）───
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
    // v10.1: regime 行（被 HY 強制升級或非 NORMAL 時顯示）
    if (payload.regime) {
      const regimeIcon = {
        'CRISIS':  '🔴',
        'WARNING': '🟠',
        'SHOCK':   '⚡',
        'HALT':    '🛑',
        'NORMAL':  '🟢'
      }[String(payload.regime).toUpperCase()] || '⚪';
      const regimeStr = String(payload.regime);
      const upgraded = payload.regime_base && String(payload.regime_base) !== regimeStr;
      let line = `Regime: ${regimeIcon} <b>${escapeHtml(regimeStr)}</b>`;
      if (upgraded) {
        line += ` <i>(由 ${escapeHtml(String(payload.regime_base))} 升級)</i>`;
      }
      if (payload.regime_upgrade_reason) {
        line += `\n   <i>↳ ${escapeHtml(String(payload.regime_upgrade_reason))}</i>`;
      }
      msg += line + `\n`;
    }
    msg += `\n`;
    if (payload.stop !== undefined)        msg += `停損: <code>${fmt(payload.stop)}</code>\n`;
    if (payload.trail_start !== undefined) msg += `啟動點: <code>${fmt(payload.trail_start)}</code>（浮盈 1×ATR）\n`;
    if (payload.target !== undefined) {
      const rText = payload.target_r !== undefined && payload.target_r !== null
        ? ` (R:R = ${fmt(payload.target_r, 1)})`
        : '';
      msg += `目標: <code>${fmt(payload.target)}</code>${rText}\n`;
    }
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
// v10 State Snapshot endpoint
// Pine 每 bar close 推一筆 D2/D3 snapshot（pattern / quality / OBV）
// 不發 Telegram，只寫進 v10_state sheet（upsert by ticker）給 macro routine 拉
// ============================================================
function handleV10State(e) {
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
      console.warn('[v10_state] Invalid JSON:', e.postData.contents);
      return jsonResp({ ok: false, error: 'invalid_json' });
    }

    const expectedSecret = PropertiesService.getScriptProperties().getProperty('PINE_ALERT_SECRET');
    if (!expectedSecret) {
      return jsonResp({ ok: false, error: 'server_misconfigured' });
    }
    if (payload.secret !== expectedSecret) {
      console.warn('[v10_state] Invalid secret');
      return jsonResp({ ok: false, error: 'unauthorized' });
    }

    const required = ['ticker', 'price', 'pattern', 'quality'];
    const missing = required.filter(k => payload[k] === undefined || payload[k] === null);
    if (missing.length > 0) {
      return jsonResp({ ok: false, error: 'missing_fields: ' + missing.join(', ') });
    }

    const priceNum = Number(payload.price);
    const qualityNum = Number(payload.quality);
    if (!isFinite(priceNum) || !isFinite(qualityNum)) {
      return jsonResp({ ok: false, error: 'non_numeric_price_or_quality' });
    }

    const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    let sh = ss.getSheetByName('v10_state');
    if (!sh) {
      sh = ss.insertSheet('v10_state');
      sh.appendRow(['ticker', 'timestamp', 'timeframe', 'price', 'pattern', 'quality',
                    'obv_direction', 'atr',
                    'regime', 'regime_base', 'regime_upgrade_reason',
                    'hy_pressure_level', 'hy_weekly_jump', 'hy_acute_event']);
    }

    const ticker = String(payload.ticker);
    const atrNum = (payload.atr === undefined || payload.atr === null || !isFinite(Number(payload.atr)))
      ? '' : Number(payload.atr);
    // v10.1 optional credit stress / regime fields — empty cell when not sent
    const hyJump = payload.hy_weekly_jump;
    const hyJumpCell = (hyJump === undefined || hyJump === null || !isFinite(Number(hyJump)))
      ? '' : Number(hyJump);
    const hyAcute = payload.hy_acute_event;
    const hyAcuteCell = (hyAcute === undefined || hyAcute === null) ? '' : Boolean(hyAcute);
    const row = [
      ticker,
      new Date(),
      String(payload.timeframe || ''),
      priceNum,
      String(payload.pattern),
      qualityNum,
      String(payload.obv_direction || 'flat'),
      atrNum,
      payload.regime ? String(payload.regime) : '',
      payload.regime_base ? String(payload.regime_base) : '',
      payload.regime_upgrade_reason ? String(payload.regime_upgrade_reason) : '',
      payload.hy_pressure_level ? String(payload.hy_pressure_level) : '',
      hyJumpCell,
      hyAcuteCell
    ];

    const lastRow = sh.getLastRow();
    let targetRow = -1;
    if (lastRow >= 2) {
      const tickers = sh.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < tickers.length; i++) {
        if (String(tickers[i][0]) === ticker) {
          targetRow = i + 2;
          break;
        }
      }
    }
    if (targetRow > 0) {
      sh.getRange(targetRow, 1, 1, row.length).setValues([row]);
    } else {
      sh.appendRow(row);
    }

    return jsonResp({ ok: true, upserted: ticker });

  } catch (err) {
    console.error('[v10_state]', err.message, err.stack);
    return jsonResp({ ok: false, error: err.message });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}


// ============================================================
// Read v10 State endpoint — Routine 拉最新 D2/D3 snapshot
// 不發 Telegram；回傳所有 ticker 的最新 state（routine 自己挑 TXF1!）
// ============================================================
function handleReadV10State(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonResp({ ok: false, error: 'no_body' });
    }
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonResp({ ok: false, error: 'invalid_json' });
    }

    const expectedToken = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
    if (!expectedToken) {
      return jsonResp({ ok: false, error: 'server_misconfigured' });
    }
    if (payload.token !== expectedToken) {
      console.warn('[read_v10_state] Invalid token');
      return jsonResp({ ok: false, error: 'unauthorized' });
    }

    const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    const sh = ss.getSheetByName('v10_state');
    if (!sh) {
      return jsonResp({ ok: true, states: [], count: 0 });
    }
    const lastRow = sh.getLastRow();
    if (lastRow < 2) {
      return jsonResp({ ok: true, states: [], count: 0 });
    }
    // 讀全寬，舊 8-col sheet 也能跑（新欄位回傳 null）
    const numCols = Math.max(sh.getLastColumn(), 8);
    const rows = sh.getRange(2, 1, lastRow - 1, numCols).getValues();
    const nowMs = Date.now();
    const states = rows
      .filter(r => String(r[0] || '').trim() !== '')
      .map(r => {
        const ts = r[1] instanceof Date ? r[1] : new Date(r[1]);
        const tsMs = ts.getTime();
        const tsValid = isFinite(tsMs);
        return {
          ticker: String(r[0]),
          timestamp: tsValid ? ts.toISOString() : null,
          age_sec: tsValid ? Math.round((nowMs - tsMs) / 1000) : null,
          timestamp_invalid: !tsValid,
          timeframe: String(r[2] || ''),
          price: r[3] === '' || r[3] === null ? null : Number(r[3]),
          pattern: String(r[4] || ''),
          quality: r[5] === '' || r[5] === null ? null : Number(r[5]),
          obv_direction: String(r[6] || 'flat'),
          atr: r[7] === '' || r[7] === null ? null : Number(r[7]),
          // v10.1 fields — null on legacy 8-col sheets or v10.0 Pine
          regime: r[8] ? String(r[8]) : null,
          regime_base: r[9] ? String(r[9]) : null,
          regime_upgrade_reason: r[10] ? String(r[10]) : null,
          hy_pressure_level: r[11] ? String(r[11]) : null,
          hy_weekly_jump: (r[12] === '' || r[12] === undefined || r[12] === null) ? null : Number(r[12]),
          hy_acute_event: (r[13] === '' || r[13] === undefined || r[13] === null) ? null : Boolean(r[13])
        };
      });

    // optional ticker filter
    const filtered = payload.ticker
      ? states.filter(s => s.ticker === String(payload.ticker))
      : states;

    return jsonResp({ ok: true, states: filtered, count: filtered.length });

  } catch (err) {
    console.error('[read_v10_state]', err.message, err.stack);
    return jsonResp({ ok: false, error: err.message });
  }
}


// ============================================================
// Earnings Report endpoint handler
// 接收 Routine 推來的「明日提醒」(type=alert) 和「當日盤後 summary」(type=summary)
// ============================================================
function handleEarningsReport(e) {
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
      return jsonResp({ ok: false, error: 'invalid_json' });
    }

    // ─── Token（沿用 ROUTINE_TOKEN）───
    const expectedToken = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
    if (!expectedToken) {
      return jsonResp({ ok: false, error: 'server_misconfigured' });
    }
    if (payload.token !== expectedToken) {
      console.warn('[earnings] Invalid token');
      return jsonResp({ ok: false, error: 'unauthorized' });
    }

    // ─── 必要欄位 ───
    const required = ['type', 'ticker', 'earnings_date'];
    const missing = required.filter(k => payload[k] === undefined || payload[k] === null);
    if (missing.length > 0) {
      throw new Error('Missing fields: ' + missing.join(', '));
    }
    if (payload.type !== 'alert' && payload.type !== 'summary') {
      throw new Error('Invalid type: ' + payload.type);
    }

    // ─── Dedup（掃 earnings_log 最後 50 列；同一 ticker+type+earnings_date 已記錄就 skip）───
    const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
    if (!sheetId) {
      return jsonResp({ ok: false, error: 'sheet_id_missing' });
    }
    const ss = SpreadsheetApp.openById(sheetId);
    const logSheet = ss.getSheetByName('earnings_log');
    if (!logSheet) {
      throw new Error('earnings_log sheet missing — run setupCheck()');
    }

    const dedupKey = `${payload.ticker}_${payload.type}_${payload.earnings_date}`;
    const lastRow = logSheet.getLastRow();
    if (lastRow > 1) {
      const startRow = Math.max(2, lastRow - 49);
      const numRows = lastRow - startRow + 1;
      const recent = logSheet.getRange(startRow, 2, numRows, 3).getValues();  // ticker, type, earnings_date
      for (let i = 0; i < recent.length; i++) {
        const k = `${recent[i][0]}_${recent[i][1]}_${recent[i][2]}`;
        if (k === dedupKey) {
          console.warn(`[earnings] Dedup hit: ${dedupKey}`);
          return jsonResp({ ok: true, dedup: true });
        }
      }
    }

    // ─── 格式化訊息 ───
    const msg = payload.type === 'alert'
      ? formatEarningsAlert(payload)
      : formatEarningsSummary(payload);

    const sendResult = sendTelegramHtml(msg);
    if (!sendResult.ok) {
      throw new Error(`Telegram send failed: ${sendResult.error}`);
    }

    // ─── 記 log ───
    logSheet.appendRow([
      new Date(),
      payload.ticker,
      payload.type,
      payload.earnings_date,
      safe(() => payload.eps_actual),
      safe(() => payload.eps_estimate),
      safe(() => payload.rev_actual),
      safe(() => payload.rev_estimate),
      safe(() => payload.price_reaction_pct),
      safe(() => payload.summary_text)
    ]);

    return jsonResp({ ok: true, posted: true });

  } catch (err) {
    console.error('[earnings]', err.message, err.stack);
    try {
      sendTelegramHtml(`⚠ <b>Earnings 推送失敗</b>\n${escapeHtml(err.message)}`);
    } catch (_) {}
    return jsonResp({ ok: false, error: err.message });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}


// ============================================================
// Read watchlist endpoint — Routine 動態讀清單，不再硬編在 prompt
// ============================================================
function handleReadWatchlist(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonResp({ ok: false, error: 'no_body' });
    }
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonResp({ ok: false, error: 'invalid_json' });
    }

    const expectedToken = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
    if (!expectedToken) {
      return jsonResp({ ok: false, error: 'server_misconfigured' });
    }
    if (payload.token !== expectedToken) {
      console.warn('[read_watchlist] Invalid token');
      return jsonResp({ ok: false, error: 'unauthorized' });
    }

    const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
    if (!sheetId) {
      return jsonResp({ ok: false, error: 'sheet_id_missing' });
    }
    const ss = SpreadsheetApp.openById(sheetId);
    const sh = ss.getSheetByName('earnings_watchlist');
    if (!sh) {
      throw new Error('earnings_watchlist sheet missing — run setupCheck()');
    }

    const lastRow = sh.getLastRow();
    if (lastRow < 2) {
      return jsonResp({ ok: true, watchlist: [], count: 0 });
    }
    // v1.2: 9 columns（加 lock_status + asset_type）
    // 舊 sheet 還是 7 欄時會自動 fallback：lock_status='tradeable' / asset_type=從 ticker 推
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const hasLockCols = headers.indexOf('lock_status') >= 0 && headers.indexOf('asset_type') >= 0;
    const numCols = hasLockCols ? 9 : 7;
    const rows = sh.getRange(2, 1, lastRow - 1, numCols).getValues();

    const watchlist = rows.map(r => {
      const ticker = String(r[0] || '').trim();
      const market = String(r[1] || '').trim();
      const item = {
        ticker:   ticker,
        market:   market,
        shares:   r[2] === '' || r[2] === null ? null : Number(r[2]),
        avg_cost: r[3] === '' || r[3] === null ? null : Number(r[3]),
        added_at: r[4] ? String(r[4]) : null,
        exit_at:  r[5] ? String(r[5]) : null,
      };
      if (hasLockCols) {
        item.lock_status = String(r[6] || 'tradeable').trim().toLowerCase();
        item.asset_type  = String(r[7] || 'stock').trim().toLowerCase();
        item.note        = String(r[8] || '').trim();
      } else {
        // 舊 sheet — 推一個合理預設
        item.lock_status = 'tradeable';
        item.asset_type  = inferAssetType(ticker, market);
        item.note        = String(r[6] || '').trim();
      }
      return item;
    }).filter(x => x.ticker !== '');

    return jsonResp({ ok: true, watchlist: watchlist, count: watchlist.length });

  } catch (err) {
    console.error('[read_watchlist]', err.message, err.stack);
    return jsonResp({ ok: false, error: err.message });
  }
}


// ============================================================
// Earnings 訊息格式化
// ============================================================

/**
 * 前一交易日提醒（type=alert）
 * payload 欄位:
 *   ticker, market ('TW'|'US'|'HK'), earnings_date (YYYY-MM-DD),
 *   release_time_local (e.g. "盤後 16:30 NY" / "14:00 台北"),
 *   eps_estimate, rev_estimate (string with currency),
 *   shares (number, optional), avg_cost (number, optional),
 *   current_price (number), action_hint (string, optional)
 */
function formatEarningsAlert(p) {
  const marketLabel = { 'TW': '台股', 'US': '美股', 'HK': '港股' }[p.market] || p.market || '';
  const isLocked = String(p.lock_status || '').toLowerCase() === 'locked';
  const titlePrefix = isLocked ? '🔒 ' : '';
  let msg = `📅 <b>${titlePrefix}明日財報提醒</b>  ${escapeHtml(String(p.earnings_date))}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>${escapeHtml(String(p.ticker))}</b>`;
  if (p.company_name) msg += `  ${escapeHtml(String(p.company_name))}`;
  if (marketLabel)    msg += `  <i>${escapeHtml(marketLabel)}</i>`;
  if (isLocked)       msg += `  <i>(太太代持)</i>`;
  msg += `\n`;
  if (p.release_time_local) {
    msg += `公布時間: ${escapeHtml(String(p.release_time_local))}\n`;
  }
  if (p.fiscal_period) {
    msg += `期別: ${escapeHtml(String(p.fiscal_period))}\n`;
  }
  msg += `\n<b>分析師預估</b>\n`;
  if (p.eps_estimate !== undefined && p.eps_estimate !== null) {
    msg += `EPS: <code>${escapeHtml(String(p.eps_estimate))}</code>\n`;
  }
  if (p.rev_estimate !== undefined && p.rev_estimate !== null) {
    msg += `Rev: <code>${escapeHtml(String(p.rev_estimate))}</code>\n`;
  }

  // 部位影響預估（只有 shares 填了才算）
  if (typeof p.shares === 'number' && p.shares > 0 && typeof p.current_price === 'number') {
    msg += `\n<b>你的部位</b>\n`;
    msg += `${fmt(p.shares, 0)} 股 @ 現價 <code>${fmt(p.current_price)}</code>`;
    if (typeof p.avg_cost === 'number' && p.avg_cost > 0) {
      const pnlPct = ((p.current_price - p.avg_cost) / p.avg_cost) * 100;
      msg += `（avg <code>${fmt(p.avg_cost)}</code>, ${fmt(pnlPct, 1)}%）`;
    }
    msg += `\n`;
    // 盤後波動 ±10% 假設
    const lowSwing = p.current_price * p.shares * 0.10;
    msg += `±10% 波動 ≈ <code>${fmt(lowSwing, 0)}</code>\n`;
  } else {
    msg += `\n⚠ <i>部位 shares/avg_cost 未填，無法估影響 — 補 earnings_watchlist</i>\n`;
  }

  msg += `\n<b>提醒</b>\n`;
  if (isLocked) {
    msg += `• 太太代持，僅監控不下單\n`;
    msg += `• 公布後留意是否需告知她調整\n`;
  } else {
    msg += `• 不過 earnings → 盤前/收盤前出\n`;
    msg += `• 過 earnings → IB 設 OCO 保護\n`;
  }
  if (p.action_hint) {
    msg += `• ${escapeHtml(String(p.action_hint))}\n`;
  }
  return msg;
}

/**
 * 公布當日盤後 summary（type=summary）
 * payload 欄位:
 *   ticker, market, earnings_date, fiscal_period,
 *   eps_actual, eps_estimate, eps_yoy_pct,
 *   rev_actual, rev_estimate, rev_yoy_pct,
 *   guidance ('raised' | 'in_line' | 'cut' | null),
 *   guidance_text (string, optional),
 *   price_before, price_after, price_reaction_pct,
 *   shares, avg_cost,
 *   recommendation ('hold' | 'add' | 'trim' | 'exit' | 'monitor'),
 *   recommendation_reason (string),
 *   summary_text (string, 2-3 句重點)
 */
function formatEarningsSummary(p) {
  const marketLabel = { 'TW': '台股', 'US': '美股', 'HK': '港股' }[p.market] || p.market || '';
  let msg = `📊 <b>${escapeHtml(String(p.ticker))} 財報公布</b>`;
  if (p.fiscal_period) msg += `  ${escapeHtml(String(p.fiscal_period))}`;
  msg += `\n━━━━━━━━━━━━━━━━━━\n`;
  if (p.company_name) msg += `${escapeHtml(String(p.company_name))} <i>${escapeHtml(marketLabel)}</i>\n\n`;

  // EPS / Rev beat-miss
  if (p.eps_actual !== undefined && p.eps_actual !== null) {
    msg += `<b>EPS</b>: 實際 <code>${escapeHtml(String(p.eps_actual))}</code>`;
    if (p.eps_estimate !== undefined && p.eps_estimate !== null) {
      msg += ` / 預估 <code>${escapeHtml(String(p.eps_estimate))}</code>`;
    }
    msg += `  ${beatMissIcon(p.eps_actual, p.eps_estimate)}`;
    if (typeof p.eps_yoy_pct === 'number') msg += `  YoY ${fmt(p.eps_yoy_pct, 1)}%`;
    msg += `\n`;
  }
  if (p.rev_actual !== undefined && p.rev_actual !== null) {
    msg += `<b>Rev</b>: 實際 <code>${escapeHtml(String(p.rev_actual))}</code>`;
    if (p.rev_estimate !== undefined && p.rev_estimate !== null) {
      msg += ` / 預估 <code>${escapeHtml(String(p.rev_estimate))}</code>`;
    }
    msg += `  ${beatMissIcon(p.rev_actual, p.rev_estimate)}`;
    if (typeof p.rev_yoy_pct === 'number') msg += `  YoY ${fmt(p.rev_yoy_pct, 1)}%`;
    msg += `\n`;
  }

  // Guidance
  if (p.guidance) {
    const gIcon = { 'raised': '🟢 上修', 'in_line': '⚪ 持平', 'cut': '🔴 下修' }[p.guidance] || p.guidance;
    msg += `<b>Guidance</b>: ${escapeHtml(gIcon)}`;
    if (p.guidance_text) msg += `  ${escapeHtml(String(p.guidance_text))}`;
    msg += `\n`;
  }

  // 盤後股價反應
  if (typeof p.price_reaction_pct === 'number') {
    const rIcon = p.price_reaction_pct >= 0 ? '📈' : '📉';
    msg += `\n${rIcon} <b>盤後反應</b>: ${fmt(p.price_reaction_pct, 1)}%`;
    if (typeof p.price_before === 'number' && typeof p.price_after === 'number') {
      msg += `（<code>${fmt(p.price_before)}</code> → <code>${fmt(p.price_after)}</code>）`;
    }
    msg += `\n`;
  }

  // 對部位影響
  if (typeof p.shares === 'number' && p.shares > 0
      && typeof p.price_after === 'number') {
    msg += `\n<b>你的影響</b>\n`;
    msg += `部位 ${fmt(p.shares, 0)} 股`;
    if (typeof p.avg_cost === 'number' && p.avg_cost > 0) {
      const totalPnl = (p.price_after - p.avg_cost) * p.shares;
      const totalPct = ((p.price_after - p.avg_cost) / p.avg_cost) * 100;
      msg += ` @ avg <code>${fmt(p.avg_cost)}</code>\n`;
      msg += `MTM ≈ <code>${fmt(totalPnl, 0)}</code>（${fmt(totalPct, 1)}% vs avg）\n`;
    } else {
      msg += `（avg_cost 未填，無 PnL）\n`;
    }
    if (typeof p.price_reaction_pct === 'number') {
      const todayPnl = p.price_after * p.shares * (p.price_reaction_pct / 100);
      msg += `今日 ≈ <code>${fmt(todayPnl, 0)}</code>\n`;
    }
  }

  // 建議
  if (p.recommendation) {
    const recIcon = {
      'add':     '🟢 加碼',
      'hold':    '⚪ 持有',
      'monitor': '🟡 觀察',
      'trim':    '🟠 減碼',
      'exit':    '🔴 出清'
    }[p.recommendation] || p.recommendation;
    msg += `\n<b>建議</b>: ${escapeHtml(recIcon)}`;
    if (p.recommendation_reason) {
      msg += `\n<i>${escapeHtml(String(p.recommendation_reason))}</i>`;
    }
    msg += `\n`;
  }

  // Call 重點（管理層 prepared remarks 抽出 3-5 條）
  if (Array.isArray(p.call_highlights) && p.call_highlights.length > 0) {
    msg += `\n<b>【Call 重點】</b>\n`;
    p.call_highlights.forEach(h => {
      msg += `• ${escapeHtml(String(h))}\n`;
    });
  }

  // 分析師 Q&A（2-3 條對立或 surprise 交鋒）
  if (Array.isArray(p.qa_highlights) && p.qa_highlights.length > 0) {
    msg += `\n<b>【分析師 Q&amp;A】</b>\n`;
    p.qa_highlights.forEach(qa => {
      const raw = String(qa || '');
      const arrowIdx = raw.indexOf('→');
      let qPart;
      let aPart;
      if (arrowIdx >= 0) {
        qPart = raw.slice(0, arrowIdx).trim();
        aPart = raw.slice(arrowIdx + 1).trim() || '—';
      } else {
        qPart = raw.trim();
        aPart = '—';
      }
      msg += `Q · ${escapeHtml(qPart)}\n`;
      msg += `A · ${escapeHtml(aPart)}\n\n`;
    });
  }

  // 摘要
  if (p.summary_text) {
    msg += `\n<b>重點</b>\n${escapeHtml(String(p.summary_text))}`;
  }

  return msg;
}

/** Beat / Miss 圖示 — 接受字串或數字（"$0.92" / 0.92 都能比） */
function beatMissIcon(actual, estimate) {
  const a = parseFloatLoose(actual);
  const e = parseFloatLoose(estimate);
  if (a === null || e === null) return '';
  if (a > e) return '✅ Beat';
  if (a < e) return '❌ Miss';
  return '⚪ In-line';
}

/** 從 "$0.92" / "$44.2B" / 0.92 抽出純數字（M/B/K 不換算 — 只給 beat/miss 比方向用） */
function parseFloatLoose(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const m = String(v).replace(/[$,\s]/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return isFinite(n) ? n : null;
}


// ============================================================
// Macro Snapshot 訊息格式化
// ============================================================

/** news_pulse 章節：category → emoji + 中文 label 對應表 */
const NEWS_CATEGORY_ICON = {
  monetary_policy:  { emoji: '🏦', label: '貨幣' },
  geopolitics:      { emoji: '🌏', label: '地緣' },
  inflation:        { emoji: '📈', label: '通膨' },
  growth:           { emoji: '🏭', label: '成長' },
  semis:            { emoji: '💻', label: '半導體' },
  oil_energy:       { emoji: '🛢', label: '油氣' },
  fx_rates:         { emoji: '💱', label: '匯率' },
  china_macro:      { emoji: '🇨🇳', label: '中國' },
  tech_regulation:  { emoji: '⚖', label: '科技法規' }
};
const NEWS_CATEGORY_DEFAULT = { emoji: '📰', label: '一般' };

function formatMacroMessage(p) {
  // 優先：IB 分析師格式（Routine 帶 analyst_report 時走新版）
  if (p.analyst_report && p.analyst_report.headline) {
    try {
      return formatAnalystReport(p);
    } catch (err) {
      console.warn('[formatAnalystReport] failed, falling back to legacy:', err.message);
      // 失敗就退回舊版，不阻斷推播
    }
  }
  return formatLegacyMacroMessage(p);
}


/**
 * IB 分析師等級的日報渲染（v2）
 * 對應 .claude/skills/macro-daily-analyst-report/SKILL.md
 *
 * 章節順序（重敘事輕指標）：
 *   1. Headline（一句結論）
 *   2. 信號（stance · conviction · horizon）
 *   3. 宏觀敘事（成長/通膨/估值各 1-2 句）
 *   4. 持倉動作（具體 ticker + 動作）
 *   5. 關鍵風險（排序 + 影響）
 *   6. 今明 48H 催化劑
 *   7. 關鍵價位
 *   8. 翻盤條件
 *   9. 量化參考 footer（簡版）
 */
function formatAnalystReport(p) {
  const a = p.analyst_report || {};
  const sessionLabel = {
    'tw_pre_open': '🌅 台股盤前',
    'us_pre_open': '🌃 美股盤前'
  }[p.session] || '📊 快照';

  const time = Utilities.formatDate(new Date(p.timestamp), 'Asia/Taipei', 'MM/dd HH:mm');

  let msg = `<b>${sessionLabel} ${time}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;

  // 1. Headline
  msg += `<b>${escapeHtml(String(a.headline))}</b>\n\n`;

  // 2. Top call
  const tc = a.top_call || {};
  if (tc.stance || tc.conviction) {
    const stanceLabel = escapeHtml(String(tc.stance_label || tc.stance || '—'));
    const conv = escapeHtml(String(tc.conviction || '—'));
    const horizon = escapeHtml(String(tc.horizon || '—'));
    msg += `<b>【信號】</b> ${stanceLabel} · ${conv} · ${horizon}\n`;
    if (tc.one_liner) {
      msg += `<i>${escapeHtml(String(tc.one_liner))}</i>\n`;
    }
    msg += `\n`;
  }

  // 3. 宏觀敘事
  const rn = a.regime_narrative || {};
  if (rn.growth || rn.inflation || rn.valuation_credit) {
    msg += `<b>【宏觀敘事】</b>\n`;
    if (rn.growth)           msg += `• 成長：${escapeHtml(String(rn.growth))}\n`;
    if (rn.inflation)        msg += `• 通膨：${escapeHtml(String(rn.inflation))}\n`;
    if (rn.valuation_credit) msg += `• 估值：${escapeHtml(String(rn.valuation_credit))}\n`;
    msg += `\n`;
  }

  // 3.4 信用壓力（v10.1 新增；HY spread 等級 + 一週急升 + regime 強制升級）
  // 來源優先：analyst_report.credit_pressure（narrative）+ top-level credit_stress（quant）
  const cs = p.credit_stress || {};
  const cp = a.credit_pressure || {};
  const hyLevel = cp.level || cs.hy_pressure_level || null;
  const hyJump  = cs.hy_weekly_jump_pct;
  const hySpread = cs.hy_spread_pct;
  const hyAcute = Boolean(cs.hy_acute_event);
  if (hyLevel || hySpread !== undefined || cp.headline || cp.detail) {
    const levelEmoji = {
      'CRISIS':   '🔴',
      'WARNING':  '🟠',
      'ELEVATED': '🟡',
      'NORMAL':   '🟢',
      'N/A':      '⚪'
    }[String(hyLevel || '').toUpperCase()] || '⚪';
    msg += `<b>【信用壓力】</b> ${levelEmoji} ${escapeHtml(String(hyLevel || 'N/A'))}`;
    if (hySpread !== undefined && hySpread !== null) {
      msg += ` · HY <code>${fmt(hySpread, 2)}%</code>`;
    }
    if (hyJump !== undefined && hyJump !== null) {
      // fmt() 已在 ≥0 時自動加 + 前綴，不要重複加
      const jumpIcon = hyAcute ? ' 🔴急升' : (hyJump > 0.5 ? ' 🟡升溫' : '');
      msg += ` · 週Δ <code>${fmt(hyJump, 2)}%</code>${jumpIcon}`;
    }
    msg += `\n`;
    if (cp.headline) {
      msg += `<i>${escapeHtml(String(cp.headline))}</i>\n`;
    }
    if (cp.detail) {
      msg += `${escapeHtml(String(cp.detail))}\n`;
    }
    if (cs.regime_force) {
      msg += `<b>⚠ regime 強制 ${escapeHtml(String(cs.regime_force))}</b>\n`;
    }
    msg += `\n`;
  }

  // 3.5 今日新聞脈絡（4-6 條當日重要財經新聞，過濾過 macro 相關）
  if (Array.isArray(a.news_pulse) && a.news_pulse.length > 0) {
    msg += `<b>【今日新聞脈絡】</b>\n`;
    a.news_pulse.forEach(n => {
      const catKey = String(n.category || '').toLowerCase();
      const cat = NEWS_CATEGORY_ICON[catKey] || NEWS_CATEGORY_DEFAULT;
      const headline = escapeHtml(String(n.headline || ''));
      const source = escapeHtml(String(n.source || ''));
      const implication = escapeHtml(String(n.implication || ''));
      const sourceText = source ? ` (${source})` : '';
      msg += `${cat.emoji} [${escapeHtml(cat.label)}] ${headline}${sourceText}\n`;
      if (implication) {
        msg += `   → ${implication}\n`;
      }
    });
    msg += `\n`;
  }

  // 4. 持倉動作（locked 部位前綴 🔒，標 "監控用"）
  if (Array.isArray(a.portfolio_implications) && a.portfolio_implications.length > 0) {
    // 排序：tradeable 在前、locked 在後（locked 視覺上分組到下半段）
    const sorted = a.portfolio_implications.slice().sort((x, y) => {
      const xLocked = String(x.lock_status || '').toLowerCase() === 'locked' ? 1 : 0;
      const yLocked = String(y.lock_status || '').toLowerCase() === 'locked' ? 1 : 0;
      return xLocked - yLocked;
    });
    msg += `<b>【持倉動作】</b>\n`;
    let firstLocked = true;
    sorted.forEach(pi => {
      const isLocked = String(pi.lock_status || '').toLowerCase() === 'locked';
      if (isLocked && firstLocked) {
        msg += `<i>—— 🔒 太太代持（監控用，不操作） ——</i>\n`;
        firstLocked = false;
      }
      const lockIcon = isLocked ? '🔒 ' : '';
      const pos    = escapeHtml(String(pi.position || '—'));
      const stance = escapeHtml(String(pi.stance || '—'));
      const action = escapeHtml(String(pi.action || '—'));
      msg += `• ${lockIcon}<b>${pos}</b> · ${stance}\n   → ${action}\n`;
      if (pi.trigger_to_change && pi.trigger_to_change !== '—') {
        msg += `   <i>觸發：${escapeHtml(String(pi.trigger_to_change))}</i>\n`;
      }
    });
    msg += `\n`;
  }

  // 5. 關鍵風險
  if (Array.isArray(a.key_risks_ranked) && a.key_risks_ranked.length > 0) {
    msg += `<b>【關鍵風險】</b>\n`;
    a.key_risks_ranked.forEach(r => {
      const prob = String(r.probability || '');
      const probIcon =
        prob.indexOf('高') >= 0 ? '⚠⚠⚠' :
        prob.indexOf('中') >= 0 ? '⚠⚠' : '⚠';
      msg += `${probIcon} <b>${escapeHtml(String(r.risk || ''))}</b>\n`;
      if (r.impact) msg += `   ${escapeHtml(String(r.impact))}\n`;
    });
    msg += `\n`;
  }

  // 6. 催化劑
  if (Array.isArray(a.catalysts_24_48h) && a.catalysts_24_48h.length > 0) {
    msg += `<b>【今明 48H 催化劑】</b>\n`;
    a.catalysts_24_48h.forEach(c => {
      const dt = formatCatalystTime(c.datetime_utc);
      const evt = escapeHtml(String(c.event || ''));
      const cons = escapeHtml(String(c.consensus || '—'));
      const watch = escapeHtml(String(c.watch || ''));
      msg += `<code>${dt}</code> <b>${evt}</b>\n   共識 ${cons} | ${watch}\n`;
    });
    msg += `\n`;
  }

  // 7. 關鍵價位
  const kl = a.key_levels || {};
  const klRows = [];
  if (kl.spx) klRows.push(`SPX  <code>${fmt(kl.spx.support)}</code> / <code>${fmt(kl.spx.resistance)}</code>  現 <code>${fmt(kl.spx.current)}</code>`);
  if (kl.txf) klRows.push(`TXF  <code>${fmt(kl.txf.support)}</code> / <code>${fmt(kl.txf.resistance)}</code>  現 <code>${fmt(kl.txf.current)}</code>`);
  if (kl.vix) klRows.push(`VIX  &gt;<code>${fmt(kl.vix.trigger_high)}</code> 恐慌 / &lt;<code>${fmt(kl.vix.trigger_low)}</code> 自滿  現 <code>${fmt(kl.vix.current)}</code>`);
  if (kl.usdtwd) klRows.push(`USDTWD  <code>${fmt(kl.usdtwd.support)}</code> / <code>${fmt(kl.usdtwd.resistance)}</code>  現 <code>${fmt(kl.usdtwd.current)}</code>`);
  if (klRows.length > 0) {
    msg += `<b>【關鍵價位】</b>\n${klRows.join('\n')}\n\n`;
  }

  // 8. 翻盤條件
  if (a.what_proves_us_wrong) {
    msg += `<b>【翻盤條件】</b>\n${escapeHtml(String(a.what_proves_us_wrong))}\n\n`;
  }

  // 9. 量化參考 footer（簡版，給願意看細節的人）
  const light  = p.light || {};
  const score  = p.macro_score || {};
  const season = p.season || {};
  const gates  = p.v10_gates || {};
  msg += `<i>━━ 量化參考 ━━</i>\n`;
  msg += `${escapeHtml(String(light.label || '🟡 黃燈'))} · 總分 <code>${fmt(score.total, 1)}</code> · 穩定度 <code>${fmt(light.stability_pct, 0)}%</code>\n`;
  msg += `g=<code>${fmt(season.g_score)}</code>  i=<code>${fmt(season.i_score)}</code>  `;
  msg += `Base=<code>${fmt(score.base)}</code> Val=<code>${fmt(score.val_adj)}</code>\n`;
  msg += `D1 ${gateIcon(gates.d1_direction)} D4 ${gateIcon(gates.d4_cooldown)}`;
  if (gates.needs_tradingview_check) {
    msg += ` · D2/D3 看 TV`;
  } else {
    if (gates.d2_pattern_quality !== undefined && gates.d2_pattern_quality !== null) {
      msg += ` · D2 Q=${fmt(gates.d2_pattern_quality, 0)}${gates.d2_pass ? ' ✅' : ' ❌'}`;
    }
    if (gates.d3_volume_obv) {
      msg += ` · D3 OBV ${escapeHtml(String(gates.d3_volume_obv))} ${obvIcon(gates.d3_volume_obv, gates.d3_pass)}`;
    }
  }
  msg += `\n`;

  // 數據警告
  const dq = p.data_quality || {};
  if (Array.isArray(dq.warnings) && dq.warnings.length > 0) {
    msg += `\n⚠ <i>數據：${escapeHtml(dq.warnings.join(', '))}</i>`;
  }

  return msg;
}


/**
 * 格式化催化劑時間 (UTC ISO → MM/dd HH:mm 台北時區)
 */
function formatCatalystTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return escapeHtml(String(isoStr));
    return Utilities.formatDate(d, 'Asia/Taipei', 'MM/dd HH:mm');
  } catch (e) {
    return escapeHtml(String(isoStr));
  }
}


// ============================================================
// 舊版渲染（fallback：當 analyst_report 缺失或失敗）
// ============================================================
function formatLegacyMacroMessage(p) {
  const sessionLabel = {
    'tw_pre_open': '🌅 台股盤前',
    'us_pre_open': '🌃 美股盤前'
  }[p.session] || '快照';

  const time = Utilities.formatDate(new Date(p.timestamp), 'Asia/Taipei', 'MM/dd HH:mm');

  // 安全存取 nested fields（保留 null 才能跳過整個區段）
  const light  = p.light || null;
  const score  = p.macro_score || null;
  const season = p.season || null;
  const indi   = p.key_indicators || null;
  const gates  = p.v10_gates || null;
  const action = p.actionable || null;
  const dq     = p.data_quality || null;

  function hasAny(obj, keys) {
    if (!obj) return false;
    return keys.some(k => obj[k] !== undefined && obj[k] !== null && obj[k] !== '');
  }

  let msg = `<b>${sessionLabel} ${time}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;

  // ─── 燈號 + 分數（任一存在才印）───
  if (light || score) {
    const l = light || {};
    const s = score || {};
    if (l.force_yellow) {
      msg += `⚠ <b>強制黃燈</b>（穩定度 ${fmt(l.stability_pct, 0)}%，偏低）\n`;
      msg += `Score=<code>${fmt(s.total, 1)}</code>\n`;
    } else if (l.stagflation_override) {
      msg += `🚨 <b>${escapeHtml(String(l.label || '🔴 紅燈'))}</b>（Stagflation Override）\n`;
      msg += `Score=<code>${fmt(s.total, 1)}</code>\n`;
    } else {
      msg += `<b>${escapeHtml(String(l.label || '🟡 黃燈'))}</b>  Score=<code>${fmt(s.total, 1)}</code>\n`;
    }
    msg += `\n`;
  }

  // ─── 四季（任一軸有值才印）───
  if (hasAny(season, ['name', 'g_score', 'i_score'])) {
    msg += `<b>季節</b>: ${escapeHtml(String(season.name || '—'))}\n`;
    msg += `成長軸 <code>${fmt(season.g_score)}</code>  通膨軸 <code>${fmt(season.i_score)}</code>\n\n`;
  }

  // ─── 分數構成（任一構成項有值才印）───
  if (hasAny(score, ['base', 'val_adj', 'credit_adj', 'contrarian'])) {
    msg += `<b>分數構成</b>\n`;
    msg += `基礎 <code>${fmt(score.base)}</code>`;
    msg += ` / 估值 <code>${fmt(score.val_adj)}</code>`;
    msg += ` / 信用 <code>${fmt(score.credit_adj)}</code>`;
    msg += ` / 逆向 <code>${fmt(score.contrarian)}</code>\n\n`;
  }

  // ─── 關鍵指標（任一指標有值才印整段）───
  const indiKeys = ['vix', 'vix_term', 'erp', 'real_rate', 'yield_curve', 'oil_roc_20d', 'hy_spread'];
  if (hasAny(indi, indiKeys)) {
    msg += `<b>關鍵指標</b>\n`;
    if (indi.vix !== undefined && indi.vix !== null) {
      msg += `VIX <code>${fmt(indi.vix)}</code>`;
      if (indi.vix_term !== undefined && indi.vix_term !== null) {
        msg += `  期限 <code>${fmt(indi.vix_term)}</code>`;
        if (indi.vix_term > 1.05) msg += `⚠倒掛`;
      }
      msg += `\n`;
    }
    const erpLine = [];
    if (indi.erp !== undefined && indi.erp !== null) {
      let s = `ERP <code>${fmt(indi.erp)}%</code>`;
      if (indi.erp < 0) s += `⚠負值`;
      erpLine.push(s);
    }
    if (indi.real_rate !== undefined && indi.real_rate !== null) {
      erpLine.push(`實質利率 <code>${fmt(indi.real_rate)}%</code>`);
    }
    if (erpLine.length > 0) msg += erpLine.join('  ') + `\n`;

    if (indi.yield_curve !== undefined && indi.yield_curve !== null) {
      msg += `殖利率曲線 <code>${fmt(indi.yield_curve)}</code>`;
      if (indi.bear_steepening) msg += `⚠Bear Steep`;
      msg += `\n`;
    }
    const oilHy = [];
    if (indi.oil_roc_20d !== undefined && indi.oil_roc_20d !== null) {
      oilHy.push(`油 ROC <code>${fmt(indi.oil_roc_20d)}%</code>`);
    }
    if (indi.hy_spread !== undefined && indi.hy_spread !== null) {
      oilHy.push(`HY <code>${fmt(indi.hy_spread)}%</code>`);
    }
    if (oilHy.length > 0) msg += oilHy.join('  ') + `\n`;
    msg += `\n`;
  }

  // ─── v10 四門（任一門有值才印）───
  if (hasAny(gates, ['d1_direction', 'd2_pattern_quality', 'd3_volume_obv', 'd4_cooldown', 'needs_tradingview_check'])) {
    const g = gates;
    msg += `<b>v10 四門</b>\n`;
    const d1 = g.d1_direction ? gateIcon(g.d1_direction) : '—';
    const d4 = g.d4_cooldown ? gateIcon(g.d4_cooldown) : '—';
    msg += `D1 方向 ${d1}  D4 冷卻 ${d4}\n`;
    if (g.needs_tradingview_check) {
      msg += `D2 型態 / D3 量能 → 📊 開 TradingView 看\n`;
    } else {
      if (g.d2_pattern_quality !== undefined && g.d2_pattern_quality !== null) {
        msg += `D2 型態 Q=${fmt(g.d2_pattern_quality, 0)} ${g.d2_pass ? '✅' : '❌'}\n`;
      }
      if (g.d3_volume_obv) {
        msg += `D3 OBV ${escapeHtml(String(g.d3_volume_obv))} ${obvIcon(g.d3_volume_obv, g.d3_pass)}\n`;
      }
    }
    msg += `\n`;
  }

  // ─── 行動建議 ───
  if (action) {
    if (action.recommended_action) {
      msg += `<b>行動</b>: ${escapeHtml(String(action.recommended_action))}\n`;
    }
    if (action.summary) {
      msg += `${escapeHtml(String(action.summary))}\n`;
    }
    if (Array.isArray(action.key_risks) && action.key_risks.length > 0) {
      msg += `\n<b>風險</b>:\n`;
      action.key_risks.forEach(r => {
        msg += `• ${escapeHtml(String(r))}\n`;
      });
    }
  }

  // ─── 數據品質警告 ───
  if (dq && Array.isArray(dq.warnings) && dq.warnings.length > 0) {
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

/** D3 圖示：flat=⚪（中性），對齊 D1 方向=✅，反向=❌ */
function obvIcon(direction, pass) {
  const dir = String(direction || '').toLowerCase();
  if (dir === 'flat' || dir === '') return '⚪';
  return pass ? '✅' : '❌';
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

/** 測試 IB 分析師格式（含 analyst_report 物件） */
function testMacroSnapshotAnalyst() {
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
        macro_score: { total: -17.6, base: 0, val_adj: -17.6, credit_adj: 0, contrarian: 0 },
        season: { name: '🟡 轉換期', g_score: 0.5, i_score: 0.6 },
        light: { color: 'yellow', label: '🟡 黃燈', stability_pct: 57, force_yellow: false, stagflation_override: false },
        key_indicators: { vix: 17.83, erp: -0.79, real_rate: 1.91, hy_spread: 2.84, yield_curve: 0.45, oil_roc_20d: 3.4 },
        v10_gates: {
          d1_direction: 'no_entry',
          d2_pattern_quality: 78,
          d2_pass: true,
          d3_volume_obv: 'up',
          d3_pass: false,
          d4_cooldown: 'ok',
          needs_tradingview_check: false,
          v10_state_age_sec: 312
        },
        credit_stress: {
          hy_spread_pct: 3.62,
          hy_pressure_level: 'WARNING',
          hy_weekly_jump_pct: 0.42,
          hy_acute_event: false,
          regime_force: 'WARNING'
        },
        actionable: {
          summary: '黃燈待機',
          key_risks: ['Core PCE', '消費信心', 'ERP 負值'],
          recommended_action: '不主動進場'
        },
        analyst_report: {
          headline: '🟡 黃燈待機 — 估值頂 + 消費信心歷史新低',
          credit_pressure: {
            level: 'WARNING',
            headline: 'HY 升至 3.62%，私人信貸限贖風險升溫',
            detail: '本週升 42bp（未到 acute），Apollo / Ares Q1 限贖延續；regime 強制 WARNING'
          },
          top_call: {
            stance: 'neutral_defensive',
            stance_label: '中性偏防禦',
            conviction: 'HIGH',
            horizon: '1-2 weeks',
            one_liner: 'ERP 已負值無估值安全邊際；消費信心 49.8 暗示需求面崩盤'
          },
          regime_narrative: {
            growth: '邊界訊號 g=+0.5。ISM 仍 >52 但消費信心歷史新低，5/2 NFP 是引信。',
            inflation: 'ISM 物價 78.3 近 4 年高，i=+0.6 距 Stagflation 觸發還有 0.9。',
            valuation_credit: 'SPX PE 28.1、CAPE 39.6 雙重高估，ERP -0.79% 股票無吸引力。'
          },
          news_pulse: [
            { headline: 'Powell 偏鷹發言暗示 6 月不降息', source: 'Bloomberg', category: 'monetary_policy', implication: 'DXY 短彈、SPX 跌 0.8%；對 00632R 加碼有利', impacted_tickers: ['00632R', 'SPX'] },
            { headline: 'OPEC+ 6 月會議延後決議產量', source: 'Reuters', category: 'oil_energy', implication: '油價平週橫盤；IXC 短期無 catalyst', impacted_tickers: ['IXC'] },
            { headline: '美擬擴大對中 HBM 出口管制', source: 'WSJ', category: 'semis', implication: '2330 / 9660 短期承壓，長期份額不變', impacted_tickers: ['2330', '9660'] },
            { headline: '以色列伊朗停火延長 30 天', source: '中央社', category: 'geopolitics', implication: 'IXC 平倉訊號正在積分', impacted_tickers: ['IXC'] }
          ],
          portfolio_implications: [
            { position: '2330 台積電', stance: '持有', action: 'Core 不動', trigger_to_change: '若 SPX 跌破 5450 重評' },
            { position: '2382 廣達', stance: '獲利減碼', action: '+30% 出 1,100 股', trigger_to_change: '若見 350 元' },
            { position: '1810 小米', stance: '認賠分批', action: '5/27 Q1 財報前出 50%', trigger_to_change: '—' },
            { position: '00632R 反一', stance: '加碼', action: '若 ERP <-1 加 10K', trigger_to_change: 'ERP 跌破 -1' }
          ],
          key_risks_ranked: [
            { rank: 1, risk: '4/30 Core PCE March', impact: '若 >3.0% i_score 升至 +1.2', probability: '中' },
            { rank: 2, risk: '消費信心 49.8 歷史新低', impact: '5月零售業績下修', probability: '高' },
            { rank: 3, risk: 'ERP 持續負值', impact: 'SPX 修正 5-10%', probability: '中' }
          ],
          catalysts_24_48h: [
            { datetime_utc: '2026-04-30T12:30Z', event: 'Core PCE March', consensus: '3.0%', watch: '若 >3.1% Stagflation 警報' },
            { datetime_utc: '2026-05-01T14:00Z', event: 'ISM Manufacturing April', consensus: '52.5', watch: 'Prices Paid 是否仍 >65' }
          ],
          key_levels: {
            spx: { support: 5450, resistance: 5800, current: 5620 },
            txf: { support: 21000, resistance: 22500, current: 21800 },
            vix: { trigger_high: 25, trigger_low: 15, current: 17.83 }
          },
          what_proves_us_wrong: '若 5/2 NFP > 220K 且 ISM Prices < 60 → 黃燈轉綠'
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
        target: 21805.00,
        target_r: 1.5,
        regime: 'WARNING',
        regime_base: 'NORMAL',
        regime_upgrade_reason: 'HY 信用壓力 (3.62%)',
        hy_pressure_level: 'WARNING',
        hy_weekly_jump: 0.42,
        hy_acute_event: false,
        timestamp: String(Date.now())
      })
    }
  };

  const result = doPost(fakeEvent);
  console.log('Result:', result.getContent());
}

/** 模擬 Routine 送 earnings_report alert */
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
        earnings_date: '2026-05-21',
        fiscal_period: 'Q1 FY26',
        release_time_local: '盤後 16:30 NY',
        eps_estimate: '$0.84',
        rev_estimate: '$43.1B',
        shares: 50,
        avg_cost: 145.20,
        current_price: 178.50,
        action_hint: '財報前避免加碼，IV 已偏高'
      })
    }
  };
  const result = doPost(fakeEvent);
  console.log('Result:', result.getContent());
}

/** 模擬 Routine 送 earnings_report summary */
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
        earnings_date: '2026-05-21',
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
        shares: 50,
        avg_cost: 145.20,
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
  console.log('Result:', result.getContent());
}

/** 模擬 Routine 拉 watchlist */
function testReadWatchlist() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ROUTINE_TOKEN');
  const fakeEvent = {
    parameter: { endpoint: 'read_watchlist' },
    postData: { contents: JSON.stringify({ token: token }) }
  };
  const result = doPost(fakeEvent);
  console.log('Result:', result.getContent());
}

/** 模擬 Pine 推 v10_state snapshot */
function testV10State() {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('PINE_ALERT_SECRET');
  const fakeEvent = {
    parameter: { endpoint: 'v10_state' },
    postData: {
      contents: JSON.stringify({
        secret: secret,
        ticker: 'TAIFEX:TXF1!',
        timeframe: '60',
        price: 21820.00,
        pattern: '雙重底',
        quality: 78,
        obv_direction: 'up',
        atr: 145.50,
        regime: 'WARNING',
        regime_base: 'NORMAL',
        regime_upgrade_reason: 'HY 信用壓力 (3.62%)',
        hy_pressure_level: 'WARNING',
        hy_weekly_jump: 0.42,
        hy_acute_event: false,
        timestamp: String(Date.now())
      })
    }
  };
  const result = doPost(fakeEvent);
  console.log('Result:', result.getContent());
}

/** 模擬 Routine 拉最新 v10_state（先跑 testV10State 寫入再跑這個） */
function testReadV10State() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ROUTINE_TOKEN');
  const fakeEvent = {
    parameter: { endpoint: 'read_v10_state' },
    postData: { contents: JSON.stringify({ token: token, ticker: 'TAIFEX:TXF1!' }) }
  };
  const result = doPost(fakeEvent);
  console.log('Result:', result.getContent());
}

/**
 * 模擬空殼 payload — 應該被新加的 4th-layer guard 擋下並推一條警告
 * 預期回傳：{"ok":false,"error":"empty_payload","session":"manual_test"}
 * 預期 Telegram：⚠ 收到空 payload + 排查清單
 */
function testEmptyPayload() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ROUTINE_TOKEN');
  // 用唯一 session 避開既有 dedup 紀錄（例如今天已經被舊版空殼佔用了
  // manual_test_yyyy-MM-dd 的位子）；同時確保 empty check 在 dedup 之前發生
  const uniqSession = 'test_empty_' + Date.now();
  const fakeEvent = {
    parameter: { endpoint: 'macro_snapshot' },
    postData: {
      contents: JSON.stringify({
        token: token,
        timestamp: new Date().toISOString(),
        session: uniqSession
        // 故意 — 沒 light / macro_score / season / analyst_report
      })
    }
  };
  const result = doPost(fakeEvent);
  const body = result.getContent();
  console.log('Result:', body);
  console.log('預期：{"ok":false,"error":"empty_payload","session":"' + uniqSession + '"}');
  console.log('Telegram 應收到：⚠ 收到空 payload 警告');
  if (body.indexOf('empty_payload') >= 0) {
    console.log('✅ Empty-payload guard 工作正常');
  } else if (body.indexOf('dedup') >= 0) {
    console.log('❌ 被 dedup 攔下 — 表示部署的 GAS 還是舊順序（應先 empty check 再 dedup）。');
    console.log('   → 重新貼一次 macro_snapshot_handler.gs 並 Save，再跑這個函數');
  } else {
    console.log('❌ 非預期回應，貼 Result 給 Claude debug');
  }
}

/**
 * 部署健檢 — 一鍵診斷整個 macro snapshot pipeline 是否工作
 * 在 Apps Script 編輯器選 dryRunDoctor → Run，看 console 報告
 */
function dryRunDoctor() {
  const lines = [];
  const props = PropertiesService.getScriptProperties();
  const checks = {
    'ROUTINE_TOKEN':     !!props.getProperty('ROUTINE_TOKEN'),
    'PINE_ALERT_SECRET': !!props.getProperty('PINE_ALERT_SECRET'),
    'TELEGRAM_BOT_TOKEN':!!props.getProperty('TELEGRAM_BOT_TOKEN'),
    'TELEGRAM_CHAT_ID':  !!props.getProperty('TELEGRAM_CHAT_ID'),
    'MACRO_SHEET_ID':    !!props.getProperty('MACRO_SHEET_ID')
  };
  Object.keys(checks).forEach(k => {
    lines.push(`${checks[k] ? '✅' : '❌'} Script Property ${k}`);
  });

  // Sheet check
  try {
    const ss = SpreadsheetApp.openById(props.getProperty('MACRO_SHEET_ID'));
    ['dedup_state', 'macro_log', 'signal_log', 'earnings_watchlist', 'v10_state'].forEach(name => {
      const sh = ss.getSheetByName(name);
      lines.push(`${sh ? '✅' : '❌'} Sheet "${name}"`);
    });
  } catch (err) {
    lines.push(`❌ 開不了 spreadsheet: ${err.message}`);
  }

  // 函數可達性 check（catch ReferenceError if file paste 不完整）
  const fns = [
    'handleMacroSnapshot', 'handleV10Signal', 'handleV10State', 'handleReadV10State',
    'handleEarningsReport', 'handleReadWatchlist',
    'formatAnalystReport', 'formatLegacyMacroMessage',
    'sendTelegramHtml', 'fmt', 'escapeHtml', 'gateIcon', 'obvIcon'
  ];
  fns.forEach(name => {
    try {
      const fn = eval(name);  // jshint ignore:line
      lines.push(`${typeof fn === 'function' ? '✅' : '❌'} fn ${name}`);
    } catch (e) {
      lines.push(`❌ fn ${name} (NOT defined — paste 可能不完整)`);
    }
  });

  // 4th-layer empty-payload guard 是否存在
  const handlerSrc = String(handleMacroSnapshot);
  lines.push(`${handlerSrc.indexOf('empty_payload') >= 0 ? '✅' : '❌'} empty_payload guard (4th layer)`);

  const report = lines.join('\n');
  console.log(report);
  console.log('\n如果有 ❌：對照 README/runbook 修補；全 ✅ 才表示 GAS 端完整。');
  return report;
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
// Snowball CSV → earnings_watchlist 自動同步
// ============================================================
/**
 * 從 Drive folder 抓最新的 Snowball CSV，加總 BUY/SELL 算出當前持倉，
 * 更新 earnings_watchlist sheet（既有 ticker 改 shares/avg_cost，新 ticker append，淨股=0 標 exit_at）。
 *
 * 用法：
 *   1. 設 Script Property SNOWBALL_FOLDER_ID = <Drive folder ID>
 *   2. 把 Snowball 匯出的 CSV 拖進那個 folder
 *   3. Apps Script 編輯器選 syncFromSnowball → Run
 *
 * Snowball CSV header: Event, Date, Symbol, Price, Quantity, Currency, FeeTax, Exchange, FeeCurrency, DoNotAdjustCash, Note
 * Event 種類：BUY / SELL / CASH_IN / DIVIDEND / SPLIT 等。本函數只處理 BUY / SELL。
 *
 * 注意：
 *   - Snowball 把台股 ETF 的開頭 0 砍掉（006208 → 6208）→ 用 strip-leading-zero 配對
 *   - avg_cost 用所有 BUY 事件的加權平均（不做 FIFO/LIFO）→ 估算用，誤差可接受
 *   - 既有 ticker 用「strip 前導 0 + 大寫」當 key 配對；新 ticker 用 Snowball 原樣寫入
 */
function syncFromSnowball() {
  const props = PropertiesService.getScriptProperties();
  const FOLDER_ID = props.getProperty('SNOWBALL_FOLDER_ID');
  if (!FOLDER_ID) {
    throw new Error('SNOWBALL_FOLDER_ID 未設定 → Project Settings → Script properties → Add property');
  }
  const SHEET_ID = props.getProperty('MACRO_SHEET_ID');
  if (!SHEET_ID) throw new Error('MACRO_SHEET_ID 未設定');

  // 1. 從 folder 找最新的 CSV（用 lastUpdated 時間）
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const allFiles = folder.getFiles();
  let latestFile = null, latestTime = 0;
  while (allFiles.hasNext()) {
    const f = allFiles.next();
    const name = f.getName().toLowerCase();
    if (!name.endsWith('.csv') && !name.includes('snowball')) continue;
    const t = f.getLastUpdated().getTime();
    if (t > latestTime) { latestTime = t; latestFile = f; }
  }
  if (!latestFile) {
    throw new Error('Drive folder 內找不到 CSV（folder ID: ' + FOLDER_ID + '）');
  }
  console.log('📂 抓到檔案: ' + latestFile.getName());
  console.log('   修改時間: ' + latestFile.getLastUpdated());

  // 2. 解析 CSV
  const csv = latestFile.getBlob().getDataAsString('UTF-8');
  const rows = Utilities.parseCsv(csv);
  if (rows.length < 2) throw new Error('CSV 是空的或只有 header');

  const header = rows[0].map(h => String(h).trim());
  const colIdx = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error('CSV 缺欄位: ' + name + '（header=' + header.join(',') + '）');
    return i;
  };
  const cE = colIdx('Event'), cD = colIdx('Date'), cS = colIdx('Symbol'),
        cP = colIdx('Price'), cQ = colIdx('Quantity'), cC = colIdx('Currency');

  // 3. 加總 BUY/SELL by Symbol
  const positions = {};  // symbol → { buys: [], sells: [], currency }
  let skippedRows = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const event = String(r[cE] || '').trim().toUpperCase();
    if (event !== 'BUY' && event !== 'SELL') { skippedRows++; continue; }

    const symbol = String(r[cS] || '').trim();
    if (!symbol) continue;
    const price = parseFloat(r[cP]);
    const qty = parseFloat(r[cQ]);
    if (!isFinite(price) || !isFinite(qty)) continue;

    const date = String(r[cD] || '').split(' ')[0];  // strip "0:00:00" 部分
    const currency = String(r[cC] || '').trim().toUpperCase();

    if (!positions[symbol]) positions[symbol] = { buys: [], sells: [], currency: currency };
    if (event === 'BUY')  positions[symbol].buys.push({ price: price, qty: qty, date: date });
    else                  positions[symbol].sells.push({ price: price, qty: qty, date: date });
  }
  console.log('   解析完成: ' + Object.keys(positions).length + ' 個 Symbol，跳過 ' + skippedRows + ' 列（CASH_IN/DIVIDEND 等）');

  // 4. 計算當前持倉
  const holdings = [];
  for (const sym in positions) {
    const p = positions[sym];
    const buyQty  = p.buys.reduce((s, b) => s + b.qty, 0);
    const sellQty = p.sells.reduce((s, b) => s + b.qty, 0);
    const netQty  = buyQty - sellQty;
    if (buyQty === 0) continue;

    const avgCost = p.buys.reduce((s, b) => s + b.price * b.qty, 0) / buyQty;
    const lastSellDate = p.sells.length
      ? p.sells.map(b => b.date).sort().pop()
      : '';

    holdings.push({
      symbol: sym,
      currency: p.currency,
      shares: Math.round(netQty * 1000) / 1000,
      avg_cost: Math.round(avgCost * 100) / 100,
      exit_at: netQty > 0.0001 ? '' : lastSellDate,
    });
  }

  // 5. 更新 earnings_watchlist
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('earnings_watchlist');
  if (!sh) throw new Error('earnings_watchlist sheet 不存在 → 先跑 setupCheck()');
  const data = sh.getDataRange().getValues();
  const wlH = data[0];
  const wIdx = (name) => {
    const i = wlH.indexOf(name);
    if (i < 0) throw new Error('watchlist 缺欄位: ' + name);
    return i;
  };
  const wT = wIdx('ticker'), wM = wIdx('market'), wS = wIdx('shares'),
        wC = wIdx('avg_cost'), wA = wIdx('added_at'), wE = wIdx('exit_at'),
        wN = wIdx('note');

  // build lookup: 砍前導 0 + 大寫，handle 006208 ↔ 6208
  const rowByKey = {};
  for (let i = 1; i < data.length; i++) {
    const t = String(data[i][wT] || '').trim();
    if (!t) continue;
    rowByKey[normalizeTicker(t)] = i;
  }

  let updated = 0, added = 0, exited = 0, skipped = 0;
  for (const h of holdings) {
    const key = normalizeTicker(h.symbol);
    const market = currencyToMarket(h.currency);
    const rowI = rowByKey[key];

    if (rowI !== undefined) {
      sh.getRange(rowI + 1, wS + 1).setValue(h.shares);
      sh.getRange(rowI + 1, wC + 1).setValue(h.avg_cost);
      if (h.exit_at) {
        const existingExit = String(data[rowI][wE] || '').trim();
        if (!existingExit) {
          sh.getRange(rowI + 1, wE + 1).setValue(h.exit_at);
          exited++;
        }
      }
      updated++;
      console.log('  ✏ 更新 ' + h.symbol + ' shares=' + h.shares + ' avg_cost=' + h.avg_cost + (h.exit_at ? ' (exit ' + h.exit_at + ')' : ''));
    } else {
      // 新 ticker — append
      const newRow = new Array(wlH.length).fill('');
      newRow[wT] = h.symbol;
      newRow[wM] = market;
      newRow[wS] = h.shares;
      newRow[wC] = h.avg_cost;
      newRow[wA] = new Date().toISOString().split('T')[0];
      newRow[wE] = h.exit_at || '';
      newRow[wN] = '';
      sh.appendRow(newRow);
      added++;
      console.log('  ➕ 新增 ' + h.symbol + ' (' + market + ') shares=' + h.shares + ' avg_cost=' + h.avg_cost);
    }
  }

  console.log('');
  console.log('✅ Snowball sync 完成');
  console.log('   檔案: ' + latestFile.getName());
  console.log('   更新: ' + updated + ' 檔');
  console.log('   新增: ' + added + ' 檔');
  console.log('   標記 exit: ' + exited + ' 檔');
}

function normalizeTicker(s) {
  return String(s).trim().toUpperCase().replace(/^0+/, '');
}

function currencyToMarket(ccy) {
  const m = String(ccy).toUpperCase();
  if (m === 'TWD') return 'TW';
  if (m === 'HKD') return 'HK';
  if (m === 'USD') return 'US';
  return m || 'US';
}

/** 測試 syncFromSnowball：只跑 dry-run，印出 Drive 找到的檔 + 解析結果，不寫 sheet */
function testSnowballDryRun() {
  const props = PropertiesService.getScriptProperties();
  const FOLDER_ID = props.getProperty('SNOWBALL_FOLDER_ID');
  if (!FOLDER_ID) { console.log('⚠ SNOWBALL_FOLDER_ID 未設定'); return; }

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.getFiles();
  let latestFile = null, latestTime = 0;
  while (files.hasNext()) {
    const f = files.next();
    const t = f.getLastUpdated().getTime();
    if (t > latestTime) { latestTime = t; latestFile = f; }
    console.log('  • ' + f.getName() + ' (updated ' + f.getLastUpdated() + ')');
  }
  if (!latestFile) { console.log('⚠ folder 內無檔案'); return; }
  console.log('\n📂 將處理: ' + latestFile.getName());

  const csv = latestFile.getBlob().getDataAsString('UTF-8');
  const rows = Utilities.parseCsv(csv);
  console.log('   總列數: ' + rows.length + '（含 header）');
  console.log('   Header: ' + rows[0].join(' | '));
  console.log('   前 3 筆:');
  for (let i = 1; i <= Math.min(3, rows.length - 1); i++) {
    console.log('     ' + rows[i].join(' | '));
  }
}


// ============================================================
// Watchlist cleanup — 標記 ETF / closed / 負值，讓 routine 跳過
// ============================================================
/**
 * 跑完 syncFromSnowball 後執行，清理 watchlist 的 note 欄。
 * Routine 看到 note 含 "skip" 或 "no earnings" 會自動跳過。
 *
 * 規則（優先順序）：
 *   1. ETF（TW 開頭 "00xxx" / US 已知 ETF 名單）→ "ETF (no earnings) — skip"
 *   2. shares < 0（CSV 缺早期 BUY）→ "⚠ 負值 — skip（CSV 不完整）"
 *   3. shares === 0 且 note 沒有 skip 字樣 → 加 "closed (skip)" 後綴
 *   4. shares > 0 → 不動
 *
 * 不會覆寫 shares / avg_cost / exit_at — 只動 note 欄。
 */
function cleanWatchlist() {
  const props = PropertiesService.getScriptProperties();
  const SHEET_ID = props.getProperty('MACRO_SHEET_ID');
  if (!SHEET_ID) throw new Error('MACRO_SHEET_ID 未設定');

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName('earnings_watchlist');
  if (!sh) throw new Error('earnings_watchlist sheet 不存在');

  const data = sh.getDataRange().getValues();
  const wlH = data[0];
  const wIdx = (n) => wlH.indexOf(n);
  const wT = wIdx('ticker'), wM = wIdx('market'), wS = wIdx('shares'), wN = wIdx('note');
  const wExit = wIdx('exit_at'), wLock = wIdx('lock_status'), wType = wIdx('asset_type');
  if (wT < 0 || wM < 0 || wS < 0 || wN < 0) {
    throw new Error('watchlist 缺基本欄位（ticker / market / shares / note）');
  }
  const hasNewCols = wLock >= 0 && wType >= 0;

  let etfMarked = 0, closedMarked = 0, negFlagged = 0, lockDefaulted = 0, typeInferred = 0;
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');

  for (let i = 1; i < data.length; i++) {
    const ticker = String(data[i][wT] || '').trim();
    if (!ticker) continue;
    const market = String(data[i][wM] || '').trim().toUpperCase();
    const shares = parseFloat(data[i][wS]);
    const existing = String(data[i][wN] || '').trim();

    // ─── 新欄位：asset_type / lock_status 自動推斷 ───
    if (hasNewCols) {
      const curType = String(data[i][wType] || '').trim().toLowerCase();
      const curLock = String(data[i][wLock] || '').trim().toLowerCase();
      if (!curType) {
        const inferred = inferAssetType(ticker, market);
        sh.getRange(i + 1, wType + 1).setValue(inferred);
        typeInferred++;
        console.log('  ✏ ' + ticker + ' asset_type → ' + inferred);
      }
      if (!curLock) {
        sh.getRange(i + 1, wLock + 1).setValue('tradeable');
        lockDefaulted++;
        console.log('  ✏ ' + ticker + ' lock_status → tradeable (default)');
      }
    }

    // ─── note 欄維護 + exit_at 標記 ───
    let newNote = null, reason = null;

    // Rule 1: 負股數警告（CSV history 缺早期 BUY）
    if (isFinite(shares) && shares < 0) {
      if (!existing.includes('負值')) {
        newNote = '⚠ 負值（CSV 不完整，請手動補早期 BUY）';
        reason = 'neg';
      }
    }
    // Rule 2: shares=0 → 自動標 exit_at（如果還沒標）
    else if (isFinite(shares) && shares === 0 && wExit >= 0) {
      const curExit = String(data[i][wExit] || '').trim();
      if (!curExit) {
        sh.getRange(i + 1, wExit + 1).setValue(today);
        closedMarked++;
        console.log('  ✏ ' + ticker + ' exit_at → ' + today);
      }
    }
    // Rule 3（舊 sheet 相容）：沒有 asset_type 欄時用舊邏輯把 ETF 標進 note
    else if (!hasNewCols) {
      const inferred = inferAssetType(ticker, market);
      if (inferred === 'etf' && !existing.toLowerCase().includes('no earnings')) {
        newNote = 'ETF (no earnings) — skip';
        reason = 'etf';
      }
    }

    if (newNote && newNote !== existing) {
      sh.getRange(i + 1, wN + 1).setValue(newNote);
      if (reason === 'etf') etfMarked++;
      else if (reason === 'neg') negFlagged++;
    }
  }

  console.log('');
  console.log('✅ Watchlist cleanup 完成');
  if (hasNewCols) {
    console.log('   asset_type 自動推斷: ' + typeInferred);
    console.log('   lock_status 預設 tradeable: ' + lockDefaulted);
  } else {
    console.log('   ETF note 標記: ' + etfMarked);
  }
  console.log('   exit_at 自動標記（shares=0）: ' + closedMarked);
  console.log('   負值警告: ' + negFlagged);
}


/**
 * 從 ticker + market 推斷 asset_type ('stock' | 'etf')
 *
 * 規則：
 *   TW: 4 碼 + 開頭 "00" → ETF（00xxx 是台股 ETF 慣例）
 *   US: 命中 KNOWN_US_ETF 名單 → ETF
 *   HK: 一律當 stock（Cross 的 watchlist 沒港股 ETF）
 *   其他 → stock
 */
function inferAssetType(ticker, market) {
  if (!ticker) return 'stock';
  const t = String(ticker).toUpperCase();
  const m = String(market || '').toUpperCase();

  if (m === 'TW' && /^00\d/.test(t)) return 'etf';

  const KNOWN_US_ETF = new Set([
    'VOO','VTI','QQQ','SPY','IWM','DIA','EEM','EWT','EWY','EWJ','EWZ',
    'XLF','XLE','XLK','XLV','XLY','XLP','XLI','XLU','XLB','XLC',
    'ARKW','ARKK','ARKG','ARKF','ARKQ','EMQQ','IDRV','IXC','SOXX',
    'TQQQ','SQQQ','UPRO','SPXU','SOXL','SOXS','TNA','TZA','UVXY','SVXY'
  ]);
  if (m === 'US' && KNOWN_US_ETF.has(t)) return 'etf';

  return 'stock';
}
