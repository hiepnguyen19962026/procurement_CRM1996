(function () {
  var state = AppState.list('rfqItems');

  async function load(reset) {
    if (reset) state.cursor = '';
    state.q = document.getElementById('itemSearch').value || '';
    try {
      var data = await API.get('getRfqItems', {
        q: state.q,
        rfqId: document.getElementById('itemRfqId').value,
        status: document.getElementById('itemStatus').value,
        cursor: state.cursor,
        limit: 50,
      });
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) {
      API.error(err);
    }
  }

  function val(r, canonical, legacy) {
    return r[canonical] ?? (legacy ? r[legacy] : '') ?? '';
  }

  function money(v) {
    var n = Number(v || 0);
    return n ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '';
  }

  function renderCell(value, muted) {
    var text = value === undefined || value === null || value === '' ? '—' : value;
    return '<td' + (muted && text === '—' ? ' class="muted-cell"' : '') + '>' + API.esc(text) + '</td>';
  }

  function render() {
    document.getElementById('itemRows').innerHTML = (state.rows || []).map(function (r) {
      return '<tr>'
        + renderCell(r.stt_goc, true)
        + renderCell(r.ma_mua_sam, true)
        + renderCell(r.ma_vat_tu, true)
        + '<td><strong>' + API.esc(r.ten_vat_tu) + '</strong></td>'
        + renderCell(val(r, 'required_model', 'quy_cach_model_yeu_cau'), true)
        + renderCell(val(r, 'brand', 'nhan_hieu'), true)
        + renderCell(val(r, 'manufacture_year', 'nam_san_xuat'), true)
        + renderCell(val(r, 'origin_country', 'xuat_xu'), true)
        + renderCell(val(r, 'manufacturer', 'hang_goc_nsx_goc'), true)
        + renderCell(val(r, 'technical_params', 'thong_so_ky_thuat'), true)
        + renderCell(r.vat_lieu, true)
        + renderCell(r.phu_tung_chuyen_dung, true)
        + renderCell(r.yeu_cau_ky_thuat_bo_sung, true)
        + renderCell(val(r, 'unit', 'don_vi'), true)
        + renderCell(val(r, 'quantity', 'so_luong') || 0, false)
        + renderCell(r.thue_suat, true)
        + renderCell(money(r.don_gia_sau_thue || r.don_gia_truoc_thue), true)
        + renderCell(money(r.thanh_tien_sau_thue), true)
        + renderCell(r.delivery_time, true)
        + renderCell(r.note, true)
        + '<td><span class="badge">' + API.esc(statusLabel(r.trang_thai_dong)) + '</span></td>'
        + '<td><button data-write onclick="RfqItemsModule.openEdit(\'' + API.esc(r.rfq_item_id) + '\')">Sửa</button></td>'
        + '</tr>';
    }).join('');
    document.getElementById('itemMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }

  function openCreate() {
    openForm({});
  }

  function openEdit(id) {
    openForm((state.rows || []).find(function (r) { return r.rfq_item_id === id; }) || {});
  }

  function openForm(r) {
    Utils.openModal(r.rfq_item_id ? 'Sửa dòng vật tư' : 'Thêm dòng vật tư', fields(r), async function (data) {
      try {
        if (r.rfq_item_id) data.rfqItemId = r.rfq_item_id;
        await API.call(r.rfq_item_id ? 'updateRfqItem' : 'createRfqItem', data);
        Utils.closeModal();
        API.toast('Đã lưu dòng vật tư', 'success');
        await load(true);
        DashboardModule.load();
      } catch (err) {
        API.error(err);
      }
    });
  }

  function option(value, label, current) {
    return '<option value="' + API.esc(value) + '"' + (value === current ? ' selected' : '') + '>' + API.esc(label) + '</option>';
  }

  function input(name, label, value, attrs) {
    return '<label>' + API.esc(label) + '<input name="' + API.esc(name) + '" ' + (attrs || '') + ' value="' + API.esc(value) + '"></label>';
  }

  function textarea(name, label, value, attrs) {
    return '<label>' + API.esc(label) + '<textarea name="' + API.esc(name) + '" ' + (attrs || '') + '>' + API.esc(value) + '</textarea></label>';
  }

  function fields(r) {
    var status = r.trang_thai_dong || 'chua_xu_ly';
    return ''
      + input('rfqId', 'RFQ ID', r.rfq_id, 'required')
      + input('sttGoc', 'STT', r.stt_goc)
      + input('maMuaSam', 'Mã mua sắm', r.ma_mua_sam)
      + input('maVatTu', 'Mã vật tư', r.ma_vat_tu)
      + textarea('tenVatTu', 'Tên vật tư / Danh mục hàng hóa', r.ten_vat_tu, 'required')
      + textarea('requiredModel', 'Ký mã hiệu / Model', val(r, 'required_model', 'quy_cach_model_yeu_cau'))
      + input('brand', 'Nhãn hiệu', val(r, 'brand', 'nhan_hieu'))
      + input('manufactureYear', 'Năm sản xuất', val(r, 'manufacture_year', 'nam_san_xuat'))
      + input('originCountry', 'Xuất xứ', val(r, 'origin_country', 'xuat_xu'))
      + input('manufacturer', 'Hãng sản xuất', val(r, 'manufacturer', 'hang_goc_nsx_goc'))
      + textarea('technicalParams', 'Quy cách / thông số kỹ thuật', val(r, 'technical_params', 'thong_so_ky_thuat'))
      + input('vatLieu', 'Vật liệu', r.vat_lieu)
      + input('phuTungChuyenDung', 'Phụ tùng chuyên dụng', r.phu_tung_chuyen_dung)
      + textarea('yeuCauKyThuatBoSung', 'Yêu cầu kỹ thuật bổ sung', r.yeu_cau_ky_thuat_bo_sung)
      + input('unit', 'Đơn vị tính', val(r, 'unit', 'don_vi'))
      + input('quantity', 'Khối lượng', val(r, 'quantity', 'so_luong'), 'inputmode="decimal"')
      + input('thueSuat', 'Thuế suất', r.thue_suat, 'inputmode="decimal"')
      + input('donGiaSauThue', 'Đơn giá', r.don_gia_sau_thue || r.don_gia_truoc_thue, 'inputmode="numeric"')
      + input('thanhTienSauThue', 'Thành tiền', r.thanh_tien_sau_thue, 'inputmode="numeric"')
      + input('deliveryTime', 'Thời gian giao hàng', r.delivery_time)
      + textarea('note', 'Ghi chú', r.note)
      + '<label>Trạng thái dòng<select name="trangThaiDong">'
      + option('chua_xu_ly', 'Chưa xử lý', status)
      + option('dang_hoi_gia', 'Đang hỏi giá', status)
      + option('du_gia', 'Đủ giá', status)
      + option('da_bao_cdt', 'Đã báo CĐT', status)
      + option('can_xac_nhan_ky_thuat', 'Cần xác nhận kỹ thuật', status)
      + option('da_final', 'Đã final', status)
      + '</select></label>'
      + textarea('originFullText', 'Cột tổng hợp gốc để đối chiếu/export', r.origin_full_text);
  }

  function statusLabel(value) {
    return {
      chua_xu_ly: 'Chưa xử lý',
      dang_hoi_gia: 'Đang hỏi giá',
      du_gia: 'Đủ giá',
      da_bao_cdt: 'Đã báo CĐT',
      can_xac_nhan_ky_thuat: 'Cần xác nhận kỹ thuật',
      da_final: 'Đã final',
    }[value] || value || '';
  }

  window.RfqItemsModule = { load: load, openCreate: openCreate, openEdit: openEdit };
})();
