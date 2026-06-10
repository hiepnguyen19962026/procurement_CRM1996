(function () {
  var state = AppState.list('suppliers');
  async function load(reset) {
    if (reset) state.cursor = '';
    state.q = document.getElementById('supplierSearch').value || '';
    try {
      var data = await API.get('getSuppliers', { q: state.q, cursor: state.cursor, limit: 50 });
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  function render() {
    document.getElementById('supplierRows').innerHTML = (state.rows || []).map(function (r) {
      return '<tr><td>' + API.esc(r.supplier_id) + '</td><td>' + API.esc(r.supplier_name) + '</td><td>' + API.esc(r.supplier_type) + '</td><td>' + API.esc(r.country) + '</td><td>' + API.esc(r.contact_name) + '<br>' + API.esc(r.phone) + '</td><td>' + API.esc(r.email) + '</td><td><button data-write onclick="SuppliersModule.openEdit(\'' + API.esc(r.supplier_id) + '\')">Sua</button></td></tr>';
    }).join('');
    document.getElementById('supplierMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }
  function openCreate() { openForm({}); }
  function openEdit(id) { openForm((state.rows || []).find(function (r) { return r.supplier_id === id; }) || {}); }
  function openForm(r) {
    Utils.openModal(r.supplier_id ? 'Sua nha cung cap' : 'Them nha cung cap', fields(r), async function (data) {
      try {
        if (r.supplier_id) data.supplierId = r.supplier_id;
        await API.call(r.supplier_id ? 'updateSupplier' : 'createSupplier', data);
        Utils.closeModal();
        API.toast('Da luu nha cung cap', 'success');
        await load(true);
      } catch (err) { API.error(err); }
    });
  }
  function fields(r) {
    return '<label>Ten nha cung cap<input name="supplierName" required value="' + API.esc(r.supplier_name) + '"></label><label>Loai<select name="supplierType"><option value="unknown">unknown</option><option value="manufacturer">manufacturer</option><option value="distributor">distributor</option><option value="trader">trader</option></select></label><label>Quoc gia<input name="country" value="' + API.esc(r.country) + '"></label><label>Nguoi lien he<input name="contactName" value="' + API.esc(r.contact_name) + '"></label><label>Email<input name="email" value="' + API.esc(r.email) + '"></label><label>Dien thoai<input name="phone" value="' + API.esc(r.phone) + '"></label><label>Zalo<input name="zalo" value="' + API.esc(r.zalo) + '"></label><label>Wechat<input name="wechat" value="' + API.esc(r.wechat) + '"></label><label>Ghi chu<textarea name="note">' + API.esc(r.note) + '</textarea></label>';
  }
  window.SuppliersModule = { load: load, openCreate: openCreate, openEdit: openEdit };
})();
