(function () {
  var state = AppState.list('clients');
  async function load(reset) {
    if (reset) state.cursor = '';
    state.q = document.getElementById('clientSearch').value || '';
    try {
      var data = await API.get('getClients', { q: state.q, cursor: state.cursor, limit: 50 });
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  function render() {
    document.getElementById('clientRows').innerHTML = (state.rows || []).map(function (r) {
      return '<tr><td>' + API.esc(r.client_id) + '</td><td>' + API.esc(r.client_name) + '</td><td>' + API.esc(r.plant_name) + '</td><td>' + API.esc(r.province) + '</td><td>' + API.esc(r.note) + '</td><td><button data-write onclick="ClientsModule.openEdit(\'' + API.esc(r.client_id) + '\')">Sửa</button></td></tr>';
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
