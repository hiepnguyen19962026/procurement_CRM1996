(function () {
  var state = AppState.list('suppliers');
  var sort = { by: '', dir: 'asc' };
  var _setupDone = false;

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    var el = document.getElementById('supplierSearch');
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
  }

  function syncSort() {
    var def = 'supplier_id';
    document.querySelectorAll('#screen-suppliers th[data-sort-key]').forEach(function (th) {
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
    state.q = document.getElementById('supplierSearch').value || '';
    try {
      var params = { q: state.q, cursor: state.cursor, limit: 50 };
      if (sort.by) { params.sortBy = sort.by; params.sortDir = sort.dir; }
      var data = await API.get('getSuppliers', params);
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  function render() {
    syncSort();
    var canWrite = Utils.roleCanWrite();
    document.getElementById('supplierRows').innerHTML = (state.rows || []).map(function (r) {
      var nameCell = canWrite
        ? '<span class="link-edit" onclick="SuppliersModule.openEdit(\'' + API.esc(r.supplier_id) + '\')">' + API.esc(r.supplier_name) + '</span>'
        : API.esc(r.supplier_name);
      return '<tr>'
        + '<td>' + API.esc(r.supplier_id) + '</td>'
        + '<td>' + nameCell + '</td>'
        + '<td>' + API.esc(typeLabel(r.supplier_type)) + '</td>'
        + '<td>' + API.esc(r.country) + '</td>'
        + '<td>' + API.esc(r.contact_name) + '<br>' + API.esc(r.phone) + '</td>'
        + '<td>' + API.esc(r.email) + '</td>'
        + '</tr>';
    }).join('');
    document.getElementById('supplierMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }
  function openCreate() { openForm({}); }
  function openEdit(id) { openForm((state.rows || []).find(function (r) { return r.supplier_id === id; }) || {}); }
  function openForm(r) {
    Utils.openModal(r.supplier_id ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp', fields(r), async function (data) {
      try {
        if (r.supplier_id) data.supplierId = r.supplier_id;
        await API.call(r.supplier_id ? 'updateSupplier' : 'createSupplier', data);
        Utils.closeModal();
        API.toast('Đã lưu nhà cung cấp', 'success');
        await load(true);
      } catch (err) { API.error(err); }
    });
  }
  function fields(r) {
    return '<label>Tên nhà cung cấp<input name="supplierName" required value="' + API.esc(r.supplier_name) + '"></label><label>Loại<select name="supplierType"><option value="unknown">Chưa phân loại</option><option value="manufacturer">Nhà sản xuất</option><option value="distributor">Nhà phân phối</option><option value="trader">Thương mại</option></select></label><label>Quốc gia<input name="country" value="' + API.esc(r.country) + '"></label><label>Người liên hệ<input name="contactName" value="' + API.esc(r.contact_name) + '"></label><label>Email<input name="email" value="' + API.esc(r.email) + '"></label><label>Điện thoại<input name="phone" value="' + API.esc(r.phone) + '"></label><label>Zalo<input name="zalo" value="' + API.esc(r.zalo) + '"></label><label>Wechat<input name="wechat" value="' + API.esc(r.wechat) + '"></label><label>Ghi chú<textarea name="note">' + API.esc(r.note) + '</textarea></label>';
  }
  function typeLabel(value) {
    return {
      unknown: 'Chưa phân loại',
      manufacturer: 'Nhà sản xuất',
      distributor: 'Nhà phân phối',
      trader: 'Thương mại',
    }[value] || value || '';
  }
  window.SuppliersModule = { load: load, openCreate: openCreate, openEdit: openEdit };
})();
