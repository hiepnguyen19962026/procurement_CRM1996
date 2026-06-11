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
        + '<td data-role-only="admin,manager" style="text-align:center;padding:0 4px">'
          + '<button type="button" class="btn-x-archive" title="Lưu trữ nhà cung cấp" onclick="SuppliersModule.archiveSupplier(\'' + API.esc(r.supplier_id) + '\')">✕</button>'
          + '</td>'
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
    var sel = (r.supplier_type || 'unknown');
    // Row 1: tên(5) + loại(2) + quốc gia(2) + liên hệ(3) = 12
    // Row 2: email(3) + phone(3) + zalo(3) + wechat(3) = 12
    // Row 3: ghi chú(12)
    return '<label class="span-5">Tên nhà cung cấp<input name="supplierName" required value="' + API.esc(r.supplier_name) + '"></label>'
      + '<label class="span-2">Loại<select name="supplierType">'
      + '<option value="unknown"' + (sel === 'unknown' ? ' selected' : '') + '>Chưa phân loại</option>'
      + '<option value="manufacturer"' + (sel === 'manufacturer' ? ' selected' : '') + '>Nhà sản xuất</option>'
      + '<option value="distributor"' + (sel === 'distributor' ? ' selected' : '') + '>Nhà phân phối</option>'
      + '<option value="trader"' + (sel === 'trader' ? ' selected' : '') + '>Thương mại</option>'
      + '</select></label>'
      + '<label class="span-2">Quốc gia<input name="country" value="' + API.esc(r.country) + '"></label>'
      + '<label class="span-3">Người liên hệ<input name="contactName" value="' + API.esc(r.contact_name) + '"></label>'
      + '<label class="span-3">Email<input name="email" value="' + API.esc(r.email) + '"></label>'
      + '<label class="span-3">Điện thoại<input name="phone" value="' + API.esc(r.phone) + '"></label>'
      + '<label class="span-3">Zalo<input name="zalo" value="' + API.esc(r.zalo) + '"></label>'
      + '<label class="span-3">Wechat<input name="wechat" value="' + API.esc(r.wechat) + '"></label>'
      + '<label class="span-12 compact-ta">Ghi chú<textarea name="note">' + API.esc(r.note) + '</textarea></label>';
  }
  function typeLabel(value) {
    return {
      unknown: 'Chưa phân loại',
      manufacturer: 'Nhà sản xuất',
      distributor: 'Nhà phân phối',
      trader: 'Thương mại',
    }[value] || value || '';
  }
  async function archiveSupplier(supplierId) {
    var ok = await Utils.confirmDanger(
      'Lưu trữ nhà cung cấp',
      'Lưu trữ "' + supplierId + '"? Nhà cung cấp sẽ bị ẩn khỏi danh sách. Báo giá liên quan vẫn được giữ.',
      'Lưu trữ'
    );
    if (!ok) return;
    try {
      await API.call('archiveSupplier', { supplierId: supplierId });
      API.toast('Đã lưu trữ nhà cung cấp', 'success');
      await load(true);
    } catch (err) { API.error(err); }
  }

  window.SuppliersModule = { load: load, openCreate: openCreate, openEdit: openEdit, archiveSupplier: archiveSupplier };
})();
