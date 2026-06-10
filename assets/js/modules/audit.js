(function () {
  var state = AppState.list('audit');
  async function load(reset) {
    if (reset) state.cursor = '';
    state.q = document.getElementById('auditSearch').value || '';
    try {
      var data = await API.get('getAuditLogs', { q: state.q, cursor: state.cursor, limit: 50 });
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  function render() {
    document.getElementById('auditRows').innerHTML = (state.rows || []).map(function (r) {
      return '<tr><td>' + API.esc(r.created_at) + '</td><td>' + API.esc(r.actor_name) + '</td><td>' + API.esc(r.action) + '</td><td>' + API.esc(r.message) + '</td></tr>';
    }).join('');
    document.getElementById('auditMore').classList.toggle('hidden', !state.hasMore);
  }
  window.AuditModule = { load: load };
})();
