(function () {
  var state = AppState.list('rfqs');
  async function load(reset) {
    if (reset) state.cursor = '';
    state.q = document.getElementById('rfqSearch').value || '';
    try {
      var data = await API.get('getRfqs', { q: state.q, status: document.getElementById('rfqStatus').value, cursor: state.cursor, limit: 50 });
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  function render() {
    document.getElementById('rfqRows').innerHTML = (state.rows || []).map(function (r) {
      return '<tr><td>' + API.esc(r.rfq_id) + '</td><td>' + API.esc(r.ma_goi_tbmt) + '</td><td>' + API.esc(r.ten_goi) + '</td><td>' + API.esc(r.client_name || r.nha_may_cdt) + '</td><td>' + API.esc(r.ngay_het_han) + '</td><td>' + API.money(r.du_toan) + '</td><td><span class="badge">' + API.esc(r.trang_thai_goi) + '</span></td><td><button data-write onclick="RfqsModule.openEdit(\'' + API.esc(r.rfq_id) + '\')">Sua</button></td></tr>';
    }).join('');
    document.getElementById('rfqMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }
  function openCreate() { openForm({}); }
  function openEdit(id) { openForm((state.rows || []).find(function (r) { return r.rfq_id === id; }) || {}); }
  function openForm(r) {
    Utils.openModal(r.rfq_id ? 'Sua RFQ' : 'Them RFQ', fields(r), async function (data) {
      try {
        if (r.rfq_id) data.rfqId = r.rfq_id;
        await API.call(r.rfq_id ? 'updateRfq' : 'createRfq', data);
        Utils.closeModal();
        API.toast('Da luu RFQ', 'success');
        await load(true);
        DashboardModule.load();
      } catch (err) { API.error(err); }
    });
  }
  function fields(r) {
    return '<label>Ten goi<input name="tenGoi" required value="' + API.esc(r.ten_goi) + '"></label><label>Client ID<input name="clientId" value="' + API.esc(r.client_id) + '"></label><label>Ma goi/TBMT<input name="maGoiTbmt" value="' + API.esc(r.ma_goi_tbmt) + '"></label><label>Nha may/CDT<input name="nhaMayCdt" value="' + API.esc(r.nha_may_cdt) + '"></label><label>Ngay nhan/dang tai<input name="ngayNhanHoacDangTai" type="date" value="' + API.esc(r.ngay_nhan_hoac_dang_tai) + '"></label><label>Ngay het han<input name="ngayHetHan" type="date" value="' + API.esc(r.ngay_het_han) + '"></label><label>Du toan<input name="duToan" inputmode="numeric" value="' + API.esc(r.du_toan) + '"></label><label>Trang thai<select name="trangThaiGoi"><option value="dang_khao_gia">dang_khao_gia</option><option value="da_bao">da_bao</option><option value="trung">trung</option><option value="khong_trung">khong_trung</option><option value="treo">treo</option><option value="tham_khao">tham_khao</option></select></label><label>Ghi chu<textarea name="note">' + API.esc(r.note) + '</textarea></label>';
  }
  window.RfqsModule = { load: load, openCreate: openCreate, openEdit: openEdit };
})();
