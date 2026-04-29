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
    const sheets = ['macro_log', 'signal_log', 'dedup_state', 'earnings_watchlist', 'earnings_log'];
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
          sh.appendRow(['ticker', 'market', 'shares', 'avg_cost', 'added_at', 'exit_at', 'note']);
          // 預填 Cross 已開倉過的 11 檔（shares/avg_cost 留空 → 你自己補）
          // ETF / 反向 ETF 不發財報，標 skip
          const seed = [
            ['2330',   'TW', '', '', '2025', '', '台積電'],
            ['006208', 'TW', '', '', '2025', '', 'ETF (no earnings) — skip'],
            ['2382',   'TW', '', '', '2025', '', '廣達'],
            ['9660',   'TW', '', '', '2025', '', ''],
            ['00632R', 'TW', '', '', '2025', '', 'ETF (no earnings) — skip'],
            ['1810',   'HK', '', '', '2025', '', '小米（港股，HKEX）'],
            ['QQQ',    'US', '', '', '2025', '', 'ETF (no earnings) — skip'],
            ['NFLX',   'US', '', '', '2025', '', ''],
            ['NVDA',   'US', '', '', '2025', '', ''],
            ['VOO',    'US', '', '', '2025', '', 'ETF (no earnings) — skip'],
            ['VTI',    'US', '', '', '2025', '', 'ETF (no earnings) — skip'],
            ['IXC',    'US', '', '', '2026-04-21', '', 'ETF (no earnings) — skip / 能源對沖']
          ];
          seed.forEach(row => sh.appendRow(row));
          console.log('  → 已預填 12 列（請自行補 shares / avg_cost）');
        } else if (name === 'earnings_log') {
          sh.appendRow(['timestamp', 'ticker', 'type', 'earnings_date',
                        'eps_actual', 'eps_estimate', 'rev_actual', 'rev_estimate',
                        'price_reaction_pct', 'summary_text']);
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
    const rows = sh.getRange(2, 1, lastRow - 1, 7).getValues();  // 7 columns
    const watchlist = rows.map(r => ({
      ticker:   String(r[0] || '').trim(),
      market:   String(r[1] || '').trim(),
      shares:   r[2] === '' || r[2] === null ? null : Number(r[2]),
      avg_cost: r[3] === '' || r[3] === null ? null : Number(r[3]),
      added_at: r[4] ? String(r[4]) : null,
      exit_at:  r[5] ? String(r[5]) : null,
      note:     String(r[6] || '').trim()
    })).filter(x => x.ticker !== '');

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
  let msg = `📅 <b>明日財報提醒</b>  ${escapeHtml(String(p.earnings_date))}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>${escapeHtml(String(p.ticker))}</b>`;
  if (p.company_name) msg += `  ${escapeHtml(String(p.company_name))}`;
  if (marketLabel)    msg += `  <i>${escapeHtml(marketLabel)}</i>`;
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
  msg += `• 不過 earnings → 盤前/收盤前出\n`;
  msg += `• 過 earnings → IB 設 OCO 保護\n`;
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

  // 4. 持倉動作
  if (Array.isArray(a.portfolio_implications) && a.portfolio_implications.length > 0) {
    msg += `<b>【持倉動作】</b>\n`;
    a.portfolio_implications.forEach(pi => {
      const pos    = escapeHtml(String(pi.position || '—'));
      const stance = escapeHtml(String(pi.stance || '—'));
      const action = escapeHtml(String(pi.action || '—'));
      msg += `• <b>${pos}</b> · ${stance}\n   → ${action}\n`;
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
  if (gates.needs_tradingview_check) msg += ` · D2/D3 看 TV`;
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
        v10_gates: { d1_direction: 'no_entry', d4_cooldown: 'ok', needs_tradingview_check: true },
        actionable: {
          summary: '黃燈待機',
          key_risks: ['Core PCE', '消費信心', 'ERP 負值'],
          recommended_action: '不主動進場'
        },
        analyst_report: {
          headline: '🟡 黃燈待機 — 估值頂 + 消費信心歷史新低',
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
  const wIdx = (n) => {
    const i = wlH.indexOf(n);
    if (i < 0) throw new Error('watchlist 缺欄位: ' + n);
    return i;
  };
  const wT = wIdx('ticker'), wM = wIdx('market'), wS = wIdx('shares'), wN = wIdx('note');

  // 已知 US ETF / 槓桿 / 反向 ETF（補充用，TW 用 00 prefix 自動偵測）
  const KNOWN_US_ETF = new Set([
    'VOO','VTI','QQQ','SPY','IWM','DIA','EEM','EWT','EWY','EWJ','EWZ',
    'XLF','XLE','XLK','XLV','XLY','XLP','XLI','XLU','XLB','XLC',
    'ARKW','ARKK','ARKG','ARKF','ARKQ','EMQQ','IDRV','IXC','SOXX',
    'TQQQ','SQQQ','UPRO','SPXU','SOXL','SOXS','TNA','TZA','UVXY','SVXY'
  ]);

  let etfMarked = 0, closedMarked = 0, negFlagged = 0;
  for (let i = 1; i < data.length; i++) {
    const ticker = String(data[i][wT] || '').trim();
    if (!ticker) continue;
    const market = String(data[i][wM] || '').trim().toUpperCase();
    const shares = parseFloat(data[i][wS]);
    const existing = String(data[i][wN] || '').trim();

    let newNote = null, reason = null;

    // Rule 1: ETF (top priority — never has earnings)
    const isTwETF = market === 'TW' && /^00\d/.test(ticker);
    const isUsETF = market === 'US' && KNOWN_US_ETF.has(ticker.toUpperCase());
    if (isTwETF || isUsETF) {
      if (!existing.toLowerCase().includes('no earnings')) {
        newNote = 'ETF (no earnings) — skip';
        reason = 'etf';
      }
    }
    // Rule 2: negative shares (CSV history incomplete)
    else if (isFinite(shares) && shares < 0) {
      if (!existing.includes('負值')) {
        newNote = '⚠ 負值 — skip（CSV 不完整，請手動補早期 BUY）';
        reason = 'neg';
      }
    }
    // Rule 3: closed position
    else if (isFinite(shares) && shares === 0) {
      const lower = existing.toLowerCase();
      if (!lower.includes('skip') && !lower.includes('closed')) {
        newNote = existing
          ? existing + ' — closed (skip)'
          : 'closed (skip)';
        reason = 'closed';
      }
    }

    if (newNote && newNote !== existing) {
      sh.getRange(i + 1, wN + 1).setValue(newNote);
      if (reason === 'etf')    etfMarked++;
      else if (reason === 'neg')    negFlagged++;
      else if (reason === 'closed') closedMarked++;
      console.log('  ✏ ' + ticker + ' → ' + newNote);
    }
  }

  console.log('');
  console.log('✅ Watchlist cleanup 完成');
  console.log('   ETF 標記: ' + etfMarked);
  console.log('   Closed 標記: ' + closedMarked);
  console.log('   負值警告: ' + negFlagged);
}
