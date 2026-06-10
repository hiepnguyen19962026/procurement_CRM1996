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
    DashboardModule.load();
  }

  async function logout() {
    await API.call('logout', {}).catch(function () {});
    sessionStorage.removeItem('procurement_session');
    AppState.set('user', null);
    document.body.classList.remove('is-auth');
  }

  function showApp() {
    document.body.classList.add('is-auth');
    document.getElementById('currentUser').textContent = (AppState.get('user') || {}).displayName || '';
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

  function init() {
    var user = session();
    if (user) {
      AppState.set('user', user);
      applyRoleUI();
      showApp();
    }
  }

  window.Auth = { init: init, login: login, logout: logout, session: session, applyRoleUI: applyRoleUI };
})();
