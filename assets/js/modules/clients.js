(function () {
  var state = AppState.list('clients');
  var sort = { by: '', dir: 'asc' };
  var _setupDone = false;

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    var el = document.getElementById('clientSearch');
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
  }

  function syncSort() {
    var def = 'client_id';
    document.querySelectorAll('#screen-clients th[data-sort-key]').forEach(function (th) {
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
    state.q = document.getElementById('clientSearch').value || '';
    try {
      var params = { q: state.q, cursor: state.cursor, limit: 50 };
      if (sort.by) { params.sortBy = sort.by; params.sortDir = sort.dir; }
      var data = await API.get('getClients', params);
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  function render() {
    syncSort();
    var canWrite = Utils.roleCanWrite();
    document.getElementById('clientRows').innerHTML = (state.rows || []).map(function (r) {
      var nameCell = canWrite
        ? '<span class="link-edit" onclick="ClientsModule.openEdit(\'' + API.esc(r.client_id) + '\')">' + API.esc(r.client_name) + '</span>'
        : API.esc(r.client_name);
      return '<tr>'
        + '<td>' + API.esc(r.client_id) + '</td>'
        + '<td>' + nameCell + '</td>'
        + '<td>' + API.esc(r.plant_name) + '</td>'
        + '<td>' + API.esc(r.province) + '</td>'
        + '<td>' + API.esc(r.note) + '</td>'
        + '</tr>';
    }).join('');
    document.getElementById('clientMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }
  function openCreate() { openForm({}); }
  function openEdit(id) { openForm((state.rows || []).find(function (r) { return r.client_id === id; }) || {}); }
  function openForm(row) {
    Utils.openModal(row.client_id ? 'Sửa khách hàng / CĐT' : 'Thêm khách hàng / CĐT', fields(row), async function (data) {
      try {
        if (row.client_id) data.clientId = row.client_id;
        await API.call(row.client_id ? 'updateClient' : 'createClient', data);
        Utils.closeModal();
        API.toast('Đã lưu khách hàng', 'success');
        await load(true);
      } catch (err) { API.error(err); }
    });
  }
  function fields(r) {
    return '<label>Tên CĐT / khách hàng<input name="clientName" required value="' + API.esc(r.client_name) + '"></label><label>Nhà máy<input name="plantName" value="' + API.esc(r.plant_name) + '"></label><label>Tỉnh / thành<input name="province" value="' + API.esc(r.province) + '"></label><label>Ghi chú<textarea name="note">' + API.esc(r.note) + '</textarea></label>';
  }
  window.ClientsModule = { load: load, openCreate: openCreate, openEdit: openEdit };
})();
