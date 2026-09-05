(function () {
  'use strict';
  var version = 0, selected = 'Last 7 Days', customDate;
  var status = document.getElementById('trendStatus'), root = document.getElementById('trendDays');
  var label = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
  function range(period, custom) {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    function part(type) { return parts.find(function (p) { return p.type === type; }).value; }
    var today = part('year') + '-' + part('month') + '-' + part('day');
    var end = new Date(((custom && custom.to) || custom || today) + 'T00:00:00Z'), start = new Date(end);
    if(custom && custom.from) start = new Date(custom.from + 'T00:00:00Z');
    if (period === 'Last 7 Days') start.setUTCDate(start.getUTCDate() - 6);
    if (period === 'This Month') start.setUTCDate(1);
    return {start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10)};
  }
  function draw(rows, dates) {
    root.replaceChildren();
    var days = [], date = new Date(dates.start + 'T00:00:00Z');
    while (date.toISOString().slice(0,10) <= dates.end) {
      days.push({key:date.toISOString().slice(0,10), verified:0, duplicate:0}); date.setUTCDate(date.getUTCDate()+1);
    }
    rows.forEach(function (row) { var day = days.find(function (d) { return d.key === row.txn_date; }); if(day && (row.status === 'verified' || row.status === 'duplicate')) day[row.status]++; });
    var max = Math.max(1, ...days.map(function(d){return Math.max(d.verified,d.duplicate);}));
    days.forEach(function(day) {
      var row = document.createElement('div'); row.className = 'trend-day';
      var dateLabel = document.createElement('time'); dateLabel.dateTime = day.key; dateLabel.textContent = label.format(new Date(day.key + 'T00:00:00Z')); row.appendChild(dateLabel);
      var bars = document.createElement('div'); bars.className = 'trend-bars';
      ['verified','duplicate'].forEach(function(type) {
        var line = document.createElement('div'); line.className = 'trend-bar-row';
        var track = document.createElement('div'); track.className = 'trend-track'; track.setAttribute('aria-hidden','true');
        var bar = document.createElement('i'); bar.className = type; bar.style.width = day[type]/max*100+'%'; track.appendChild(bar);
        var count = document.createElement('span'); count.textContent = day[type]; count.setAttribute('aria-label',type + ': ' + day[type] + ' transactions');
        line.append(track,count); bars.appendChild(line);
      });
      row.appendChild(bars); root.appendChild(row);
    });
    var verified = days.reduce(function(sum,d){return sum+d.verified;},0), duplicate = days.reduce(function(sum,d){return sum+d.duplicate;},0);
    status.textContent = rows.length ? (verified+duplicate) + ' transactions · ' + verified + ' verified · ' + duplicate + ' duplicate' : 'No transactions in this period. All daily counts are zero.';
  }
  async function load(period, custom) {
    selected = period || selected; customDate = custom;
    var token = ++version; root.replaceChildren(); status.textContent = 'Loading your transactions...';
    window.dispatchEvent(new Event('staff-report-loading'));
    try {
      var user = GcordAPI.requireAuth(); if (!user) return;
      var dates = range(selected,customDate), client = GcordAPI.client();
      document.getElementById('trendPeriod').textContent = dates.start + ' to ' + dates.end;
      var session = await client.rpc('app_current_user_id');
      if (session.error) throw session.error;
      if(String(session.data)!==String(user.id)) throw new Error('Please sign in again to view your transactions.');
      var rows = [], offset = 0;
      while(token === version) {
        var result = await client.from('transactions').select('id,ref_no,recipient_name,recipient_number,amount,txn_date,txn_time,status,source').eq('created_by_user_id',user.id)
          .gte('txn_date',dates.start).lte('txn_date',dates.end).order('txn_date',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);
        if(result.error) throw result.error;
        if(!result.data || !result.data.length) break;
        rows = rows.concat(result.data); offset += result.data.length;
      }
      if(token === version) { draw(rows,dates); window.dispatchEvent(new CustomEvent('staff-report-data',{detail:{rows:rows,dates:dates}})); }
    } catch(error) { if(token === version) { status.textContent = 'Could not load report: ' + (error.message || 'Please try again.'); window.dispatchEvent(new CustomEvent('staff-report-error',{detail:status.textContent})); } }
  }
  window.GcordReportTrend = {load:load,draw:draw};
  document.getElementById('refreshTrend').addEventListener('click',function(){load(selected,customDate);});
  load('Last 7 Days');
})();
