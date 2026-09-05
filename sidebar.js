/* Shared sidebar — single source of truth for all screens.
   Mounts into <div id="sidebar-root"></div> and highlights the active link. */
(function () {
  var ICON = {
    brand: '<svg width="22" height="22" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 10h8M8 14h5"/></svg>',
    dashboard: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
    transactions: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M17 7H5m0 0 4-4M5 7l4 4M7 17h12m0 0-4-4m4 4-4 4"/></svg>',
    scan: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"/><path d="M8 12h8"/></svg>',
    duplicate: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M12 3l10 18H2L12 3z"/><path d="M12 9v5M12 17h.01"/></svg>',
    reports: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M8 4h8l1 3h3v14H4V7h3l1-3z"/><path d="M8 12h8M8 16h8"/></svg>',
    profile: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/></svg>',
    notification: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    logout: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H3"/></svg>'
  };

  var MENU = [
    { page: 'dashboard', href: 'dashboard.html', label: 'Dashboard', icon: ICON.dashboard },
    { page: 'transactions', href: 'dashboard.html#transactions', label: 'My Transactions', icon: ICON.transactions },
    { page: 'earnings', href: 'earnings.html', label: 'My Earnings', icon: ICON.reports },
    { page: 'scan', href: 'scan.html', label: 'Scan &amp; Record', icon: ICON.scan },
    { page: 'duplicate', href: 'duplicate.html', label: 'Duplicate Management', icon: ICON.duplicate },
    { page: 'reports', href: 'reports.html', label: 'Reports &amp; Analytics', icon: ICON.reports },
    { page: 'profile', href: 'profile.html', label: 'Profile Management', icon: ICON.profile },
    { page: 'notification', href: 'notification.html', label: 'Notification', icon: ICON.notification }
  ];

  function currentPage() {
    var file = (location.pathname.split('/').pop() || 'dashboard.html').replace('.html', '');
    if (location.hash === '#transactions') return 'transactions';
    return file;
  }

  function buildSidebar() {
    var active = currentPage();
    var links = MENU.map(function (it) {
      var cls = it.page === active ? ' class="active"' : '';
      return '<a href="' + it.href + '" data-page="' + it.page + '"' + cls + '>' + it.icon + '<span>' + it.label + '</span></a>';
    }).join('');

    return '' +
      '<aside class="sidebar">' +
        '<div class="side-top">' +
          '<div class="brand-mark">' + ICON.brand + '</div>' +
          '<div class="brand-text"><strong>G-Cash</strong><span>Cash Out System</span></div>' +
        '</div>' +
        '<div class="menu-title">Main Menu</div>' +
        '<nav class="menu" aria-label="Main menu">' +
          links +
          '<a href="login.html" class="logout-link">' + ICON.logout + 'Log Out</a>' +
        '</nav>' +
      '</aside>';
  }

  var root = document.getElementById('sidebar-root');
  if (root) root.outerHTML = buildSidebar();

  // ---- Mobile: burger icon opens sidebar as right drawer ----
  var MOBILE_NAV_CSS =
    '.sidebar{min-height:0;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow:hidden}' +
    '.sidebar .side-top,.sidebar .menu-title{flex-shrink:0}' +
    '.sidebar .menu{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;' +
    'overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.5) transparent}' +
    '.sidebar .menu a{flex-shrink:0;min-width:0}' +
    '.sidebar .menu a span{min-width:0;overflow-wrap:break-word}' +
    '.nav-burger{display:none;position:fixed;top:16px;left:16px;z-index:210;' +
    'width:46px;height:46px;border:1px solid rgba(211,221,234,.9);border-radius:14px;' +
    'background:rgba(255,255,255,.92);color:#0A2540;box-shadow:0 12px 28px -18px rgba(10,37,64,.45);' +
    'place-items:center;cursor:pointer;backdrop-filter:blur(10px)}' +
    '.nav-burger:hover{background:#fff}' +
    '.nav-drawer-backdrop{display:none;position:fixed;inset:0;background:rgba(10,25,48,.42);' +
    'backdrop-filter:blur(3px);z-index:190}' +
    '.nav-drawer-backdrop.active{display:block}' +
    '@media (max-width:840px){' +
    '.nav-burger{display:grid}' +
    '.app{grid-template-columns:1fr!important}' +
    '.sidebar{' +
    'position:fixed!important;top:0!important;left:0!important;right:auto!important;' +
    'width:min(300px,86vw)!important;height:100vh!important;height:100dvh!important;max-height:100dvh!important;' +
    'margin:0!important;border-radius:0 22px 22px 0!important;z-index:200!important;' +
    'transform:translateX(-105%);transition:transform .25s ease;' +
    'overflow:auto;box-shadow:18px 0 48px -24px rgba(10,37,64,.55)!important}' +
    '.sidebar.nav-open{transform:translateX(0)}' +
    '.sidebar .menu{display:flex!important;flex-direction:column!important;' +
    'grid-template-columns:none!important}' +
    'body.nav-drawer-open{overflow:hidden}' +
    '}';

  function ensureMobileNav() {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    if (!document.getElementById('mobileNavStyle')) {
      var style = document.createElement('style');
      style.id = 'mobileNavStyle';
      style.textContent = MOBILE_NAV_CSS;
      document.head.appendChild(style);
    }

    var burger = document.getElementById('navBurger');
    if (!burger) {
      burger = document.createElement('button');
      burger.id = 'navBurger';
      burger.className = 'nav-burger';
      burger.type = 'button';
      burger.setAttribute('aria-label', 'Open menu');
      burger.setAttribute('aria-expanded', 'false');
      burger.innerHTML =
        '<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">' +
        '<path d="M4 6h16M4 12h16M4 18h16"/></svg>';
      document.body.appendChild(burger);
    }

    var backdrop = document.getElementById('navDrawerBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'navDrawerBackdrop';
      backdrop.className = 'nav-drawer-backdrop';
      document.body.appendChild(backdrop);
    }

    function closeNav() {
      sidebar.classList.remove('nav-open');
      backdrop.classList.remove('active');
      document.body.classList.remove('nav-drawer-open');
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', 'Open menu');
    }

    function openNav() {
      sidebar.classList.add('nav-open');
      backdrop.classList.add('active');
      document.body.classList.add('nav-drawer-open');
      burger.setAttribute('aria-expanded', 'true');
      burger.setAttribute('aria-label', 'Close menu');
    }

    function toggleNav() {
      if (sidebar.classList.contains('nav-open')) closeNav();
      else openNav();
    }

    if (!burger.dataset.bound) {
      burger.dataset.bound = '1';
      burger.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleNav();
      });
      backdrop.addEventListener('click', closeNav);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeNav();
      });
      window.addEventListener('resize', function () {
        if (window.innerWidth > 840) closeNav();
      });
      sidebar.querySelectorAll('a').forEach(function (link) {
        link.addEventListener('click', closeNav);
      });
    }
  }

  ensureMobileNav();

  // ---- Shared logout confirmation modal ----
  var LOGOUT_CSS =
    '.logout-modal-backdrop{position:fixed;inset:0;display:none;align-items:center;' +
    'justify-content:center;background:rgba(10,25,48,.45);backdrop-filter:blur(4px);z-index:999}' +
    '.logout-modal-backdrop.active{display:flex}' +
    '.logout-modal{width:min(420px,calc(100vw - 32px));background:#fff;border-radius:22px;' +
    'padding:26px 24px;box-shadow:0 28px 80px rgba(15,23,42,.18)}' +
    '.logout-modal h2{margin:0 0 10px;font-size:20px;font-weight:900;color:#0F172A}' +
    '.logout-modal p{margin:0 0 24px;line-height:1.6;color:#475569}' +
    '.logout-actions{display:flex;justify-content:flex-end;gap:12px;flex-wrap:wrap}' +
    '.logout-actions button{min-height:44px;border-radius:12px;border:1px solid transparent;' +
    'background:#E2E8F0;color:#334155;font:inherit;font-weight:700;padding:0 18px;cursor:pointer}' +
    '.logout-actions button.confirm{background:#0052CC;color:#fff;border-color:transparent}';

  var LOGOUT_HTML =
    '<div class="logout-modal-backdrop" id="logoutModal">' +
      '<div class="logout-modal" role="dialog" aria-modal="true" aria-labelledby="logoutModalTitle">' +
        '<h2 id="logoutModalTitle">Confirm Log Out</h2>' +
        '<p>Are you sure you want to log out? Your current session will end.</p>' +
        '<div class="logout-actions">' +
          '<button type="button" class="cancel" data-logout-action="cancel">Cancel</button>' +
          '<button type="button" class="confirm" data-logout-action="confirm">Log Out</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  function ensureLogoutModal() {
    if (document.getElementById('logoutModal')) return;
    if (!document.getElementById('logoutModalStyle')) {
      var style = document.createElement('style');
      style.id = 'logoutModalStyle';
      style.textContent = LOGOUT_CSS;
      document.head.appendChild(style);
    }
    var holder = document.createElement('div');
    holder.innerHTML = LOGOUT_HTML;
    document.body.appendChild(holder.firstChild);
  }

  function bindLogout() {
    var modal = document.getElementById('logoutModal');
    if (!modal) return;
    document.querySelectorAll('.logout-link, [data-logout-trigger]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        modal.dataset.targetHref = link.getAttribute('href') || link.dataset.target || 'login.html';
        modal.classList.add('active');
      });
    });
    modal.addEventListener('click', function (event) {
      if (event.target === modal || event.target.dataset.logoutAction === 'cancel') {
        modal.classList.remove('active');
      }
      if (event.target.dataset.logoutAction === 'confirm') {
        var href = modal.dataset.targetHref || 'login.html';
        var go = function () { window.location.href = href; };
        if (window.GcordAPI && typeof GcordAPI.logout === 'function') {
          Promise.resolve(GcordAPI.logout()).then(go).catch(go);
        } else {
          try { localStorage.removeItem('gcord_session'); } catch (e) { /* ignore */ }
          go();
        }
      }
    });
  }

  ensureLogoutModal();
  bindLogout();
})();
