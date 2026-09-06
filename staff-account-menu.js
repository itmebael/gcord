(function () {
  function init() {
    var header = document.querySelector('.staff-page-topbar, .staff-topbar');
    if (!header) return;
    var old = header.querySelector('.top-icons, nav');
    if (old) old.remove();
    var earningsUser = header.querySelector('#earningsUser');
    if (earningsUser) earningsUser.hidden = true;
    header.classList.add('account-header');
    var host = document.createElement('div'); host.className = 'account-dropdowns';
    var bell = '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>';
    var person = '<circle cx="12" cy="8" r="3"/><path d="M5 21c0-8 14-8 14 0"/>';
    function create(label, icon, id) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'account-toggle';
      button.setAttribute('aria-label', label); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', id);
      button.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">'+icon+'</svg>';
      var panel = document.createElement('section'); panel.id = id; panel.className = 'account-panel'; panel.hidden = true; panel.setAttribute('aria-label', label);
      host.append(button,panel);
      button.onclick = function () { var open = panel.hidden; close(); panel.hidden = !open; button.setAttribute('aria-expanded', String(open)); if (open && id === 'account-notifications') load(); };
      return panel;
    }
    function close() { host.querySelectorAll('.account-panel').forEach(function(p){p.hidden=true;}); host.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-expanded','false');}); }
    var notifications = create('Notifications',bell,'account-notifications');
    notifications.innerHTML = '<div class="account-panel-heading"><div><span class="account-eyebrow">YOUR ACTIVITY</span><h2>Notifications</h2></div><span class="account-recent">Latest 5</span></div><div class="account-notice-list" aria-live="polite"></div><a class="account-footer" href="notification.html">View all notifications <span aria-hidden="true">→</span></a>';
    var profile = create('Your profile',person,'account-profile');
    profile.innerHTML = '<div class="account-identity"><span class="account-avatar" aria-hidden="true"></span><div><span class="account-eyebrow">MY ACCOUNT</span><p class="account-name"></p><span class="account-role">Staff workspace</span></div></div><a class="account-menu-link" href="profile.html"><span class="account-menu-icon" aria-hidden="true">'+ '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">'+person+'</svg></span><span><strong>Profile Management</strong><small>Personal details &amp; security</small></span><span aria-hidden="true">›</span></a>';
    var user = window.GcordAPI && GcordAPI.getCurrentUser();
    profile.querySelector('p').textContent = user ? user.full_name || user.username || 'Staff' : 'Staff';
    profile.querySelector('.account-avatar').textContent = profile.querySelector('.account-name').textContent.trim().split(/\s+/).slice(0,2).map(function(part){return part[0];}).join('').toUpperCase();
    var request = 0;
    async function load() {
      var token = ++request, list = notifications.querySelector('.account-notice-list'); list.textContent='Loading notifications…';
      try {
        var rows = await GcordAPI.listNotifications({limit:5}); if(token!==request)return; list.textContent='';
        if(!rows.length)list.textContent='No notifications yet.';
        rows.forEach(function(row){
          var item=document.createElement('a');item.href='notification.html';item.className='account-notice'+(row.isRead?'':' is-unread');
          var icon=document.createElement('span');icon.className='account-notice-icon';icon.setAttribute('aria-hidden','true');icon.textContent=row.severity==='warning'||row.severity==='error'?'!':'✓';
          var content=document.createElement('div'),title=document.createElement('strong'),body=document.createElement('p'),time=document.createElement('span');
          title.textContent=row.title;body.textContent=row.body || '';time.className='account-notice-time';
          var date=new Date(row.createdAt);time.textContent=(row.isRead?'':'Unread · ')+(!isNaN(date.getTime())?date.toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'');
          content.append(title,body,time);item.append(icon,content);list.appendChild(item);
        });
      } catch(e) { if(token===request)list.textContent='Could not load notifications. Open all notifications to try again.'; }
    }
    header.appendChild(host);
    document.addEventListener('click',function(e){if(!host.contains(e.target))close();});
    host.addEventListener('keydown',function(e){if(e.key==='Escape'){var active=host.querySelector('[aria-expanded="true"]');close();if(active)active.focus();}});
    host.addEventListener('focusout',function(){setTimeout(function(){if(!host.contains(document.activeElement))close();},0);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
