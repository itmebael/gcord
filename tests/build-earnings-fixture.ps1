$workspacePath = Split-Path -Parent $PSScriptRoot
$page = Get-Content -LiteralPath (Join-Path $workspacePath 'earnings.html') -Raw -Encoding UTF8
$page = [regex]::Replace($page, '<link[^>]+https://[^>]+>', '')
$page = [regex]::Replace($page, '<script src="(?:https:[^"]+|supabase-config.js|supabase-api.js)"></script>', '')
$mock = @'
<script>
window.fixtureMode = 'data';
var fixtureUser = { id: 7, full_name: 'Test Staff', username: 'staff' };
var fixtureTier = {id:91,user_id:7,min_amount:'500.00',max_amount:'999.99',payout_amount:'10.00',sort_order:0,updated_at:'2026-09-05T00:00:00'};
var fixtureRows = Array.from({length:31}, function(_, i) { return { transaction_id:i+1, transaction_amount:'500.00', earning_rate:'10.00', transaction_basis:'500.00', commission_method:'fixed_tier', tier_min_amount:'500.00', tier_max_amount:'999.99', earnings:'10.00', earned_at:'2026-09-05T02:00:00Z', transactions:{ref_no:'1234567890'+i} }; });
var fixtureClient = {
  rpc: async function(name, args) {
    if (name === 'app_create_my_commission_tier') {
      window.fixtureCreatedTierArgs = args;
      return {data:{id:93,user_id:7,min_amount:args.p_min_amount,max_amount:args.p_max_amount,payout_amount:args.p_payout_amount,sort_order:args.p_sort_order,updated_at:'2026-09-05T00:02:00'}};
    }
    if (name === 'app_update_my_commission_tier') {
      window.fixtureSavedTierArgs = args;
      fixtureTier = Object.assign({},fixtureTier,{min_amount:args.p_min_amount,max_amount:args.p_max_amount,payout_amount:args.p_payout_amount,sort_order:args.p_sort_order,updated_at:'2026-09-05T00:01:00'});
      return {data:fixtureTier};
    }
    return { data: name === 'app_current_user_id' ? 7 : [{ overall_earnings:310, today_earnings:310, weekly_earnings:310, monthly_earnings:310 }] };
  },
  from: function(name) {
    if (name !== 'staff_earnings' && name !== 'commission_tiers') throw new Error('Unexpected table');
    var query = {};
    ['select','eq','gte','lt','lte','order'].forEach(function(method) { query[method] = function() { return query; }; });
    query.range = async function(start) {
      if (name === 'commission_tiers') return {data:start === 0 ? [fixtureTier, Object.assign({},fixtureTier,{id:92,user_id:8})] : []};
      if (window.fixtureMode === 'error') return {error:{code:'42P01'}};
      return {data:window.fixtureMode === 'empty' ? [] : fixtureRows.slice(start,start+20)};
    };
    return query;
  }
};
window.GcordAPI = { requireAuth:function(){return fixtureUser;}, client:function(){return fixtureClient;}, listTransactions:async function(){return [];}, listNotifications:async function(){return [];} };
</script>
'@
$page = $page.Replace('<script src="sidebar.js"></script>', $mock + '<script src="sidebar.js"></script>')
$page = $page.Replace('</body>', '<script src="tests/staff-earnings.test.js"></script></body>')
$fixturePath = Join-Path $workspacePath 'earnings.preview.html'
[System.IO.File]::WriteAllText($fixturePath, $page)
Write-Output $fixturePath
$dashboard = Get-Content -LiteralPath (Join-Path $workspacePath 'dashboard.html') -Raw -Encoding UTF8
$dashboard = [regex]::Replace($dashboard, '<link[^>]+https://[^>]+>', '')
$dashboard = [regex]::Replace($dashboard, '<script src="(?:https:[^"]+|supabase-config.js|supabase-api.js)"></script>', '')
$dashboard = $dashboard.Replace('<script src="transactions.js"></script>', $mock + '<script src="transactions.js"></script>')
$dashboardCheck = @'
<script>
setTimeout(function () {
  var ok = document.querySelector('[data-earnings="overall_earnings"]').textContent.includes('310') && document.getElementById('staffChartNote').textContent.includes('No transactions') && document.documentElement.scrollWidth <= window.innerWidth;
  document.body.dataset.testResult = ok ? 'PASS: dashboard summary, chart and layout' : 'FAIL: dashboard';
}, 100);
</script>
'@
$dashboard = $dashboard.Replace('</body>', $dashboardCheck + '</body>')
[System.IO.File]::WriteAllText((Join-Path $workspacePath 'dashboard.preview.html'), $dashboard)
