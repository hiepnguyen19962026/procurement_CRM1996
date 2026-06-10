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
        row.item_id ? API.get('getMasterItemDetail', { itemId: row.item_id }).catch(function () { return { item: null }; }) : Promise.resolve({ item: null }),
        API.get('suggestMasterItemsForRfqItem', { rfqItemId: id }).catch(function () { return { rows: [] }; }),
      ]);
      var quotes = results[1].rows || [];
      var quoteMedia = await loadQuoteMedia(quotes);
      state.currentMedia = {
        itemFiles: results[3].rows || [],
        quoteFiles: quoteMedia,
      };
      state.currentMaster = {
        item: results[4].item || null,
        suggestions: results[5].rows || [],
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
      + masterItemSection(r, state.currentMaster || {})
      + itemAttachmentSection(r, (state.currentMedia && state.currentMedia.itemFiles) || [])
      + technicalSection(r, clarifications)
      + quotesSection(r, quotes || [], latestDecision, (state.currentMedia && state.currentMedia.quoteFiles) || {})
      + pricingSection(r, pricingDecisions || [])
      + priceHistorySection(r)
      + contractSection(r);
  }

  function masterItemSection(item, master) {
    if (!item.rfq_item_id) return '';
    var linked = master && master.item;
    var suggestions = (master && master.suggestions) || [];
    var suffix = String(item.rfq_item_id || '').replace(/[^A-Za-z0-9_-]/g, '_');
    var searchId = 'master_search_' + suffix;
    var resultsId = 'master_results_' + suffix;
    return '<section class="modal-section master-item-section">'
      + '<div class="section-head"><h4>Master v&#7853;t t&#432;</h4></div>'
      + (linked
        ? '<div class="timeline-item">'
          + masterItemSummary(linked)
          + '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">'
          + '<button type="button" onclick="RfqItemsModule.refreshMasterItem(\'' + API.esc(item.rfq_item_id) + '\')">L&#224;m m&#7899;i</button>'
          + '<button type="button" data-write onclick="RfqItemsModule.unlinkMasterItem(\'' + API.esc(item.rfq_item_id) + '\')">B&#7887; li&#234;n k&#7871;t</button>'
          + '</div></div>'
        : '<div class="empty-state small">Ch&#432;a li&#234;n k&#7871;t master item.</div>'
          + '<div data-write style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">'
          + '<button type="button" onclick="RfqItemsModule.createMasterFromRfqItem(\'' + API.esc(item.rfq_item_id) + '\')">T&#7841;o master t&#7915; d&#242;ng n&#224;y</button>'
          + '</div>'
          + '<div style="margin-top:10px;display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:8px;align-items:end">'
          + '<label style="margin:0">T&#236;m master item<input id="' + searchId + '" value="' + API.esc([item.ma_vat_tu, item.ten_vat_tu].filter(Boolean).join(' ')) + '"></label>'
          + '<button type="button" onclick="RfqItemsModule.searchMasterItemsForLink(\'' + API.esc(item.rfq_item_id) + '\', \'' + searchId + '\', \'' + resultsId + '\')">T&#236;m</button>'
          + '</div>'
          + '<div id="' + resultsId + '" style="margin-top:8px">' + masterSuggestionList(item.rfq_item_id, suggestions) + '</div>')
      + '</section>';
  }

  function masterItemSummary(r) {
    return '<div>'
      + '<strong>' + API.esc(r.item_id || '-') + '</strong>'
      + (r.ma_vat_tu ? ' <span class="badge">' + API.esc(r.ma_vat_tu) + '</span>' : '')
      + '<div style="margin-top:4px"><strong>' + API.esc(r.ten_vat_tu || '-') + '</strong></div>'
      + '<div class="muted">' + API.esc([r.required_model, r.manufacturer, r.brand, r.origin_country, r.unit].filter(Boolean).join(' - ')) + '</div>'
      + '<div class="muted" style="font-size:12px;margin-top:4px">'
      + API.esc((r.linked_rfq_item_count || 0) + ' dong RFQ, ' + (r.quote_count || 0) + ' bao gia')
      + '</div></div>';
  }

  function masterSuggestionList(rfqItemId, rows) {
    if (!rows || !rows.length) return '<div class="empty-state small">Ch&#432;a c&#243; g&#7907;i &#253; ph&#249; h&#7907;p.</div>';
    return '<div class="quotes-table-wrap"><table class="quotes-mini-table">'
      + '<thead><tr><th>M&#227;</th><th>T&#234;n master</th><th>Quy c&#225;ch / h&#227;ng</th><th></th></tr></thead><tbody>'
      + rows.slice(0, 10).map(function (r) {
        return '<tr>'
          + '<td>' + API.esc(r.ma_vat_tu || r.item_id || '-') + '</td>'
          + '<td><strong>' + API.esc(r.ten_vat_tu || '-') + '</strong><div class="muted">' + API.esc(r.item_id || '') + '</div></td>'
          + '<td>' + API.esc([r.required_model, r.manufacturer, r.brand, r.origin_country, r.unit].filter(Boolean).join(' - ')) + '</td>'
          + '<td><button type="button" data-write onclick="RfqItemsModule.linkMasterItem(\'' + API.esc(rfqItemId) + '\', \'' + API.esc(r.item_id) + '\')">Link</button></td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>';
  }

  async function refreshMasterItem(rfqItemId) {
    await openEdit(rfqItemId);
  }

  async function createMasterFromRfqItem(rfqItemId) {
    try {
      await API.call('createMasterItem', { sourceRfqItemId: rfqItemId });
      API.toast('Da tao va lien ket master item', 'success');
      await load(true);
      await openEdit(rfqItemId);
    } catch (err) {
      API.error(err);
    }
  }

  async function linkMasterItem(rfqItemId, itemId) {
    try {
      await API.call('linkRfqItemToMaster', { rfqItemId: rfqItemId, itemId: itemId });
      API.toast('Da lien ket master item', 'success');
      await load(true);
      await openEdit(rfqItemId);
    } catch (err) {
      API.error(err);
    }
  }

  async function unlinkMasterItem(rfqItemId) {
    try {
      await API.call('unlinkRfqItemFromMaster', { rfqItemId: rfqItemId });
      API.toast('Da bo lien ket master item', 'success');
      await load(true);
      await openEdit(rfqItemId);
    } catch (err) {
      API.error(err);
    }
  }

  async function searchMasterItemsForLink(rfqItemId, inputId, targetId) {
    var input = document.getElementById(inputId);
    var target = document.getElementById(targetId);
    var q = input ? input.value : '';
    if (target) target.innerHTML = '<div class="empty-state small">&#272;ang t&#236;m...</div>';
    try {
      var data = await API.get('searchMasterItems', { q: q, status: 'active', limit: 10 });
      if (target) target.innerHTML = masterSuggestionList(rfqItemId, data.rows || []);
      Auth.applyRoleUI();
    } catch (err) {
      API.error(err);
    }
  }

  function itemAttachmentSection(item, files) {
    if (!item.rfq_item_id) return '';
    var pdfInputId = mediaInputId('rfq_item', item.rfq_item_id, 'document_pdf');
    var imageInputId = mediaInputId('rfq_item', item.rfq_item_id, 'item_image');
    var pdfFiles = filterMedia(files, 'document_pdf');
    var imageFiles = filterMedia(files, 'item_image');
    return '<section class="modal-section media-section">'
      + '<div class="section-head"><h4>Tài liệu dòng vật tư</h4>'
      + '<div data-write>'
      + '<input id="' + pdfInputId + '" type="file" accept="application/pdf,.pdf" style="max-width:220px">'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'rfq_item\', \'' + API.esc(item.rfq_item_id) + '\', \'document_pdf\', \'' + pdfInputId + '\', \'' + API.esc(item.rfq_item_id) + '\')">Upload PDF</button>'
      + '</div></div>'
      + mediaList(pdfFiles, 'Chưa có file PDF.')
      + '<div class="section-head media-subhead"><h4>Ảnh vật tư</h4>'
      + '<div data-write>'
      + '<input id="' + imageInputId + '" type="file" accept="image/jpeg,image/png,image/webp" style="max-width:220px">'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'rfq_item\', \'' + API.esc(item.rfq_item_id) + '\', \'item_image\', \'' + imageInputId + '\', \'' + API.esc(item.rfq_item_id) + '\')">Upload ảnh</button>'
      + '</div></div>'
      + imageGallery(imageFiles)
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
      + '<th>Thuế</th><th>VND + Thuế</th><th>Giao hàng</th><th>Hiệu lực</th><th>Bảo hành</th><th>File / minh chứng</th><th>Ghi chú</th><th></th>'
      + '</tr></thead><tbody>'
      + rows.map(function (r) { return quoteRow(rfqItemId, r, latestDecision, quoteFiles && quoteFiles[r.quote_id] || []); }).join('')
      + '</tbody></table>';
  }

  function quoteRow(rfqItemId, r, latestDecision, files) {
    var isArchived = r.status === 'archived';
    var isSelectedBase = !isArchived && latestDecision && latestDecision.base_quote_id === r.quote_id;
    var inputId = mediaInputId('quote', r.quote_id, 'quote');
    var actions = isArchived
      ? '<span class="badge">Đã lưu trữ</span>'
      : '<button type="button" data-role-only="admin,manager,purchasing" onclick="RfqItemsModule.openQuoteForm(\''
          + API.esc(rfqItemId) + '\', \'' + API.esc(r.quote_id) + '\')">Sửa</button>'
        + ' <button type="button" data-role-only="admin,manager" onclick="RfqItemsModule.archiveQuote(\''
          + API.esc(rfqItemId) + '\', \'' + API.esc(r.quote_id) + '\')">Lưu trữ</button>'
        + ' <button type="button" data-role-only="admin,manager" onclick="RfqItemsModule.openPricingForm(\''
          + API.esc(rfqItemId) + '\', \'' + API.esc(r.quote_id) + '\', \'' + API.esc(r.supplier_name || '') + '\', '
          + (r.price_vnd_incl_tax || 0) + ')">Chọn làm base</button>';
    var baseLabel = isSelectedBase
      ? ' <span class="badge" style="background:var(--primary-bg);border-color:var(--primary-border);color:var(--primary-dk)">★ base</span>'
      : '';
    var sourceText = quoteSourceText(r);
    return '<tr' + (isSelectedBase ? ' style="background:var(--primary-bg)"' : '') + '>'
      + '<td>' + API.esc(r.supplier_name || r.supplier_id || '-') + baseLabel
        + (sourceText ? '<div class="muted" style="font-size:12px;margin-top:4px">' + API.esc(sourceText) + '</div>' : '')
        + '</td>'
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
      + '<td class="muted">' + API.esc([r.note, r.received_at ? ('Nhận: ' + r.received_at) : ''].filter(Boolean).join('\n')) + '</td>'
      + '<td class="nowrap">' + actions + '</td>'
      + '</tr>';
  }

  function quoteFileCell(rfqItemId, quoteId, inputId, files) {
    var pdfInputId = inputId + '_pdf';
    var imageInputId = inputId + '_evidence';
    var pdfFiles = filterMedia(files, 'quote_pdf');
    var imageFiles = filterMedia(files, 'quote_evidence_image');
    return '<div class="quote-file-cell">'
      + '<div class="media-label">File PDF</div>'
      + mediaList(pdfFiles, 'Chưa có file PDF.')
      + '<div data-write style="margin-top:6px">'
      + '<input id="' + pdfInputId + '" type="file" accept="application/pdf,.pdf" style="max-width:170px">'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'quote\', \'' + API.esc(quoteId) + '\', \'quote_pdf\', \'' + pdfInputId + '\', \'' + API.esc(rfqItemId) + '\')">Upload</button>'
      + '</div>'
      + '<div class="media-label" style="margin-top:8px">Minh chứng báo giá</div>'
      + imageGallery(imageFiles)
      + '<div data-write style="margin-top:6px">'
      + '<input id="' + imageInputId + '" type="file" accept="image/jpeg,image/png,image/webp" style="max-width:170px">'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'quote\', \'' + API.esc(quoteId) + '\', \'quote_evidence_image\', \'' + imageInputId + '\', \'' + API.esc(rfqItemId) + '\')">Upload ảnh</button>'
      + '</div></div>';
  }

  function mediaList(files, emptyText) {
    if (!files || !files.length) return '<div class="empty-state small">' + API.esc(emptyText || 'Chưa có file.') + '</div>';
    return '<ul class="media-list" style="margin:0;padding-left:18px;font-size:12px">'
      + files.map(function (f) {
        return '<li><a href="' + API.esc(API.mediaUrl(f.file_id)) + '" target="_blank" rel="noopener"><strong>' + API.esc(f.file_name || f.file_id) + '</strong></a>'
          + ' <span class="muted">(' + API.esc(formatSize(f.size_bytes)) + ', ' + API.esc(formatDate(f.created_at)) + ')</span></li>';
      }).join('')
      + '</ul>';
  }

  function imageGallery(files) {
    if (!files || !files.length) return '<div class="empty-state small">Chưa có ảnh.</div>';
    return '<div class="media-gallery">'
      + files.map(function (f) {
        var src = API.mediaUrl(f.file_id);
        return '<button type="button" class="media-thumb" onclick="RfqItemsModule.openMediaPreview(\'' + API.esc(f.file_id) + '\')" title="' + API.esc(f.file_name || f.file_id) + '">'
          + '<img src="' + API.esc(src) + '" alt="' + API.esc(f.file_name || 'Ảnh upload') + '" loading="lazy">'
          + '<span>' + API.esc(f.file_name || f.file_id) + '</span>'
          + '</button>';
      }).join('')
      + '</div>';
  }

  function filterMedia(files, fileKind) {
    return (files || []).filter(function (f) { return f.file_kind === fileKind; });
  }

  async function uploadMediaFile(ownerType, ownerId, fileKind, inputId, rfqItemId) {
    var input = document.getElementById(inputId);
    var file = input && input.files && input.files[0];
    var isImage = fileKind === 'item_image' || fileKind === 'quote_evidence_image';
    if (!file) {
      if (isImage) {
        API.toast('Chọn ảnh trước khi upload', 'warn');
        return;
      }
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
      if (isImage) {
        API.toast('Đã upload ảnh', 'success');
        await openEdit(rfqItemId);
        return;
      }
      API.toast('Đã upload file PDF', 'success');
      await openEdit(rfqItemId);
    } catch (err) {
      API.error(err);
    }
  }

  function openMediaPreview(fileId) {
    window.open(API.mediaUrl(fileId), '_blank', 'noopener');
  }

  function mediaInputId(ownerType, ownerId, fileKind) {
    return 'media_' + ownerType + '_' + String(ownerId || '').replace(/[^A-Za-z0-9_-]/g, '_') + '_' + String(fileKind || '').replace(/[^A-Za-z0-9_-]/g, '_');
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
    var sourceChannel = r.source_channel || '';
    return ''
      + quoteReferenceFields(r, sourceChannel)
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

  function quoteReferenceFields(r, sourceChannel) {
    return ''
      + '<label>Nguồn báo giá<select name="sourceChannel">'
      + sourceOption('', '-', sourceChannel)
      + sourceOption('zalo', 'Zalo', sourceChannel)
      + sourceOption('wechat', 'WeChat', sourceChannel)
      + sourceOption('email', 'Email', sourceChannel)
      + sourceOption('phone', 'Phone', sourceChannel)
      + sourceOption('direct', 'Direct', sourceChannel)
      + sourceOption('other', 'Other', sourceChannel)
      + '</select></label>'
      + input('receivedAt', 'Thời điểm nhận báo giá', r.received_at || '', 'type="datetime-local"')
      + textarea('sourceRef', 'Ghi chú nguồn / tham chiếu', r.source_ref || '');
  }

  function sourceOption(value, label, current) {
    return '<option value="' + API.esc(value) + '"' + (value === current ? ' selected' : '') + '>' + API.esc(label) + '</option>';
  }

  function quoteSourceText(r) {
    var channel = sourceChannelLabel(r.source_channel);
    var ref = r.source_ref || '';
    return [channel, ref].filter(Boolean).join(' - ');
  }

  function sourceChannelLabel(value) {
    return {
      zalo: 'Zalo',
      wechat: 'WeChat',
      email: 'Email',
      phone: 'Phone',
      direct: 'Direct',
      other: 'Other',
    }[value] || '';
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

  // --- Price History ---

  function priceHistorySection(item) {
    if (!item.rfq_item_id) return '';
    var suffix = String(item.rfq_item_id).replace(/[^A-Za-z0-9_-]/g, '_');
    var containerId = 'ph_' + suffix;
    return '<section class="modal-section price-history-section">'
      + '<div class="section-head"><h4>L&#7883;ch s&#7917; gi&#225;</h4>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
      + '<button type="button" onclick="RfqItemsModule.loadPriceHistory(\'' + API.esc(item.rfq_item_id) + '\')">Xem l&#7883;ch s&#7917; gi&#225;</button>'
      + '<button type="button" onclick="RfqItemsModule.exportPriceHistory(\'' + API.esc(item.rfq_item_id) + '\')">Xu&#7845;t CSV</button>'
      + '</div></div>'
      + '<div id="' + containerId + '" class="empty-state small">Nh&#7845;n &#8220;Xem l&#7883;ch s&#7917; gi&#225;&#8221; &#273;&#7875; t&#7843;i d&#7919; li&#7879;u.</div>'
      + '</section>';
  }

  async function loadPriceHistory(rfqItemId) {
    var item = (state.rows || []).find(function (r) { return r.rfq_item_id === rfqItemId; }) || { rfq_item_id: rfqItemId };
    var suffix = String(rfqItemId).replace(/[^A-Za-z0-9_-]/g, '_');
    var container = document.getElementById('ph_' + suffix);
    if (!container) return;
    container.textContent = 'Đang tải...';
    var params = { limit: 50 };
    if (item.item_id) {
      params.itemId = item.item_id;
    } else if (item.ma_vat_tu) {
      params.maVatTu = item.ma_vat_tu;
    } else {
      params.rfqItemId = rfqItemId;
    }
    try {
      var data = await API.get('searchPriceHistory', params);
      var rows = data.rows || [];
      if (!rows.length) {
        container.innerHTML = '<div class="empty-state small">Ch&#432;a c&#243; l&#7883;ch s&#7917; gi&#225;.</div>';
        return;
      }
      container.innerHTML = renderPriceHistoryTable(rows, data.hasMore);
    } catch (err) {
      container.textContent = 'Lỗi tải lịch sử giá.';
      API.error(err);
    }
  }

  async function exportPriceHistory(rfqItemId) {
    var item = (state.rows || []).find(function (r) { return r.rfq_item_id === rfqItemId; }) || { rfq_item_id: rfqItemId };
    var params = {};
    if (item.item_id) {
      params.itemId = item.item_id;
    } else if (item.ma_vat_tu) {
      params.maVatTu = item.ma_vat_tu;
    } else {
      params.rfqItemId = rfqItemId;
    }
    try {
      var data = await API.call('exportPriceHistoryCsv', params);
      if (!data.ok) { API.toast(data.error || 'Lỗi xuất CSV', 'error'); return; }
      downloadCsvBlob(data.csv, data.filename);
      API.toast('Đã xuất ' + (data.row_count || 0) + ' dòng lịch sử giá', 'success');
    } catch (err) {
      API.error(err);
    }
  }

  function downloadCsvBlob(csvText, filename) {
    var blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'price-history.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function renderPriceHistoryTable(rows, hasMore) {
    var head = '<thead><tr>'
      + '<th>Tên VT</th><th>Quy c&#225;ch/model</th><th>M&#227; g&#243;i</th>'
      + '<th>T&#234;n NCC</th><th>H&#227;ng SX</th>'
      + '<th>Ng&#224;y b&#225;o gi&#225;</th><th>Ng&#224;y nh&#7853;n</th>'
      + '<th>Gi&#225; b&#225;o</th><th>T.t&#7879;</th><th>Gi&#225; VND+Thu&#7871;</th>'
      + '<th>Giao h&#224;ng</th><th>Minh ch&#7913;ng</th><th>K&#234;nh</th>'
      + '</tr></thead>';
    var body = '<tbody>'
      + rows.map(function (r) {
          var tenVt = r.master_ten_vat_tu || r.ten_vat_tu || '-';
          var model = r.master_spec || r.required_model || '-';
          var evidenceBadge = r.evidence_count > 0
            ? ' <span class="badge" style="background:var(--blue-lt);color:var(--blue)">' + r.evidence_count + ' file</span>'
            : '';
          return '<tr>'
            + '<td><strong>' + API.esc(tenVt) + '</strong>'
              + (r.ma_vat_tu ? '<div class="muted" style="font-size:11px">' + API.esc(r.ma_vat_tu) + '</div>' : '')
              + '</td>'
            + '<td>' + API.esc(model) + '</td>'
            + '<td>' + API.esc(r.ma_goi_tbmt || r.rfq_id || '-') + '<div class="muted" style="font-size:11px">' + API.esc(r.ten_goi || '') + '</div></td>'
            + '<td>' + API.esc(r.supplier_name || '-') + '</td>'
            + '<td>' + API.esc(r.manufacturer || '-') + '</td>'
            + '<td>' + API.esc(r.quote_date || '') + '</td>'
            + '<td>' + API.esc(r.received_at || '') + '</td>'
            + '<td class="num">' + API.esc(r.quoted_price ? Number(r.quoted_price).toLocaleString('vi-VN') : '-') + '</td>'
            + '<td>' + API.esc(r.currency || 'VND') + '</td>'
            + '<td class="num"><strong>' + API.esc(r.price_vnd_incl_tax ? API.money(r.price_vnd_incl_tax) : '-') + '</strong></td>'
            + '<td>' + API.esc(r.lead_time || '') + '</td>'
            + '<td>' + evidenceBadge + '</td>'
            + '<td>' + API.esc(r.source_channel || '') + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody>';
    return '<div class="quotes-table-wrap">'
      + '<table class="quotes-mini-table">' + head + body + '</table>'
      + (hasMore ? '<p style="font-size:12px;color:var(--text-muted);margin:6px 0 0">Ch&#7881; hi&#7875;n 50 d&#242;ng m&#7899;i nh&#7845;t. D&#249;ng n&#250;t Xu&#7845;t CSV &#273;&#7875; l&#7845;y to&#224;n b&#7897;.</p>' : '')
      + '</div>';
  }

  // --- Contracts ---

  function contractSection(item) {
    if (!item.rfq_item_id) return '';
    var suffix = String(item.rfq_item_id).replace(/[^A-Za-z0-9_-]/g, '_');
    var containerId = 'ctr_' + suffix;
    return '<section class="modal-section" style="border-top:1px solid var(--border);padding-top:14px">'
      + '<div class="section-head"><h4>H&#7907;p &#273;&#7891;ng</h4>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
      + '<button type="button" onclick="RfqItemsModule.loadContractItems(\'' + API.esc(item.rfq_item_id) + '\')">Xem H&#272; d&#242;ng n&#224;y</button>'
      + '<button type="button" data-write onclick="RfqItemsModule.openContractFromRfqItemModal(\'' + API.esc(item.rfq_item_id) + '\')">T&#7841;o H&#272; t&#7915; d&#242;ng n&#224;y</button>'
      + '</div></div>'
      + '<div id="' + containerId + '" class="empty-state small">Nh&#7845;n &#8220;Xem H&#272; d&#242;ng n&#224;y&#8221; &#273;&#7875; t&#7843;i d&#7919; li&#7879;u.</div>'
      + '</section>';
  }

  async function loadContractItems(rfqItemId) {
    var suffix = String(rfqItemId).replace(/[^A-Za-z0-9_-]/g, '_');
    var container = document.getElementById('ctr_' + suffix);
    if (!container) return;
    container.textContent = 'Đang tải...';
    try {
      var data = await API.get('getContractItemsForRfqItem', { rfqItemId: rfqItemId });
      var rows = data.rows || [];
      if (!rows.length) {
        container.innerHTML = '<div class="empty-state small">D&#242;ng n&#224;y ch&#432;a c&#243; trong h&#7907;p &#273;&#7891;ng n&#224;o.</div>';
        return;
      }
      container.innerHTML = contractItemsTable(rows);
    } catch (err) {
      container.textContent = 'Lỗi tải hợp đồng.';
      API.error(err);
    }
  }

  function contractItemsTable(rows) {
    return '<div class="quotes-table-wrap">'
      + '<table class="quotes-mini-table">'
      + '<thead><tr>'
      + '<th>S&#7889; H&#272;</th><th>T&#234;n H&#272;</th><th>Ng&#224;y k&#253;</th>'
      + '<th>Nh&#224; CC</th><th>SL H&#272;</th><th>&#272;&#417;n gi&#225; H&#272;</th><th>Th&#224;nh ti&#7873;n H&#272;</th><th>T.t&#7879;</th><th>Tr&#7841;ng th&#225;i</th>'
      + '</tr></thead><tbody>'
      + rows.map(function (r) {
          var statusBadge = r.contract_status === 'archived'
            ? '<span class="badge" style="opacity:0.6">L&#432;u tr&#7919;</span>'
            : '<span class="badge" style="background:var(--green-bg);border-color:#86efac;color:var(--green)">Hi&#7879;u l&#7921;c</span>';
          return '<tr>'
            + '<td><strong>' + API.esc(r.contract_no || '-') + '</strong>'
              + (r.contract_id ? '<div class="muted" style="font-size:11px">' + API.esc(r.contract_id) + '</div>' : '')
              + '</td>'
            + '<td>' + API.esc(r.contract_name || '') + '</td>'
            + '<td>' + API.esc(r.signed_date || '') + '</td>'
            + '<td>' + API.esc(r.supplier_name || '') + '</td>'
            + '<td class="num">' + API.esc(r.contract_quantity != null ? Number(r.contract_quantity).toLocaleString('vi-VN') : '-') + (r.unit ? ' ' + API.esc(r.unit) : '') + '</td>'
            + '<td class="num">' + API.esc(r.contract_unit_price ? API.money(r.contract_unit_price) : '-') + '</td>'
            + '<td class="num"><strong>' + API.esc(r.contract_line_total ? API.money(r.contract_line_total) : '-') + '</strong></td>'
            + '<td>' + API.esc(r.contract_currency || 'VND') + '</td>'
            + '<td>' + statusBadge + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  }

  function openContractFromRfqItemModal(rfqItemId) {
    var item = (state.rows || []).find(function (r) { return r.rfq_item_id === rfqItemId; }) || { rfq_item_id: rfqItemId };
    var currency = 'VND';
    var html = ''
      + input('contractNo', 'Số hợp đồng', '', 'required placeholder="VD: HD-2026-001"')
      + input('contractName', 'Tên hợp đồng', '', 'placeholder="VD: Hợp đồng cung cấp vòng bi"')
      + input('signedDate', 'Ngày ký', '', 'type="date"')
      + input('effectiveDate', 'Ngày có hiệu lực', '', 'type="date"')
      + input('expiryDate', 'Ngày hết hạn', '', 'type="date"')
      + '<label>Ti&#7873;n t&#7879;<select name="currency">'
      + option('VND', 'VND', currency)
      + option('USD', 'USD', currency)
      + option('EUR', 'EUR', currency)
      + option('JPY', 'JPY', currency)
      + option('CNY', 'CNY', currency)
      + option('SGD', 'SGD', currency)
      + option('KRW', 'KRW', currency)
      + '</select></label>'
      + '<div style="background:var(--primary-bg);border:1px solid var(--primary-border);border-radius:9px;padding:10px 13px;margin-bottom:10px;font-size:13px">'
      + '<strong>D&#242;ng v&#7853;t t&#432;:</strong> ' + API.esc(item.ten_vat_tu || rfqItemId)
      + (item.ma_vat_tu ? ' <span class="badge">' + API.esc(item.ma_vat_tu) + '</span>' : '')
      + '</div>'
      + input('contractQuantity', 'Số lượng HĐ', val(item, 'quantity', 'so_luong') || '', 'inputmode="decimal" placeholder="0"')
      + input('contractUnitPrice', 'Đơn giá HĐ (VND)', '', 'inputmode="numeric" placeholder="0"')
      + textarea('note', 'Ghi chú', '');
    Utils.openModal('Tạo hợp đồng từ dòng vật tư', html, async function (form) {
      try {
        form.rfqItemId = rfqItemId;
        var data = await API.call('createContractFromRfqItem', form);
        Utils.closeModal();
        API.toast('Đã tạo hợp đồng ' + (data.contract && data.contract.contract_no || ''), 'success');
        var suffix = String(rfqItemId).replace(/[^A-Za-z0-9_-]/g, '_');
        var container = document.getElementById('ctr_' + suffix);
        if (container) await loadContractItems(rfqItemId);
      } catch (err) {
        API.error(err);
      }
    });
    Auth.applyRoleUI();
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
  var importMapState = { headers: null, rows: null, fileName: '', sheetName: 'csv', workbook: null, templates: [] };

  var IMPORT_TARGET_FIELDS = [
    ['', '- Không import -'],
    ['rfq_item_id', 'rfq_item_id (update)'],
    ['ten_vat_tu', 'Tên vật tư *'],
    ['stt_goc', 'STT'],
    ['ma_vat_tu', 'Mã vật tư'],
    ['required_model', 'Quy cách / Model'],
    ['manufacturer', 'HSX / Hãng sản xuất'],
    ['brand', 'Nhãn hiệu'],
    ['origin_country', 'Xuất xứ'],
    ['unit', 'Đơn vị'],
    ['quantity', 'Số lượng'],
    ['yeu_cau_ky_thuat_bo_sung', 'Yêu cầu kỹ thuật bổ sung'],
    ['don_gia_sau_thue', 'Đơn giá'],
    ['thanh_tien_sau_thue', 'Thành tiền'],
    ['delivery_time', 'Thời gian cấp / deadline'],
    ['origin_full_text', 'Cột tổng hợp gốc'],
  ];

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

  function openImportMapping() {
    importMapState = { headers: null, rows: null, fileName: '', sheetName: 'csv', workbook: null, templates: [] };
    var rfqId = (document.getElementById('itemRfqId').value || '').trim();
    var html = ''
      + '<div class="modal-section" style="border-top:0;margin-top:0;padding-top:0">'
      + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">'
      + '<label>RFQ ID<input id="importMapRfqId" value="' + API.esc(rfqId) + '" placeholder="RFQ ID"></label>'
      + '<label>Owner key<input id="importOwnerKey" placeholder="VD: nha_may_a" onblur="RfqItemsModule.loadImportTemplates()"></label>'
      + '<label>Template<select id="importTemplateSelect" onchange="RfqItemsModule.applyImportTemplate()"><option value="">Chưa chọn template</option></select></label>'
      + '<label>Tên template<input id="importTemplateName" placeholder="VD: Owner A - danh sách vật tư"></label>'
      + '</div>'
      + '<label>CSV / XLSX file<input type="file" id="importMapCsvFile" accept=".csv,.xlsx" onchange="RfqItemsModule._onImportMapFileChange(this)"></label>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px">'
      + '<button type="button" onclick="RfqItemsModule.loadImportTemplates()">Load template</button>'
      + '<button type="button" onclick="RfqItemsModule.saveImportTemplate()">Lưu template</button>'
      + '<button type="button" class="primary" onclick="RfqItemsModule.commitImportMapping()">Validate / Commit</button>'
      + '</div>'
      + '<div id="importMapArea" style="color:var(--text-muted);font-size:13px">Chọn file CSV hoặc XLSX để xem preview và map cột.</div>'
      + '</div>';
    Utils.openModal('Import CSV/XLSX nâng cao', html, async function () {
      await commitImportMapping();
    });
  }

  function _onImportMapFileChange(input) {
    var area = document.getElementById('importMapArea');
    if (!input || !input.files || !input.files[0]) return;
    var file = input.files[0];
    var name = file.name || '';
    var ext = name.split('.').pop().toLowerCase();
    if (ext === 'xls' || ext === 'xlsm' || ext === 'ods') {
      area.textContent = 'Định dạng .' + ext + ' không được hỗ trợ. Vui lòng dùng .csv hoặc .xlsx.';
      input.value = '';
      return;
    }
    importMapState.fileName = name;
    importMapState.workbook = null;
    area.textContent = 'Đang đọc file...';
    if (ext === 'xlsx') {
      parseXlsxFile(file, area);
    } else {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var all = parseCsv(e.target.result);
          if (!all.length) { area.textContent = 'File trống.'; return; }
          importMapState.headers = all[0];
          importMapState.rows = all.slice(1).filter(function (r) { return r.some(function (c) { return c !== ''; }); });
          importMapState.sheetName = 'csv';
          renderImportMapping();
        } catch (err) {
          area.textContent = 'Lỗi đọc file: ' + (err.message || String(err));
        }
      };
      reader.onerror = function () { area.textContent = 'Không đọc được file.'; };
      reader.readAsText(file, 'UTF-8');
    }
  }

  function parseXlsxFile(file, area) {
    if (typeof XLSX === 'undefined') {
      area.textContent = 'Thư viện XLSX chưa tải. Vui lòng tải lại trang và thử lại.';
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        if (!wb.SheetNames || !wb.SheetNames.length) {
          area.textContent = 'File không có sheet nào.';
          return;
        }
        importMapState.workbook = wb;
        loadXlsxSheet(wb, wb.SheetNames[0]);
      } catch (err) {
        area.textContent = 'Lỗi đọc XLSX: ' + (err.message || String(err));
      }
    };
    reader.onerror = function () { area.textContent = 'Không đọc được file.'; };
    reader.readAsArrayBuffer(file);
  }

  function loadXlsxSheet(wb, sheetName) {
    var sheet = wb.Sheets[sheetName];
    if (!sheet) return;
    var result = xlsxSheetToArrays(sheet);
    importMapState.headers = result.headers;
    importMapState.rows = result.rows;
    importMapState.sheetName = sheetName;
    renderImportMapping();
  }

  function xlsxSheetToArrays(sheet) {
    var ref = sheet['!ref'];
    if (!ref) return { headers: [], rows: [] };
    var range = XLSX.utils.decode_range(ref);
    var headers = [];
    var rows = [];
    var c, r;
    for (c = range.s.c; c <= range.e.c; c++) {
      var hCell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: c })];
      headers.push(hCell ? String(hCell.v !== undefined ? hCell.v : '') : '');
    }
    for (r = range.s.r + 1; r <= range.e.r; r++) {
      var row = [];
      var hasValue = false;
      for (c = range.s.c; c <= range.e.c; c++) {
        var dCell = sheet[XLSX.utils.encode_cell({ r: r, c: c })];
        var val = dCell ? fmtXlsxCell(dCell.v) : '';
        row.push(val);
        if (val !== '') hasValue = true;
      }
      if (hasValue) rows.push(row);
    }
    return { headers: headers, rows: rows };
  }

  function fmtXlsxCell(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
      var y = v.getFullYear();
      var mo = v.getMonth() + 1;
      var d = v.getDate();
      return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
    }
    return String(v);
  }

  function _onImportMapSheetChange(sel) {
    var wb = importMapState.workbook;
    if (!wb || !sel || !sel.value) return;
    loadXlsxSheet(wb, sel.value);
  }

  function renderImportMapping() {
    var area = document.getElementById('importMapArea');
    if (!area || !importMapState.headers) return;
    var headers = importMapState.headers;
    var rows = importMapState.rows || [];
    var mappingRows = headers.map(function (h, i) {
      return '<tr><td style="white-space:nowrap">' + API.esc(h) + '</td>'
        + '<td><select data-map-header="' + API.esc(h) + '">' + importTargetOptions(guessTargetField(h)) + '</select></td>'
        + '<td class="muted">' + API.esc(sampleColumn(rows, i)) + '</td></tr>';
    }).join('');
    var previewRows = rows.slice(0, 20);
    var previewHead = headers.map(function (h) { return '<th>' + API.esc(h) + '</th>'; }).join('');
    var previewBody = previewRows.map(function (r) {
      return '<tr>' + headers.map(function (h, i) {
        return '<td>' + API.esc(r[i] || '') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var sheetSelectorHtml = '';
    if (importMapState.workbook && importMapState.workbook.SheetNames.length > 1) {
      var sheetOptions = importMapState.workbook.SheetNames.map(function (s) {
        return '<option value="' + API.esc(s) + '"' + (s === importMapState.sheetName ? ' selected' : '') + '>' + API.esc(s) + '</option>';
      }).join('');
      sheetSelectorHtml = '<div style="margin-bottom:10px">'
        + '<label style="font-size:13px;font-weight:600">Sheet: <select id="importMapSheetSelect" onchange="RfqItemsModule._onImportMapSheetChange(this)" style="margin-left:4px;font-size:13px">'
        + sheetOptions + '</select></label></div>';
    }
    var sheetLabel = importMapState.sheetName && importMapState.sheetName !== 'csv'
      ? ' · Sheet: <strong>' + API.esc(importMapState.sheetName) + '</strong>' : '';
    area.innerHTML = sheetSelectorHtml
      + '<p style="margin:0 0 8px;color:var(--text-muted)">File: <strong>' + API.esc(importMapState.fileName || '-') + '</strong>' + sheetLabel + ' — '
      + rows.length + ' dòng dữ liệu. Preview ' + previewRows.length + ' dòng đầu.</p>'
      + '<div style="overflow:auto;max-height:230px;margin-bottom:12px"><table class="quotes-mini-table"><thead><tr><th>Source Header</th><th>Target Field</th><th>Mẫu dữ liệu</th></tr></thead><tbody>'
      + mappingRows + '</tbody></table></div>'
      + '<div style="overflow:auto;max-height:220px"><table class="quotes-mini-table"><thead><tr>' + previewHead + '</tr></thead><tbody>' + previewBody + '</tbody></table></div>';
  }

  function importTargetOptions(current) {
    return IMPORT_TARGET_FIELDS.map(function (pair) {
      return '<option value="' + API.esc(pair[0]) + '"' + (pair[0] === current ? ' selected' : '') + '>' + API.esc(pair[1]) + '</option>';
    }).join('');
  }

  function sampleColumn(rows, index) {
    for (var i = 0; i < Math.min(rows.length, 5); i++) {
      if (rows[i] && rows[i][index]) return rows[i][index];
    }
    return '';
  }

  function currentImportMapping() {
    var mapping = {};
    Array.prototype.forEach.call(document.querySelectorAll('#importMapArea select[data-map-header]'), function (sel) {
      if (sel.value) mapping[sel.getAttribute('data-map-header')] = sel.value;
    });
    return mapping;
  }

  function guessTargetField(header) {
    var h = normalizeHeader(header);
    if (h === 'rfqitemid' || h === 'rfq_item_id') return 'rfq_item_id';
    if (h === 'stt' || h === 'sttgoc') return 'stt_goc';
    if (h.indexOf('mavattu') >= 0 || h.indexOf('mahang') >= 0) return 'ma_vat_tu';
    if (h.indexOf('tenvattu') >= 0 || h.indexOf('danhmuchanghoa') >= 0 || h === 'tenhang') return 'ten_vat_tu';
    if (h.indexOf('quycach') >= 0 || h.indexOf('model') >= 0 || h.indexOf('kymahieu') >= 0) return 'required_model';
    if (h === 'hsx' || h.indexOf('hangsanxuat') >= 0) return 'manufacturer';
    if (h.indexOf('nhanhieu') >= 0) return 'brand';
    if (h.indexOf('xuatxu') >= 0) return 'origin_country';
    if (h.indexOf('donvi') >= 0 || h === 'dvt') return 'unit';
    if (h.indexOf('soluong') >= 0 || h.indexOf('khoiluong') >= 0) return 'quantity';
    if (h.indexOf('yeucaukythuat') >= 0) return 'yeu_cau_ky_thuat_bo_sung';
    if (h.indexOf('dongia') >= 0) return 'don_gia_sau_thue';
    if (h.indexOf('thanhtien') >= 0) return 'thanh_tien_sau_thue';
    if (h.indexOf('deadline') >= 0 || h.indexOf('thoigiancap') >= 0 || h.indexOf('giaohang') >= 0) return 'delivery_time';
    return '';
  }

  function normalizeHeader(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '');
  }

  async function loadImportTemplates() {
    var ownerKey = (document.getElementById('importOwnerKey') || {}).value || '';
    var select = document.getElementById('importTemplateSelect');
    if (!select) return;
    try {
      var data = await API.get('getImportTemplates', ownerKey ? { ownerKey: ownerKey } : {});
      importMapState.templates = data.rows || [];
      select.innerHTML = '<option value="">Chưa chọn template</option>' + importMapState.templates.map(function (t) {
        return '<option value="' + API.esc(t.template_id) + '">' + API.esc(t.template_name) + '</option>';
      }).join('');
    } catch (err) {
      API.error(err);
    }
  }

  function applyImportTemplate() {
    var templateId = (document.getElementById('importTemplateSelect') || {}).value || '';
    var template = (importMapState.templates || []).find(function (t) { return t.template_id === templateId; });
    if (!template) return;
    var owner = document.getElementById('importOwnerKey');
    var name = document.getElementById('importTemplateName');
    if (owner) owner.value = template.owner_key || '';
    if (name) name.value = template.template_name || '';
    var mapping = template.mappingJson || {};
    Array.prototype.forEach.call(document.querySelectorAll('#importMapArea select[data-map-header]'), function (sel) {
      var header = sel.getAttribute('data-map-header');
      sel.value = mapping[header] || '';
    });
  }

  async function saveImportTemplate() {
    var ownerKey = (document.getElementById('importOwnerKey') || {}).value || '';
    var templateName = (document.getElementById('importTemplateName') || {}).value || '';
    var templateId = (document.getElementById('importTemplateSelect') || {}).value || '';
    var mapping = currentImportMapping();
    if (!ownerKey || !templateName) { API.toast('Nhập owner key và tên template', 'warn'); return; }
    if (!Object.keys(mapping).length) { API.toast('Chưa map cột nào', 'warn'); return; }
    try {
      await API.call('saveImportTemplate', { ownerKey: ownerKey, templateName: templateName, templateId: templateId, mappingJson: mapping });
      API.toast('Đã lưu template import', 'success');
      await loadImportTemplates();
    } catch (err) {
      API.error(err);
    }
  }

  function mappedRowsForCommit(mapping) {
    var headers = importMapState.headers || [];
    return (importMapState.rows || []).map(function (row, idx) {
      var raw = {};
      var mapped = {};
      headers.forEach(function (h, colIdx) {
        var value = row[colIdx] !== undefined ? row[colIdx] : '';
        raw[h] = value;
        if (mapping[h]) mapped[mapping[h]] = value;
      });
      return { sourceRowNumber: idx + 2, rawRow: raw, mapped: mapped };
    });
  }

  async function commitImportMapping() {
    var area = document.getElementById('importMapArea');
    var rfqId = (document.getElementById('importMapRfqId') || {}).value || '';
    var ownerKey = (document.getElementById('importOwnerKey') || {}).value || '';
    var templateId = (document.getElementById('importTemplateSelect') || {}).value || '';
    if (!rfqId) { API.toast('Thiếu RFQ ID', 'warn'); return; }
    if (!importMapState.rows || !importMapState.rows.length) { API.toast('Chưa chọn file', 'warn'); return; }
    var mapping = currentImportMapping();
    if (Object.values(mapping).indexOf('ten_vat_tu') < 0) {
      API.toast('Cần map cột Tên vật tư', 'warn');
      return;
    }
    if (area) area.insertAdjacentHTML('afterbegin', '<p style="color:var(--text-muted)">Đang commit import...</p>');
    try {
      var data = await commitInChunks(rfqId, ownerKey, templateId, importMapState.fileName, importMapState.sheetName || 'csv', mappedRowsForCommit(mapping));
      renderImportResult(data.summary || {});
      await load(true);
      if (typeof RfqsModule !== 'undefined') await RfqsModule.load(true);
    } catch (err) {
      API.error(err);
    }
  }

  async function commitInChunks(rfqId, ownerKey, templateId, sourceFileName, sourceSheetName, allRows) {
    var CHUNK_SIZE = 500;
    var totalCreated = 0, totalUpdated = 0, totalSkipped = 0, totalErrors = 0;
    var allRowErrors = [];
    var lastJobId = '';
    for (var i = 0; i < allRows.length; i += CHUNK_SIZE) {
      var chunk = allRows.slice(i, i + CHUNK_SIZE);
      var data = await API.call('commitImportRows', {
        rfqId: rfqId,
        ownerKey: ownerKey,
        templateId: templateId,
        sourceFileName: sourceFileName,
        sourceSheetName: sourceSheetName,
        rows: chunk,
      });
      var s = data.summary || {};
      totalCreated += Number(s.created || 0);
      totalUpdated += Number(s.updated || 0);
      totalSkipped += Number(s.skipped || 0);
      totalErrors += Number(s.errors || 0);
      if (s.jobId) lastJobId = s.jobId;
      if (s.rowErrors && s.rowErrors.length) allRowErrors = allRowErrors.concat(s.rowErrors);
    }
    return {
      summary: {
        jobId: lastJobId,
        totalRows: allRows.length,
        created: totalCreated,
        updated: totalUpdated,
        skipped: totalSkipped,
        errors: totalErrors,
        rowErrors: allRowErrors,
      },
    };
  }

  function renderImportResult(summary) {
    var area = document.getElementById('importMapArea');
    if (!area) return;
    var errors = summary.rowErrors || [];
    var html = '<div style="border-left:3px solid ' + (summary.errors ? 'var(--primary)' : 'var(--green)') + ';padding-left:10px;margin-bottom:10px">'
      + '<p style="margin:2px 0"><strong>Import job:</strong> ' + API.esc(summary.jobId || '') + '</p>'
      + '<p style="margin:2px 0"><strong>Tổng:</strong> ' + Number(summary.totalRows || 0)
      + ' | Tạo mới: ' + Number(summary.created || 0)
      + ' | Cập nhật: ' + Number(summary.updated || 0)
      + ' | Bỏ qua: ' + Number(summary.skipped || 0)
      + ' | Lỗi: ' + Number(summary.errors || 0) + '</p>'
      + '</div>';
    if (errors.length) {
      html += '<ul style="font-size:12px;color:var(--red);margin:0 0 10px;padding-left:1.2em">'
        + errors.slice(0, 30).map(function (e) { return '<li>Dòng ' + API.esc(e.sourceRowNumber) + ': ' + API.esc(e.error) + '</li>'; }).join('')
        + '</ul>';
    }
    area.insertAdjacentHTML('afterbegin', html);
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
    refreshMasterItem: refreshMasterItem,
    createMasterFromRfqItem: createMasterFromRfqItem,
    linkMasterItem: linkMasterItem,
    unlinkMasterItem: unlinkMasterItem,
    searchMasterItemsForLink: searchMasterItemsForLink,
    uploadMediaFile: uploadMediaFile,
    openMediaPreview: openMediaPreview,
    downloadTemplate: downloadTemplate,
    exportCsv: exportCsv,
    importCsv: importCsv,
    openImportMapping: openImportMapping,
    _onCsvFileChange: _onCsvFileChange,
    _onImportMapFileChange: _onImportMapFileChange,
    _onImportMapSheetChange: _onImportMapSheetChange,
    loadImportTemplates: loadImportTemplates,
    applyImportTemplate: applyImportTemplate,
    saveImportTemplate: saveImportTemplate,
    commitImportMapping: commitImportMapping,
    loadPriceHistory: loadPriceHistory,
    exportPriceHistory: exportPriceHistory,
    loadContractItems: loadContractItems,
    openContractFromRfqItemModal: openContractFromRfqItemModal,
  };
})();
