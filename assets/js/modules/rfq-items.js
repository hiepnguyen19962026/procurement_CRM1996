(function () {
  var state = AppState.list('rfqItems');
  async function load(reset) {
    if (reset) state.cursor = '';
    state.q = document.getElementById('itemSearch').value || '';
    try {
      var data = await API.get('getRfqItems', { q: state.q, rfqId: document.getElementById('itemRfqId').value, status: document.getElementById('itemStatus').value, cursor: state.cursor, limit: 50 });
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  function render() {
    document.getElementById('itemRows').innerHTML = (state.rows || []).map(function (r) {
      return '<tr><td>' + API.esc(r.rfq_item_id) + '</td><td>' + API.esc(r.rfq_id) + '</td><td>' + API.esc(r.ma_vat_tu || r.ma_mua_sam) + '</td><td>' + API.esc(r.ten_vat_tu) + '<div class="muted">' + API.esc(r.quy_cach_model_yeu_cau) + '</div></td><td>' + API.esc(r.hang_goc_nsx_goc || r.hang_final) + '</td><td>' + API.esc(r.so_luong) + ' ' + API.esc(r.don_vi) + '</td><td><span class="badge">' + API.esc(r.trang_thai_dong) + '</span></td><td><button data-write onclick="RfqItemsModule.openEdit(\'' + API.esc(r.rfq_item_id) + '\')">Sua</button></td></tr>';
    }).join('');
    document.getElementById('itemMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }
  function openCreate() { openForm({}); }
  function openEdit(id) { openForm((state.rows || []).find(function (r) { return r.rfq_item_id === id; }) || {}); }
  function openForm(r) {
    Utils.openModal(r.rfq_item_id ? 'Sua dong RFQ' : 'Them dong RFQ', fields(r), async function (data) {
      try {
        if (r.rfq_item_id) data.rfqItemId = r.rfq_item_id;
        await API.call(r.rfq_item_id ? 'updateRfqItem' : 'createRfqItem', data);
        Utils.closeModal();
        API.toast('Da luu dong vat tu', 'success');
        await load(true);
        DashboardModule.load();
      } catch (err) { API.error(err); }
    });
  }
  function fields(r) {
    return '<label>RFQ ID<input name="rfqId" required value="' + API.esc(r.rfq_id) + '"></label><label>STT goc<input name="sttGoc" value="' + API.esc(r.stt_goc) + '"></label><label>Ma mua sam<input name="maMuaSam" value="' + API.esc(r.ma_mua_sam) + '"></label><label>Ma vat tu<input name="maVatTu" value="' + API.esc(r.ma_vat_tu) + '"></label><label>Ten vat tu<textarea name="tenVatTu" required>' + API.esc(r.ten_vat_tu) + '</textarea></label><label>Quy cach/model<textarea name="quyCachModelYeuCau">' + API.esc(r.quy_cach_model_yeu_cau) + '</textarea></label><label>Hang goc<input name="hangGocNsxGoc" value="' + API.esc(r.hang_goc_nsx_goc) + '"></label><label>Xuat xu<input name="xuatXu" value="' + API.esc(r.xuat_xu) + '"></label><label>So luong<input name="soLuong" inputmode="decimal" value="' + API.esc(r.so_luong) + '"></label><label>Don vi<input name="donVi" value="' + API.esc(r.don_vi) + '"></label><label>Trang thai dong<select name="trangThaiDong"><option value="chua_xu_ly">chua_xu_ly</option><option value="dang_hoi_gia">dang_hoi_gia</option><option value="du_gia">du_gia</option><option value="da_bao_cdt">da_bao_cdt</option><option value="can_xac_nhan_ky_thuat">can_xac_nhan_ky_thuat</option><option value="da_final">da_final</option></select></label><label>Thong so ky thuat<textarea name="thongSoKyThuat">' + API.esc(r.thong_so_ky_thuat) + '</textarea></label><label>Quy cach final<textarea name="quyCachFinal">' + API.esc(r.quy_cach_final) + '</textarea></label><label>Ghi chu final<textarea name="ghiChuFinal">' + API.esc(r.ghi_chu_final) + '</textarea></label>';
  }
  window.RfqItemsModule = { load: load, openCreate: openCreate, openEdit: openEdit };
})();
