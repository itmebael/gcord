/* Browser checks using the fixture client, without a database connection. */
(async function () {
  var checks = [];
  function assert(condition, label) { if (!condition) throw new Error(label); checks.push(label); }
  function settle() { return new Promise(function (resolve) { setTimeout(resolve, 30); }); }
  try {
    await settle();
    var helpers = window.GcordEarnings;
    var editorForms = document.querySelectorAll('.commission-tier-form');
    assert(editorForms.length === 1, 'Tier editor excludes another staff tier');
    var editor = editorForms[0];
    editor.elements.max_amount.value = '1';
    editor.dispatchEvent(new Event('submit', {cancelable:true}));
    assert(editor.textContent.includes('Maximum must be at least'), 'Tier editor rejects reversed amount bounds');
    editor.elements.max_amount.value = '999.99'; editor.elements.payout_amount.value = '25';
    editor.dispatchEvent(new Event('submit', {cancelable:true})); await settle();
    assert(window.fixtureSavedTierArgs.p_id === 91 && window.fixtureSavedTierArgs.p_payout_amount === 25, 'Tier saved through personal-tier RPC');
    assert(!('user_id' in window.fixtureSavedTierArgs) && !('p_user_id' in window.fixtureSavedTierArgs), 'Save request cannot select another owner');
    assert(editor.textContent.includes('Saved. This tier applies to future'), 'Successful tier edit confirmed');
    document.getElementById('addCommissionTier').click();
    var newTier = document.querySelector('.commission-tier-form');
    newTier.elements.min_amount.value = '1000'; newTier.elements.max_amount.value = '1499.99'; newTier.elements.payout_amount.value = '30';
    newTier.dispatchEvent(new Event('submit', {cancelable:true})); await settle();
    assert(window.fixtureCreatedTierArgs.p_payout_amount === 30 && !('p_user_id' in window.fixtureCreatedTierArgs), 'Create RPC uses session ownership, not a supplied user');
    assert(newTier.querySelector('h3').textContent === 'Personal tier #93' && newTier.querySelector('button').textContent === 'Save changes', 'New tier becomes an editable saved tier');
    assert(helpers.commissionLabel({commission_method:'fixed_tier',tier_min_amount:500,tier_max_amount:999.99}).includes('Fixed payout'), 'Fixed tier display');
    assert(helpers.commissionLabel({commission_method:'no_matching_tier'}) === 'No matching tier', 'Unmatched tier display');
    assert(helpers.commissionLabel({commission_method:'legacy',earning_rate:10,transaction_basis:500}).includes('Previous rate'), 'Historical rate remains distinguishable');
    var week = helpers.periodRange('week', '2026-01-01');
    assert(week.from === '2025-12-29' && week.to === '2026-01-04', 'Week crosses year boundary');
    var leap = helpers.periodRange('month', '2024-02-15');
    assert(leap.to === '2024-02-29' && leap.end === '2024-03-01T00:00:00+08:00', 'Leap month and exclusive Philippine-time end');
    var year = helpers.periodRange('year', '2026-09-05');
    assert(year.from === '2026-01-01' && year.to === '2026-12-31', 'Full calendar year');
    var day = helpers.periodRange('day', '2026-09-05');
    assert(day.start === '2026-09-05T00:00:00+08:00' && day.end === '2026-09-06T00:00:00+08:00', 'Day bounds');
    var reversed = false;
    try { helpers.periodRange('custom', '', '2026-09-06', '2026-09-05'); } catch (_) { reversed = true; }
    assert(reversed, 'Reversed custom dates rejected');
    assert(helpers.csvCell('=HYPERLINK("x")').startsWith('"\''), 'CSV formula injection neutralized');
    assert(helpers.totalCents([{ earnings: '0.10' }, { earnings: '0.20' }], 'earnings') === 30, 'Exact cents aggregation');
    assert(!document.getElementById('earningsReport').hidden, 'Initial report rendered');
    assert(document.querySelectorAll('#earningsRows tr').length === 25, 'First report page limited to 25 rows');
    assert(document.getElementById('earningsReportCount').textContent.startsWith('31 qualifying'), 'All query pages included');
    document.getElementById('earningsNext').click();
    assert(document.querySelectorAll('#earningsRows tr').length === 6, 'Next page renders remaining rows');
    window.dispatchEvent(new Event('beforeprint'));
    assert(document.querySelectorAll('#earningsRows tr').length === 31, 'Print contains all report rows');
    window.dispatchEvent(new Event('afterprint'));
    assert(document.querySelectorAll('#earningsRows tr').length === 6, 'Pagination restored after printing');
    assert(!document.querySelector('.menu a[data-page="earnings"]'), 'My Earnings is removed from staff navigation');
    var period = document.getElementById('earningsPeriod');
    period.value = 'custom'; period.dispatchEvent(new Event('input', { bubbles: true }));
    assert(document.getElementById('earningsReport').hidden && !document.getElementById('earningsFrom').disabled, 'Filter change invalidates stale export and enables custom dates');
    window.fixtureMode = 'empty';
    document.getElementById('earningsFilters').dispatchEvent(new Event('submit', { cancelable: true })); await settle();
    assert(document.getElementById('earningsRows').textContent.includes('No qualifying'), 'Empty report state');
    window.fixtureMode = 'error';
    document.getElementById('earningsFilters').dispatchEvent(new Event('submit', { cancelable: true })); await settle();
    assert(document.getElementById('earningsReport').hidden && document.getElementById('earningsReportStatus').textContent.includes('not set up'), 'Missing migration gives actionable error, no stale export');
    window.fixtureMode = 'data';
    document.getElementById('earningsFilters').dispatchEvent(new Event('submit', { cancelable: true })); await settle();
    assert(document.documentElement.scrollWidth <= window.innerWidth, 'Page fits viewport without horizontal overflow');
    document.body.dataset.testResult = 'PASS: ' + checks.length + ' checks; viewport=' + window.innerWidth;
  } catch (error) { document.body.dataset.testResult = 'FAIL: ' + error.message; }
})();
