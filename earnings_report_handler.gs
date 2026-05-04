/**
 * GAS Earnings Report endpoints for Claude Code Routine
 *
 * Version: 1.0
 *
 * 整合指引：把以下兩行加進現有 doPost() 路由段（在 handleTelegramUpdate 之前）：
 *
 *   if (endpoint === 'read_watchlist')  return handleReadWatchlist(e);
 *   if (endpoint === 'earnings_report') return handleEarningsReport(e);
 *
 * 依賴（同一個 GAS 專案的 macro_snapshot_handler.gs 提供）：
 *   fmt(), escapeHtml(), safe(), jsonResp(), sendTelegramHtml()
 *
 * Script Properties（沿用 macro 已設的）：
 *   ROUTINE_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, MACRO_SHEET_ID
 *
 * 新增 Sheets：執行 setupEarningsSheets() 自動建立
 *   earnings_watchlist  — Single source of truth，Cross 手動維護
 *   earnings_log        — 每次推播記錄
 *   earnings_dedup      — 防重複推播
 *
 * ⚠ GAS V8 runtime 必要（Project Settings → Runtime version → V8）
 */


// ============================================================
// Read Watchlist endpoint
// POST ?endpoint=read_watchlist  { "token": "..." }
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
    if (!expectedToken || payload.token !== expectedToken) {
      console.warn('[read_watchlist] Invalid token');
      return jsonResp({ ok: false, error: 'unauthorized' });
    }

    const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
    if (!sheetId) {
      return jsonResp({ ok: false, error: 'sheet_id_missing' });
    }
    const ss = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName('earnings_watchlist');
    if (!sheet) {
      return jsonResp({ ok: false, error: 'earnings_watchlist_sheet_missing — run setupEarningsSheets()' });
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return jsonResp({ ok: true, count: 0, watchlist: [] });
    }

    // Columns: ticker(A) market(B) shares(C) avg_cost(D) added_at(E) exit_at(F) lock_status(G) asset_type(H) note(I)
    const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    const watchlist = data
      .filter(row => row[0] && String(row[0]).trim() !== '')
      .map(row => ({
        ticker:      String(row[0]).trim().toUpperCase(),
        market:      String(row[1] || '').trim().toUpperCase() || null,
        shares:      (row[2] !== '' && row[2] !== null && row[2] !== undefined) ? Number(row[2]) : null,
        avg_cost:    (row[3] !== '' && row[3] !== null && row[3] !== undefined) ? Number(row[3]) : null,
        added_at:    row[4] ? String(row[4]) : null,
        exit_at:     row[5] instanceof Date
                       ? Utilities.formatDate(row[5], 'UTC', 'yyyy-MM-dd')
                       : (row[5] ? String(row[5]) : null),
        lock_status: String(row[6] || 'tradeable').trim() || 'tradeable',
        asset_type:  String(row[7] || 'stock').trim() || 'stock',
        note:        String(row[8] || '').trim() || null
      }));

    return jsonResp({ ok: true, count: watchlist.length, watchlist });

  } catch (err) {
    console.error('[read_watchlist]', err.message, err.stack);
    return jsonResp({ ok: false, error: err.message });
  }
}


// ============================================================
// Earnings Report endpoint
// POST ?endpoint=earnings_report  { alert or summary payload }
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

    // Token validation
    const expectedToken = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
    if (!expectedToken || payload.token !== expectedToken) {
      console.warn('[earnings_report] Invalid token');
      return jsonResp({ ok: false, error: 'unauthorized' });
    }

    // Required fields
    const missing = ['type', 'ticker', 'earnings_date'].filter(k => !payload[k]);
    if (missing.length > 0) {
      return jsonResp({ ok: false, error: `missing_fields: ${missing.join(', ')}` });
    }
    if (payload.type !== 'alert' && payload.type !== 'summary') {
      return jsonResp({ ok: false, error: `invalid_type: ${payload.type}` });
    }

    // Dedup check via earnings_dedup sheet
    const sheetId = PropertiesService.getScriptProperties().getProperty('MACRO_SHEET_ID');
    if (!sheetId) {
      return jsonResp({ ok: false, error: 'sheet_id_missing' });
    }
    const ss = SpreadsheetApp.openById(sheetId);
    const dedupSheet = ss.getSheetByName('earnings_dedup');
    if (!dedupSheet) {
      throw new Error('earnings_dedup sheet missing — run setupEarningsSheets()');
    }

    const dedupKey = `${payload.ticker}_${payload.type}_${payload.earnings_date}`;
    const dedupLastRow = dedupSheet.getLastRow();
    if (dedupLastRow >= 2) {
      const dedupKeys = dedupSheet.getRange(2, 1, dedupLastRow - 1, 1).getValues().flat();
      if (dedupKeys.indexOf(dedupKey) !== -1) {
        console.warn(`[earnings_report] Dedup hit: ${dedupKey}`);
        return jsonResp({ ok: true, dedup: true });
      }
    }
    // Record dedup before sending to prevent race on retry
    dedupSheet.appendRow([dedupKey, new Date()]);

    // Format message
    const message = payload.type === 'alert'
      ? formatEarningsAlert(payload)
      : formatEarningsSummary(payload);

    const sendResult = sendTelegramHtml(message);
    if (!sendResult.ok) {
      throw new Error(`Telegram send failed: ${sendResult.error}`);
    }

    // Log
    const logSheet = ss.getSheetByName('earnings_log');
    if (logSheet) {
      logSheet.appendRow([
        new Date(),
        payload.type,
        payload.ticker,
        payload.earnings_date,
        payload.fiscal_period || '',
        payload.market || '',
        payload.type === 'summary' ? (payload.recommendation || '') : '',
        true
      ]);
    }

    return jsonResp({ ok: true, posted: true });

  } catch (err) {
    console.error('[earnings_report]', err.message, err.stack);
    try {
      sendTelegramHtml(`⚠ <b>Earnings report 處理失敗</b>\n${escapeHtml(err.message)}`);
    } catch (_) {}
    return jsonResp({ ok: false, error: err.message });
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}


// ============================================================
// Alert 訊息格式化
// ============================================================
function formatEarningsAlert(p) {
  const isLocked = p.lock_status === 'locked';
  const lockTag  = isLocked ? ' 🔒' : '';
  const currency = p.market === 'US' ? '$' : '';

  let msg = `📅 <b>財報預警${lockTag} — ${escapeHtml(String(p.ticker))}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>${escapeHtml(String(p.company_name || p.ticker))}</b>`;
  if (p.fiscal_period) msg += `  ${escapeHtml(String(p.fiscal_period))}`;
  msg += `\n`;
  msg += `📆 ${escapeHtml(String(p.earnings_date))}`;
  if (p.release_time_local) msg += `  ${escapeHtml(String(p.release_time_local))}`;
  msg += `\n\n`;

  // Analyst estimates
  if (p.eps_estimate || p.rev_estimate) {
    msg += `<b>分析師預估</b>\n`;
    if (p.eps_estimate) msg += `EPS <code>${escapeHtml(String(p.eps_estimate))}</code>`;
    if (p.eps_estimate && p.rev_estimate) msg += `  `;
    if (p.rev_estimate) msg += `Rev <code>${escapeHtml(String(p.rev_estimate))}</code>`;
    msg += `\n\n`;
  }

  // Position info
  const hasShares   = p.shares    !== null && p.shares    !== undefined;
  const hasAvgCost  = p.avg_cost  !== null && p.avg_cost  !== undefined;
  const hasPrice    = p.current_price !== null && p.current_price !== undefined;

  if (hasShares || hasPrice) {
    msg += `<b>持倉</b>\n`;
    if (hasShares && hasAvgCost) {
      msg += `${p.shares} 股 @ ${currency}${Number(p.avg_cost).toFixed(2)}`;
    } else if (hasShares) {
      msg += `${p.shares} 股 @ 成本未填`;
    } else {
      msg += `持倉未填`;
    }
    if (hasPrice) {
      msg += `  現價 <code>${currency}${Number(p.current_price).toFixed(2)}</code>`;
      if (hasAvgCost && Number(p.avg_cost) > 0) {
        const pnlPct = (Number(p.current_price) - Number(p.avg_cost)) / Number(p.avg_cost) * 100;
        msg += `  (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`;
      }
    }
    msg += `\n`;
    if (isLocked) msg += `🔒 <i>太太代持，僅監控</i>\n`;
    msg += `\n`;
  }

  // Action hint
  if (p.action_hint) {
    msg += `⚡ <i>${escapeHtml(String(p.action_hint))}</i>`;
  }

  return msg.trim();
}


// ============================================================
// Summary 訊息格式化
// ============================================================
function formatEarningsSummary(p) {
  const currency  = p.market === 'US' ? '$' : '';
  const epsIcon   = earningsBeatMissIcon(p.eps_actual, p.eps_estimate);
  const revIcon   = earningsBeatMissIcon(p.rev_actual, p.rev_estimate);
  const overallIcon = (epsIcon === '✅' && revIcon === '✅') ? '✅雙Beat'
                    : (epsIcon === '❌' && revIcon === '❌') ? '❌雙Miss'
                    : '➡Mixed';

  let msg = `📊 <b>財報結果 — ${escapeHtml(String(p.ticker))}  ${overallIcon}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>${escapeHtml(String(p.company_name || p.ticker))}</b>`;
  if (p.fiscal_period) msg += `  ${escapeHtml(String(p.fiscal_period))}`;
  if (p.earnings_date) msg += `  ${escapeHtml(String(p.earnings_date))}`;
  msg += `\n\n`;

  // EPS
  if (p.eps_actual !== undefined || p.eps_estimate !== undefined) {
    msg += `<b>EPS</b>`;
    if (p.eps_actual    !== undefined) msg += ` <code>${escapeHtml(String(p.eps_actual))}</code>`;
    if (p.eps_estimate  !== undefined) msg += ` vs <code>${escapeHtml(String(p.eps_estimate))}E</code>`;
    if (p.eps_yoy_pct   !== null && p.eps_yoy_pct !== undefined) {
      msg += `  YoY <code>${fmt(p.eps_yoy_pct, 1)}%</code>`;
    }
    if (epsIcon) msg += `  ${epsIcon}`;
    msg += `\n`;
  }

  // Revenue
  if (p.rev_actual !== undefined || p.rev_estimate !== undefined) {
    msg += `<b>Rev</b>`;
    if (p.rev_actual    !== undefined) msg += ` <code>${escapeHtml(String(p.rev_actual))}</code>`;
    if (p.rev_estimate  !== undefined) msg += ` vs <code>${escapeHtml(String(p.rev_estimate))}E</code>`;
    if (p.rev_yoy_pct   !== null && p.rev_yoy_pct !== undefined) {
      msg += `  YoY <code>${fmt(p.rev_yoy_pct, 1)}%</code>`;
    }
    if (revIcon) msg += `  ${revIcon}`;
    msg += `\n`;
  }

  // Guidance
  if (p.guidance) {
    const guidanceIcon = { raised: '🔼上修', in_line: '➡持平', lowered: '🔽下修' }[p.guidance]
                       || escapeHtml(String(p.guidance));
    msg += `<b>Guidance</b> ${guidanceIcon}`;
    if (p.guidance_text) msg += `  <i>${escapeHtml(String(p.guidance_text))}</i>`;
    msg += `\n`;
  }
  msg += `\n`;

  // Price reaction
  if (p.price_before !== undefined || p.price_after !== undefined) {
    msg += `<b>股價反應</b>\n`;
    if (p.price_before !== null && p.price_before !== undefined) {
      msg += `${currency}${Number(p.price_before).toFixed(2)}`;
    }
    if (p.price_after !== null && p.price_after !== undefined) {
      msg += ` → ${currency}${Number(p.price_after).toFixed(2)}`;
    }
    if (p.price_reaction_pct !== null && p.price_reaction_pct !== undefined) {
      const r = Number(p.price_reaction_pct);
      msg += `  ${r >= 0 ? '📈' : '📉'} <b>${r >= 0 ? '+' : ''}${r.toFixed(2)}%</b>`;
    }
    msg += `\n\n`;
  }

  // Call highlights (prepared remarks, max 5)
  const callHighlights = Array.isArray(p.call_highlights) ? p.call_highlights : [];
  if (callHighlights.length > 0) {
    msg += `<b>Call 重點</b>\n`;
    callHighlights.slice(0, 5).forEach(h => {
      msg += `• ${escapeHtml(String(h))}\n`;
    });
    msg += `\n`;
  }

  // Q&A highlights — split on → for Q / A rendering (max 3)
  const qaHighlights = Array.isArray(p.qa_highlights) ? p.qa_highlights : [];
  if (qaHighlights.length > 0) {
    msg += `<b>Q&amp;A 重點</b>\n`;
    qaHighlights.slice(0, 3).forEach(item => {
      const parts = String(item).split('→');
      if (parts.length >= 2) {
        msg += `Q: ${escapeHtml(parts[0].trim())}\n`;
        msg += `A: ${escapeHtml(parts.slice(1).join('→').trim())}\n`;
      } else {
        msg += `• ${escapeHtml(String(item))}\n`;
      }
    });
    msg += `\n`;
  }

  // Recommendation
  if (p.recommendation) {
    const recMap = {
      add:     '🟢加碼',
      hold:    '🔵持有',
      monitor: '🟡觀察',
      trim:    '🟠減碼',
      exit:    '🔴出清'
    };
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `建議: <b>${recMap[p.recommendation] || escapeHtml(String(p.recommendation))}</b>\n`;
    if (p.recommendation_reason) {
      msg += `<i>${escapeHtml(String(p.recommendation_reason))}</i>\n`;
    }
  }

  if (p.summary_text) {
    msg += `\n${escapeHtml(String(p.summary_text))}`;
  }

  return msg.trim();
}


// ============================================================
// 工具函數
// ============================================================

/**
 * 解析估值字串為數字，用於 beat/miss 比較。
 * 支援：$0.84, $43.1B, $1.2M, 120.5, -$0.15
 */
function parseEarningsEstimate(s) {
  if (s === null || s === undefined || s === '') return null;
  const str = String(s).trim().toLowerCase();
  let multiplier = 1;
  if (str.endsWith('t')) multiplier = 1000;   // T → same unit as B
  else if (str.endsWith('b')) multiplier = 1;
  else if (str.endsWith('m')) multiplier = 0.001;
  else if (str.endsWith('k')) multiplier = 0.000001;
  const num = parseFloat(str.replace(/[^0-9.\-]/g, ''));
  if (isNaN(num)) return null;
  return num * multiplier;
}

/** ✅ / ❌ / ➡ based on actual vs estimate numeric comparison */
function earningsBeatMissIcon(actual, estimate) {
  const a = parseEarningsEstimate(actual);
  const e = parseEarningsEstimate(estimate);
  if (a === null || e === null) return '';
  if (a > e) return '✅';
  if (a < e) return '❌';
  return '➡';
}


// ============================================================
// Setup — 建立所需 Sheets（一次性執行）
// ============================================================
function setupEarningsSheets() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty('MACRO_SHEET_ID');
  if (!sheetId) {
    console.log('⚠ MACRO_SHEET_ID 未設定');
    return;
  }

  const ss = SpreadsheetApp.openById(sheetId);
  const toCreate = [
    {
      name: 'earnings_watchlist',
      headers: ['ticker', 'market', 'shares', 'avg_cost', 'added_at', 'exit_at', 'lock_status', 'asset_type', 'note']
    },
    {
      name: 'earnings_log',
      headers: ['timestamp', 'type', 'ticker', 'earnings_date', 'fiscal_period', 'market', 'recommendation', 'posted']
    },
    {
      name: 'earnings_dedup',
      headers: ['key', 'created_at']
    }
  ];

  toCreate.forEach(({ name, headers }) => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(headers);
      sh.setFrozenRows(1);
      console.log(`✅ 建立 sheet: ${name}`);
    } else {
      console.log(`✅ Sheet "${name}" 已存在`);
    }
  });
  console.log('setupEarningsSheets 完成');
}


// ============================================================
// Test functions（部署後在 Apps Script 編輯器手動跑）
// ============================================================

function testReadWatchlist() {
  const token = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
  const result = handleReadWatchlist({
    postData: { contents: JSON.stringify({ token }) },
    parameter: { endpoint: 'read_watchlist' }
  });
  console.log('read_watchlist result:', result.getContent());
}

function testEarningsAlert() {
  const token = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
  const result = handleEarningsReport({
    parameter: { endpoint: 'earnings_report' },
    postData: {
      contents: JSON.stringify({
        token,
        type: 'alert',
        ticker: 'NVDA',
        company_name: 'NVIDIA',
        market: 'US',
        earnings_date: '2099-12-31',       // 遠期日期避免 dedup 與真實資料衝突
        fiscal_period: 'Q1 FY26',
        release_time_local: '盤後 16:30 NY',
        eps_estimate: '$0.84',
        rev_estimate: '$43.1B',
        shares: 50,
        avg_cost: 145.20,
        current_price: 178.50,
        lock_status: 'tradeable',
        action_hint: '財報前 IV 偏高，options 不利進場'
      })
    }
  });
  console.log('alert result:', result.getContent());
}

function testEarningsSummary() {
  const token = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
  const result = handleEarningsReport({
    parameter: { endpoint: 'earnings_report' },
    postData: {
      contents: JSON.stringify({
        token,
        type: 'summary',
        ticker: 'NVDA',
        company_name: 'NVIDIA',
        market: 'US',
        earnings_date: '2099-12-31',
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
  });
  console.log('summary result:', result.getContent());
}

function testEarningsAlertLocked() {
  const token = PropertiesService.getScriptProperties().getProperty('ROUTINE_TOKEN');
  const result = handleEarningsReport({
    parameter: { endpoint: 'earnings_report' },
    postData: {
      contents: JSON.stringify({
        token,
        type: 'alert',
        ticker: '2330',
        company_name: '台積電',
        market: 'TW',
        earnings_date: '2099-12-31',
        fiscal_period: 'Q2 FY26',
        release_time_local: '台北 14:00',
        eps_estimate: 'NT$14.5',
        shares: 920,
        avg_cost: 972,
        current_price: 950,
        lock_status: 'locked'
      })
    }
  });
  console.log('locked alert result:', result.getContent());
}
