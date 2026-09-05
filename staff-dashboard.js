/* Staff-only presentation; data comes from the existing scoped transaction query. */
function renderStaffOverview(transactions) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  function dateKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  var days = Array.from({ length: 7 }, function (_, index) {
    var date = new Date(today);
    date.setDate(date.getDate() - 6 + index);
    return { key: dateKey(date), label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), verified: 0, duplicate: 0 };
  });
  transactions.forEach(function (tx) {
    var key = tx.txnDate || '';
    var day = days.find(function (entry) { return entry.key === key; });
    if (day) day[tx.status === 'duplicate' ? 'duplicate' : 'verified']++;
  });
  var max = Math.max(1, ...days.map(function (day) { return Math.max(day.verified, day.duplicate); }));
  var chart = document.getElementById('staffTrendBars');
  chart.replaceChildren();
  days.forEach(function (day) {
    var column = document.createElement('div');
    column.className = 'staff-day';
    column.title = day.label + ': ' + day.verified + ' verified, ' + day.duplicate + ' duplicate';
    var pair = document.createElement('div');
    pair.className = 'staff-bar-pair';
    ['verified', 'duplicate'].forEach(function (status) {
      var bar = document.createElement('i');
      bar.className = status;
      bar.style.height = (day[status] / max * 100) + '%';
      pair.appendChild(bar);
    });
    var label = document.createElement('span');
    label.textContent = day.label;
    column.append(pair, label);
    chart.appendChild(column);
  });
  chart.setAttribute('aria-label', days.map(function (d) { return d.label + ': ' + d.verified + ' verified, ' + d.duplicate + ' duplicate'; }).join('; '));
  var count = days.reduce(function (total, day) { return total + day.verified + day.duplicate; }, 0);
  document.getElementById('staffChartNote').textContent = count ? count + (count === 1 ? ' transaction' : ' transactions') + ' in the last 7 days' : 'No transactions in the last 7 days';
  var duplicateCount = transactions.filter(function (tx) { return tx.status === 'duplicate'; }).length;
  document.getElementById('staffTotalBar').style.width = transactions.length ? '100%' : '0%';
  document.getElementById('staffDuplicateBar').style.width = transactions.length ? (duplicateCount / transactions.length * 100) + '%' : '0%';
  var activity = document.getElementById('staffRecentActivity');
  activity.replaceChildren();
  if (!transactions.length) {
    var empty = document.createElement('p');
    empty.className = 'staff-empty';
    empty.textContent = 'No activity yet. Scan a receipt to record your first transaction.';
    activity.appendChild(empty);
  }
  transactions.slice().sort(function (a, b) { return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0); }).slice(0, 4).forEach(function (tx) {
    var row = document.createElement('article');
    row.className = 'staff-activity-row';
    var text = document.createElement('strong');
    text.textContent = (tx.status === 'duplicate' ? 'Duplicate flagged' : 'Verified transaction') + ' — Ref #' + (tx.ref || 'Unavailable') + ' (' + GcordTransactions.formatAmount(tx.amount) + ')';
    var time = document.createElement('time');
    var timestamp = tx.txnDate && tx.txnTime ? new Date(tx.txnDate + 'T' + tx.txnTime) : null;
    if (timestamp && !isNaN(timestamp.getTime())) time.dateTime = timestamp.toISOString();
    time.textContent = [tx.recordedDate, tx.recordedTime].filter(function (value) { return value && value !== '—'; }).join(' · ') || 'Date unavailable';
    row.append(text, time);
    activity.appendChild(row);
  });
}
