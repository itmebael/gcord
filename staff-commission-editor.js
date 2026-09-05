(function () {
  'use strict';
  var root = document.getElementById('commissionTierForms');
  if (!root) return;
  var user = GcordAPI.requireAuth();
  if (!user) return;
  var status = document.getElementById('commissionEditorStatus');
  var reload = document.getElementById('reloadCommissionTiers');
  var add = document.getElementById('addCommissionTier');
  var busy = false;
  function message(node, text, error) { node.textContent = text; node.classList.toggle('error', !!error); }
  function tierForm(tier) {
    var form = document.createElement('form'); form.className = 'commission-tier-form';
    var heading = document.createElement('h3'); heading.textContent = tier.id ? 'Personal tier #' + tier.id : 'New personal tier';
    var fields = document.createElement('div'); fields.className = 'earnings-filters';
    [['min_amount', 'Minimum transaction (PHP)'], ['max_amount', 'Maximum transaction (PHP)'], ['payout_amount', 'Fixed payout (PHP)'], ['sort_order', 'Priority']].forEach(function (field) {
      var label = document.createElement('label'); label.textContent = field[1];
      var input = document.createElement('input'); input.type = 'number'; input.name = field[0]; input.required = true;
      input.step = field[0] === 'sort_order' ? '1' : '0.01';
      input.min = field[0] === 'sort_order' ? '-2147483648' : '0';
      input.max = field[0] === 'sort_order' ? '2147483647' : '9999999999.99';
      input.value = tier[field[0]]; label.appendChild(input); fields.appendChild(label);
    });
    var save = document.createElement('button'); save.type = 'submit'; save.className = 'earnings-button primary'; save.textContent = tier.id ? 'Save changes' : 'Create my tier'; fields.appendChild(save);
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'earnings-button'; cancel.textContent = 'Cancel'; cancel.hidden = !!tier.id; fields.appendChild(cancel);
    cancel.addEventListener('click', function () { if (!busy) form.remove(); });
    var note = document.createElement('p'); note.className = 'earnings-note'; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite');
    form.append(heading, fields, note);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (busy || !form.reportValidity()) return;
      var minimum = Number(form.elements.min_amount.value), maximum = Number(form.elements.max_amount.value);
      if (maximum < minimum) { message(note, 'Maximum must be at least equal to minimum.', true); return; }
      busy = true; reload.disabled = true; add.disabled = true;
      root.querySelectorAll('button').forEach(function (button) { button.disabled = true; });
      var controls = Array.from(form.querySelectorAll('input'));
      var creating = !tier.id;
      var args = { p_min_amount: minimum, p_max_amount: maximum,
        p_payout_amount: Number(form.elements.payout_amount.value), p_sort_order: Number(form.elements.sort_order.value) };
      if (!creating) { args.p_id = tier.id; args.p_expected_updated_at = tier.updated_at; }
      controls.forEach(function (input) { input.disabled = true; });
      message(note, 'Saving your tier...');
      try {
        var result = await GcordAPI.client().rpc(creating ? 'app_create_my_commission_tier' : 'app_update_my_commission_tier', args);
        if (result.error) throw result.error;
        var saved = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!saved || !saved.id || String(saved.user_id) !== String(user.id) || (!creating && String(saved.id) !== String(tier.id))) throw new Error('Could not confirm the saved tier. Reload your tiers.');
        tier = saved;
        heading.textContent = 'Personal tier #' + saved.id; save.textContent = 'Save changes'; cancel.hidden = true;
        message(status, 'Create or edit your personal tiers here.');
        controls.forEach(function (input) { input.value = saved[input.name]; });
        message(note, 'Saved. This tier applies to future claims; previous earnings are unchanged.');
      } catch (error) {
        message(note, error.code === 'PGRST202' ? 'Apply staff_edit_own_commission.sql in Supabase to enable personal tier editing.' : (error.message || 'Could not save. Please try again.'), true);
      } finally {
        busy = false; reload.disabled = false; add.disabled = false;
        controls.forEach(function (input) { input.disabled = false; });
        root.querySelectorAll('button').forEach(function (button) { button.disabled = false; });
      }
    });
    return form;
  }
  async function load() {
    if (busy) return;
    busy = true; reload.disabled = true; add.disabled = true; root.replaceChildren(); message(status, 'Loading your personal tiers...');
    try {
      var client = GcordAPI.client();
      var session = await client.rpc('app_current_user_id');
      if (session.error) throw session.error;
      if (String(session.data) !== String(user.id)) throw new Error('Please sign in again. Your session has expired.');
      var tiers = [], offset = 0;
      while (true) {
        var result = await client.from('commission_tiers').select('id,user_id,min_amount,max_amount,payout_amount,sort_order,updated_at')
          .eq('user_id', user.id).order('sort_order').order('id').range(offset, offset + 499);
        if (result.error) throw result.error;
        if (!result.data || !result.data.length) break;
        tiers = tiers.concat(result.data); offset += result.data.length;
      }
      tiers.filter(function (tier) { return String(tier.user_id) === String(user.id); }).forEach(function (tier) { root.appendChild(tierForm(tier)); });
      message(status, root.children.length ? 'Create or edit your personal tiers here.' : 'No personal tiers yet. Select Add my tier to create your first one.');
    } catch (error) { message(status, error.message || 'Could not load your tiers. Try reloading.', true); }
    finally { busy = false; reload.disabled = false; add.disabled = false; }
  }
  add.addEventListener('click', function () {
    if (busy) return;
    var form = tierForm({min_amount:'', max_amount:'', payout_amount:'', sort_order:0});
    root.prepend(form); form.querySelector('input').focus();
  });
  reload.addEventListener('click', load);
  load();
})();
