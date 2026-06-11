(function () {
  var state = AppState.list('audit');
  var sort = { by: '', dir: 'desc' };
  var _setupDone = false;

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    var el = document.getElementById('auditSearch');
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
  }

  function syncSort() {
    var def = 'created_at';
    document.querySelectorAll('#screen-audit th[data-sort-key]').forEach(function (th) {
      var key = th.getAttribute('data-sort-key');
      if (!th.getAttribute('data-label')) th.setAttribute('data-label', th.textContent.trim());
      var label = th.getAttribute('data-label');
      var active = (sort.by || def) === key;
      th.textContent = label + (active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕');
      th.onclick = function () {
        var cur = sort.by || def;
        if (cur === key) { sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; }
        else { sort.by = key; sort.dir = 'asc'; }
        load(true);
      };
    });
  }

  async function load(reset) {
    setupOnce();
    if (reset) state.cursor = '';
    state.q = document.getElementById('auditSearch').value || '';
    try {
      var params = { q: state.q, cursor: state.cursor, limit: 50 };
      if (sort.by) { params.sortBy = sort.by; params.sortDir = sort.dir; }
      var data = await API.get('getAuditLogs', params);
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  var ACTION_LABELS = {
    createRfq:                      'Tạo gói thầu',
    updateRfq:                      'Sửa gói thầu',
    archiveRfq:                     'Lưu trữ gói thầu',
    createRfqItem:                  'Thêm dòng vật tư',
    updateRfqItem:                  'Sửa dòng vật tư',
    archiveRfqItem:                 'Lưu trữ dòng vật tư',
    importRfqItems:                 'Import dòng vật tư',
    commitImportRows:               'Import nâng cao',
    createTask:                     'Tạo task',
    updateTask:                     'Sửa task',
    deleteTask:                     'Xóa task',
    quickUpdateTaskStatus:          'Đổi trạng thái task',
    quickUpdateTaskPriority:        'Đổi ưu tiên task',
    createTechnicalClarification:   'Trao đổi KT mới',
    updateTechnicalClarification:   'Sửa trao đổi KT',
    deleteTechnicalClarification:   'Xóa trao đổi KT',
    createClient:                   'Thêm khách hàng',
    updateClient:                   'Sửa khách hàng',
    archiveClient:                  'Lưu trữ khách hàng',
  };

  function render() {
    syncSort();
    document.getElementById('auditRows').innerHTML = (state.rows || []).map(function (r) {
      var actionLabel = ACTION_LABELS[r.action] || r.action;
      var ts = r.created_at ? r.created_at.replace('T', ' ').replace('Z', '').slice(0, 16) : '';
      return '<tr>'
        + '<td style="white-space:nowrap;color:var(--text-muted);font-size:12px">' + API.esc(ts) + '</td>'
        + '<td style="white-space:nowrap">' + API.esc(r.actor_name) + '</td>'
        + '<td style="white-space:nowrap"><span class="badge">' + API.esc(actionLabel) + '</span></td>'
        + '<td>' + API.esc(r.message) + '</td>'
        + '</tr>';
    }).join('');
    document.getElementById('auditMore').classList.toggle('hidden', !state.hasMore);
  }
  window.AuditModule = { load: load };
})();
