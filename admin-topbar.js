/* Shared admin topbar — mounts into <div id="admin-topbar-root"></div>
   Bell opens notification dropdown; avatar opens admin settings. */
(function () {
  var CSS =
    '.admin-topbar{display:flex;align-items:center;justify-content:flex-end;gap:14px;' +
    'max-width:1440px;margin:0 auto 18px;background:rgba(255,255,255,.72);' +
    'border:1px solid rgba(255,255,255,.72);border-radius:14px;padding:14px 18px;' +
    'box-shadow:0 18px 48px -34px rgba(10,37,64,.5);backdrop-filter:blur(18px);' +
    'position:relative;z-index:80;overflow:visible}' +
    '.admin-topbar.has-welcome{justify-content:space-between}' +
    '.admin-topbar .welcome{flex:1;text-align:center;font-size:clamp(15px,2vw,20px);font-weight:700;color:#0A2540}' +
    '.admin-topbar .top-icons{display:flex;align-items:center;gap:12px;position:relative;margin-left:auto;overflow:visible}' +
    '.admin-topbar .bell,.admin-topbar .avatar-btn{' +
    'width:38px;height:38px;border:1px solid rgba(211,221,234,.78);border-radius:8px;' +
    'background:rgba(255,255,255,.62);color:#0A2540;display:grid;place-items:center;cursor:pointer;position:relative}' +
    '.admin-topbar .avatar-btn{width:36px;height:36px;border-radius:50%;' +
    'background:linear-gradient(155deg,#2485FF 0%,#0052CC 100%);color:#fff;border:0;' +
    'box-shadow:0 8px 18px -10px rgba(0,82,204,.7)}' +
    '.admin-topbar .badge{position:absolute;top:-7px;right:-7px;min-width:18px;height:18px;padding:0 4px;border-radius:999px;' +
    'display:none;place-items:center;background:#e11d48;color:#fff;font-size:11px;font-weight:800;box-sizing:border-box}' +
    '.admin-topbar .badge.show{display:grid}' +
    '.admin-dropdown{position:absolute;top:calc(100% + 10px);right:0;z-index:90;display:none;' +
    'width:min(380px,calc(100vw - 40px));max-height:min(70vh,480px);background:#fff;' +
    'border:1px solid rgba(10,37,64,.1);border-radius:16px;padding:12px;' +
    'box-shadow:0 24px 60px -20px rgba(10,37,64,.45);overflow:hidden}' +
    '.admin-dropdown.open{display:flex;flex-direction:column}' +
    '.admin-dropdown .drop-title{display:flex;align-items:center;justify-content:space-between;' +
    'padding:6px 8px 12px;border-bottom:1px solid rgba(10,37,64,.08);margin-bottom:8px;flex:0 0 auto}' +
    '.admin-dropdown .drop-title strong{font-size:14px;font-weight:800;color:#0A2540}' +
    '.admin-dropdown .drop-title span{font-size:12px;font-weight:700;color:#1D5BD6}' +
    '.admin-dropdown .notif-scroll{overflow:auto;max-height:min(52vh,360px);padding-right:2px}' +
    '.admin-dropdown .notif-empty{padding:18px 10px;text-align:center;color:#64748B;font-size:13px;font-weight:600}' +
    '.notif-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:start;' +
    'padding:10px 8px;border-radius:12px;text-decoration:none;color:inherit}' +
    '.notif-item:hover{background:#F3F7FF}' +
    '.notif-item .n-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:0 0 auto}' +
    '.notif-item .n-icon.ok{background:#E4F8EF;color:#0F9B6A}' +
    '.notif-item .n-icon.warn{background:#FFF4E0;color:#D97706}' +
    '.notif-item .n-icon.info{background:#E8F1FF;color:#1D5BD6}' +
    '.notif-item .n-copy{min-width:0}' +
    '.notif-item strong{display:block;font-size:13px;font-weight:700;line-height:1.3;margin-bottom:2px;' +
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.notif-item p{font-size:12px;color:#64748B;line-height:1.35;margin:0;' +
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
    '.notif-item time{font-size:11px;color:#94A3B8;white-space:nowrap}' +
    '.settings-profile{display:flex;align-items:center;gap:12px;padding:10px 8px 14px;' +
    'border-bottom:1px solid rgba(10,37,64,.08);margin-bottom:8px;text-decoration:none;color:inherit;border-radius:12px}' +
    '.settings-profile:hover{background:#F3F7FF}' +
    '.settings-profile .s-avatar{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;' +
    'background:linear-gradient(155deg,#2485FF 0%,#0052CC 100%);color:#fff;flex:0 0 auto}' +
    '.settings-profile strong{display:block;font-size:14px;font-weight:800}' +
    '.settings-profile span{display:block;font-size:12px;color:#64748B;margin-top:2px;overflow:hidden;text-overflow:ellipsis}' +
    '.settings-item{width:100%;display:flex;align-items:center;gap:12px;padding:11px 10px;' +
    'border:0;border-radius:12px;background:transparent;color:#0A2540;font:inherit;' +
    'text-align:left;text-decoration:none;cursor:pointer;box-sizing:border-box}' +
    '.settings-item:hover{background:#F3F7FF}' +
    '.settings-item .s-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;' +
    'background:#E8F1FF;color:#1D5BD6;flex:0 0 auto}' +
    '.settings-item .s-icon.danger{background:#FDEAEA;color:#DC2626}' +
    '.settings-item .s-text{flex:1;min-width:0}' +
    '.settings-item strong{display:block;font-size:13px;font-weight:700}' +
    '.settings-item small{display:block;font-size:11px;color:#64748B;margin-top:2px}' +
    '.settings-item .chev{margin-left:auto;color:#94A3B8;flex:0 0 auto}' +
    '@media (max-width:840px){.admin-topbar{min-height:68px;padding-left:76px;padding-right:18px;justify-content:flex-end}}' +
    '@media (max-width:520px){.admin-topbar .welcome{display:none}}';

  function ensureStyles() {
    if (document.getElementById('adminTopbarStyle')) return;
    var style = document.createElement('style');
    style.id = 'adminTopbarStyle';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function roleLabel(role) {
    if (role === 'admin' || role === 'super_admin') return 'Admin';
    return 'Admin';
  }

  function buildTopbar(welcome, user) {
    var name = (user && (user.full_name || user.username)) || 'Admin';
    var email = (user && user.email) || 'admin@gcash.local';
    var welcomeHtml = welcome
      ? '<div class="welcome" id="adminWelcomeText">' + escapeHtml(welcome) + '</div>'
      : '';

    return '' +
      '<header class="admin-topbar' + (welcome ? ' has-welcome' : '') + '">' +
        welcomeHtml +
        '<div class="top-icons">' +
          '<button class="bell" id="adminNotifBtn" type="button" aria-label="Notifications" aria-expanded="false" aria-controls="adminNotifDropdown">' +
            '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
              '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/>' +
              '<path d="M13.7 21a2 2 0 0 1-3.4 0"/>' +
            '</svg>' +
            '<span class="badge" id="adminNotifBadge">0</span>' +
          '</button>' +
          '<button class="avatar-btn" id="adminSettingsBtn" type="button" aria-label="Admin settings" aria-expanded="false" aria-controls="adminSettingsDropdown">' +
            '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
              '<circle cx="12" cy="8" r="3"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>' +
            '</svg>' +
          '</button>' +

          '<div class="admin-dropdown" id="adminNotifDropdown" role="menu" aria-label="Notifications">' +
            '<div class="drop-title"><strong>Notifications</strong><span id="adminNotifCountLabel">0 new</span></div>' +
            '<div class="notif-scroll" id="adminNotifList">' +
              '<div class="notif-empty">Loading notifications…</div>' +
            '</div>' +
          '</div>' +

          '<div class="admin-dropdown" id="adminSettingsDropdown" role="menu" aria-label="Admin settings">' +
            '<a class="settings-profile" href="admin-settings.html">' +
              '<div class="s-avatar"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/></svg></div>' +
              '<div><strong id="adminProfileName">' + escapeHtml(name) + '</strong><span id="adminProfileEmail">' + escapeHtml(email) + '</span></div>' +
            '</a>' +
            '<a class="settings-item" href="admin-settings.html">' +
              '<div class="s-icon"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/></svg></div>' +
              '<span class="s-text"><strong>Account Settings</strong><small>View and update admin profile</small></span>' +
              '<svg class="chev" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>' +
            '</a>' +
            '<a class="settings-item" href="admin-settings.html#password">' +
              '<div class="s-icon"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>' +
              '<span class="s-text"><strong>Change Password</strong><small>Update your account password</small></span>' +
              '<svg class="chev" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>' +
            '</a>' +
            '<a class="settings-item" href="admin-settings.html#security">' +
              '<div class="s-icon"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 3l7 4v5c0 5-3 8-7 9-4-1-7-4-7-9V7l7-4z"/></svg></div>' +
              '<span class="s-text"><strong>Security</strong><small>Login alerts and access control</small></span>' +
              '<svg class="chev" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>' +
            '</a>' +
            '<button class="settings-item" type="button" id="adminLogoutBtn">' +
              '<div class="s-icon danger"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H3"/></svg></div>' +
              '<span class="s-text"><strong>Log Out</strong><small>Sign out from your account</small></span>' +
              '<svg class="chev" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</header>';
  }

  function iconClass(n) {
    if (n.severity === 'warning' || n.severity === 'danger' || n.category === 'alerts') return 'warn';
    if (n.severity === 'success' || n.category === 'transactions') return 'ok';
    return 'info';
  }

  function iconSvg(cls) {
    if (cls === 'ok') {
      return '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
    }
    if (cls === 'warn') {
      return '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 3l10 18H2L12 3z"/><path d="M12 9v5M12 17h.01"/></svg>';
    }
    return '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/></svg>';
  }

  function renderNotifs(items) {
    var list = document.getElementById('adminNotifList');
    var badge = document.getElementById('adminNotifBadge');
    var countLabel = document.getElementById('adminNotifCountLabel');
    if (!list) return;

    var unread = (items || []).filter(function (n) { return !n.isRead; }).length;
    var total = (items || []).length;

    if (badge) {
      badge.textContent = String(Math.min(unread || total, 99));
      badge.classList.toggle('show', (unread || total) > 0);
    }
    if (countLabel) countLabel.textContent = (unread || total) + ' new';

    if (!items || !items.length) {
      list.innerHTML = '<div class="notif-empty">No notifications yet.</div>';
      return;
    }

    list.innerHTML = items.slice(0, 12).map(function (n) {
      var cls = iconClass(n);
      var href = n.href || 'system-logs.html';
      return '' +
        '<a class="notif-item" href="' + href + '">' +
          '<div class="n-icon ' + cls + '">' + iconSvg(cls) + '</div>' +
          '<div class="n-copy"><strong>' + escapeHtml(n.title) + '</strong><p>' + escapeHtml(n.body) + '</p></div>' +
          '<time>' + escapeHtml(n.timeLabel) + '</time>' +
        '</a>';
    }).join('');
  }

  function closeAll() {
    document.querySelectorAll('.admin-dropdown.open').forEach(function (el) {
      el.classList.remove('open');
    });
    var notifBtn = document.getElementById('adminNotifBtn');
    var settingsBtn = document.getElementById('adminSettingsBtn');
    if (notifBtn) notifBtn.setAttribute('aria-expanded', 'false');
    if (settingsBtn) settingsBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleDropdown(btn, dropdown) {
    var willOpen = !dropdown.classList.contains('open');
    closeAll();
    if (willOpen) {
      dropdown.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
  }

  function openLogoutModal() {
    closeAll();
    var modal = document.getElementById('logoutModal');
    if (modal) {
      modal.dataset.targetHref = 'login.html';
      modal.classList.add('active');
      return;
    }
    if (window.confirm('Are you sure you want to log out?')) {
      window.location.href = 'login.html';
    }
  }

  function bindTopbar() {
    var notifBtn = document.getElementById('adminNotifBtn');
    var settingsBtn = document.getElementById('adminSettingsBtn');
    var notifDrop = document.getElementById('adminNotifDropdown');
    var settingsDrop = document.getElementById('adminSettingsDropdown');
    var logoutBtn = document.getElementById('adminLogoutBtn');
    if (!notifBtn || !settingsBtn) return;

    notifBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleDropdown(notifBtn, notifDrop);
    });

    settingsBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleDropdown(settingsBtn, settingsDrop);
    });

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openLogoutModal();
      });
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest('.admin-dropdown') || e.target.closest('#adminNotifBtn') || e.target.closest('#adminSettingsBtn')) {
        return;
      }
      closeAll();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
    });
  }

  async function loadAdminNotifications() {
    if (!window.GcordAPI || !GcordAPI.listNotifications) {
      renderNotifs([]);
      return;
    }
    try {
      var items = await GcordAPI.listNotifications({ adminFeed: true, limit: 20 });
      renderNotifs(items);
    } catch (err) {
      var list = document.getElementById('adminNotifList');
      if (list) list.innerHTML = '<div class="notif-empty">Could not load notifications.</div>';
    }
  }

  ensureStyles();

  var root = document.getElementById('admin-topbar-root');
  if (root) {
    var user = (window.GcordAPI && GcordAPI.getSession && GcordAPI.getSession()) || null;
    var first = user && (user.first_name || (user.full_name || '').split(' ')[0] || user.username);
    var welcomeAttr = root.getAttribute('data-welcome') || '';
    var welcome = welcomeAttr
      ? welcomeAttr.replace(/Super Admin|Admin/i, roleLabel(user && user.role))
      : (first ? ('Welcome back, ' + first + '!') : 'Welcome back!');
    if (user && user.full_name) {
      welcome = 'Welcome back, ' + (user.first_name || user.full_name.split(' ')[0]) + '!';
    }
    root.outerHTML = buildTopbar(welcome, user);
    bindTopbar();
    loadAdminNotifications();
  }
})();
