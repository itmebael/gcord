const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = fs.readFileSync('supabase-api.js', 'utf8');
const login = fs.readFileSync('login.html', 'utf8');
const start = login.indexOf('  const session = window.GcordAPI');
const redirect = '(function () {' + login.slice(start, login.indexOf('  async function doLogin()', start)) + '})();';
const storage = new Map();
let destination;
function openBrowser() {
  const context = {
    localStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    location: {replace: value => {destination = value;}}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(api, context);
  return context;
}
for (const role of ['staff', 'admin', 'super_admin']) {
  const first = openBrowser();
  first.GcordAPI.setSession({id: 7, role, session_token: 'saved-session'});
  const reopened = openBrowser();
  destination = undefined;
  vm.runInContext(redirect, reopened);
  assert.equal(destination, role === 'staff' ? 'dashboard.html' : 'admin-dashboard.html');
  assert.equal(reopened.GcordAPI.getSession().session_token, 'saved-session');
  reopened.GcordAPI.clearSession();
  destination = undefined;
  vm.runInContext(redirect, openBrowser());
  assert.equal(destination, undefined, 'After logout the login page remains available');
}
storage.set('gcord_session', JSON.stringify({id: 7, role: 'staff'}));
vm.runInContext(redirect, openBrowser());
assert.equal(destination, undefined, 'Do not resume a session without a token');
console.log('Session persistence: staff/admin reopening, logout, and missing token PASS');
