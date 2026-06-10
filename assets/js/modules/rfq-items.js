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
    openForm({}, []);
  }

  async function openEdit(id) {
    var row = (state.rows || []).find(function (r) { return r.rfq_item_id === id; }) || {};
    try {
      var data = await API.get('getTechnicalClarifications', { rfqItemId: id });
      openForm(row, data.rows || []);
    } catch (err) {
      API.error(err);
    }
  }

  function openForm(r, clarifications) {
    Utils.openModal(r.rfq_item_id ? 'Sửa dòng vật tư' : 'Thêm dòng vật tư', fields(r, clarifications || []), async function (data) {
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

  function fields(r, clarifications) {
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
      + technicalSection(r, clarifications);
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

  window.RfqItemsModule = {
    load: load,
    openCreate: openCreate,
    openEdit: openEdit,
    openClarificationForm: openClarificationForm,
  };
})();
