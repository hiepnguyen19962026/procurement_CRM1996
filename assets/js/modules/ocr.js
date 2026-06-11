(function () {
  'use strict';

  var ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

  // ── File picker ────────────────────────────────────────────────────────────
  function pickFile(accept, cb) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.onchange = function () {
      document.body.removeChild(inp);
      if (inp.files && inp.files[0]) cb(inp.files[0]);
    };
    inp.click();
  }

  // ── Send image to Worker via /api/upload (multipart, action=ocrImage) ─────
  async function sendOcr(file, mode) {
    var form = new FormData();
    form.append('action', 'ocrImage');
    form.append('mode', mode);
    form.append('file', file);
    var res = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: form });
    var data = await res.json().catch(function () { return { ok: false, error: 'Lỗi kết nối OCR' }; });
    if (!data.ok) throw new Error(data.error || 'Lỗi OCR không xác định');
    return data;
  }

  // ── Shared: info banner shown at top of every OCR preview modal ───────────
  function ocrBanner() {
    return '<div class="span-12" style="padding:6px 10px;background:#f0f6ff;border:1px solid #b3d4ff;'
      + 'border-radius:4px;font-size:12px;color:#1a4a80;margin-bottom:4px">'
      + 'Kết quả OCR — kiểm tra và chỉnh sửa trước khi lưu. Ô viền đỏ bên trái = trường bắt buộc còn trống.</div>';
  }

  // Highlight a label if its mapped value is empty (required field)
  function req(val) {
    return val ? '' : 'border-left:3px solid #c00;padding-left:6px;';
  }

  // ── RFQ OCR ────────────────────────────────────────────────────────────────
  function openRfqOcr() {
    pickFile(ACCEPT_IMAGE, async function (file) {
      API.toast('Đang nhận dạng ảnh...', 'info');
      try {
        var result = await sendOcr(file, 'rfq');
        showRfqPreview(result.mapped || {});
      } catch (err) { API.error(err); }
    });
  }

  function showRfqPreview(m) {
    Utils.openModal('OCR — Gói thầu (kiểm tra trước khi lưu)', rfqHtml(m), async function (data) {
      if (!data.tenGoi || !data.tenGoi.trim()) {
        API.toast('Tên gói không được để trống', 'warn');
        return;
      }
      try {
        await API.call('createRfq', data);
        Utils.closeModal();
        API.toast('Đã tạo gói thầu từ OCR', 'success');
        if (typeof RfqsModule !== 'undefined') await RfqsModule.load(true);
        if (typeof DashboardModule !== 'undefined') DashboardModule.load();
      } catch (err) { API.error(err); }
    });
  }

  function rfqHtml(m) {
    var statOpts = [
      ['dang_khao_gia', 'Đang khảo giá'], ['da_bao', 'Đã báo'], ['trung', 'Trúng'],
      ['khong_trung', 'Không trúng'], ['treo', 'Treo'], ['tham_khao', 'Tham khảo'],
    ];
    var selStat = '<select name="trangThaiGoi">'
      + statOpts.map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === 'dang_khao_gia' ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>';
    return ocrBanner()
      + '<label class="span-7" style="' + req(m.tenGoi) + '">Tên gói <small style="color:#c00">*</small>'
        + '<input name="tenGoi" required value="' + API.esc(m.tenGoi || '') + '"></label>'
      + '<label class="span-5">Mã gói / TBMT'
        + '<input name="maGoiTbmt" value="' + API.esc(m.maGoiTbmt || '') + '"></label>'
      + '<label class="span-4">CĐT / nhà máy'
        + '<input name="nhaMayCdt" value="' + API.esc(m.nhaMayCdt || '') + '"></label>'
      + '<label class="span-3">Ngày nhận'
        + '<input name="ngayNhanHoacDangTai" type="date" value="' + API.esc(m.ngayNhanHoacDangTai || '') + '"></label>'
      + '<label class="span-3">Ngày hết hạn'
        + '<input name="ngayHetHan" type="date" value="' + API.esc(m.ngayHetHan || '') + '"></label>'
      + '<label class="span-2">Dự toán (VNĐ)'
        + '<input name="duToan" inputmode="numeric" value="' + API.esc(m.duToan || '') + '"></label>'
      + '<label class="span-2">Trạng thái' + selStat + '</label>'
      + '<label class="span-12 compact-ta">Ghi chú'
        + '<textarea name="note">' + API.esc(m.note || '') + '</textarea></label>';
  }

  // ── RFQ Item OCR ───────────────────────────────────────────────────────────
  function openItemOcr() {
    pickFile(ACCEPT_IMAGE, async function (file) {
      API.toast('Đang nhận dạng bảng vật tư...', 'info');
      try {
        var result = await sendOcr(file, 'item');
        if (result.kind === 'table') {
          showItemTablePreview(result.rows || []);
        } else {
          showItemPreview(result.mapped || {});
        }
      } catch (err) { API.error(err); }
    });
  }

  function showItemTablePreview(rows) {
    if (rows.length > 100) {
      API.toast('OCR trả về ' + rows.length + ' dòng — vui lòng dùng import XLSX cho danh sách lớn', 'warn');
      return;
    }
    if (!rows.length) {
      API.toast('OCR không tìm thấy bảng vật tư trong ảnh', 'warn');
      return;
    }
    var rfqIdEl = document.getElementById('itemRfqId');
    var rfqId = rfqIdEl ? rfqIdEl.value.trim() : '';
    Utils.openModal(
      'OCR — Bảng vật tư (' + rows.length + ' dòng) — kiểm tra trước khi lưu',
      itemTableHtml(rows, rfqId),
      async function (data) {
        var targetRfqId = (data.ocr_rfqId || '').trim();
        if (!targetRfqId) { API.toast('Thiếu RFQ ID', 'warn'); return; }
        var rowCount = Number(data.ocr_rowCount || 0);
        var commitRows = [];
        for (var i = 0; i < rowCount; i++) {
          var tenVatTu = (data['ocr_r' + i + '_tenVatTu'] || '').trim();
          if (!tenVatTu) continue;
          commitRows.push({
            sourceRowNumber: i + 1,
            rawRow: {},
            mapped: {
              stt_goc:       (data['ocr_r' + i + '_sttGoc']        || '').trim(),
              ma_vat_tu:     (data['ocr_r' + i + '_maVatTu']       || '').trim(),
              ten_vat_tu:    tenVatTu,
              required_model:(data['ocr_r' + i + '_requiredModel'] || '').trim(),
              unit:          (data['ocr_r' + i + '_unit']          || '').trim(),
              quantity:      (data['ocr_r' + i + '_quantity']      || '').trim(),
            },
          });
        }
        if (!commitRows.length) { API.toast('Không có dòng hợp lệ (Tên vật tư là bắt buộc)', 'warn'); return; }
        try {
          var result = await API.call('commitImportRows', {
            rfqId: targetRfqId,
            sourceSheetName: 'ocr',
            rows: commitRows,
          });
          Utils.closeModal();
          var s = result.summary || {};
          var msg = 'OCR nhập ' + (s.created || 0) + ' mới'
            + (s.updated ? ', ' + s.updated + ' cập nhật' : '')
            + (s.errors  ? ', ' + s.errors  + ' lỗi'      : '');
          API.toast(msg, s.errors ? 'warn' : 'success');
          if (typeof RfqItemsModule !== 'undefined') await RfqItemsModule.load(true);
          if (typeof DashboardModule !== 'undefined') DashboardModule.load();
        } catch (err) { API.error(err); }
      }
    );
  }

  function itemTableHtml(rows, rfqId) {
    var head = '<thead><tr>'
      + '<th style="min-width:38px">STT</th>'
      + '<th style="min-width:110px">Mã vật tư</th>'
      + '<th style="min-width:220px">Tên vật tư <small style="color:#c00">*</small></th>'
      + '<th style="min-width:170px">Quy cách / Model</th>'
      + '<th style="min-width:52px">ĐVT</th>'
      + '<th style="min-width:52px">SL</th>'
      + '</tr></thead>';
    var body = '<tbody>'
      + rows.map(function (r, i) {
          var emptyName = !r.tenVatTu;
          var nameStyle = 'width:100%' + (emptyName ? ';border-left:3px solid #c00' : '');
          return '<tr>'
            + '<td><input name="ocr_r' + i + '_sttGoc" value="' + API.esc(r.sttGoc || '') + '" style="width:36px"></td>'
            + '<td><input name="ocr_r' + i + '_maVatTu" value="' + API.esc(r.maVatTu || '') + '" style="width:100%"></td>'
            + '<td><input name="ocr_r' + i + '_tenVatTu" value="' + API.esc(r.tenVatTu || '') + '" style="' + nameStyle + '"></td>'
            + '<td><input name="ocr_r' + i + '_requiredModel" value="' + API.esc(r.requiredModel || '') + '" style="width:100%"></td>'
            + '<td><input name="ocr_r' + i + '_unit" value="' + API.esc(r.unit || '') + '" style="width:50px"></td>'
            + '<td><input name="ocr_r' + i + '_quantity" value="' + API.esc(r.quantity || '') + '" inputmode="decimal" style="width:50px"></td>'
            + '</tr>';
        }).join('')
      + '</tbody>';
    return ocrBanner()
      + '<div class="span-12">'
      + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">'
      + '<label style="margin:0;flex:0 0 auto;font-weight:600">RFQ ID <small style="color:#c00">*</small></label>'
      + '<input name="ocr_rfqId" value="' + API.esc(rfqId) + '" placeholder="VD: RFQ-2026-001" style="max-width:200px">'
      + '</div>'
      + '<p style="margin:0 0 8px;font-size:12px;color:var(--text-muted)">Chỉnh sửa trực tiếp trong bảng. Dòng không có Tên vật tư sẽ bị bỏ qua khi nhập.</p>'
      + '<div style="overflow:auto;max-height:400px">'
      + '<table class="quotes-mini-table" style="min-width:680px">' + head + body + '</table>'
      + '</div>'
      + '<input type="hidden" name="ocr_rowCount" value="' + rows.length + '">'
      + '</div>';
  }

  function showItemPreview(m) {
    var rfqIdEl = document.getElementById('itemRfqId');
    if (!m.rfqId && rfqIdEl && rfqIdEl.value) m.rfqId = rfqIdEl.value;
    Utils.openModal('OCR — Dòng vật tư (kiểm tra trước khi lưu)', itemHtml(m), async function (data) {
      if (!data.rfqId || !data.rfqId.trim()) {
        API.toast('RFQ ID không được để trống', 'warn');
        return;
      }
      if (!data.tenVatTu || !data.tenVatTu.trim()) {
        API.toast('Tên vật tư không được để trống', 'warn');
        return;
      }
      try {
        await API.call('createRfqItem', data);
        Utils.closeModal();
        API.toast('Đã thêm dòng vật tư từ OCR', 'success');
        if (typeof RfqItemsModule !== 'undefined') await RfqItemsModule.load(true);
        if (typeof DashboardModule !== 'undefined') DashboardModule.load();
      } catch (err) { API.error(err); }
    });
  }

  function itemHtml(m) {
    return ocrBanner()
      + '<label class="span-3" style="' + req(m.rfqId) + '">RFQ ID <small style="color:#c00">*</small>'
        + '<input name="rfqId" required value="' + API.esc(m.rfqId || '') + '"></label>'
      + '<label class="span-1">STT'
        + '<input name="sttGoc" value="' + API.esc(m.sttGoc || '') + '"></label>'
      + '<label class="span-4">Mã vật tư'
        + '<input name="maVatTu" value="' + API.esc(m.maVatTu || '') + '"></label>'
      + '<label class="span-2">ĐVT'
        + '<input name="unit" value="' + API.esc(m.unit || '') + '"></label>'
      + '<label class="span-2">Số lượng'
        + '<input name="quantity" inputmode="decimal" value="' + API.esc(m.quantity || '') + '"></label>'
      + '<label class="span-7" style="' + req(m.tenVatTu) + '">Tên vật tư <small style="color:#c00">*</small>'
        + '<textarea name="tenVatTu" required class="compact-ta">' + API.esc(m.tenVatTu || '') + '</textarea></label>'
      + '<label class="span-5">Model / ký mã hiệu'
        + '<textarea name="requiredModel" class="compact-ta">' + API.esc(m.requiredModel || '') + '</textarea></label>'
      + '<label class="span-3">Hãng sản xuất'
        + '<input name="manufacturer" value="' + API.esc(m.manufacturer || '') + '"></label>'
      + '<label class="span-3">Nhãn hiệu'
        + '<input name="brand" value="' + API.esc(m.brand || '') + '"></label>'
      + '<label class="span-3">Xuất xứ'
        + '<input name="originCountry" value="' + API.esc(m.originCountry || '') + '"></label>'
      + '<label class="span-3">Thuế suất (%)'
        + '<input name="thueSuat" inputmode="decimal" value="' + API.esc(m.thueSuat || '') + '"></label>'
      + '<label class="span-4">Đơn giá sau thuế'
        + '<input name="donGiaSauThue" inputmode="numeric" value="' + API.esc(m.donGiaSauThue || '') + '"></label>'
      + '<label class="span-4">Thành tiền'
        + '<input name="thanhTienSauThue" inputmode="numeric" value="' + API.esc(m.thanhTienSauThue || '') + '"></label>'
      + '<label class="span-12 compact-ta">Thông số kỹ thuật'
        + '<textarea name="technicalParams">' + API.esc(m.technicalParams || '') + '</textarea></label>'
      + '<label class="span-12 compact-ta">Ghi chú'
        + '<textarea name="note">' + API.esc(m.note || '') + '</textarea></label>'
      + '<input type="hidden" name="originFullText" value="' + API.esc(m.originFullText || '') + '">';
  }

  // ── Supplier / business card OCR ───────────────────────────────────────────
  function openSupplierOcr() {
    pickFile(ACCEPT_IMAGE, async function (file) {
      API.toast('Đang nhận dạng danh thiếp...', 'info');
      try {
        var result = await sendOcr(file, 'supplier');
        showSupplierPreview(result.mapped || {});
      } catch (err) { API.error(err); }
    });
  }

  function showSupplierPreview(m) {
    Utils.openModal('OCR — Nhà cung cấp / danh thiếp (kiểm tra trước khi lưu)', supplierHtml(m), async function (data) {
      if (!data.supplierName || !data.supplierName.trim()) {
        API.toast('Tên nhà cung cấp không được để trống', 'warn');
        return;
      }
      try {
        await API.call('createSupplier', data);
        Utils.closeModal();
        API.toast('Đã thêm nhà cung cấp từ OCR', 'success');
        if (typeof SuppliersModule !== 'undefined') await SuppliersModule.load(true);
      } catch (err) { API.error(err); }
    });
  }

  function supplierHtml(m) {
    var types = [
      ['unknown', 'Chưa phân loại'], ['manufacturer', 'Nhà sản xuất'],
      ['distributor', 'Nhà phân phối'], ['trader', 'Thương mại'],
    ];
    var sel = m.supplierType || 'unknown';
    var typeSel = '<select name="supplierType">'
      + types.map(function (t) {
        return '<option value="' + t[0] + '"' + (t[0] === sel ? ' selected' : '') + '>' + t[1] + '</option>';
      }).join('') + '</select>';
    return ocrBanner()
      + '<label class="span-5" style="' + req(m.supplierName) + '">Tên nhà cung cấp <small style="color:#c00">*</small>'
        + '<input name="supplierName" required value="' + API.esc(m.supplierName || '') + '"></label>'
      + '<label class="span-2">Loại' + typeSel + '</label>'
      + '<label class="span-2">Quốc gia'
        + '<input name="country" value="' + API.esc(m.country || '') + '"></label>'
      + '<label class="span-3">Người liên hệ'
        + '<input name="contactName" value="' + API.esc(m.contactName || '') + '"></label>'
      + '<label class="span-3">Email'
        + '<input name="email" type="email" value="' + API.esc(m.email || '') + '"></label>'
      + '<label class="span-3">Điện thoại'
        + '<input name="phone" value="' + API.esc(m.phone || '') + '"></label>'
      + '<label class="span-3">Zalo'
        + '<input name="zalo" value="' + API.esc(m.zalo || '') + '"></label>'
      + '<label class="span-3">Wechat'
        + '<input name="wechat" value="' + API.esc(m.wechat || '') + '"></label>'
      + '<label class="span-9 compact-ta">Ghi chú (chức danh, địa chỉ, website...)'
        + '<textarea name="note">' + API.esc(m.note || '') + '</textarea></label>';
  }

  window.OcrModule = {
    openRfqOcr: openRfqOcr,
    openItemOcr: openItemOcr,
    openSupplierOcr: openSupplierOcr,
  };
})();
