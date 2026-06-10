(function () {
  async function call(action, payload) {
    var res = await fetch('/api/fetch-data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(Object.assign({}, payload || {}, { action: action })),
    });
    var data = await res.json().catch(function () { return { ok: false, error: 'Loi API' }; });
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Loi API');
    return data;
  }

  async function get(action, params) {
    var qs = new URLSearchParams(Object.assign({}, params || {}, { action: action }));
    var res = await fetch('/api/fetch-data?' + qs.toString(), { credentials: 'include' });
    var data = await res.json().catch(function () { return { ok: false, error: 'Loi API' }; });
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Loi API');
    return data;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  function money(value) {
    var n = Number(value || 0);
    return n ? Math.round(n).toLocaleString('vi-VN') : '';
  }

  function toast(message, type) {
    var box = document.getElementById('toast');
    if (!box) return;
    box.textContent = message;
    box.className = 'toast show ' + (type || 'info');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { box.className = 'toast'; }, 2600);
  }

  function error(err) {
    toast(err && err.message ? err.message : String(err || 'Co loi'), 'error');
  }

  window.API = { call: call, get: get, esc: esc, money: money, toast: toast, error: error };
})();
