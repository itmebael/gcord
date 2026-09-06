/* Supabase client + API helpers for Gcord */
(function (global) {
  var SESSION_KEY = 'gcord_session';

  function getSessionToken() {
    var s = getSession();
    return (s && s.session_token) || '';
  }

  function requireClient() {
    if (!global.supabase || !global.GCORD_SUPABASE) {
      throw new Error('Supabase SDK or config missing. Load supabase-config.js and supabase-js first.');
    }
    if (!global.__gcordSb) {
      global.__gcordSb = global.supabase.createClient(
        global.GCORD_SUPABASE.url,
        global.GCORD_SUPABASE.anonKey,
        {
          global: {
            fetch: function (input, init) {
              init = init || {};
              var headers = new Headers(init.headers || {});
              var token = getSessionToken();
              if (token) headers.set('x-gcord-session', token);
              init.headers = headers;
              return fetch(input, init);
            }
          }
        }
      );
    }
    return global.__gcordSb;
  }

  function getSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setSession(user) {
    var session = {
      id: user.id || user.user_id,
      username: user.username,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      full_name: user.full_name || ((user.first_name || '') + ' ' + (user.last_name || '')).trim(),
      role: user.role,
      phone: user.phone || null,
      session_token: user.session_token || null
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function getCurrentUser() {
    return getSession();
  }

  async function requireActiveSession() {
    var user = getSession();
    var message = 'Your session is no longer valid. Please sign in again on this device. Signing in on another device may have ended this session.';
    if (!user || !user.id || !user.session_token) throw new Error(message);
    var check = await requireClient().rpc('app_current_user_id');
    if (check.error) throw new Error('Could not verify your login: ' + check.error.message);
    if (check.data == null || String(check.data) !== String(user.id)) throw new Error(message);
    return user;
  }

  function isAdmin(user) {
    var u = user || getSession();
    return !!(u && (u.role === 'admin' || u.role === 'super_admin'));
  }

  function requireAuth(options) {
    options = options || {};
    var user = getSession();
    if (!user) {
      window.location.href = 'login.html';
      return null;
    }
    if (options.adminOnly && !isAdmin(user)) {
      window.location.href = 'dashboard.html';
      return null;
    }
    return user;
  }

  function formatAmount(value) {
    var n = Number(value) || 0;
    return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    var raw = String(dateStr);
    var dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    var d = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(raw);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function manilaDateKey(date) {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date || new Date());
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + '-' + values.month + '-' + values.day;
  }

  function nextDateKey(dateKey) {
    var parts = String(dateKey).split('-');
    var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + 1));
    return date.toISOString().slice(0, 10);
  }

  function manilaDayStartUtc(dateKey) {
    var parts = String(dateKey).split('-');
    return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0) - (8 * 60 * 60 * 1000))
      .toISOString().slice(0, 19);
  }

  function formatRecordedDate(timestamp) {
    if (!timestamp) return '—';
    var date = parseDatabaseTimestamp(timestamp);
    if (isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date);
  }

  function formatRecordedTime(timestamp) {
    if (!timestamp) return '—';
    var date = parseDatabaseTimestamp(timestamp);
    if (isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila',
      hour: 'numeric',
      minute: '2-digit'
    }).format(date);
  }

  function parseDatabaseTimestamp(timestamp) {
    var raw = String(timestamp);
    var normalized = raw.indexOf(' ') >= 0 ? raw.replace(' ', 'T') : raw;
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) normalized += 'Z';
    return new Date(normalized);
  }

  function formatTime(timeStr) {
    if (!timeStr) return '—';
    var raw = String(timeStr);
    if (/AM|PM/i.test(raw)) return raw;
    var parts = raw.split(':');
    var h = Number(parts[0]);
    var m = parts[1] || '00';
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + String(m).slice(0, 2) + ' ' + ampm;
  }

  function normalizeRef(ref) {
    return String(ref || '').replace(/\D/g, '');
  }

  function normalizeNumber(num) {
    var n = String(num || '').replace(/\D/g, '');
    if (n.indexOf('63') === 0 && n.length >= 12) n = '0' + n.slice(2);
    return n;
  }

  function formatRefDisplay(ref) {
    var digits = normalizeRef(ref);
    if (digits.length < 7) return '#' + digits;
    return '#' + digits.slice(0, 5) + '<br>' + digits.slice(5, 10) + (digits.length > 10 ? '<br>' + digits.slice(10) : '');
  }

  function mapTransaction(row) {
    return {
      id: String(row.id),
      ref: row.ref_no,
      recipient: row.recipient_name,
      number: row.recipient_number,
      amount: Number(row.amount) || 0,
      amountLabel: formatAmount(row.amount),
      date: formatDate(row.txn_date),
      time: formatTime(row.txn_time),
      txnDate: row.txn_date || null,
      txnTime: row.txn_time || null,
      recordedDate: formatRecordedDate(row.created_at),
      recordedTime: formatRecordedTime(row.created_at),
      status: row.status === 'duplicate' ? 'duplicate' : 'verified',
      source: row.source || 'scan',
      createdAt: row.created_at,
      createdBy: row.created_by_user_id
    };
  }

  function sha256Hex(text) {
    return global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  async function hashPassword(password) {
    if (global.bcrypt && typeof global.bcrypt.hashSync === 'function') {
      return global.bcrypt.hashSync(password, 10);
    }
    if (global.dcodeIO && global.dcodeIO.bcrypt && typeof global.dcodeIO.bcrypt.hashSync === 'function') {
      return global.dcodeIO.bcrypt.hashSync(password, 10);
    }
    var digest = await sha256Hex('gcord:' + password);
    return 'sha256$' + digest;
  }

  async function verifyPassword(password, hash) {
    var h = String(hash || '');
    if (!h) return false;
    if (h.indexOf('placeholder') !== -1) {
      return password === 'admin1234' || password === 'staff1234';
    }
    if (h.indexOf('sha256$') === 0) {
      var digest = await sha256Hex('gcord:' + password);
      return h === 'sha256$' + digest;
    }
    if (global.bcrypt && typeof global.bcrypt.compareSync === 'function') {
      try { return global.bcrypt.compareSync(password, h); } catch (e) { return false; }
    }
    if (global.dcodeIO && global.dcodeIO.bcrypt && typeof global.dcodeIO.bcrypt.compareSync === 'function') {
      try { return global.dcodeIO.bcrypt.compareSync(password, h); } catch (e) { return false; }
    }
    return password === h;
  }

  async function login(identifier, password) {
    var sb = requireClient();
    var id = String(identifier || '').trim();
    var pwd = String(password || '');
    if (!id || !pwd) throw new Error('Enter username/email and password.');

    // Prefer SQL login (creates DB session token for RLS)
    var rpc = await sb.rpc('app_login', { p_identifier: id, p_password: pwd });
    if (!rpc.error && rpc.data) {
      var row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      if (!row || row.ok === false) {
        throw new Error((row && row.message) || 'Login failed.');
      }
      return setSession({
        id: row.user_id,
        username: row.username,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
        full_name: row.full_name,
        phone: row.phone,
        role: row.role,
        session_token: row.session_token
      });
    }

    // Fallback if RLS migration not applied yet
    var byEmail = await sb
      .from('users')
      .select('id,username,email,password_hash,first_name,last_name,full_name,phone,role,status,verification_status')
      .eq('email', id)
      .maybeSingle();
    var user = byEmail.data;
    if (!user) {
      var byUser = await sb
        .from('users')
        .select('id,username,email,password_hash,first_name,last_name,full_name,phone,role,status,verification_status')
        .eq('username', id)
        .maybeSingle();
      if (byUser.error) throw byUser.error;
      user = byUser.data;
    } else if (byEmail.error) {
      throw byEmail.error;
    }

    if (!user) throw new Error(rpc.error ? ('Login failed. Run database/rls_privacy.sql in Supabase. (' + rpc.error.message + ')') : 'Account not found.');
    if (user.status !== 'active') throw new Error('This account is inactive.');
    if (user.verification_status && user.verification_status !== 'verified') {
      throw new Error('Account is not verified yet. Wait for Admin approval.');
    }

    var ok = await verifyPassword(pwd, user.password_hash);
    if (!ok) throw new Error('Incorrect password.');

    await sb.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
    await sb.from('system_logs').insert({
      actor_user_id: user.id,
      actor_name: user.full_name || (user.first_name + ' ' + user.last_name).trim(),
      actor_role: user.role,
      action_code: 'login',
      message: (user.role === 'staff' ? 'Staff ' : 'Admin ') +
        (user.full_name || user.first_name) + ' logged in',
      status: 'success',
      icon: 'login'
    });

    return setSession(user);
  }

  async function logout() {
    var user = getSession();
    try {
      if (user && user.session_token) {
        await requireClient().rpc('app_logout');
      } else if (user) {
        var sb = requireClient();
        await sb.from('system_logs').insert({
          actor_user_id: user.id,
          actor_name: user.full_name,
          actor_role: user.role,
          action_code: 'logout',
          message: (user.full_name || user.username) + ' logged out',
          status: 'success',
          icon: 'logout'
        });
      }
    } catch (e) { /* ignore */ }
    clearSession();
  }

  async function listUsers(filters) {
    var sb = requireClient();
    var q = sb.from('users').select(
      'id,username,email,first_name,last_name,middle_initial,full_name,phone,role,status,age,birthday,valid_id_url,face_capture_url,verification_status,verified_at,created_at,last_login_at'
    ).order('id', { ascending: true });
    if (filters && filters.role && filters.role !== 'all') q = q.eq('role', filters.role);
    if (filters && filters.status) q = q.eq('status', filters.status);
    var res = await q;
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function getUserStats() {
    var users = await listUsers();
    return {
      totalAdmins: users.filter(function (u) { return u.role === 'admin' || u.role === 'super_admin'; }).length,
      totalStaff: users.filter(function (u) { return u.role === 'staff'; }).length,
      activeAccounts: users.filter(function (u) { return u.status === 'active'; }).length,
      inactiveAccounts: users.filter(function (u) { return u.status === 'inactive'; }).length,
      admin: users.filter(function (u) { return u.role === 'admin' || u.role === 'super_admin'; }).length,
      users: users
    };
  }

  async function createUser(payload) {
    var sb = requireClient();
    var username = String(payload.username || '').trim() ||
      String(payload.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    var password = String(payload.password || '').trim();
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');

    var role = payload.role || 'staff';
    if (role !== 'staff' && role !== 'admin') {
      throw new Error('Role must be Staff or Admin.');
    }

    var passwordHash = await hashPassword(password);
    var row = {
      username: username,
      email: String(payload.email || '').trim().toLowerCase(),
      password_hash: passwordHash,
      first_name: String(payload.first_name || '').trim(),
      last_name: String(payload.last_name || '').trim(),
      middle_initial: payload.middle_initial ? String(payload.middle_initial).trim() : null,
      phone: payload.phone ? normalizeNumber(payload.phone) : null,
      role: role,
      status: payload.status || 'active',
      age: payload.age != null ? Number(payload.age) : null,
      birthday: payload.birthday || null,
      valid_id_url: payload.valid_id_url || null,
      face_capture_url: payload.face_capture_url || null,
      // Admin-created accounts are auto-verified; public signup uses pending
      verification_status: payload.verification_status || 'verified',
      verified_at: (payload.verification_status === 'pending') ? null : new Date().toISOString(),
      verified_by_user_id: (payload.verification_status === 'pending') ? null : (getSession() && getSession().id) || null
    };

    var res = await sb.from('users').insert(row).select('id,username,email,first_name,last_name,full_name,phone,role,status,created_at').single();
    if (res.error) throw res.error;

    await sb.from('user_security_settings').insert({
      user_id: res.data.id,
      login_alerts: true,
      duplicate_alerts: true,
      require_reauth: false
    });

    var actor = getSession();
    await sb.from('system_logs').insert({
      actor_user_id: actor ? actor.id : null,
      actor_name: actor ? actor.full_name : 'Admin',
      actor_role: actor ? actor.role : 'admin',
      action_code: 'create_admin',
      message: 'Account created: ' + (res.data.full_name || res.data.email),
      status: 'success',
      icon: 'update'
    });

    return res.data;
  }

  async function updateUser(id, patch) {
    var sb = requireClient();
    var data = {};
    if (patch.first_name != null) data.first_name = String(patch.first_name).trim();
    if (patch.last_name != null) data.last_name = String(patch.last_name).trim();
    if (patch.email != null) data.email = String(patch.email).trim().toLowerCase();
    if (patch.phone != null) data.phone = normalizeNumber(patch.phone);
    if (patch.role != null) {
      if (patch.role !== 'staff' && patch.role !== 'admin') {
        throw new Error('Role must be Staff or Admin.');
      }
      data.role = patch.role;
    }
    if (patch.status != null) data.status = patch.status;
    var res = await sb.from('users').update(data).eq('id', id).select('id,username,email,first_name,last_name,full_name,phone,role,status').single();
    if (res.error) throw res.error;
    return res.data;
  }

  async function changePassword(currentPassword, newPassword) {
    var session = getSession();
    if (!session || !session.id) throw new Error('Please sign in again.');

    var current = String(currentPassword || '');
    var next = String(newPassword || '');
    if (!current) throw new Error('Current password is required.');
    if (next.length < 8) throw new Error('New password must be at least 8 characters.');
    if (current === next) throw new Error('New password must be different from the current password.');

    var sb = requireClient();

    // Prefer SQL RPC when available (verifies + updates server-side)
    var rpc = await sb.rpc('app_change_password', {
      p_current_password: current,
      p_new_password: next
    });
    if (!rpc.error) {
      var row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      if (row && row.ok === false) {
        throw new Error(row.message || 'Could not update password.');
      }
      try {
        await sb.from('system_logs').insert({
          actor_user_id: session.id,
          actor_name: session.full_name || session.username || 'User',
          actor_role: session.role || 'staff',
          action_code: 'change_password',
          message: 'Password updated for ' + (session.username || session.email || session.id),
          status: 'success',
          icon: 'update'
        });
      } catch (e) { /* ignore log failures */ }
      return true;
    }

    var rpcMsg = String((rpc.error && rpc.error.message) || '');
    var missingFn = /could not find|does not exist|PGRST202/i.test(rpcMsg);
    if (!missingFn) {
      throw new Error(rpcMsg || 'Could not update password.');
    }

    // Fallback: verify current hash client-side, then update password_hash
    var res = await sb.from('users')
      .select('id,password_hash')
      .eq('id', session.id)
      .maybeSingle();
    if (res.error) throw res.error;
    if (!res.data) throw new Error('Account not found.');

    var ok = await verifyPassword(current, res.data.password_hash);
    if (!ok) throw new Error('Current password is incorrect.');

    var passwordHash = await hashPassword(next);
    var upd = await sb.from('users')
      .update({ password_hash: passwordHash })
      .eq('id', session.id)
      .select('id')
      .single();
    if (upd.error) throw upd.error;

    try {
      await sb.from('system_logs').insert({
        actor_user_id: session.id,
        actor_name: session.full_name || session.username || 'User',
        actor_role: session.role || 'staff',
        action_code: 'change_password',
        message: 'Password updated for ' + (session.username || session.email || session.id),
        status: 'success',
        icon: 'update'
      });
    } catch (e) { /* ignore log failures */ }

    return true;
  }

  async function deleteUser(id) {
    throw new Error('Accounts cannot be deleted. Deactivate the account instead.');
  }

  async function setUserActiveStatus(id, status) {
    if (status !== 'active' && status !== 'inactive') {
      throw new Error('Invalid status.');
    }
    var session = getSession();
    if (session && Number(session.id) === Number(id) && status === 'inactive') {
      throw new Error('You cannot deactivate your own account.');
    }
    return updateUser(id, { status: status });
  }

  async function setUserVerification(id, verificationStatus) {
    if (verificationStatus !== 'verified' && verificationStatus !== 'rejected' && verificationStatus !== 'pending') {
      throw new Error('Invalid verification status.');
    }
    if (!isAdmin()) throw new Error('Only Admin can verify accounts.');
    var sb = requireClient();
    var session = getSession();
    var data = {
      verification_status: verificationStatus,
      verified_at: verificationStatus === 'verified' ? new Date().toISOString() : null,
      verified_by_user_id: verificationStatus === 'verified' ? (session && session.id) : null
    };
    var res = await sb.from('users').update(data).eq('id', id)
      .select('id,username,email,first_name,last_name,full_name,phone,role,status,age,birthday,valid_id_url,face_capture_url,verification_status,verified_at')
      .single();
    if (res.error) throw res.error;

    await sb.from('system_logs').insert({
      actor_user_id: session ? session.id : null,
      actor_name: session ? session.full_name : 'Admin',
      actor_role: session ? session.role : 'admin',
      action_code: 'verify_account',
      message: 'Account ' + verificationStatus + ': ' + (res.data.full_name || res.data.email),
      status: verificationStatus === 'verified' ? 'success' : 'warning',
      icon: verificationStatus === 'verified' ? 'update' : 'warn'
    });

    return res.data;
  }

  async function registerSignup(payload) {
    if (!global.GcordIdentity) throw new Error('Open the signup page to verify your email first.');
    return global.GcordIdentity.signup(payload);
  }
  /**
   * Privacy rule:
   * - Staff see ONLY their own transactions (created_by_user_id = session.id)
  * - Admin sees ALL transactions
   * Duplicate-ref checks remain global for fraud protection.
   */
  async function listTransactions(options) {
    options = options || {};
    var sb = requireClient();
    var user = getSession();
    var q = sb
      .from('transactions')
      .select('id,ref_no,recipient_name,recipient_number,amount,txn_date,txn_time,status,source,created_by_user_id,created_at')
      .order('created_at', { ascending: false });

    if (options.userId) {
      q = q.eq('created_by_user_id', options.userId);
    } else if (!user) {
      return [];
    } else if (!isAdmin(user) && !options.all) {
      // Staff (and any non-admin): only own transactions
      q = q.eq('created_by_user_id', user.id);
    }

    if (options.useRecordedDate && options.fromDate && options.toDate) {
      q = q.gte('created_at', manilaDayStartUtc(options.fromDate));
      q = q.lt('created_at', manilaDayStartUtc(nextDateKey(options.toDate)));
    } else {
      if (options.fromDate) q = q.gte('txn_date', options.fromDate);
      if (options.toDate) q = q.lte('txn_date', options.toDate);
    }
    if (options.status === 'verified' || options.status === 'duplicate') {
      q = q.eq('status', options.status);
    }
    // admin → all rows

    var res = await q;
    if (res.error) throw res.error;
    return (res.data || []).map(mapTransaction);
  }

  async function getAdminReport(options) {
    options = options || {};
    if (!isAdmin()) throw new Error('Admin access required.');
    // RLS returns no rows for inactive sessions, which is not an empty report.
    var session = getSession();
    if (!session.session_token) throw new Error('Your session is no longer valid. Please sign in again.');
    var sessionCheck = await requireClient().rpc('app_current_user_id');
    if (sessionCheck.error) throw sessionCheck.error;
    if (sessionCheck.data == null || String(sessionCheck.data) !== String(session.id)) {
      throw new Error('Your session is no longer valid. Please sign in again. Signing in on another device may have ended this session.');
    }

    var type = options.type || 'all'; // all | transactions | duplicates | usage
    var status = type === 'transactions' ? 'verified'
      : (type === 'duplicates' ? 'duplicate' : null);

    var list = await listTransactions({
      all: true,
      userId: options.userId || null,
      fromDate: options.fromDate || null,
      toDate: options.toDate || null,
      useRecordedDate: options.useRecordedDate === true,
      status: status
    });

    var users = [];
    try { users = await listUsers(); } catch (e) { users = []; }
    var userMap = {};
    users.forEach(function (u) {
      userMap[u.id] = u.full_name || ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.username;
    });

    list = list.map(function (tx) {
      return Object.assign({}, tx, {
        staffName: userMap[tx.createdBy] || ('User #' + (tx.createdBy || '—'))
      });
    });

    var verified = list.filter(function (tx) { return tx.status === 'verified'; });
    var duplicate = list.filter(function (tx) { return tx.status === 'duplicate'; });
    var cashOut = verified.reduce(function (sum, tx) { return sum + (Number(tx.amount) || 0); }, 0);

    var usage = [];
    if (type === 'usage' || type === 'all') {
      var bucket = {};
      list.forEach(function (tx) {
        var key = tx.createdBy || 'unknown';
        if (!bucket[key]) {
          bucket[key] = {
            userId: tx.createdBy,
            staffName: tx.staffName,
            total: 0,
            verified: 0,
            duplicate: 0,
            cashOut: 0
          };
        }
        bucket[key].total += 1;
        if (tx.status === 'duplicate') bucket[key].duplicate += 1;
        else {
          bucket[key].verified += 1;
          bucket[key].cashOut += Number(tx.amount) || 0;
        }
      });
      usage = Object.keys(bucket).map(function (k) { return bucket[k]; })
        .sort(function (a, b) { return b.total - a.total || b.cashOut - a.cashOut; });
    }

    return {
      type: type,
      fromDate: options.fromDate || null,
      toDate: options.toDate || null,
      total: list.length,
      verified: verified.length,
      duplicate: duplicate.length,
      cashOut: cashOut,
      cashOutLabel: formatAmount(cashOut),
      transactions: list,
      usage: usage
    };
  }

  async function getTransactionStats(options) {
    var list = await listTransactions(options);
    var verified = list.filter(function (tx) { return tx.status === 'verified'; });
    var duplicate = list.filter(function (tx) { return tx.status === 'duplicate'; });
    var cashOut = verified.reduce(function (sum, tx) { return sum + (Number(tx.amount) || 0); }, 0);
    return {
      total: list.length,
      verified: verified.length,
      duplicate: duplicate.length,
      cashOut: cashOut,
      cashOutLabel: formatAmount(cashOut),
      list: list
    };
  }

  async function findTransactionByRef(ref) {
    var sb = requireClient();
    var key = normalizeRef(ref);
    var rpc = await sb.rpc('app_find_transaction_by_ref', { p_ref: key });
    if (!rpc.error) {
      var row = Array.isArray(rpc.data) ? rpc.data[0] : (rpc.data && rpc.data[0]) || rpc.data;
      if (row) {
        var claim = await sb.rpc('app_duplicate_claim_details', { p_ref: key });
        if (!claim.error) {
          var claimRow = Array.isArray(claim.data) ? claim.data[0] : claim.data;
          if (claimRow) row = Object.assign({}, row, claimRow);
        }
        // Read claim details under the current user's existing row permissions.
        var detail = await sb.from('transactions')
          .select('recipient_name,txn_date,txn_time').eq('id', row.id).maybeSingle();
        if (!detail.error && detail.data) row = Object.assign({}, row, detail.data);
      }
      return row || null;
    }
    // Fallback before RLS migration
    var res = await sb.from('transactions').select('id,ref_no,status,created_by_user_id,recipient_name,txn_date,txn_time').eq('ref_no', key).order('id', { ascending: true }).limit(1);
    if (res.error) throw res.error;
    return (res.data && res.data[0]) || null;
  }

  async function addTransaction(payload) {
    var sb = requireClient();
    var user = await requireActiveSession();
    var ref = normalizeRef(payload.ref);
    var number = normalizeNumber(payload.number);
    var amount = Number(String(payload.amount).replace(/[^\d.]/g, '')) || 0;
    var existing = await findTransactionByRef(ref);
    var status = existing ? 'duplicate' : 'verified';

    var ownerId = user && user.id ? user.id : null;
    // Staff always own their own rows; only admin may attribute on behalf of another user
    if (isAdmin(user) && payload.created_by_user_id) {
      ownerId = payload.created_by_user_id;
    }
    var actorName = payload.actor_name || (user && user.full_name) || null;
    var actorRole = payload.actor_role || (user && user.role) || null;

    var txnDate = payload.txn_date || null;
    var txnTime = payload.txn_time || null;

    if (!txnDate && payload.date) {
      var rawDate = String(payload.date).trim();
      var parsedDate = new Date(rawDate);
      if (/^(\d{4})-(\d{2})-(\d{2})$/.test(rawDate)) txnDate = rawDate;
      else if (!isNaN(parsedDate.getTime())) txnDate = manilaDateKey(parsedDate);
    }
    if (!txnDate) txnDate = manilaDateKey();

    if (!txnTime && payload.time) {
      var t = String(payload.time).trim();
      var m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (m) {
        var h = Number(m[1]);
        var min = m[2];
        var ap = (m[3] || '').toUpperCase();
        if (ap === 'PM' && h < 12) h += 12;
        if (ap === 'AM' && h === 12) h = 0;
        txnTime = String(h).padStart(2, '0') + ':' + min + ':00';
      }
    }
    if (!txnTime) txnTime = new Date().toTimeString().slice(0, 8);

    if (!ownerId) throw new Error('You must be logged in to save a transaction.');

    var insert = {
      ref_no: ref,
      recipient_name: String(payload.recipient || '').trim().toUpperCase(),
      recipient_number: number,
      amount: amount,
      txn_date: txnDate,
      txn_time: txnTime,
      status: status,
      source: payload.source || 'scan',
      created_by_user_id: ownerId,
      claimant_name: String(payload.claimant_name || '').trim() || null,
      matched_transaction_id: existing ? existing.id : null
    };

    var res = await sb.from('transactions').insert(insert).select('*').single();
    if (res.error) {
      if (res.error.code === '42501') {
        // A session can be ended on another device while the scan is being saved.
        await requireActiveSession();
        throw new Error('Your login is valid, but the database denied this transaction. Ask your administrator to check the transaction access rules.');
      }
      throw res.error;
    }

    if (status === 'duplicate' && existing) {
      await sb.from('duplicate_events').insert({
        ref_no: ref,
        original_transaction_id: existing.id,
        duplicate_transaction_id: res.data.id,
        amount: amount,
        resolved_status: 'blocked'
      });
    }

    await sb.from('notifications').insert({
      user_id: ownerId,
      category: status === 'duplicate' ? 'alerts' : 'transactions',
      title: status === 'duplicate' ? 'Duplicate transaction detected' : 'Transaction recorded successfully',
      body: status === 'duplicate'
        ? ('Recorded No. ' + ref + ' was blocked as duplicate')
        : ('Recorded No. ' + ref),
      ref_no: ref,
      transaction_id: res.data.id,
      severity: status === 'duplicate' ? 'warning' : 'success',
      is_read: false
    });

    // Notify admins about staff activity (SECURITY DEFINER RPC bypasses inbox RLS)
    if (!isAdmin(user)) {
      try {
        await sb.rpc('app_notify_admins', {
          p_category: status === 'duplicate' ? 'alerts' : 'transactions',
          p_title: status === 'duplicate' ? 'Duplicate transaction detected' : 'New transaction created',
          p_body: status === 'duplicate'
            ? ((actorName || 'Staff') + ' blocked duplicate Ref ' + ref)
            : ((actorName || 'Staff') + ' recorded a cash-out · Ref ' + ref),
          p_ref_no: ref,
          p_transaction_id: res.data.id,
          p_severity: status === 'duplicate' ? 'warning' : 'success'
        });
      } catch (e) { /* non-fatal if RPC not installed yet */ }
    }

    await sb.from('system_logs').insert({
      actor_user_id: ownerId,
      actor_name: actorName,
      actor_role: actorRole,
      action_code: status === 'duplicate' ? 'duplicate_detected' : 'create_transaction',
      message: status === 'duplicate'
        ? 'Duplicate transaction detected'
        : ((actorName || 'User') + ' created a transaction'),
      status: status === 'duplicate' ? 'warning' : 'success',
      icon: status === 'duplicate' ? 'warn' : 'create',
      transaction_id: res.data.id
    });

    return { transaction: mapTransaction(res.data), isDuplicate: res.data.status === 'duplicate' };
  }

  async function listSystemLogs(filters) {
    var sb = requireClient();
    var q = sb.from('system_logs').select('*').order('created_at', { ascending: false }).limit(100);
    if (filters && filters.date) {
      q = q.gte('created_at', filters.date + 'T00:00:00').lte('created_at', filters.date + 'T23:59:59');
    }
    var res = await q;
    if (res.error) throw res.error;
    return res.data || [];
  }

  async function getTopUsers(limit) {
    var sb = requireClient();
    var usersRes = await sb.from('users').select('id,full_name,role,first_name,last_name').in('role', ['staff', 'admin', 'super_admin']);
    if (usersRes.error) throw usersRes.error;
    var txnRes = await sb.from('transactions').select('created_by_user_id,amount,status');
    if (txnRes.error) throw txnRes.error;

    var map = {};
    (usersRes.data || []).forEach(function (u) {
      map[u.id] = {
        id: u.id,
        name: u.full_name || ((u.first_name || '') + ' ' + (u.last_name || '')).trim(),
        role: (u.role === 'admin' || u.role === 'super_admin') ? 'Admin' : 'Staff',
        count: 0,
        amount: 0
      };
    });
    (txnRes.data || []).forEach(function (t) {
      if (!t.created_by_user_id || !map[t.created_by_user_id]) return;
      map[t.created_by_user_id].count += 1;
      if (t.status === 'verified') map[t.created_by_user_id].amount += Number(t.amount) || 0;
    });

    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count || b.amount - a.amount; })
      .slice(0, limit || 5);
  }

  async function listDuplicateEvents() {
    var sb = requireClient();
    var user = getSession();
    if (!user) return [];

    var res = await sb
      .from('duplicate_events')
      .select('id,ref_no,amount,detected_at,resolved_status,original_transaction_id,duplicate_transaction_id')
      .order('detected_at', { ascending: false });

    if (res.error) {
      // Fallback: build from this user's duplicate transactions
      var txns = await listTransactions();
      return txns
        .filter(function (t) { return t.status === 'duplicate'; })
        .map(function (t) {
          return {
            id: t.id,
            ref: t.ref,
            refLabel: 'REF' + normalizeRef(t.ref),
            amount: t.amount,
            amountLabel: t.amountLabel,
            detectedAt: t.date + (t.time && t.time !== '—' ? ' • ' + t.time : ''),
            statusLabel: 'Blocked',
            origRef: 'REF' + normalizeRef(t.ref),
            origAmount: t.amountLabel,
            origStatus: 'Verified',
            origClaimant: 'Not available',
            origDate: 'Not available',
            matchRef: 'REF' + normalizeRef(t.ref),
            matchAmount: t.amountLabel,
            matchStatus: 'Duplicate',
            matchClaimant: t.recipient || 'Not available',
            matchDate: t.date + (t.time && t.time !== '—' ? ' • ' + t.time : '')
          };
        });
    }

    var rows = res.data || [];
    var ids = [];
    rows.forEach(function (r) {
      if (r.original_transaction_id) ids.push(r.original_transaction_id);
      if (r.duplicate_transaction_id) ids.push(r.duplicate_transaction_id);
    });

    var txnMap = {};
    if (ids.length) {
      var uniq = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
      var txnRes = await sb
        .from('transactions')
        .select('id,ref_no,recipient_name,amount,txn_date,txn_time,status')
        .in('id', uniq);
      if (!txnRes.error) {
        (txnRes.data || []).forEach(function (t) { txnMap[t.id] = t; });
      }
    }

    function fmtWhen(isoOrDate, timeStr) {
      if (isoOrDate && String(isoOrDate).indexOf('T') >= 0) {
        var d = new Date(isoOrDate);
        if (!isNaN(d.getTime())) {
          return d.toLocaleString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit'
          }).replace(',', ' •');
        }
      }
      var datePart = formatDate(isoOrDate);
      var timePart = formatTime(timeStr);
      if (datePart === '—' && timePart === '—') return '—';
      if (timePart === '—') return datePart;
      return datePart + ' • ' + timePart;
    }

    return rows.map(function (r) {
      var orig = txnMap[r.original_transaction_id];
      var dup = txnMap[r.duplicate_transaction_id];
      var refDigits = normalizeRef(r.ref_no);
      var amountLabel = formatAmount(r.amount);
      var when = fmtWhen(r.detected_at);
      var statusLabel = r.resolved_status === 'blocked' ? 'Blocked'
        : (r.resolved_status === 'reviewed' ? 'Reviewed' : 'Ignored');

      return {
        id: r.id,
        ref: refDigits,
        refLabel: 'REF' + refDigits,
        amount: Number(r.amount) || 0,
        amountLabel: amountLabel,
        detectedAt: when,
        statusLabel: statusLabel,
        origRef: 'REF' + normalizeRef((orig && orig.ref_no) || r.ref_no),
        origAmount: orig ? formatAmount(orig.amount) : amountLabel,
        origStatus: orig ? (orig.status === 'duplicate' ? 'Duplicate' : 'Verified') : 'Verified',
        origClaimant: orig && orig.recipient_name ? orig.recipient_name : 'Not available',
        origDate: orig ? fmtWhen(orig.txn_date, orig.txn_time) : 'Not available',
        matchRef: 'REF' + normalizeRef((dup && dup.ref_no) || r.ref_no),
        matchAmount: dup ? formatAmount(dup.amount) : amountLabel,
        matchStatus: dup ? (dup.status === 'duplicate' ? 'Duplicate' : 'Verified') : 'Duplicate',
        matchClaimant: dup && dup.recipient_name ? dup.recipient_name : 'Not available',
        matchDate: dup ? fmtWhen(dup.txn_date, dup.txn_time) : 'Not available'
      };
    });
  }

  async function listNotifications(options) {
    options = options || {};
    var sb = requireClient();
    var user = getSession();
    if (!user) return [];

    var q = sb
      .from('notifications')
      .select('id,user_id,category,title,body,ref_no,transaction_id,severity,is_read,created_at')
      .order('created_at', { ascending: false })
      .limit(options.limit || 80)
      .eq('user_id', user.id);

    var res = await q;
    if (res.error) throw res.error;

    var todayKey = manilaDateKey(new Date());
    var yesterdayKey = manilaDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    var mapped = (res.data || []).map(function (n) {
      var created = n.created_at ? parseDatabaseTimestamp(n.created_at) : null;
      var timeLabel = '—';
      var dayKey = 'older';
      if (created && !isNaN(created.getTime())) {
        timeLabel = formatRecordedTime(n.created_at);
        var createdDayKey = manilaDateKey(created);
        if (createdDayKey === todayKey) dayKey = 'today';
        else if (createdDayKey === yesterdayKey) dayKey = 'yesterday';
        else dayKey = 'older';
      }
      return {
        id: n.id,
        userId: n.user_id,
        category: n.category || 'system',
        title: n.title || 'Notification',
        body: n.body || '',
        ref: n.ref_no || null,
        severity: n.severity || 'info',
        isRead: !!n.is_read,
        createdAt: n.created_at,
        timeLabel: timeLabel,
        dayKey: dayKey,
        href: n.category === 'alerts' ? 'system-logs.html' : 'system-logs.html'
      };
    });

    // Admin topbar: if inbox empty, show recent system logs
    if (isAdmin(user) && options.adminFeed && !mapped.length) {
      try {
        var logs = await listSystemLogs();
        return (logs || []).slice(0, options.limit || 12).map(function (log, i) {
          var created = log.created_at ? parseDatabaseTimestamp(log.created_at) : null;
          var timeLabel = created && !isNaN(created.getTime())
            ? formatRecordedTime(log.created_at)
            : '—';
          var sev = log.status === 'warning' || log.status === 'error' ? 'warning' : 'info';
          if (log.action_code === 'create_transaction') sev = 'success';
          return {
            id: 'log-' + (log.id || i),
            userId: null,
            category: log.action_code === 'duplicate_detected' ? 'alerts'
              : (log.action_code === 'create_transaction' ? 'transactions' : 'system'),
            title: log.message || log.action_code || 'System activity',
            body: (log.actor_name ? (log.actor_name + ' · ') : '') + (log.action_code || 'system'),
            ref: null,
            severity: sev,
            isRead: false,
            createdAt: log.created_at,
            timeLabel: timeLabel,
            dayKey: 'today',
            href: 'system-logs.html'
          };
        });
      } catch (e) {
        return [];
      }
    }

    return mapped;
  }

  async function getDashboardSummary() {
    var userStats = await getUserStats();
    var txnStats = await getTransactionStats({ all: true }); // admin overview: all users
    var logs = await listSystemLogs();
    var topUsers = await getTopUsers(5);
    return {
      totalAdmins: userStats.totalAdmins,
      totalStaff: userStats.totalStaff,
      totalTransactions: txnStats.total,
      duplicateBlocked: txnStats.duplicate,
      transactions: txnStats.list,
      recentLogs: logs.slice(0, 5),
      topUsers: topUsers,
      cashOutLabel: txnStats.cashOutLabel
    };
  }

  function parseGCashText(rawText) {
    if (global.GcordTransactions && global.GcordTransactions.parseGCashText) {
      return global.GcordTransactions.parseGCashText(rawText);
    }
    return { recipient: '', number: '', amount: '', ref: '', date: '', time: '' };
  }

  global.GcordAPI = {
    client: requireClient,
    getSession: getSession,
    getCurrentUser: getCurrentUser,
    setSession: setSession,
    clearSession: clearSession,
    isAdmin: isAdmin,
    requireAuth: requireAuth,
    login: login,
    logout: logout,
    listUsers: listUsers,
    getUserStats: getUserStats,
    createUser: createUser,
    updateUser: updateUser,
    changePassword: changePassword,
    deleteUser: deleteUser,
    setUserActiveStatus: setUserActiveStatus,
    setUserVerification: setUserVerification,
    registerSignup: registerSignup,
    listTransactions: listTransactions,
    getTransactionStats: getTransactionStats,
    findTransactionByRef: findTransactionByRef,
    addTransaction: addTransaction,
    listSystemLogs: listSystemLogs,
    listDuplicateEvents: listDuplicateEvents,
    listNotifications: listNotifications,
    getTopUsers: getTopUsers,
    getDashboardSummary: getDashboardSummary,
    getAdminReport: getAdminReport,
    formatAmount: formatAmount,
    formatDate: formatDate,
    formatTime: formatTime,
    formatRefDisplay: formatRefDisplay,
    normalizeRef: normalizeRef,
    normalizeNumber: normalizeNumber,
    parseGCashText: parseGCashText
  };
})(window);
