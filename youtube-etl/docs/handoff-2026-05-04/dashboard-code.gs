// =====================================================================
// mikai YouTube ETL Dashboard — full Apps Script
// =====================================================================
// Sheet ID is hard-coded so this works as a standalone script too.
// Required Services (Apps Script editor → Services + button): BigQuery v2.
// Required GCP project (Project Settings): 508645124315 (mikai-yt-data).
//
// Functions:
//   buildDashboard()       — main entry, builds 6 tabs from BQ mart
//   buildTrendTab()        — last 30 days time-series, skips bootstrap day
//   buildContentTabs()     — Videos + Lives drill-down (per-video / per-live)
//   setupDailyTrigger()    — register daily 13:00 (local TZ) auto-refresh
//
// First run: clear Code.gs entirely, paste this whole file, save, then
// Run buildDashboard. After OAuth approve, run setupDailyTrigger to
// schedule auto-refresh.
// =====================================================================

const PROJECT_ID = 'mikai-yt-data';
const SHEET_ID = '1A5ynk0IoQ9UpV9AP5OiplsAsL3rbAl-38-2R-kYovbo';

// UI-safe notify: works in both UI runs and time-triggered runs
function notify(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* no UI context, fine */ }
}

// =====================================================================
// MAIN ENTRY: buildDashboard
// =====================================================================
function buildDashboard() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  const sqlTalent = `
    SELECT
      manager_name, talent_name, channel_id, channel_type,
      views, new_video_count, live_session_count,
      comment_count, unique_commenters, concurrent_peak,
      live_minutes, comment_velocity_24h, report_date
    FROM \`${PROJECT_ID}.youtube_mart.mart_talent_daily_kpi\`
    WHERE report_date = (
      SELECT MAX(report_date) FROM \`${PROJECT_ID}.youtube_mart.mart_talent_daily_kpi\`
    )
    ORDER BY manager_name, views DESC
  `;
  const talentRows = runQuery(sqlTalent);
  if (talentRows.length === 0) {
    notify('mart_talent_daily_kpi empty — has rollup run?');
    return;
  }

  const talentHeaders = ['manager_name','talent_name','channel_id','channel_type',
                         'views','new_video_count','live_session_count',
                         'comment_count','unique_commenters','concurrent_peak',
                         'live_minutes','comment_velocity_24h','report_date'];
  const talentToRow = (r) => r.f.map((c, i) => {
    if (c.v === null || c.v === undefined) return null;
    if (i >= 4 && i <= 11) return Number(c.v);
    return c.v;
  });

  // Tab 0: Talent Dashboard
  const detail = [talentHeaders].concat(talentRows.map(talentToRow));
  recreateSheet(ss, 'Talent Dashboard', 0, detail, '#1a73e8', [{startCol: 5, endCol: 11}]);

  // Tab 1: Manager Summary + chart
  const mgrMap = {};
  talentRows.forEach(r => {
    const f = r.f, m = f[0].v;
    if (!mgrMap[m]) mgrMap[m] = {talents:0, views:0, new_videos:0, live:0, comments:0, unique_c:0, peak:0};
    mgrMap[m].talents++;
    mgrMap[m].views     += Number(f[4].v) || 0;
    mgrMap[m].new_videos+= Number(f[5].v) || 0;
    mgrMap[m].live      += Number(f[6].v) || 0;
    mgrMap[m].comments  += Number(f[7].v) || 0;
    mgrMap[m].unique_c  += Number(f[8].v) || 0;
    mgrMap[m].peak       = Math.max(mgrMap[m].peak, Number(f[9].v) || 0);
  });
  const summary = [['manager_name','talents','total_views','new_videos_today',
                    'live_sessions_today','total_comments','unique_commenters','concurrent_peak']];
  Object.entries(mgrMap).sort((a,b) => b[1].views - a[1].views)
    .forEach(([m,s]) => summary.push([m, s.talents, s.views, s.new_videos, s.live, s.comments, s.unique_c, s.peak]));

  const s2 = recreateSheet(ss, 'Manager Summary', 1, summary, '#1a73e8', [{startCol: 2, endCol: 8}]);
  const chart = s2.newChart()
    .asColumnChart()
    .addRange(s2.getRange(1, 1, summary.length, 1))
    .addRange(s2.getRange(1, 3, summary.length, 1))
    .setPosition(2, 10, 0, 0)
    .setOption('title', 'Total Views by Manager Group')
    .setOption('width', 600).setOption('height', 350)
    .setOption('legend', {position: 'none'})
    .build();
  s2.insertChart(chart);
  s2.getRange(summary.length + 3, 1).setValue('Last refreshed:');
  s2.getRange(summary.length + 3, 2).setValue(new Date()).setNumberFormat('yyyy-MM-dd HH:mm:ss');

  // Tab 2: Top 10
  const sortedTop = talentRows.slice().sort((a, b) => Number(b.f[4].v) - Number(a.f[4].v)).slice(0, 10);
  const top = [talentHeaders].concat(sortedTop.map(talentToRow));
  recreateSheet(ss, 'Top 10', 2, top, '#34a853', [{startCol: 5, endCol: 11}]);

  buildTrendTab(ss);
  buildContentTabs(ss);

  notify(
    `Dashboard built ✓\n` +
    `${talentRows.length} talents · ${Object.keys(mgrMap).length} manager groups\n` +
    `report_date ${talentRows[0].f[12].v}`
  );
}

// =====================================================================
// Trend tab: last 30 days from mart_talent_daily_kpi
// Auto-skips bootstrap day (MIN(report_date)) which has cumulative views.
// =====================================================================
function buildTrendTab(ss) {
  const sql = `
    SELECT
      report_date, manager_name, talent_name,
      views, new_video_count, live_session_count, comment_count, concurrent_peak
    FROM \`${PROJECT_ID}.youtube_mart.mart_talent_daily_kpi\`
    WHERE report_date > (
      SELECT MIN(report_date) FROM \`${PROJECT_ID}.youtube_mart.mart_talent_daily_kpi\`
    )
      AND report_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    ORDER BY report_date DESC, views DESC
  `;
  const rows = runQuery(sql);
  const headers = ['report_date','manager_name','talent_name','views',
                   'new_video_count','live_session_count','comment_count','concurrent_peak'];

  if (rows.length === 0) {
    const empty = [headers,
      ['(等到明天 May 5 才會有第一筆有效時間序資料 — May 4 是 bootstrap 日已被自動排除)','','','','','','','']];
    recreateSheet(ss, 'Trend', 3, empty, '#fbbc04', []);
    return;
  }

  const data = [headers].concat(rows.map(r => r.f.map((c, i) => {
    if (c.v === null || c.v === undefined) return null;
    if (i >= 3) return Number(c.v);
    return c.v;
  })));
  recreateSheet(ss, 'Trend', 3, data, '#fbbc04', [{startCol: 4, endCol: 8}]);
}

// =====================================================================
// Per-content tabs: Videos + Lives drill-down from mart_content_daily.
// content_type splits videos vs livestreams.
// =====================================================================
function buildContentTabs(ss) {
  const sql = `
    SELECT
      manager_name, talent_name, channel_id, video_id, title, published_at,
      content_type, duration_seconds, live_started_at, live_ended_at, live_minutes,
      view_count, view_count_delta, like_count, comment_count, concurrent_peak,
      report_date
    FROM \`${PROJECT_ID}.youtube_mart.mart_content_daily\`
    WHERE report_date = (
      SELECT MAX(report_date) FROM \`${PROJECT_ID}.youtube_mart.mart_content_daily\`
    )
    ORDER BY manager_name, talent_name, view_count DESC
  `;
  const rows = runQuery(sql);
  if (rows.length === 0) { Logger.log('mart_content_daily empty'); return; }

  const headers = ['manager_name','talent_name','channel_id','video_id','title','published_at',
                   'content_type','duration_seconds','live_started_at','live_ended_at','live_minutes',
                   'view_count','view_count_delta','like_count','comment_count','concurrent_peak','report_date'];
  const numericRanges = [{startCol: 8, endCol: 8}, {startCol: 11, endCol: 16}];
  const toRow = (r) => r.f.map((c, i) => {
    if (c.v === null || c.v === undefined) return null;
    if (i === 7 || (i >= 10 && i <= 15)) return Number(c.v);
    return c.v;
  });

  const videoRows = rows.filter(r => r.f[6].v === 'video');
  recreateSheet(ss, 'Videos', 4, [headers].concat(videoRows.map(toRow)), '#ea4335', numericRanges);

  const liveRows = rows.filter(r => (r.f[6].v || '').startsWith('live'))
    .sort((a, b) => Number(b.f[15].v || 0) - Number(a.f[15].v || 0));
  recreateSheet(ss, 'Lives', 5, [headers].concat(liveRows.map(toRow)), '#9c27b0', numericRanges);
}

// =====================================================================
// runQuery: BQ SQL, paginated
// =====================================================================
function runQuery(sql) {
  let job = BigQuery.Jobs.query({query: sql, useLegacySql: false}, PROJECT_ID);
  const jobId = job.jobReference.jobId;
  while (!job.jobComplete) {
    Utilities.sleep(500);
    job = BigQuery.Jobs.getQueryResults(PROJECT_ID, jobId);
  }
  let rows = job.rows || [];
  while (job.pageToken) {
    job = BigQuery.Jobs.getQueryResults(PROJECT_ID, jobId, {pageToken: job.pageToken});
    rows = rows.concat(job.rows || []);
  }
  return rows;
}

// =====================================================================
// Sheet helpers (recreateSheet handles "only sheet in spreadsheet" edge case)
// =====================================================================
function recreateSheet(ss, name, idx, data, headerColor, numericRanges) {
  const existing = ss.getSheetByName(name);
  if (existing) {
    if (ss.getSheets().length > 1) {
      ss.deleteSheet(existing);
    } else {
      existing.clear();
      existing.getCharts().forEach(c => existing.removeChart(c));
      const filter = existing.getFilter();
      if (filter) filter.remove();
      return populate(existing, data, headerColor, numericRanges);
    }
  }
  const s = ss.insertSheet(name, idx);
  return populate(s, data, headerColor, numericRanges);
}

function populate(s, data, headerColor, numericRanges) {
  s.getRange(1, 1, data.length, data[0].length).setValues(data);
  s.getRange(1, 1, 1, data[0].length).setFontWeight('bold').setBackground(headerColor).setFontColor('#ffffff');
  s.setFrozenRows(1);
  numericRanges.forEach(r => {
    s.getRange(2, r.startCol, data.length - 1, r.endCol - r.startCol + 1).setNumberFormat('#,##0');
  });
  s.autoResizeColumns(1, data[0].length);
  if (data.length > 1) s.getRange(1, 1, data.length, data[0].length).createFilter();
  return s;
}

// =====================================================================
// Daily refresh trigger (run once to set up; safe to re-run, replaces existing)
// =====================================================================
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'buildDashboard') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildDashboard')
    .timeBased().atHour(13).everyDays(1)
    .create();
  notify('Daily refresh trigger set: 13:00 (your local TZ, after mart rollup at 12:00 UTC+8).');
}
