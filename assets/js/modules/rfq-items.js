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
    var rows = state.rows || [];
    var rfqFilter = (document.getElementById('itemRfqId').value || '').trim();
    if (!rows.length && rfqFilter) {
      var rfqMeta = (AppState.list('rfqs').rows || []).find(function (r) { return r.rfq_id === rfqFilter; }) || null;
      var rfqInfo = rfqMeta
        ? '<div style="margin-bottom:14px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:13px;text-align:left">'
          + '<div style="font-weight:600;margin-bottom:4px">' + API.esc(rfqMeta.rfq_id) + '</div>'
          + (rfqMeta.ten_goi ? '<div style="color:var(--text-muted)">Tên gói: <span style="color:var(--text)">' + API.esc(rfqMeta.ten_goi) + '</span></div>' : '')
          + ((rfqMeta.client_name || rfqMeta.nha_may_cdt) ? '<div style="color:var(--text-muted)">CĐT: <span style="color:var(--text)">' + API.esc(rfqMeta.client_name || rfqMeta.nha_may_cdt) + '</span></div>' : '')
          + '</div>'
        : '<div style="margin-bottom:10px;font-size:13px;color:var(--text-muted);text-align:left">RFQ: <strong>' + API.esc(rfqFilter) + '</strong></div>';
      document.getElementById('itemRows').innerHTML = '<tr><td colspan="12" style="padding:0;border:0">'
        + '<div class="empty-state" style="margin:8px;border-radius:8px">'
        + '<div style="width:100%">'
        + rfqInfo
        + '<p style="margin:0 0 14px;font-size:14px;font-weight:500">RFQ chưa có dòng vật tư.</p>'
        + '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">'
        + '<button onclick="RfqItemsModule.downloadTemplate()">Tải template CSV</button>'
        + '<button data-write onclick="RfqItemsModule.importCsv()">Upload CSV</button>'
        + '</div></div></div>'
        + '</td></tr>';
      document.getElementById('itemMore').classList.add('hidden');
      Auth.applyRoleUI();
      return;
    }
    document.getElementById('itemRows').innerHTML = rows.map(function (r) {
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
    state.currentMedia = {};
    openForm({}, [], [], [], {});
  }

  async function openEdit(id) {
    var row = (state.rows || []).find(function (r) { return r.rfq_item_id === id; }) || { rfq_item_id: id };
    try {
      var results = await Promise.all([
        API.get('getTechnicalClarifications', { rfqItemId: id }),
        API.get('getSupplierQuotes', { rfqItemId: id }),
        API.get('getPricingDecisions', { rfqItemId: id }).catch(function () { return { rows: [] }; }),
        API.get('getMediaFiles', { ownerType: 'rfq_item', ownerId: id }).catch(function () { return { rows: [] }; }),
      ]);
      var quotes = results[1].rows || [];
      var quoteMedia = await loadQuoteMedia(quotes);
      state.currentMedia = {
        itemFiles: results[3].rows || [],
        quoteFiles: quoteMedia,
      };
      openForm(row, results[0].rows || [], quotes, results[2].rows || [], {
        itemFiles: results[3].rows || [],
        quoteFiles: quoteMedia,
      });
    } catch (err) {
      API.error(err);
    }
  }

  function openForm(r, clarifications, quotes, pricingDecisions, media) {
    Utils.openModal(r.rfq_item_id ? 'Sửa dòng vật tư' : 'Thêm dòng vật tư', fields(r, clarifications || [], quotes || [], pricingDecisions || []), async function (data) {
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

  async function loadQuoteMedia(quotes) {
    var map = {};
    await Promise.all((quotes || []).map(function (q) {
      if (!q.quote_id) return Promise.resolve();
      return API.get('getMediaFiles', { ownerType: 'quote', ownerId: q.quote_id })
        .then(function (data) { map[q.quote_id] = data.rows || []; })
        .catch(function () { map[q.quote_id] = []; });
    }));
    return map;
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

  function fields(r, clarifications, quotes, pricingDecisions) {
    var status = r.trang_thai_dong || 'chua_xu_ly';
    var latestDecision = (pricingDecisions || [])[0] || null;
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
      + itemAttachmentSection(r, (state.currentMedia && state.currentMedia.itemFiles) || [])
      + technicalSection(r, clarifications)
      + quotesSection(r, quotes || [], latestDecision, (state.currentMedia && state.currentMedia.quoteFiles) || {})
      + pricingSection(r, pricingDecisions || []);
  }

  function itemAttachmentSection(item, files) {
    if (!item.rfq_item_id) return '';
    var inputId = mediaInputId('rfq_item', item.rfq_item_id);
    return '<section class="modal-section media-section">'
      + '<div class="section-head"><h4>Tài liệu dòng vật tư</h4>'
      + '<div data-write>'
      + '<input id="' + inputId + '" type="file" accept="application/pdf,.pdf" style="max-width:220px">'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'rfq_item\', \'' + API.esc(item.rfq_item_id) + '\', \'document_pdf\', \'' + inputId + '\', \'' + API.esc(item.rfq_item_id) + '\')">Upload PDF</button>'
      + '</div></div>'
      + mediaList(files)
      + '</section>';
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
      ? '<span>' + API.esc(r.attachment_file_name || r.attachment_file_id) + '</span>'
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

  function quotesSection(item, rows, latestDecision, quoteFiles) {
    if (!item.rfq_item_id) return '';
    var activeRows = rows.filter(function (r) { return r.status !== 'archived'; });
    var archivedRows = rows.filter(function (r) { return r.status === 'archived'; });
    return '<section class="modal-section quotes-section">'
      + '<div class="section-head"><h4>Báo giá nhà cung cấp</h4>'
      + '<button type="button" data-write onclick="RfqItemsModule.openQuoteForm(\'' + API.esc(item.rfq_item_id) + '\')">+ Thêm báo giá</button></div>'
      + (activeRows.length >= 2 ? comparisonTable(item.rfq_item_id, activeRows, latestDecision) : '')
      + (activeRows.length
        ? '<div class="quotes-table-wrap">' + quotesTable(item.rfq_item_id, activeRows, latestDecision, quoteFiles) + '</div>'
        : '<div class="empty-state small">Chưa có báo giá.</div>')
      + (archivedRows.length
        ? '<details class="archived-quotes"><summary>Đã lưu trữ (' + archivedRows.length + ')</summary>'
          + '<div class="quotes-table-wrap">' + quotesTable(item.rfq_item_id, archivedRows, null, quoteFiles) + '</div>'
          + '</details>'
        : '')
      + '</section>';
  }

  function quotesTable(rfqItemId, rows, latestDecision, quoteFiles) {
    return '<table class="quotes-mini-table">'
      + '<thead><tr>'
      + '<th>Nhà CC</th><th>Hãng SX</th><th>Giá báo</th><th>T.tệ</th><th>Tỷ giá</th>'
      + '<th>Thuế</th><th>VND + Thuế</th><th>Giao hàng</th><th>Hiệu lực</th><th>Bảo hành</th><th>File PDF</th><th>Ghi chú</th><th></th>'
      + '</tr></thead><tbody>'
      + rows.map(function (r) { return quoteRow(rfqItemId, r, latestDecision, quoteFiles && quoteFiles[r.quote_id] || []); }).join('')
      + '</tbody></table>';
  }

  function quoteRow(rfqItemId, r, latestDecision, files) {
    var isArchived = r.status === 'archived';
    var isSelectedBase = !isArchived && latestDecision && latestDecision.base_quote_id === r.quote_id;
    var inputId = mediaInputId('quote', r.quote_id);
    var actions = isArchived
      ? '<span class="badge">Đã lưu trữ</span>'
      : '<button type="button" data-role-only="admin,manager" onclick="RfqItemsModule.openQuoteForm(\''
          + API.esc(rfqItemId) + '\', \'' + API.esc(r.quote_id) + '\')">Sửa</button>'
        + ' <button type="button" data-role-only="admin,manager" onclick="RfqItemsModule.archiveQuote(\''
          + API.esc(rfqItemId) + '\', \'' + API.esc(r.quote_id) + '\')">Lưu trữ</button>'
        + ' <button type="button" data-role-only="admin,manager" onclick="RfqItemsModule.openPricingForm(\''
          + API.esc(rfqItemId) + '\', \'' + API.esc(r.quote_id) + '\', \'' + API.esc(r.supplier_name || '') + '\', '
          + (r.price_vnd_incl_tax || 0) + ')">Chọn làm base</button>';
    var baseLabel = isSelectedBase
      ? ' <span class="badge" style="background:var(--primary-bg);border-color:var(--primary-border);color:var(--primary-dk)">★ base</span>'
      : '';
    return '<tr' + (isSelectedBase ? ' style="background:var(--primary-bg)"' : '') + '>'
      + '<td>' + API.esc(r.supplier_name || r.supplier_id || '-') + baseLabel + '</td>'
      + '<td>' + API.esc(r.manufacturer || '-') + '</td>'
      + '<td class="num">' + API.esc(r.quoted_price ? Number(r.quoted_price).toLocaleString('vi-VN') : '-') + '</td>'
      + '<td>' + API.esc(r.currency || 'VND') + '</td>'
      + '<td class="num">' + API.esc(r.exchange_rate && Number(r.exchange_rate) !== 1 ? Number(r.exchange_rate).toLocaleString('vi-VN') : '') + '</td>'
      + '<td class="num">' + API.esc(r.tax_rate ? r.tax_rate + '%' : '') + '</td>'
      + '<td class="num"><strong>' + API.esc(r.price_vnd_incl_tax ? API.money(r.price_vnd_incl_tax) : '-') + '</strong></td>'
      + '<td>' + API.esc(r.lead_time || '') + '</td>'
      + '<td>' + API.esc(r.valid_until || '') + '</td>'
      + '<td>' + API.esc(r.warranty || '') + '</td>'
      + '<td>' + quoteFileCell(rfqItemId, r.quote_id, inputId, files) + '</td>'
      + '<td class="muted">' + API.esc(r.note || '') + '</td>'
      + '<td class="nowrap">' + actions + '</td>'
      + '</tr>';
  }

  function quoteFileCell(rfqItemId, quoteId, inputId, files) {
    return '<div class="quote-file-cell">'
      + mediaList(files)
      + '<div data-write style="margin-top:6px">'
      + '<input id="' + inputId + '" type="file" accept="application/pdf,.pdf" style="max-width:170px">'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'quote\', \'' + API.esc(quoteId) + '\', \'quote_pdf\', \'' + inputId + '\', \'' + API.esc(rfqItemId) + '\')">Upload</button>'
      + '</div></div>';
  }

  function mediaList(files) {
    if (!files || !files.length) return '<div class="empty-state small">Chưa có file PDF.</div>';
    return '<ul class="media-list" style="margin:0;padding-left:18px;font-size:12px">'
      + files.map(function (f) {
        return '<li><strong>' + API.esc(f.file_name || f.file_id) + '</strong>'
          + ' <span class="muted">(' + API.esc(formatSize(f.size_bytes)) + ', ' + API.esc(formatDate(f.created_at)) + ')</span></li>';
      }).join('')
      + '</ul>';
  }

  async function uploadMediaFile(ownerType, ownerId, fileKind, inputId, rfqItemId) {
    var input = document.getElementById(inputId);
    var file = input && input.files && input.files[0];
    if (!file) {
      API.toast('Chọn file PDF trước khi upload', 'warn');
      return;
    }
    var form = new FormData();
    form.append('ownerType', ownerType);
    form.append('ownerId', ownerId);
    form.append('fileKind', fileKind);
    form.append('file', file);
    try {
      await API.upload(form);
      API.toast('Đã upload file PDF', 'success');
      await openEdit(rfqItemId);
    } catch (err) {
      API.error(err);
    }
  }

  function mediaInputId(ownerType, ownerId) {
    return 'media_' + ownerType + '_' + String(ownerId || '').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  function formatSize(value) {
    var n = Number(value || 0);
    if (!n) return '0 KB';
    if (n < 1024 * 1024) return Math.ceil(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
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

  // --- Price Comparison ---

  function comparisonTable(rfqItemId, activeRows, latestDecision) {
    var baseQuoteId = latestDecision ? latestDecision.base_quote_id : null;
    var sorted = activeRows.slice().sort(function (a, b) {
      return (a.price_vnd_incl_tax || 0) - (b.price_vnd_incl_tax || 0);
    });
    var minPrice = sorted.length ? (sorted[0].price_vnd_incl_tax || 0) : 0;
    return '<div style="margin-bottom:10px">'
      + '<p style="font-size:12px;color:var(--text-muted);margin:0 0 6px">So sánh giá (sắp xếp theo VND + thuế tăng dần)</p>'
      + '<table class="quotes-mini-table">'
      + '<thead><tr><th>Nhà CC</th><th>Hãng SX</th><th>VND + Thuế</th><th>Giao hàng</th><th>Bảo hành</th><th></th></tr></thead>'
      + '<tbody>'
      + sorted.map(function (r) {
          var isMin = minPrice > 0 && (r.price_vnd_incl_tax || 0) === minPrice;
          var isBase = baseQuoteId && r.quote_id === baseQuoteId;
          return '<tr' + (isMin ? ' style="background:var(--green-bg)"' : '') + '>'
            + '<td>' + API.esc(r.supplier_name || r.supplier_id || '-')
              + (isBase ? ' <span class="badge" style="background:var(--primary-bg);border-color:var(--primary-border);color:var(--primary-dk)">★ base</span>' : '')
              + '</td>'
            + '<td>' + API.esc(r.manufacturer || '-') + '</td>'
            + '<td><strong' + (isMin ? ' style="color:var(--green)"' : '') + '>'
              + API.esc(r.price_vnd_incl_tax ? API.money(r.price_vnd_incl_tax) : '-') + '</strong></td>'
            + '<td>' + API.esc(r.lead_time || '') + '</td>'
            + '<td>' + API.esc(r.warranty || '') + '</td>'
            + '<td><button type="button" data-role-only="admin,manager" onclick="RfqItemsModule.openPricingForm(\''
              + API.esc(rfqItemId) + '\', \'' + API.esc(r.quote_id) + '\', \'' + API.esc(r.supplier_name || '') + '\', '
              + (r.price_vnd_incl_tax || 0) + ')">Chọn làm base</button></td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>'
      + '</div>';
  }

  // --- Pricing Decisions ---

  function pricingSection(item, pricingRows) {
    if (!item.rfq_item_id) return '';
    return '<section class="modal-section pricing-section" data-role-only="admin,manager,purchasing">'
      + '<div class="section-head"><h4>Cân giá / Quyết định giá</h4>'
      + '<button type="button" data-role-only="admin,manager" onclick="RfqItemsModule.openPricingForm(\''
      + API.esc(item.rfq_item_id) + '\')">+ Tạo phiên cân giá</button>'
      + '</div>'
      + (pricingRows.length
        ? pricingRows.map(function (r, i) { return pricingRow(r, i === 0); }).join('')
        : '<div class="empty-state small">Chưa có phiên cân giá.</div>')
      + '</section>';
  }

  function pricingRow(r, isLatest) {
    var riskBg     = r.risk_level === 'high' ? '#fef2f2' : r.risk_level === 'medium' ? '#fffbeb' : 'var(--green-bg)';
    var riskBorder = r.risk_level === 'high' ? '#fecaca' : r.risk_level === 'medium' ? '#fde68a' : '#86efac';
    var riskColor  = r.risk_level === 'high' ? 'var(--red)' : r.risk_level === 'medium' ? '#92400e' : 'var(--green)';
    return '<article class="timeline-item"' + (isLatest ? ' style="border-color:var(--primary-border)"' : '') + '>'
      + '<div class="timeline-top">'
      + '<strong>Phiên v' + r.version
        + (isLatest ? ' <span class="badge">Mới nhất</span>' : '')
        + '</strong>'
      + '<span>' + API.esc(formatDate(r.created_at)) + '</span>'
      + '</div>'
      + '<div style="margin-bottom:6px">'
      + (r.selection_reason
        ? '<span class="badge" style="margin-right:4px">' + API.esc(selectionReasonLabel(r.selection_reason)) + '</span>'
        : '')
      + (r.risk_level
        ? '<span class="badge" style="background:' + riskBg + ';border-color:' + riskBorder + ';color:' + riskColor + '">'
          + API.esc(riskLevelLabel(r.risk_level)) + '</span>'
        : '')
      + '</div>'
      + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">'
      + 'Báo giá gốc: <strong style="color:var(--text)">' + API.esc(r.supplier_name || r.base_quote_id || '-') + '</strong>'
      + ' — Giá gốc: <strong style="color:var(--text)">' + (r.base_price_vnd_incl_tax ? API.money(r.base_price_vnd_incl_tax) : '-') + '</strong> VND'
      + '</div>'
      + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">'
      + 'Markup: <strong style="color:var(--text)">x' + (r.markup_rate || '-') + '</strong>'
      + ' → Đơn giá đề xuất: <strong style="color:var(--primary-dk)">' + (r.proposed_unit_price ? API.money(r.proposed_unit_price) : '-') + '</strong> VND'
      + ' | Tổng: <strong style="color:var(--primary-dk)">' + (r.proposed_line_total ? API.money(r.proposed_line_total) : '-') + '</strong> VND'
      + '</div>'
      + (r.risk_note ? '<div style="font-size:12px;color:var(--text-muted)">Rủi ro: ' + API.esc(r.risk_note) + '</div>' : '')
      + (r.pricing_note ? '<p style="font-size:12px;margin:4px 0 0">' + API.esc(r.pricing_note) + '</p>' : '')
      + '</article>';
  }

  function selectionReasonLabel(value) {
    return {
      lowest_price:    'Giá thấp nhất',
      better_lead_time: 'Giao hàng nhanh hơn',
      better_warranty: 'Bảo hành tốt hơn',
      preferred_brand: 'Hãng ưu tiên',
      client_approved: 'CĐT chấp thuận',
      available_stock: 'Có hàng sẵn',
      other:           'Lý do khác',
    }[value] || value || '-';
  }

  function riskLevelLabel(value) {
    return {
      low:    'Rủi ro thấp',
      medium: 'Rủi ro trung bình',
      high:   'Rủi ro cao',
    }[value] || value || '-';
  }

  function openPricingForm(rfqItemId, baseQuoteId, supplierName, basePriceVndInclTax) {
    if (baseQuoteId) {
      Utils.openModal(
        'Tạo phiên cân giá',
        pricingFormHtml(baseQuoteId, null, supplierName, basePriceVndInclTax),
        async function (form) {
          try {
            form.rfqItemId   = rfqItemId;
            await API.call('createPricingDecision', form);
            Utils.closeModal();
            API.toast('Đã lưu phiên cân giá', 'success');
            await load(true);
          } catch (err) {
            API.error(err);
          }
        }
      );
      Auth.applyRoleUI();
    } else {
      API.get('getSupplierQuotes', { rfqItemId: rfqItemId }).then(function (data) {
        var activeQuotes = (data.rows || []).filter(function (q) { return q.status !== 'archived'; });
        if (!activeQuotes.length) {
          API.toast('Không có báo giá active. Thêm báo giá trước.', 'warn');
          return;
        }
        Utils.openModal(
          'Tạo phiên cân giá',
          pricingFormHtml(null, activeQuotes, null, 0),
          async function (form) {
            try {
              form.rfqItemId = rfqItemId;
              await API.call('createPricingDecision', form);
              Utils.closeModal();
              API.toast('Đã lưu phiên cân giá', 'success');
              await load(true);
            } catch (err) {
              API.error(err);
            }
          }
        );
        Auth.applyRoleUI();
      }).catch(API.error);
    }
  }

  function pricingFormHtml(baseQuoteId, activeQuotes, supplierName, basePriceVndInclTax) {
    var baseSection = baseQuoteId
      ? '<input type="hidden" name="baseQuoteId" value="' + API.esc(baseQuoteId) + '">'
        + '<div style="background:var(--primary-bg);border:1px solid var(--primary-border);border-radius:9px;padding:10px 13px;margin-bottom:10px;font-size:13px;grid-column:1/-1">'
        + '<strong>Báo giá gốc:</strong> ' + API.esc(supplierName || baseQuoteId)
        + (basePriceVndInclTax ? ' — ' + API.money(basePriceVndInclTax) + ' VND' : '')
        + '</div>'
      : '<label style="grid-column:1/-1">Chọn báo giá gốc'
        + '<select name="baseQuoteId" required>'
        + '<option value="">-- Chọn báo giá --</option>'
        + (activeQuotes || []).map(function (q) {
            return '<option value="' + API.esc(q.quote_id) + '">'
              + API.esc(q.supplier_name || q.quote_id)
              + (q.price_vnd_incl_tax ? ' — ' + API.money(q.price_vnd_incl_tax) + ' VND' : '')
              + '</option>';
          }).join('')
        + '</select></label>';

    var markupOptions = [1.0, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0];

    return baseSection
      + '<label>Hệ số markup<select name="markupRate">'
      + markupOptions.map(function (v) {
          return '<option value="' + v + '"' + (v === 1.4 ? ' selected' : '') + '>'
            + 'x' + v + ' (' + Math.round((v - 1) * 100) + '% biên độ)'
            + '</option>';
        }).join('')
      + '</select></label>'
      + '<label>Lý do chọn báo giá<select name="selectionReason">'
      + option('', '-- Chọn lý do --', '')
      + option('lowest_price',    'Giá thấp nhất', '')
      + option('better_lead_time','Giao hàng nhanh hơn', '')
      + option('better_warranty', 'Bảo hành tốt hơn', '')
      + option('preferred_brand', 'Hãng ưu tiên', '')
      + option('client_approved', 'CĐT chấp thuận', '')
      + option('available_stock', 'Có hàng sẵn', '')
      + option('other',           'Lý do khác', '')
      + '</select></label>'
      + '<label>Mức độ rủi ro<select name="riskLevel">'
      + option('low',    'Thấp', 'low')
      + option('medium', 'Trung bình', '')
      + option('high',   'Cao', '')
      + '</select></label>'
      + '<label>Ghi chú rủi ro<textarea name="riskNote" placeholder="Mô tả rủi ro nếu có"></textarea></label>'
      + '<label>Ghi chú cân giá (bắt buộc nếu chọn "Lý do khác")<textarea name="pricingNote" placeholder="Ghi chú bổ sung hoặc lý do cụ thể"></textarea></label>';
  }

  // --- CSV Template / Import ---

  // Business-friendly template — rfqItemId/rfqId/originFullText hidden (still supported on import)
  var TEMPLATE_HEADERS = [
    'STT', 'Mã mua sắm', 'Mã vật tư',
    'Tên vật tư / Danh mục hàng hóa', 'Ký mã hiệu / Model', 'Nhãn hiệu',
    'Năm sản xuất', 'Xuất xứ', 'Hãng sản xuất', 'Quy cách / thông số kỹ thuật',
    'Vật liệu', 'Phụ tùng chuyên dụng', 'Yêu cầu kỹ thuật bổ sung',
    'Đơn vị tính', 'Khối lượng', 'Thuế suất', 'Đơn giá', 'Thành tiền',
    'Thời gian giao hàng', 'Ghi chú',
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
    'rfqItemId (Không sửa)': 'rfqItemId',
  };

  var csvState = { headers: null, rows: null };

  // Export: all business columns + rfqItemId at far right for round-trip bulk update
  var EXPORT_HEADERS = TEMPLATE_HEADERS.concat(['rfqItemId (Không sửa)']);

  function rowToExportValues(r) {
    return [
      r.stt_goc, r.ma_mua_sam, r.ma_vat_tu,
      r.ten_vat_tu,
      val(r, 'required_model', 'quy_cach_model_yeu_cau'),
      val(r, 'brand', 'nhan_hieu'),
      val(r, 'manufacture_year', 'nam_san_xuat'),
      val(r, 'origin_country', 'xuat_xu'),
      val(r, 'manufacturer', 'hang_goc_nsx_goc'),
      val(r, 'technical_params', 'thong_so_ky_thuat'),
      r.vat_lieu, r.phu_tung_chuyen_dung, r.yeu_cau_ky_thuat_bo_sung,
      val(r, 'unit', 'don_vi'),
      val(r, 'quantity', 'so_luong'),
      r.thue_suat,
      r.don_gia_truoc_thue || r.don_gia_sau_thue,
      r.thanh_tien_sau_thue,
      r.delivery_time,
      r.note,
      r.rfq_item_id,
    ];
  }

  async function exportCsv() {
    var rfqId = (document.getElementById('itemRfqId').value || '').trim();
    if (!rfqId) { API.toast('Lọc theo RFQ trước khi xuất CSV', 'warn'); return; }
    try {
      var allRows = [], cursor = '', page = 0, maxPages = 20;
      while (page < maxPages) {
        var data = await API.get('getRfqItems', { rfqId: rfqId, cursor: cursor, limit: 50 });
        allRows = allRows.concat(data.rows || []);
        if (!data.hasMore) break;
        cursor = data.nextCursor || '';
        page++;
      }
      if (!allRows.length) { API.toast('Không có dữ liệu để xuất', 'warn'); return; }
      var csv = '﻿'
        + EXPORT_HEADERS.map(csvQuote).join(',') + '\r\n'
        + allRows.map(function (r) { return rowToExportValues(r).map(csvQuote).join(','); }).join('\r\n')
        + '\r\n';
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'rfq-items-' + rfqId + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      API.toast('Đã xuất ' + allRows.length + ' dòng', 'success');
    } catch (err) {
      API.error(err);
    }
  }

  function csvQuote(value) {
    var s = String(value == null ? '' : value);
    if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function downloadTemplate() {
    var exampleRow = TEMPLATE_HEADERS.map(function (h) {
      if (h === 'STT') return '1';
      if (h === 'Tên vật tư / Danh mục hàng hóa') return csvQuote('Vòng bi SKF 6205-2RS');
      if (h === 'Ký mã hiệu / Model') return 'SKF 6205-2RS';
      if (h === 'Nhãn hiệu') return 'SKF';
      if (h === 'Hãng sản xuất') return 'SKF AB';
      if (h === 'Xuất xứ') return csvQuote('Thụy Điển');
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
      if (!payload.rfqId) payload.rfqId = (document.getElementById('itemRfqId').value || '').trim();
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
    if (ok > 0 && typeof RfqsModule !== 'undefined') await RfqsModule.load(true);
    var importRfqId = (document.getElementById('itemRfqId').value || '').trim();
    var rfqRow = importRfqId ? (AppState.list('rfqs').rows || []).find(function (r) { return r.rfq_id === importRfqId; }) : null;
    var totalCount = rfqRow ? Number(rfqRow.item_count || 0) : state.rows.length;
    var borderColor = errs.length && ok === 0 ? 'var(--red)' : (errs.length ? 'var(--primary)' : 'var(--green)');
    var rfqLine = rfqRow
      ? '<p style="margin:0 0 6px;font-size:12px;color:var(--text-muted)">RFQ: <strong>' + API.esc(rfqRow.rfq_id) + '</strong>' + (rfqRow.ten_goi ? ' — ' + API.esc(rfqRow.ten_goi) : '') + '</p>'
      : (importRfqId ? '<p style="margin:0 0 6px;font-size:12px;color:var(--text-muted)">RFQ: <strong>' + API.esc(importRfqId) + '</strong></p>' : '');
    var summary = '<div style="border-left:3px solid ' + borderColor + ';padding-left:10px;margin-bottom:0.5rem">'
      + rfqLine
      + '<p style="margin:2px 0;font-size:13px"><strong>Đã thêm / cập nhật:</strong> ' + ok + ' dòng vật tư</p>'
      + '<p style="margin:2px 0;font-size:13px"><strong>Lỗi:</strong> ' + errs.length + '</p>'
      + '<p style="margin:2px 0;font-size:13px"><strong>Tổng số dòng hiện tại:</strong> ' + totalCount + '</p>'
      + '</div>';
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
    openPricingForm: openPricingForm,
    uploadMediaFile: uploadMediaFile,
    downloadTemplate: downloadTemplate,
    exportCsv: exportCsv,
    importCsv: importCsv,
    _onCsvFileChange: _onCsvFileChange,
  };
})();
