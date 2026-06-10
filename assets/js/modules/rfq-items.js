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

  function renderCell(value, muted) {
    var text = value === undefined || value === null || value === '' ? '-' : value;
    return '<td' + (muted && text === '-' ? ' class="muted-cell"' : '') + '>' + API.esc(text) + '</td>';
  }

  function render() {
    document.getElementById('itemRows').innerHTML = (state.rows || []).map(function (r) {
      return '<tr>'
        + renderCell(r.stt_goc, true)
        + renderCell(r.ma_mua_sam, true)
        + renderCell(r.ma_vat_tu, true)
        + '<td><strong>' + API.esc(r.ten_vat_tu) + '</strong><div class="muted">' + API.esc(val(r, 'technical_params', 'thong_so_ky_thuat')) + '</div></td>'
        + renderCell(val(r, 'required_model', 'quy_cach_model_yeu_cau'), true)
        + renderCell(val(r, 'brand', 'nhan_hieu'), true)
        + renderCell(val(r, 'manufacturer', 'hang_goc_nsx_goc'), true)
        + renderCell(val(r, 'origin_country', 'xuat_xu'), true)
        + renderCell((val(r, 'quantity', 'so_luong') || 0) + ' ' + (val(r, 'unit', 'don_vi') || ''), false)
        + '<td>' + technicalSummary(r) + '</td>'
        + '<td><span class="badge">' + API.esc(statusLabel(r.trang_thai_dong)) + '</span></td>'
        + '<td><button data-write onclick="RfqItemsModule.openEdit(\'' + API.esc(r.rfq_item_id) + '\')">Sửa</button></td>'
        + '</tr>';
    }).join('');
    document.getElementById('itemMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }

  function technicalSummary(r) {
    var count = Number(r.clarification_count || 0);
    var finalText = [r.quy_cach_final, r.hang_final].filter(Boolean).join(' - ');
    return '<div class="tech-summary">'
      + '<span class="badge">' + API.esc(technicalStatusLabel(r.clarification_status || r.trang_thai_ky_thuat)) + '</span>'
      + '<span>' + API.esc(count + ' lần trao đổi') + '</span>'
      + (finalText ? '<strong>' + API.esc(finalText) + '</strong>' : '')
      + '</div>';
  }

  function openCreate() {
    openForm({}, [], []);
  }

  async function openEdit(id) {
    var row = (state.rows || []).find(function (r) { return r.rfq_item_id === id; }) || {};
    try {
      var results = await Promise.all([
        API.get('getTechnicalClarifications', { rfqItemId: id }),
        API.get('getSupplierQuotes', { rfqItemId: id }),
      ]);
      openForm(row, results[0].rows || [], results[1].rows || []);
    } catch (err) {
      API.error(err);
    }
  }

  function openForm(r, clarifications, quotes) {
    Utils.openModal(r.rfq_item_id ? 'Sửa dòng vật tư' : 'Thêm dòng vật tư', fields(r, clarifications || [], quotes || []), async function (data) {
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
    Auth.applyRoleUI();
  }

  function openClarificationForm(rfqItemId, clarificationId) {
    var item = (state.rows || []).find(function (r) { return r.rfq_item_id === rfqItemId; }) || {};
    API.get('getTechnicalClarifications', { rfqItemId: rfqItemId }).then(function (data) {
      var row = (data.rows || []).find(function (r) { return r.clarification_id === clarificationId; }) || {};
      Utils.openModal(row.clarification_id ? 'Sửa trao đổi kỹ thuật' : 'Thêm trao đổi kỹ thuật', clarificationFields(item, row), async function (form) {
        try {
          form.rfqItemId = rfqItemId;
          if (row.clarification_id) form.clarificationId = row.clarification_id;
          await API.call(row.clarification_id ? 'updateTechnicalClarification' : 'createTechnicalClarification', form);
          Utils.closeModal();
          API.toast('Đã lưu trao đổi kỹ thuật', 'success');
          await load(true);
        } catch (err) {
          API.error(err);
        }
      });
    }).catch(API.error);
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

  function fields(r, clarifications, quotes) {
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
      + textarea('originFullText', 'Cột tổng hợp gốc để đối chiếu/export', r.origin_full_text)
      + technicalSection(r, clarifications)
      + quotesSection(r, quotes || []);
  }

  function technicalSection(item, rows) {
    if (!item.rfq_item_id) return '';
    return '<section class="modal-section technical-section">'
      + '<div class="section-head"><h4>Xác nhận kỹ thuật</h4><button type="button" data-write onclick="RfqItemsModule.openClarificationForm(\'' + API.esc(item.rfq_item_id) + '\')">+ Thêm trao đổi</button></div>'
      + (rows.length ? rows.map(function (r) { return timelineItem(item.rfq_item_id, r); }).join('') : '<div class="empty-state small">Chưa có trao đổi kỹ thuật.</div>')
      + '</section>';
  }

  function timelineItem(rfqItemId, r) {
    var modelChange = r.old_model || r.proposed_model
      ? '<div class="muted">' + API.esc(r.old_model || '-') + ' -> ' + API.esc(r.proposed_model || '-') + '</div>'
      : '';
    var attachment = r.attachment_file_id
      ? '<a href="' + API.esc(r.attachment_public_url || '#') + '" target="_blank" rel="noopener">' + API.esc(r.attachment_file_name || r.attachment_file_id) + '</a>'
      : '';
    return '<article class="timeline-item">'
      + '<div class="timeline-top"><strong>' + API.esc(r.title) + '</strong><span>' + API.esc(formatDate(r.created_at)) + '</span></div>'
      + '<div><span class="badge">' + API.esc(typeLabel(r.clarification_type)) + '</span> <span class="badge">' + API.esc(technicalStatusLabel(r.status_after)) + '</span></div>'
      + (r.content ? '<p>' + API.esc(r.content) + '</p>' : '')
      + modelChange
      + (r.proposed_manufacturer || r.proposed_origin ? '<div class="muted">' + API.esc([r.proposed_manufacturer, r.proposed_origin].filter(Boolean).join(' - ')) + '</div>' : '')
      + (attachment ? '<div>' + attachment + '</div>' : '')
      + '<button type="button" data-role-only="admin,manager" onclick="RfqItemsModule.openClarificationForm(\'' + API.esc(rfqItemId) + '\', \'' + API.esc(r.clarification_id) + '\')">Sửa</button>'
      + '</article>';
  }

  function clarificationFields(item, r) {
    var type = r.clarification_type || 'ask_supplier';
    var status = r.status_after || 'waiting_supplier';
    return ''
      + '<label>Loại trao đổi<select name="clarificationType">'
      + option('ask_supplier', 'Hỏi hãng', type)
      + option('supplier_reply', 'Hãng phản hồi', type)
      + option('ask_client', 'Hỏi CĐT', type)
      + option('client_reply', 'CĐT phản hồi', type)
      + option('replacement_proposal', 'Đề xuất thay thế', type)
      + option('final_confirm', 'Final confirm', type)
      + '</select></label>'
      + '<label>Trạng thái sau trao đổi<select name="statusAfter">'
      + option('waiting_supplier', 'Đang hỏi hãng', status)
      + option('waiting_client', 'Đang hỏi CĐT', status)
      + option('need_more_info', 'Cần bổ sung', status)
      + option('final_confirmed', 'Đã xác nhận', status)
      + option('rejected', 'Bị từ chối', status)
      + '</select></label>'
      + input('title', 'Tiêu đề', r.title, 'required')
      + textarea('content', 'Nội dung', r.content)
      + input('oldModel', 'Model cũ', r.old_model || val(item, 'required_model', 'quy_cach_model_yeu_cau'))
      + input('proposedModel', 'Model đề xuất / final', r.proposed_model || item.quy_cach_final)
      + input('proposedManufacturer', 'Hãng sản xuất đề xuất / final', r.proposed_manufacturer || item.hang_final)
      + input('proposedOrigin', 'Xuất xứ đề xuất / final', r.proposed_origin || item.xuat_xu_final)
      + input('attachmentFileId', 'File đính kèm (file_id)', r.attachment_file_id)
      + textarea('rawNote', 'Ghi chú gốc', r.raw_note)
      + '<label class="check"><input type="checkbox" name="updateFinal"> Cập nhật quy cách final cho vật tư này</label>';
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

  function technicalStatusLabel(value) {
    return {
      khong_can_xac_nhan: 'Không cần xác nhận',
      dang_hoi: 'Đang hỏi',
      can_bo_sung: 'Cần bổ sung',
      da_xac_nhan: 'Đã xác nhận',
      bi_tu_choi: 'Bị từ chối',
      thay_the: 'Thay thế',
      waiting_supplier: 'Đang hỏi hãng',
      waiting_client: 'Đang hỏi CĐT',
      need_more_info: 'Cần bổ sung',
      final_confirmed: 'Đã xác nhận',
      rejected: 'Bị từ chối',
    }[value] || 'Chưa xác nhận';
  }

  function typeLabel(value) {
    return {
      ask_supplier: 'Hỏi hãng',
      supplier_reply: 'Hãng phản hồi',
      ask_client: 'Hỏi CĐT',
      client_reply: 'CĐT phản hồi',
      replacement_proposal: 'Đề xuất thay thế',
      final_confirm: 'Final confirm',
    }[value] || value || '';
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN');
  }

  // --- Supplier Quotes ---

  function quotesSection(item, rows) {
    if (!item.rfq_item_id) return '';
    var activeRows = rows.filter(function (r) { return r.status !== 'archived'; });
    var archivedRows = rows.filter(function (r) { return r.status === 'archived'; });
    return '<section class="modal-section quotes-section">'
      + '<div class="section-head"><h4>Báo giá nhà cung cấp</h4>'
      + '<button type="button" data-write onclick="RfqItemsModule.openQuoteForm(\'' + API.esc(item.rfq_item_id) + '\')">+ Thêm báo giá</button></div>'
      + (activeRows.length
        ? '<div class="quotes-table-wrap">' + quotesTable(item.rfq_item_id, activeRows) + '</div>'
        : '<div class="empty-state small">Chưa có báo giá.</div>')
      + (archivedRows.length
        ? '<details class="archived-quotes"><summary>Đã lưu trữ (' + archivedRows.length + ')</summary>'
          + '<div class="quotes-table-wrap">' + quotesTable(item.rfq_item_id, archivedRows) + '</div>'
          + '</details>'
        : '')
      + '</section>';
  }

  function quotesTable(rfqItemId, rows) {
    return '<table class="quotes-mini-table">'
      + '<thead><tr>'
      + '<th>Nhà CC</th><th>Hãng SX</th><th>Giá báo</th><th>T.tệ</th><th>Tỷ giá</th>'
      + '<th>Thuế</th><th>VND + Thuế</th><th>Giao hàng</th><th>Hiệu lực</th><th>Bảo hành</th><th>Ghi chú</th><th></th>'
      + '</tr></thead><tbody>'
      + rows.map(function (r) { return quoteRow(rfqItemId, r); }).join('')
      + '</tbody></table>';
  }

  function quoteRow(rfqItemId, r) {
    var isArchived = r.status === 'archived';
    var actions = isArchived
      ? '<span class="badge">Đã lưu trữ</span>'
      : '<button type="button" data-role-only="admin,manager" onclick="RfqItemsModule.openQuoteForm(\''
          + API.esc(rfqItemId) + '\', \'' + API.esc(r.quote_id) + '\')">Sửa</button>'
        + ' <button type="button" data-role-only="admin,manager" onclick="RfqItemsModule.archiveQuote(\''
          + API.esc(rfqItemId) + '\', \'' + API.esc(r.quote_id) + '\')">Lưu trữ</button>';
    return '<tr>'
      + '<td>' + API.esc(r.supplier_name || r.supplier_id || '-') + '</td>'
      + '<td>' + API.esc(r.manufacturer || '-') + '</td>'
      + '<td class="num">' + API.esc(r.quoted_price ? Number(r.quoted_price).toLocaleString('vi-VN') : '-') + '</td>'
      + '<td>' + API.esc(r.currency || 'VND') + '</td>'
      + '<td class="num">' + API.esc(r.exchange_rate && Number(r.exchange_rate) !== 1 ? Number(r.exchange_rate).toLocaleString('vi-VN') : '') + '</td>'
      + '<td class="num">' + API.esc(r.tax_rate ? r.tax_rate + '%' : '') + '</td>'
      + '<td class="num"><strong>' + API.esc(r.price_vnd_incl_tax ? API.money(r.price_vnd_incl_tax) : '-') + '</strong></td>'
      + '<td>' + API.esc(r.lead_time || '') + '</td>'
      + '<td>' + API.esc(r.valid_until || '') + '</td>'
      + '<td>' + API.esc(r.warranty || '') + '</td>'
      + '<td class="muted">' + API.esc(r.note || '') + '</td>'
      + '<td class="nowrap">' + actions + '</td>'
      + '</tr>';
  }

  function openQuoteForm(rfqItemId, quoteId) {
    var fetchRow = quoteId
      ? API.get('getSupplierQuotes', { rfqItemId: rfqItemId }).then(function (data) {
          return (data.rows || []).find(function (r) { return r.quote_id === quoteId; }) || {};
        })
      : Promise.resolve({});
    fetchRow.then(function (r) {
      Utils.openModal(
        r.quote_id ? 'Sửa báo giá' : 'Thêm báo giá',
        quoteFields(r),
        async function (form) {
          try {
            form.rfqItemId = rfqItemId;
            if (r.quote_id) form.quoteId = r.quote_id;
            await API.call(r.quote_id ? 'updateSupplierQuote' : 'createSupplierQuote', form);
            Utils.closeModal();
            API.toast('Đã lưu báo giá', 'success');
            await load(true);
          } catch (err) {
            API.error(err);
          }
        }
      );
      Auth.applyRoleUI();
    }).catch(API.error);
  }

  async function archiveQuote(rfqItemId, quoteId) {
    try {
      await API.call('archiveSupplierQuote', { quoteId: quoteId });
      Utils.closeModal();
      API.toast('Đã lưu trữ báo giá', 'success');
      await load(true);
    } catch (err) {
      API.error(err);
    }
  }

  function quoteFields(r) {
    var currency = r.currency || 'VND';
    return ''
      + input('supplierName', 'Tên nhà cung cấp', r.supplier_name || '', 'placeholder="VD: SKF Vietnam"')
      + input('manufacturer', 'Hãng sản xuất', r.manufacturer || '', 'placeholder="VD: SKF"')
      + input('quoteDate', 'Ngày báo giá', r.quote_date || '', 'type="date"')
      + input('quotedPrice', 'Giá báo (theo tiền tệ)', r.quoted_price || '', 'inputmode="decimal" placeholder="0"')
      + '<label>Tiền tệ<select name="currency">'
      + option('VND', 'VND', currency)
      + option('USD', 'USD', currency)
      + option('EUR', 'EUR', currency)
      + option('JPY', 'JPY', currency)
      + option('CNY', 'CNY', currency)
      + option('SGD', 'SGD', currency)
      + option('KRW', 'KRW', currency)
      + '</select></label>'
      + input('exchangeRate', 'Tỷ giá (1 đơn vị ngoại tệ = ? VND)', r.exchange_rate || 1, 'inputmode="decimal" placeholder="1"')
      + input('taxRate', 'Thuế suất (%)', r.tax_rate || 0, 'inputmode="decimal" placeholder="0"')
      + input('leadTime', 'Thời gian giao hàng', r.lead_time || '', 'placeholder="VD: 4-6 tuần"')
      + input('validUntil', 'Hiệu lực đến', r.valid_until || '', 'type="date"')
      + input('warranty', 'Bảo hành', r.warranty || '', 'placeholder="VD: 12 tháng"')
      + textarea('note', 'Ghi chú', r.note || '');
  }

  // --- CSV Template / Import ---

  var TEMPLATE_HEADERS = [
    'rfqItemId', 'rfqId', 'STT', 'Mã mua sắm', 'Mã vật tư',
    'Tên vật tư / Danh mục hàng hóa', 'Ký mã hiệu / Model', 'Nhãn hiệu',
    'Năm sản xuất', 'Xuất xứ', 'Hãng sản xuất', 'Quy cách / thông số kỹ thuật',
    'Vật liệu', 'Phụ tùng chuyên dụng', 'Yêu cầu kỹ thuật bổ sung',
    'Đơn vị tính', 'Khối lượng', 'Thuế suất', 'Đơn giá', 'Thành tiền',
    'Thời gian giao hàng', 'Ghi chú', 'Cột tổng hợp gốc để đối chiếu/export',
  ];

  var HEADER_MAP = {
    'rfqItemId': 'rfqItemId',
    'rfqId': 'rfqId',
    'STT': 'sttGoc',
    'Mã mua sắm': 'maMuaSam',
    'Mã vật tư': 'maVatTu',
    'Tên vật tư / Danh mục hàng hóa': 'tenVatTu',
    'Ký mã hiệu / Model': 'requiredModel',
    'Nhãn hiệu': 'brand',
    'Năm sản xuất': 'manufactureYear',
    'Xuất xứ': 'originCountry',
    'Hãng sản xuất': 'manufacturer',
    'Quy cách / thông số kỹ thuật': 'technicalParams',
    'Vật liệu': 'vatLieu',
    'Phụ tùng chuyên dụng': 'phuTungChuyenDung',
    'Yêu cầu kỹ thuật bổ sung': 'yeuCauKyThuatBoSung',
    'Đơn vị tính': 'unit',
    'Khối lượng': 'quantity',
    'Thuế suất': 'thueSuat',
    'Đơn giá': 'donGiaTruocThue',
    'Thành tiền': 'thanhTienSauThue',
    'Thời gian giao hàng': 'deliveryTime',
    'Ghi chú': 'note',
    'Cột tổng hợp gốc để đối chiếu/export': 'originFullText',
  };

  var csvState = { headers: null, rows: null };

  function csvQuote(value) {
    var s = String(value == null ? '' : value);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function downloadTemplate() {
    var rfqId = (document.getElementById('itemRfqId').value || '').trim();
    var exampleRow = TEMPLATE_HEADERS.map(function (h) {
      if (h === 'rfqId') return csvQuote(rfqId);
      if (h === 'Tên vật tư / Danh mục hàng hóa') return csvQuote('VÍ DỤ: Vòng bi SKF 6205-2RS');
      if (h === 'Đơn vị tính') return 'cái';
      if (h === 'Khối lượng') return '10';
      return '';
    });
    var csv = '﻿'
      + TEMPLATE_HEADERS.map(csvQuote).join(',') + '\r\n'
      + exampleRow.join(',') + '\r\n';
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'rfq-items-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function parseCsv(text) {
    // RFC 4180 + BOM strip + CRLF normalize
    var src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var rows = [], row = [], field = '', inQ = false, n = src.length;
    for (var i = 0; i <= n; i++) {
      var c = i < n ? src[i] : '\n'; // virtual newline flushes last row
      if (inQ) {
        if (c === '"') {
          if (i + 1 < n && src[i + 1] === '"') { field += '"'; i++; } // escaped ""
          else { inQ = false; }
        } else { field += c; }
      } else if (c === '"') {
        inQ = true;
      } else if (c === ',') {
        row.push(field.trim()); field = '';
      } else if (c === '\n') {
        row.push(field.trim()); field = '';
        if (row.some(function (v) { return v !== ''; })) rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    return rows;
  }

  function csvRowToPayload(headers, rowValues) {
    var rawRowJson = {};
    headers.forEach(function (h, i) { rawRowJson[h] = rowValues[i] !== undefined ? rowValues[i] : ''; });
    var payload = { rawRowJson: rawRowJson };
    Object.keys(HEADER_MAP).forEach(function (h) {
      var idx = headers.indexOf(h);
      payload[HEADER_MAP[h]] = idx >= 0 && rowValues[idx] !== undefined ? rowValues[idx] : '';
    });
    return payload;
  }

  function importCsv() {
    csvState.headers = null;
    csvState.rows = null;
    var html = '<div style="margin-bottom:0.75rem">'
      + '<label style="display:block">Chọn file CSV<br>'
      + '<input type="file" name="csvFile" id="csvFileInput" accept=".csv,text/csv" style="margin-top:0.25rem" onchange="RfqItemsModule._onCsvFileChange(this)">'
      + '</label></div>'
      + '<div id="csvPreviewArea" style="color:var(--text-muted);font-size:13px">Chưa chọn file — chọn file để xem trước rồi nhấn Lưu để import.</div>';
    Utils.openModal('Import CSV – Dòng vật tư', html, async function () {
      if (!csvState.rows || !csvState.rows.length) {
        var area = document.getElementById('csvPreviewArea');
        if (area) area.innerHTML = '<p style="color:var(--red)">Chưa chọn file hoặc file không có dữ liệu.</p>';
        return;
      }
      await runImport(csvState.rows, csvState.headers);
    });
  }

  function _onCsvFileChange(input) {
    var area = document.getElementById('csvPreviewArea');
    if (!input || !input.files || !input.files[0]) return;
    area.textContent = 'Đang đọc file...';
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var all = parseCsv(e.target.result);
        if (!all.length) { area.textContent = 'File trống.'; return; }
        var headers = all[0];
        var dataRows = all.slice(1).filter(function (r) { return r.some(function (c) { return c !== ''; }); });
        csvState.headers = headers;
        csvState.rows = dataRows;
        renderCsvPreview(area, headers, dataRows);
      } catch (err) {
        area.textContent = 'Lỗi đọc file: ' + (err.message || String(err));
      }
    };
    reader.onerror = function () { area.textContent = 'Không đọc được file.'; };
    reader.readAsText(input.files[0], 'UTF-8');
  }

  function renderCsvPreview(area, headers, rows) {
    var warn = rows.length > 200
      ? '<p style="color:var(--red);font-weight:600;margin-bottom:0.5rem">⚠ File có ' + rows.length + ' dòng dữ liệu. Khuyến nghị không quá 200 dòng mỗi lần import.</p>'
      : '';
    var previewRows = rows.slice(0, 20);
    var th = headers.map(function (h) {
      return '<th style="border:1px solid var(--border);padding:2px 5px;background:var(--bg);white-space:nowrap;font-size:11px">' + API.esc(h) + '</th>';
    }).join('');
    var tb = previewRows.map(function (r) {
      return '<tr>' + r.map(function (c) {
        return '<td style="border:1px solid var(--border);padding:2px 5px;max-width:100px;overflow:hidden;white-space:nowrap;font-size:11px">' + API.esc(c) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    area.innerHTML = warn
      + '<p style="color:var(--text-muted);font-size:12px;margin-bottom:0.3rem">Xem trước ' + previewRows.length + '/' + rows.length + ' dòng. Nhấn <strong>Lưu</strong> để bắt đầu import.</p>'
      + '<div style="overflow:auto;max-height:200px"><table style="border-collapse:collapse;width:max-content"><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table></div>';
  }

  async function runImport(rows, headers) {
    var area = document.getElementById('csvPreviewArea');
    var ok = 0, errs = [];
    for (var i = 0; i < rows.length; i++) {
      var payload = csvRowToPayload(headers, rows[i]);
      var rowNum = i + 2; // 1-based + header row
      if (!payload.rfqId) { errs.push('Dòng ' + rowNum + ': Thiếu rfqId'); continue; }
      if (!payload.tenVatTu) { errs.push('Dòng ' + rowNum + ': Thiếu Tên vật tư'); continue; }
      var action = payload.rfqItemId ? 'updateRfqItem' : 'createRfqItem';
      try {
        await API.call(action, payload);
        ok++;
      } catch (err) {
        errs.push('Dòng ' + rowNum + ': ' + (err && err.message ? err.message : String(err)));
      }
      if (area) area.innerHTML = '<p style="color:var(--text-muted)">Đang import... ' + (ok + errs.length) + '/' + rows.length + '</p>';
    }
    await load(true);
    var color = errs.length && ok === 0 ? 'var(--red)' : (errs.length ? 'var(--primary)' : 'var(--green)');
    var summary = '<p style="font-weight:600;color:' + color + ';margin-bottom:0.4rem">Hoàn tất: ' + ok + ' thành công' + (errs.length ? ', ' + errs.length + ' lỗi.' : '.') + '</p>';
    var errList = errs.length
      ? '<ul style="font-size:12px;color:var(--red);margin:0;padding-left:1.2em">'
        + errs.slice(0, 20).map(function (e) { return '<li>' + API.esc(e) + '</li>'; }).join('')
        + (errs.length > 20 ? '<li>... và ' + (errs.length - 20) + ' lỗi khác (xem console)</li>' : '')
        + '</ul>'
      : '';
    if (area) area.innerHTML = summary + errList;
    if (errs.length) console.warn('[Import CSV] Lỗi:', errs);
    API.toast(ok + ' dòng đã import' + (errs.length ? ', ' + errs.length + ' lỗi' : ''), errs.length ? 'warn' : 'success');
  }

  window.RfqItemsModule = {
    load: load,
    openCreate: openCreate,
    openEdit: openEdit,
    openClarificationForm: openClarificationForm,
    openQuoteForm: openQuoteForm,
    archiveQuote: archiveQuote,
    downloadTemplate: downloadTemplate,
    importCsv: importCsv,
    _onCsvFileChange: _onCsvFileChange,
  };
})();
