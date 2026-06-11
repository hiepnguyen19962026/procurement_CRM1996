(function () {
  function session() {
    try { return JSON.parse(sessionStorage.getItem('procurement_session') || 'null'); }
    catch { return null; }
  }

  function save(user) {
    sessionStorage.setItem('procurement_session', JSON.stringify(user));
    AppState.set('user', user);
  }

  async function login(username, password) {
    var data = await API.call('authLogin', { username: username, password: password });
    save(data.user);
    applyRoleUI();
    showApp();
    document.querySelector('.nav button[data-screen="tasks"]').click();
  }

  async function logout() {
    await API.call('logout', {}).catch(function () {});
    sessionStorage.removeItem('procurement_session');
    AppState.set('user', null);
    document.body.classList.remove('is-auth');
  }

  function showApp() {
    document.body.classList.add('is-auth');
    renderCurrentUser(AppState.get('user') || {});
  }

  function renderCurrentUser(user) {
    var name = user.displayName || user.username || 'Người dùng';
    var username = user.username || '';
    var maskedUsername = username ? maskUsername(username) : '';
    document.getElementById('currentUser').innerHTML =
      '<div class="user-text"><strong>' + API.esc(name) + '</strong>' +
      (maskedUsername ? '<span>' + API.esc(maskedUsername) + '</span>' : '') +
      '</div>';
  }

  function maskUsername(username) {
    var value = String(username || '');
    return value ? '***' + value.slice(-3) : '';
  }

  function applyRoleUI() {
    var user = AppState.get('user') || session();
    if (!user) return;
    AppState.set('user', user);
    document.querySelectorAll('[data-role-only]').forEach(function (el) {
      var roles = el.getAttribute('data-role-only').split(',');
      el.classList.toggle('hidden', roles.indexOf(user.role) < 0);
    });
    document.querySelectorAll('[data-write]').forEach(function (el) {
      el.classList.toggle('hidden', !Utils.roleCanWrite());
    });
  }

  async function restoreSession() {
    var res, data;
    try {
      res = await fetch('/api/fetch-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'getSession' }),
      });
      data = await res.json().catch(function () { return null; });
    } catch {
      // Network unreachable — do not destroy session; cookie may still be valid
      API.toast('Không kết nối được server. Tải lại trang để thử lại.', 'error');
      return;
    }
    // 401 = JWT expired/missing; 400 + ok:false = session invalidated in DB
    if (res.status === 401 || (res.status === 400 && data && data.ok === false)) {
      sessionStorage.removeItem('procurement_session');
      AppState.set('user', null);
      document.body.classList.remove('is-auth');
      return;
    }
    if (data && data.ok && data.user) {
      save(data.user);
      applyRoleUI();
      showApp();
      document.querySelector('.nav button[data-screen="tasks"]').click();
      return;
    }
    // Server error (5xx) or unexpected response — do not destroy session
    API.toast('Server gặp lỗi tạm thời. Tải lại trang để thử lại.', 'error');
  }

  async function init() {
    var user = session();
    if (user) {
      AppState.set('user', user);
      applyRoleUI();
      showApp();
      return;
    }
    await restoreSession();
  }

  window.Auth = { init: init, login: login, logout: logout, session: session, applyRoleUI: applyRoleUI };
})();
