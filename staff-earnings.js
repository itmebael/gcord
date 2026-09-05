/* Shared earnings dashboard and report. Uses the ledger's saved rates, never estimates. */
(function () {
  'use strict';
  var money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
  var claimDate = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  function dateKey(date) { return date.toISOString().slice(0, 10); }
  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid date.');
    var date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || dateKey(date) !== value) throw new Error('Choose a valid date.');
    return date;
  }
  function periodRange(period, anchor, from, to) {
    var start = parseDate(period === 'custom' ? from : anchor);
    var end = new Date(start);
    if (period === 'custom') end = parseDate(to);
    else if (period === 'week') {
      start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
      end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
    } else if (period === 'month') {
      start.setUTCDate(1); end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    } else if (period === 'year') {
      start.setUTCMonth(0, 1); end.setUTCMonth(11, 31);
    } else if (period !== 'day') throw new Error('Choose a valid period.');
    if (start > end) throw new Error('The end date must be on or after the start date.');
    var next = new Date(end); next.setUTCDate(next.getUTCDate() + 1);
    return { from: dateKey(start), to: dateKey(end), start: dateKey(start) + 'T00:00:00+08:00', end: dateKey(next) + 'T00:00:00+08:00' };
  }
  function csvCell(value) {
    var text = String(value == null ? '' : value);
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function totalCents(rows, field) { return rows.reduce(function (sum, row) { return sum + Math.round(Number(row[field]) * 100); }, 0); }
  function commissionLabel(row) {
    if (row.commission_method === 'fixed_tier') return 'Fixed payout · ' + money.format(row.tier_min_amount) + '–' + money.format(row.tier_max_amount);
    if (row.commission_method === 'no_matching_tier') return 'No matching tier';
    return 'Previous rate · ' + money.format(row.earning_rate) + ' / ' + money.format(row.transaction_basis);
  }
  // Pure helpers are exposed for date-boundary and export verification.
  window.GcordEarnings = { periodRange: periodRange, csvCell: csvCell, totalCents: totalCents, commissionLabel: commissionLabel };
  if (!document.getElementById('earningsSummaryStatus')) return;
  var user = GcordAPI.requireAuth();
  if (!user) return;
  var summaryBusy = false;
  function showStatus(element, message, error) {
    element.textContent = message;
    element.classList.toggle('error', !!error);
  }
  function errorMessage(error) {
    if (error.code === 'PGRST202') {
      return 'The earnings summary function is unavailable. Apply admin_staff_earnings.sql if it has not been applied, then commission_tiers_earnings.sql in Supabase. Refresh the page afterward.';
    }
    if (error.code === '42703') {
      return 'The earnings database is missing required columns. Apply commission_tiers_earnings.sql after the base earnings migration, then refresh this page.';
    }
    if (error.code === 'PGRST200') {
      return 'The earnings-to-transactions relationship is unavailable. Ask your admin to check the earnings migration and reload the Supabase schema cache.';
    }
    if (['42P01', 'PGRST202', 'PGRST200', 'PGRST205', '42703'].indexOf(error.code) !== -1) {
      return 'Earnings are not set up yet. The commission_tiers table alone is not enough: apply the base earnings migration, then commission_tiers_earnings.sql. Do not rerun the base migration if it is already applied.';
    }
    return error.message || 'Unable to load earnings. Please try again.';
  }
  async function refreshSummary() {
    if (summaryBusy) return;
    summaryBusy = true;
    var status = document.getElementById('earningsSummaryStatus');
    try {
      var result = await GcordAPI.client().rpc('app_staff_earnings_summary');
      if (result.error) throw result.error;
      var summary = result.data && result.data[0];
      if (!summary) throw new Error('No earnings summary returned. Please sign in again.');
      document.querySelectorAll('[data-earnings]').forEach(function (element) { element.textContent = money.format(summary[element.dataset.earnings]); });
      showStatus(status, 'From qualifying claims · Philippine time · Updated ' + new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' }));
    } catch (error) {
      document.querySelectorAll('[data-earnings]').forEach(function (element) { element.textContent = '\u2014'; });
      showStatus(status, errorMessage(error), true);
    } finally { summaryBusy = false; }
  }
  refreshSummary();
  // A scan in another tab is reflected when returning, and while the dashboard is open.
  window.addEventListener('focus', refreshSummary);
  window.addEventListener('pageshow', refreshSummary);
  setInterval(function () { if (!document.hidden) refreshSummary(); }, 60000);

  var form = document.getElementById('earningsFilters');
  if (!form) return;
  document.getElementById('earningsUser').textContent = user.full_name || user.username || 'My profile';
  var period = document.getElementById('earningsPeriod');
  var anchor = document.getElementById('earningsAnchor');
  var from = document.getElementById('earningsFrom');
  var to = document.getElementById('earningsTo');
  // ISO date in Philippine time, independent of the browser's timezone.
  var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  function part(type) { return parts.find(function (item) { return item.type === type; }).value; }
  anchor.value = from.value = to.value = part('year') + '-' + part('month') + '-' + part('day');
  var report = document.getElementById('earningsReport');
  var status = document.getElementById('earningsReportStatus');
  var generate = document.getElementById('generateEarnings');
  var rows = [], range = null, page = 0, request = 0, pageSize = 25;
  function toggleCustom() {
    var custom = period.value === 'custom';
    document.getElementById('earningsAnchorLabel').hidden = custom;
    document.getElementById('earningsFromLabel').hidden = !custom;
    document.getElementById('earningsToLabel').hidden = !custom;
    anchor.disabled = custom; anchor.required = !custom;
    from.disabled = to.disabled = !custom; from.required = to.required = custom;
  }
  form.addEventListener('input', function () {
    toggleCustom();
    // Prevent exports of stale results after the user changes a filter.
    request++; report.hidden = true; generate.disabled = false;
    showStatus(status, 'Filters changed. Generate a report to apply them.');
  });
  function renderRows(all) {
    var body = document.getElementById('earningsRows'); body.replaceChildren();
    var visible = all ? rows : rows.slice(page * pageSize, (page + 1) * pageSize);
    visible.forEach(function (row) {
      var tr = document.createElement('tr');
      var txn = row.transactions || {};
      [claimDate.format(new Date(row.earned_at)), txn.ref_no || 'Unavailable', money.format(row.transaction_amount), commissionLabel(row), money.format(row.earnings)].forEach(function (value, index) {
        var td = document.createElement('td'); td.textContent = value; if (index > 1) td.className = 'money'; tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    if (!visible.length) {
      var tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = 5; td.textContent = 'No qualifying earnings in this period.'; tr.appendChild(td); body.appendChild(tr);
    }
    document.getElementById('earningsPageLabel').textContent = 'Page ' + (page + 1) + ' of ' + Math.max(1, Math.ceil(rows.length / pageSize));
    document.getElementById('earningsPrevious').disabled = page === 0;
    document.getElementById('earningsNext').disabled = (page + 1) * pageSize >= rows.length;
  }
  async function generateReport(event) {
    if (event) event.preventDefault();
    var token = ++request;
    report.hidden = true; generate.disabled = true;
    showStatus(status, 'Generating your earnings report...');
    try {
      var selected = periodRange(period.value, anchor.value, from.value, to.value);
      var client = GcordAPI.client();
      var session = await client.rpc('app_current_user_id');
      if (session.error) throw session.error;
      if (String(session.data) !== String(user.id)) throw new Error('Your session has expired. Please sign in again.');
      var collected = [], offset = 0, cutoff = new Date().toISOString();
      while (true) {
        if (token !== request) return;
        var result = await client.from('staff_earnings')
          .select('transaction_id,transaction_amount,earning_rate,transaction_basis,commission_method,tier_min_amount,tier_max_amount,earnings,earned_at,transactions(ref_no)')
          .eq('staff_user_id', user.id).eq('voided', false)
          .gte('earned_at', selected.start).lt('earned_at', selected.end).lte('earned_at', cutoff)
          .order('earned_at', { ascending: false }).order('transaction_id', { ascending: false }).range(offset, offset + 499);
        if (result.error) throw result.error;
        if (!result.data || !result.data.length) break;
        collected = collected.concat(result.data); offset += result.data.length;
      }
      if (token !== request) return;
      rows = collected; range = selected; page = 0;
      document.getElementById('earningsReportTotal').textContent = money.format(totalCents(rows, 'earnings') / 100) + ' earnings';
      document.getElementById('earningsReportCount').textContent = rows.length + ' qualifying transactions · ' + money.format(totalCents(rows, 'transaction_amount') / 100) + ' transaction value';
      document.getElementById('earningsReportCaption').textContent = (user.full_name || user.username || 'My earnings') + ' · ' + range.from + ' to ' + range.to + ' · Philippine time';
      renderRows(false); report.hidden = false;
      showStatus(status, 'Report generated. Each claim keeps its saved commission. Duplicates and voided earnings are excluded; claims without a matching tier earn zero.');
      refreshSummary();
    } catch (error) {
      if (token === request) { rows = []; showStatus(status, errorMessage(error), true); }
    } finally { if (token === request) generate.disabled = false; }
  }
  form.addEventListener('submit', generateReport);
  document.getElementById('earningsPrevious').addEventListener('click', function () { if (page > 0) { page--; renderRows(false); } });
  document.getElementById('earningsNext').addEventListener('click', function () { if ((page + 1) * pageSize < rows.length) { page++; renderRows(false); } });
  document.getElementById('exportEarnings').addEventListener('click', function () {
    if (!range || report.hidden) return;
    var csv = [['Staff', 'Period from', 'Period to', 'Claimed at (Asia/Manila)', 'Reference number', 'Transaction amount (PHP)', 'Commission method', 'Tier minimum (PHP)', 'Tier maximum (PHP)', 'Earnings (PHP)']];
    rows.forEach(function (row) {
      csv.push([user.full_name || user.username, range.from, range.to, claimDate.format(new Date(row.earned_at)), (row.transactions || {}).ref_no, row.transaction_amount, row.commission_method || 'legacy', row.tier_min_amount, row.tier_max_amount, row.earnings]);
    });
    csv.push(['TOTAL', range.from, range.to, '', '', (totalCents(rows, 'transaction_amount') / 100).toFixed(2), '', '', '', (totalCents(rows, 'earnings') / 100).toFixed(2)]);
    var filename = 'my-earnings-' + range.from + '-to-' + range.to + '.csv';
    GcordExportPreview(csv, filename, function () {
    var blob = new Blob(['\uFEFF' + csv.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  });
  window.addEventListener('beforeprint', function () { if (!report.hidden) renderRows(true); });
  window.addEventListener('afterprint', function () { renderRows(false); });
  document.getElementById('printEarnings').addEventListener('click', function () {
    if (report.hidden) return;
    var preview = [['Claim date', 'Reference', 'Transaction amount (PHP)', 'Earnings (PHP)']].concat(rows.map(function (row) {
      return [claimDate.format(new Date(row.earned_at)), (row.transactions || {}).ref_no, row.transaction_amount, row.earnings];
    }));
    GcordExportPreview(preview, 'Earnings: ' + range.from + ' to ' + range.to + ' — choose Save as PDF in the print dialog', function () { window.print(); });
  });
  generateReport();
})();
