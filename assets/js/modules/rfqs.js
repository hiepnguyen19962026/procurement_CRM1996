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
      return '<tr><td>' + API.esc(r.rfq_id) + '</td><td>' + API.esc(r.ma_goi_tbmt) + '</td><td>' + API.esc(r.ten_goi) + '</td><td>' + API.esc(r.client_name || r.nha_may_cdt) + '</td><td>' + valueOrDash(r.ngay_nhan_hoac_dang_tai) + '</td><td>' + valueOrDash(r.ngay_het_han) + '</td><td>' + API.esc(itemCountLabel(r.item_count)) + '</td><td>' + API.money(r.du_toan) + '</td><td><span class="badge">' + API.esc(statusLabel(r.trang_thai_goi)) + '</span></td><td>' + noteCell(r.note) + '</td><td><button data-write onclick="RfqsModule.openEdit(\'' + API.esc(r.rfq_id) + '\')">Sửa</button></td></tr>';
    }).join('');
    document.getElementById('rfqMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }
  function openCreate() { openForm({}); }
  function openEdit(id) { openForm((state.rows || []).find(function (r) { return r.rfq_id === id; }) || {}); }
  function openForm(r) {
    Utils.openModal(r.rfq_id ? 'Sửa RFQ' : 'Thêm RFQ', fields(r), async function (data) {
      try {
        if (r.rfq_id) data.rfqId = r.rfq_id;
        await API.call(r.rfq_id ? 'updateRfq' : 'createRfq', data);
        Utils.closeModal();
        API.toast('Đã lưu RFQ', 'success');
        await load(true);
        DashboardModule.load();
      } catch (err) { API.error(err); }
    });
  }
  function fields(r) {
    return '<label>Tên gói<input name="tenGoi" required value="' + API.esc(r.ten_goi) + '"></label><label>Client ID<input name="clientId" value="' + API.esc(r.client_id) + '"></label><label>Mã gói / TBMT<input name="maGoiTbmt" value="' + API.esc(r.ma_goi_tbmt) + '"></label><label>Nhà máy / CĐT<input name="nhaMayCdt" value="' + API.esc(r.nha_may_cdt) + '"></label><label>Ngày nhận / đăng tải<input name="ngayNhanHoacDangTai" type="date" value="' + API.esc(r.ngay_nhan_hoac_dang_tai) + '"></label><label>Ngày hết hạn<input name="ngayHetHan" type="date" value="' + API.esc(r.ngay_het_han) + '"></label><label>Dự toán<input name="duToan" inputmode="numeric" value="' + API.esc(r.du_toan) + '"></label><label>Trạng thái<select name="trangThaiGoi"><option value="dang_khao_gia">Đang khảo giá</option><option value="da_bao">Đã báo</option><option value="trung">Trúng</option><option value="khong_trung">Không trúng</option><option value="treo">Treo</option><option value="tham_khao">Tham khảo</option></select></label><label>Ghi chú<textarea name="note">' + API.esc(r.note) + '</textarea></label>';
  }
  function valueOrDash(value) {
    return value ? API.esc(value) : '<span class="muted">—</span>';
  }
  function noteCell(value) {
    return value ? '<span class="rfq-note">' + API.esc(value) + '</span>' : '<span class="muted">—</span>';
  }
  function itemCountLabel(value) {
    var count = Number(value || 0);
    return count + ' dòng';
  }
  function statusLabel(value) {
    return {
      dang_khao_gia: 'Đang khảo giá',
      da_bao: 'Đã báo',
      trung: 'Trúng',
      khong_trung: 'Không trúng',
      treo: 'Treo',
      tham_khao: 'Tham khảo',
    }[value] || value || '';
  }
  window.RfqsModule = { load: load, openCreate: openCreate, openEdit: openEdit };
})();
