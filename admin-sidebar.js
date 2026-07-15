/* Shared admin sidebar — mounts into <div id="sidebar-root"></div> */
(function () {
  var ICON = {
    brand: '<svg width="22" height="22" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 10h8M8 14h5"/></svg>',
    dashboard: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>',
    admin: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M12 3l7 4v5c0 5-3 8-7 9-4-1-7-4-7-9V7l7-4z"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 16c1.2-1.4 2.3-2 3.5-2s2.3.6 3.5 2"/></svg>',
    logs: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M8 4h8l1 3h3v14H4V7h3l1-3z"/><path d="M8 12h8M8 16h8"/></svg>',
    reports: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 15v4M12 11v8M16 7v12"/></svg>',
    logout: '<svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H3"/></svg>'
  };

  var MENU = [
    { page: 'admin-dashboard', href: 'admin-dashboard.html', label: 'Dashboard', icon: ICON.dashboard },
    { page: 'admin-management', href: 'admin-management.html', label: 'Admin Management', icon: ICON.admin },
    { page: 'admin-reports', href: 'admin-reports.html', label: 'Analytics &amp; Reports', icon: ICON.reports },
    { page: 'system-logs', href: 'system-logs.html', label: 'System Logs', icon: ICON.logs }
  ];

  function currentPage() {
    return (location.pathname.split('/').pop() || 'admin-dashboard.html').replace('.html', '');
  }

  function buildSidebar() {
    var active = currentPage();
    var links = MENU.map(function (it) {
      var cls = it.page === active ? ' class="active"' : '';
      return '<a href="' + it.href + '" data-page="' + it.page + '"' + cls + '>' + it.icon + it.label + '</a>';
    }).join('');

    return '' +
      '<aside class="sidebar" id="adminSidebar">' +
        '<div class="side-top">' +
          '<div class="brand-mark">' + ICON.brand + '</div>' +
          '<div class="brand-text"><strong>G-Cash</strong><span>Cash Out System</span></div>' +
        '</div>' +
        '<div class="menu-title">Main Menu</div>' +
        '<nav class="menu" aria-label="Admin main menu">' +
          links +
          '<a href="login.html" class="logout-link">' + ICON.logout + 'Log Out</a>' +
        '</nav>' +
      '</aside>';
  }

  var root = document.getElementById('sidebar-root');
  if (root) root.outerHTML = buildSidebar();
})();
