(function () {
  var state = AppState.list('rfqItems');
  var sort = { by: '', dir: 'desc' };
  var _setupDone = false;

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    ['itemSearch', 'itemRfqId'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
    });
  }

  function syncSort() {
    document.querySelectorAll('#screen-items th[data-sort-key]').forEach(function (th) {
      var key = th.getAttribute('data-sort-key');
      if (!th.getAttribute('data-label')) th.setAttribute('data-label', th.textContent.trim());
      var label = th.getAttribute('data-label');
      var active = sort.by === key;
      th.textContent = label + (active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕');
      th.onclick = function () {
        if (sort.by === key) { sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; }
        else { sort.by = key; sort.dir = 'asc'; }
        load(true);
      };
    });
  }

  async function load(reset) {
    setupOnce();
    if (reset) state.cursor = '';
    state.q = document.getElementById('itemSearch').value || '';
    try {
      var params = {
        q: state.q,
        rfqId: document.getElementById('itemRfqId').value,
        status: document.getElementById('itemStatus').value,
        cursor: state.cursor,
        limit: 50,
      };
      if (sort.by) { params.sortBy = sort.by; params.sortDir = sort.dir; }
      var data = await API.get('getRfqItems', params);
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
    syncSort();
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
      document.getElementById('itemRows').innerHTML = '<tr><td colspan="11" style="padding:0;border:0">'
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
    var canWrite = Utils.roleCanWrite();
    document.getElementById('itemRows').innerHTML = rows.map(function (r) {
      var nameInner = '<strong>' + API.esc(r.ten_vat_tu) + '</strong>'
        + '<div class="muted">' + API.esc(val(r, 'technical_params', 'thong_so_ky_thuat')) + '</div>';
      var nameCell = canWrite
        ? '<td><span class="link-edit" onclick="RfqItemsModule.openEdit(\'' + API.esc(r.rfq_item_id) + '\')">'
          + '<strong>' + API.esc(r.ten_vat_tu) + '</strong></span>'
          + '<div class="muted">' + API.esc(val(r, 'technical_params', 'thong_so_ky_thuat')) + '</div></td>'
        : '<td>' + nameInner + '</td>';
      return '<tr>'
        + renderCell(r.stt_goc, true)
        + renderCell(r.ma_mua_sam, true)
        + renderCell(r.ma_vat_tu, true)
        + nameCell
        + renderCell(val(r, 'required_model', 'quy_cach_model_yeu_cau'), true)
        + renderCell(val(r, 'brand', 'nhan_hieu'), true)
        + renderCell(val(r, 'manufacturer', 'hang_goc_nsx_goc'), true)
        + renderCell(val(r, 'origin_country', 'xuat_xu'), true)
        + renderCell((val(r, 'quantity', 'so_luong') || 0) + ' ' + (val(r, 'unit', 'don_vi') || ''), false)
        + '<td>' + technicalSummary(r) + '</td>'
        + '<td><span class="badge">' + API.esc(statusLabel(r.trang_thai_dong)) + '</span></td>'
        + '</tr>';
    }).join('');
    document.getElementById('itemMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }

  function technicalSummary(r) {
    var count = Number(r.clarification_count || 0);
    var finalText = [r.quy_cach_final, r.hang_final].filter(Boolean).join(' - ');
    var techStatus = r.clarification_status || r.trang_thai_ky_thuat;
    var badge = '<span class="badge badge-clickable" title="Xem lịch sử xác nhận kỹ thuật" onclick="RfqItemsModule.openClarificationTimeline(\'' + API.esc(r.rfq_item_id) + '\')">'
      + API.esc(technicalStatusLabel(techStatus)) + '</span>';
    return '<div class="tech-summary">'
      + badge
      + '<span>' + API.esc(count + ' lần trao đổi') + '</span>'
      + (finalText ? '<strong>' + API.esc(finalText) + '</strong>' : '')
      + '</div>';
  }

  function openCreate() {
    state.currentMedia = {};
    openForm({}, [], [], [], {});
  }

  function safeGet(action, params, fallback) {
    return API.get(action, params).catch(function (err) {
      console.warn('[rfq-items] safeGet ' + action + ' failed:', err && err.message);
      return fallback;
    });
  }

  async function openEdit(id) {
    var row = (state.rows || []).find(function (r) { return r.rfq_item_id === id; }) || { rfq_item_id: id };
    try {
      var results = await Promise.all([
        safeGet('getTechnicalClarifications', { rfqItemId: id }, { rows: [] }),
        safeGet('getSupplierQuotes', { rfqItemId: id }, { rows: [] }),
        safeGet('getPricingDecisions', { rfqItemId: id }, { rows: [] }),
        safeGet('getMediaFiles', { ownerType: 'rfq_item', ownerId: id }, { rows: [] }),
        row.item_id ? safeGet('getMasterItemDetail', { itemId: row.item_id }, { item: null }) : Promise.resolve({ item: null }),
        safeGet('suggestMasterItemsForRfqItem', { rfqItemId: id }, { rows: [], _failed: true }),
      ]);
      var quotes = results[1].rows || [];
      var quoteMedia = await loadQuoteMedia(quotes).catch(function () { return {}; });
      state.currentMedia = {
        itemFiles: results[3].rows || [],
        quoteFiles: quoteMedia,
      };
      state.currentMaster = {
        item: results[4].item || null,
        suggestions: results[5].rows || [],
        suggestionsFailed: !!(results[5] && results[5]._failed),
      };
      openForm(row, results[0].rows || [], quotes, results[2].rows || [], {
        itemFiles: results[3].rows || [],
        quoteFiles: quoteMedia,
      });
    } catch (err) {
      // Critical failure — show error but still attempt to render with bare row data
      API.error(err);
      openForm(row, [], [], [], { itemFiles: [], quoteFiles: {} });
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

  function openClarificationTimeline(rfqItemId) {
    var item = (state.rows || []).find(function (r) { return r.rfq_item_id === rfqItemId; }) || {};
    API.get('getTechnicalClarifications', { rfqItemId: rfqItemId }).then(function (data) {
      var rows = data.rows || [];
      var canWrite = Utils.roleCanWrite();
      var html = '<div style="grid-column:1/-1">'
        + '<div class="section-head" style="margin-bottom:10px">'
        + '<div><strong>' + API.esc(item.ten_vat_tu || rfqItemId) + '</strong>'
        + (item.ma_vat_tu ? ' <span class="badge">' + API.esc(item.ma_vat_tu) + '</span>' : '')
        + '</div>'
        + (canWrite
          ? '<button type="button" data-write onclick="RfqItemsModule.openClarificationForm(\'' + API.esc(rfqItemId) + '\')">+ Thêm trao đổi</button>'
          : '')
        + '</div>'
        + (rows.length
          ? rows.map(function (r) { return timelineItem(rfqItemId, r); }).join('')
          : '<div class="empty-state small">Chưa có trao đổi kỹ thuật.</div>')
        + '</div>';
      Utils.openModal('Xác nhận kỹ thuật', html, null);
      Auth.applyRoleUI();
    }).catch(API.error);
  }

  function option(value, label, current) {
    return '<option value="' + API.esc(value) + '"' + (value === current ? ' selected' : '') + '>' + API.esc(label) + '</option>';
  }

  function input(name, label, value, attrs, cls) {
    return '<label' + (cls ? ' class="' + cls + '"' : '') + '>' + API.esc(label) + '<input name="' + API.esc(name) + '" ' + (attrs || '') + ' value="' + API.esc(value) + '"></label>';
  }

  function textarea(name, label, value, attrs, cls) {
    return '<label' + (cls ? ' class="' + cls + '"' : '') + '>' + API.esc(label) + '<textarea name="' + API.esc(name) + '" ' + (attrs || '') + '>' + API.esc(value) + '</textarea></label>';
  }

  function fields(r, clarifications, quotes, pricingDecisions) {
    var status = r.trang_thai_dong || 'chua_xu_ly';
    var techStatus = r.clarification_status || r.trang_thai_ky_thuat || '';
    var latestDecision = (pricingDecisions || [])[0] || null;
    return ''
      // Row 1: identifiers (2+1+2+3) + quantities (1+1+1+1) = 12
      + '<label class="span-2 readonly-field">RFQ ID<input name="rfqId" value="' + API.esc(r.rfq_id || '') + '" readonly tabindex="-1"></label>'
      + input('sttGoc', 'STT', r.stt_goc, '', 'span-1')
      + input('maMuaSam', 'Mã mua sắm', r.ma_mua_sam, '', 'span-2')
      + input('maVatTu', 'Mã vật tư', r.ma_vat_tu, '', 'span-3')
      + input('unit', 'ĐVT', val(r, 'unit', 'don_vi'), '', 'span-1')
      + input('quantity', 'Khối lượng', val(r, 'quantity', 'so_luong'), 'inputmode="decimal"', 'span-1')
      + input('thueSuat', 'Thuế suất', r.thue_suat, 'inputmode="decimal"', 'span-1')
      + input('manufactureYear', 'Năm SX', val(r, 'manufacture_year', 'nam_san_xuat'), '', 'span-1')
      // Row 2: description (5+4+3) = 12
      + textarea('tenVatTu', 'Tên vật tư / Danh mục hàng hóa', r.ten_vat_tu, 'required', 'span-5 compact-ta')
      + textarea('requiredModel', 'Ký mã hiệu / Model', val(r, 'required_model', 'quy_cach_model_yeu_cau'), '', 'span-4 compact-ta')
      + input('brand', 'Nhãn hiệu', val(r, 'brand', 'nhan_hieu'), '', 'span-3')
      // Row 3: origin / material (3+2+3+2+2) = 12
      + input('manufacturer', 'Hãng sản xuất', val(r, 'manufacturer', 'hang_goc_nsx_goc'), '', 'span-3')
      + input('originCountry', 'Xuất xứ', val(r, 'origin_country', 'xuat_xu'), '', 'span-2')
      + input('vatLieu', 'Vật liệu', r.vat_lieu, '', 'span-3')
      + input('phuTungChuyenDung', 'Phụ tùng chuyên dụng', r.phu_tung_chuyen_dung, '', 'span-2')
      + input('deliveryTime', 'Thời gian giao hàng', r.delivery_time, '', 'span-2')
      // Row 4: pricing + status (3+3+3+3) = 12
      + input('donGiaSauThue', 'Đơn giá', r.don_gia_sau_thue || r.don_gia_truoc_thue, 'inputmode="numeric"', 'span-3')
      + input('thanhTienSauThue', 'Thành tiền', r.thanh_tien_sau_thue, 'inputmode="numeric"', 'span-3')
      + '<label class="span-3 readonly-field">Trạng thái gói <small style="font-weight:400;color:var(--text-muted)">(RFQ)</small>'
      + '<input value="' + API.esc(statusLabel(status)) + '" readonly tabindex="-1">'
      + '<input type="hidden" name="trangThaiDong" value="' + API.esc(status) + '">'
      + '</label>'
      + latestClarificationSummary(r, clarifications)
      // Full-width specification fields
      + textarea('technicalParams', 'Quy cách / thông số kỹ thuật', val(r, 'technical_params', 'thong_so_ky_thuat'), '', 'span-12 compact-ta')
      + textarea('yeuCauKyThuatBoSung', 'Yêu cầu kỹ thuật bổ sung', r.yeu_cau_ky_thuat_bo_sung, '', 'span-12 compact-ta')
      + textarea('note', 'Ghi chú', r.note, '', 'span-12 compact-ta')
      + textarea('originFullText', 'Cột tổng hợp gốc để đối chiếu/export', r.origin_full_text, '', 'span-12 compact-ta')
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
    var suggestionsFailed = !!(master && master.suggestionsFailed);
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
          + (suggestionsFailed
            ? '<div style="margin-top:8px;font-size:12px;color:var(--text-muted);padding:6px 8px;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px">⚠ Không tải được gợi ý master item.</div>'
            : '<div id="' + resultsId + '" style="margin-top:8px">' + masterSuggestionList(item.rfq_item_id, suggestions) + '</div>')
          )
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
    var modelChange = (r.old_model || r.proposed_model)
      ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">' + API.esc(r.old_model || '—') + ' → ' + API.esc(r.proposed_model || '—') + '</div>'
      : '';
    var propSpec = (r.proposed_manufacturer || r.proposed_origin)
      ? '<div style="font-size:12px;color:var(--text-muted)">' + API.esc([r.proposed_manufacturer, r.proposed_origin].filter(Boolean).join(' · ')) + '</div>'
      : '';
    return '<article class="timeline-item" style="display:grid;grid-template-columns:130px 1fr auto;gap:8px;align-items:start;padding:7px 9px;margin-bottom:4px">'
      + '<div style="display:flex;flex-direction:column;gap:3px">'
      + '<span class="' + typeBadgeClass(r.clarification_type) + '" style="font-size:11px;padding:2px 7px;white-space:nowrap">' + API.esc(typeLabel(r.clarification_type)) + '</span>'
      + '<span class="' + statusBadgeClass(r.status_after) + '" style="font-size:11px;padding:2px 7px;white-space:nowrap">' + API.esc(technicalStatusLabel(r.status_after)) + '</span>'
      + '<span style="font-size:11px;color:var(--text-muted);margin-top:2px">' + API.esc(formatDate(r.created_at)) + '</span>'
      + '</div>'
      + '<div style="min-width:0">'
      + '<strong style="font-size:13px">' + API.esc(r.title) + '</strong>'
      + (r.content ? '<div style="font-size:12px;margin-top:3px;white-space:pre-wrap">' + API.esc(r.content) + '</div>' : '')
      + modelChange + propSpec
      + (r.attachment_file_id ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">📎 ' + API.esc(r.attachment_file_name || r.attachment_file_id) + '</div>' : '')
      + '</div>'
      + '<div><button type="button" data-role-only="admin,manager" style="font-size:12px;min-height:28px;padding:3px 8px" onclick="RfqItemsModule.openClarificationForm(\'' + API.esc(rfqItemId) + '\', \'' + API.esc(r.clarification_id) + '\')">Sửa</button></div>'
      + '</article>';
  }

  var TYPE_CHIPS = [
    { value: 'ask_supplier',     label: 'Hỏi hãng',       color: 'orange' },
    { value: 'supplier_opinion', label: 'HSX ý kiến',      color: 'green' },
    { value: 'supplier_reply',   label: 'HSX phản hồi',    color: 'green' },
    { value: 'ask_client',       label: 'CĐT ý kiến',      color: 'blue' },
    { value: 'client_reply',     label: 'CĐT phản hồi',    color: 'blue' },
    { value: 'final_confirm',    label: 'Final confirm',    color: 'green-strong' },
    { value: 'rejected',         label: 'Từ chối',          color: 'red' },
    { value: 'other',            label: 'Khác',             color: 'grey' },
  ];

  var STATUS_CHIPS = [
    { value: 'processing',       label: 'Đang xử lý',      color: 'grey' },
    { value: 'waiting_supplier', label: 'Đang hỏi hãng',   color: 'orange' },
    { value: 'waiting_client',   label: 'Đang chờ CĐT',    color: 'blue' },
    { value: 'need_more_info',   label: 'Cần bổ sung',      color: 'amber' },
    { value: 'final_confirmed',  label: 'Đã xác nhận',      color: 'green-strong' },
    { value: 'rejected',         label: 'Bị từ chối',       color: 'red' },
    { value: 'other',            label: 'Khác',             color: 'grey' },
  ];

  function renderPickerDropdown(labelText, groupName, chips, selectedValue) {
    var sel = chips[0];
    for (var i = 0; i < chips.length; i++) { if (chips[i].value === selectedValue) { sel = chips[i]; break; } }
    var optionsHtml = chips.map(function (c) {
      return '<button type="button" class="picker-option chip chip-' + c.color + '"'
        + ' data-value="' + API.esc(c.value) + '" data-picker="' + API.esc(groupName) + '"'
        + ' onclick="RfqItemsModule._pickOption(this)">' + API.esc(c.label) + '</button>';
    }).join('');
    return '<div class="picker-wrap">'
      + '<span class="chip-group-label">' + API.esc(labelText) + '</span>'
      + '<button type="button" class="chip chip-' + sel.color + ' picker-btn"'
      + ' data-picker="' + API.esc(groupName) + '" data-value="' + API.esc(sel.value) + '"'
      + ' onclick="RfqItemsModule._togglePicker(this)"><span>' + API.esc(sel.label) + '</span></button>'
      + '<div class="picker-list hidden" data-picker-list="' + API.esc(groupName) + '">' + optionsHtml + '</div>'
      + '<input type="hidden" name="' + API.esc(groupName) + '" value="' + API.esc(sel.value) + '">'
      + '</div>';
  }

  function togglePicker(btn) {
    var group = btn.getAttribute('data-picker');
    var wrap = btn.closest('.picker-wrap');
    var list = wrap.querySelector('[data-picker-list="' + group + '"]');
    document.querySelectorAll('.picker-list:not(.hidden)').forEach(function (l) {
      if (l !== list) l.classList.add('hidden');
    });
    list.classList.toggle('hidden');
  }

  function pickOption(btn) {
    var value = btn.getAttribute('data-value');
    var group = btn.getAttribute('data-picker');
    var wrap = btn.closest('.picker-wrap');
    var hidden = wrap.querySelector('input[type="hidden"]');
    if (hidden) hidden.value = value;
    var chips = group === 'clarificationType' ? TYPE_CHIPS : STATUS_CHIPS;
    var chip = chips[0];
    for (var i = 0; i < chips.length; i++) { if (chips[i].value === value) { chip = chips[i]; break; } }
    var trigger = wrap.querySelector('.picker-btn');
    if (trigger) {
      trigger.className = 'chip chip-' + chip.color + ' picker-btn';
      trigger.setAttribute('data-value', value);
      var span = trigger.querySelector('span');
      if (span) span.textContent = chip.label;
    }
    var list = wrap.querySelector('[data-picker-list]');
    if (list) list.classList.add('hidden');
  }

  function clarificationFields(item, r) {
    var type = r.clarification_type || 'ask_supplier';
    var status = r.status_after || 'waiting_supplier';
    return ''
      + '<div class="span-4">' + renderPickerDropdown('Loại trao đổi', 'clarificationType', TYPE_CHIPS, type) + '</div>'
      + '<div class="span-4">' + renderPickerDropdown('Trạng thái sau trao đổi', 'statusAfter', STATUS_CHIPS, status) + '</div>'
      + '<div class="span-4"></div>'
      + input('title', 'Tiêu đề', r.title, 'required', 'span-12')
      + textarea('content', 'Nội dung', r.content, '', 'span-12 compact-ta')
      + input('oldModel', 'Model cũ', r.old_model || val(item, 'required_model', 'quy_cach_model_yeu_cau'), '', 'span-3')
      + input('proposedModel', 'Model đề xuất / final', r.proposed_model || item.quy_cach_final, '', 'span-3')
      + input('proposedManufacturer', 'Hãng SX đề xuất', r.proposed_manufacturer || item.hang_final, '', 'span-3')
      + input('proposedOrigin', 'Xuất xứ đề xuất', r.proposed_origin || item.xuat_xu_final, '', 'span-3')
      + textarea('rawNote', 'Ghi chú gốc', r.raw_note, '', 'span-12 compact-ta');
    // updateFinal is auto-applied by backend when type=final_confirm or status=final_confirmed
  }

  function latestClarificationSummary(item, clarifications) {
    var rfqItemId = item.rfq_item_id || '';
    var escId = API.esc(rfqItemId);
    if (!clarifications || !clarifications.length) {
      return '<div class="span-3" data-latest-clarification style="font-size:12px">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Xác nhận kỹ thuật</div>'
        + '<span class="clar-summary-empty">Chưa có trao đổi kỹ thuật.</span>'
        + (rfqItemId ? '<div style="margin-top:6px"><button type="button" style="font-size:12px;min-height:28px;padding:3px 10px" onclick="RfqItemsModule.openClarificationForm(\'' + escId + '\')">+ Thêm trao đổi</button></div>' : '')
        + '</div>';
    }
    var c = clarifications[0];
    var preview = (c.content || '').slice(0, 80) + ((c.content || '').length > 80 ? '…' : '');
    return '<div class="span-3" data-latest-clarification style="font-size:12px">'
      + '<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Xác nhận kỹ thuật</div>'
      + '<div class="clar-summary">'
      + '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">'
      + '<span class="' + typeBadgeClass(c.clarification_type) + '" style="font-size:11px;padding:2px 7px">' + API.esc(typeLabel(c.clarification_type)) + '</span>'
      + '<span class="' + statusBadgeClass(c.status_after) + '" style="font-size:11px;padding:2px 7px">' + API.esc(technicalStatusLabel(c.status_after)) + '</span>'
      + '</div>'
      + '<div style="font-weight:600;margin-bottom:2px">' + API.esc(c.title || '') + '</div>'
      + (preview ? '<div style="color:var(--text-muted);margin-bottom:2px">' + API.esc(preview) + '</div>' : '')
      + '<div style="color:var(--text-muted)">' + API.esc(formatDate(c.created_at)) + '</div>'
      + (rfqItemId ? '<div style="margin-top:5px"><button type="button" data-open-clarification-timeline style="font-size:12px;min-height:26px;padding:2px 10px" onclick="RfqItemsModule.openClarificationTimeline(\'' + escId + '\')">Xem trao đổi (' + API.esc(String(clarifications.length)) + ')</button></div>' : '')
      + '</div>'
      + '</div>';
  }

  function typeBadgeClass(type) {
    return {
      ask_supplier: 'badge-orange',
      supplier_opinion: 'badge-green',
      supplier_reply: 'badge-green',
      ask_client: 'badge-blue',
      client_reply: 'badge-blue',
      replacement_proposal: 'badge-amber',
      final_confirm: 'badge-green-strong',
      rejected: 'badge-red',
      other: 'badge-grey',
    }[type] || 'badge-grey';
  }

  function statusBadgeClass(status) {
    return {
      processing: 'badge-grey',
      waiting_supplier: 'badge-orange',
      waiting_client: 'badge-blue',
      need_more_info: 'badge-amber',
      final_confirmed: 'badge-green-strong',
      rejected: 'badge-red',
      other: 'badge-grey',
    }[status] || 'badge-grey';
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
      processing: 'Đang xử lý',
      waiting_supplier: 'Đang hỏi hãng',
      waiting_client: 'Đang chờ CĐT',
      need_more_info: 'Cần bổ sung',
      final_confirmed: 'Đã xác nhận',
      rejected: 'Bị từ chối',
      other: 'Khác',
    }[value] || 'Chưa xác nhận';
  }

  function typeLabel(value) {
    return {
      ask_supplier: 'Hỏi hãng',
      supplier_opinion: 'HSX ý kiến',
      supplier_reply: 'HSX phản hồi',
      ask_client: 'CĐT ý kiến',
      client_reply: 'CĐT phản hồi',
      replacement_proposal: 'Đề xuất thay thế',
      final_confirm: 'Final confirm',
      rejected: 'Từ chối',
      other: 'Khác',
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
          + (r.price_vnd_incl_tax || 0) + ')" title="Chọn làm base giá để tính phương án cân giá">★ Base</button>';
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
        var origSz = Number(form.get('_origSize') || 0);
        var compSz = Number(form.get('_compSize') || 0);
        var overTgt = form.get('_overTarget') === '1';
        var sizeHint = (compSz > 0 && origSz > 0 && compSz < origSz)
          ? ' (' + Math.round(compSz / 1024) + ' KB sau nén)' : '';
        if (overTgt) {
          API.toast('Đã upload ảnh' + sizeHint + ' — lớn hơn khuyến nghị', 'warn');
        } else {
          API.toast('Đã upload ảnh' + sizeHint, 'success');
        }
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
    var vndDisplay = r.price_vnd_incl_tax ? API.money(r.price_vnd_incl_tax) : '';
    return ''
      // Row 1: source ref (2+3+7) = 12
      + quoteReferenceFields(r, sourceChannel)
      // Row 2: supplier (4+3) + date(2) + currency(1) = 10 → pricing continues
      + input('supplierName', 'Tên nhà cung cấp', r.supplier_name || '', 'placeholder="VD: SKF Vietnam"', 'span-4')
      + input('manufacturer', 'Hãng sản xuất', r.manufacturer || '', 'placeholder="VD: SKF"', 'span-3')
      + input('quoteDate', 'Ngày báo giá', r.quote_date || '', 'type="date"', 'span-2')
      + '<label class="span-1">Tiền tệ<select name="currency">'
      + option('VND', 'VND', currency)
      + option('USD', 'USD', currency)
      + option('EUR', 'EUR', currency)
      + option('JPY', 'JPY', currency)
      + option('CNY', 'CNY', currency)
      + option('SGD', 'SGD', currency)
      + option('KRW', 'KRW', currency)
      + '</select></label>'
      // Row 3: pricing (3+2+1+3) + delivery/validity (2+2+2) = 15, wraps naturally
      + input('quotedPrice', 'Giá báo', r.quoted_price || '', 'inputmode="decimal" placeholder="0"', 'span-3')
      + input('exchangeRate', 'Tỷ giá (1 NTệ=?VND)', r.exchange_rate || 1, 'inputmode="decimal" placeholder="1"', 'span-2')
      + input('taxRate', 'Thuế (%)', r.tax_rate || 0, 'inputmode="decimal" placeholder="0"', 'span-1')
      + '<label class="span-3 readonly-field">VND + Thuế<input value="' + API.esc(vndDisplay) + '" readonly tabindex="-1"></label>'
      + input('leadTime', 'Thời gian giao hàng', r.lead_time || '', 'placeholder="VD: 4-6 tuần"', 'span-2')
      + input('validUntil', 'Hiệu lực đến', r.valid_until || '', 'type="date"', 'span-2')
      + input('warranty', 'Bảo hành', r.warranty || '', 'placeholder="VD: 12 tháng"', 'span-2')
      + textarea('note', 'Ghi chú', r.note || '', '', 'span-12 compact-ta');
  }

  function quoteReferenceFields(r, sourceChannel) {
    return ''
      // Row: nguồn(2) + thời điểm(3) + ghi chú nguồn(7) = 12
      + '<label class="span-2">Nguồn báo giá<select name="sourceChannel">'
      + sourceOption('', '-', sourceChannel)
      + sourceOption('zalo', 'Zalo', sourceChannel)
      + sourceOption('wechat', 'WeChat', sourceChannel)
      + sourceOption('email', 'Email', sourceChannel)
      + sourceOption('phone', 'Phone', sourceChannel)
      + sourceOption('direct', 'Direct', sourceChannel)
      + sourceOption('other', 'Other', sourceChannel)
      + '</select></label>'
      + input('receivedAt', 'Thời điểm nhận', r.received_at || '', 'placeholder="YYYY-MM-DD HH:mm"', 'span-3')
      + textarea('sourceRef', 'Ghi chú nguồn / tham chiếu', r.source_ref || '', '', 'span-7 compact-ta');
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
              + (r.price_vnd_incl_tax || 0) + ')" title="Chọn làm base giá để tính phương án cân giá">★ Base</button></td>'
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
        + '<div class="span-12" style="background:var(--primary-bg);border:1px solid var(--primary-border);border-radius:9px;padding:10px 13px;margin-bottom:6px;font-size:13px">'
        + '<strong>Báo giá gốc:</strong> ' + API.esc(supplierName || baseQuoteId)
        + (basePriceVndInclTax ? ' — ' + API.money(basePriceVndInclTax) + ' VND' : '')
        + '</div>'
      : '<label class="span-12">Chọn báo giá gốc'
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
      + '<label class="span-4">Hệ số markup<select name="markupRate">'
      + markupOptions.map(function (v) {
          return '<option value="' + v + '"' + (v === 1.4 ? ' selected' : '') + '>'
            + 'x' + v + ' (' + Math.round((v - 1) * 100) + '%)'
            + '</option>';
        }).join('')
      + '</select></label>'
      + '<label class="span-4">Lý do chọn báo giá<select name="selectionReason">'
      + option('', '-- Chọn lý do --', '')
      + option('lowest_price',    'Giá thấp nhất', '')
      + option('better_lead_time','Giao hàng nhanh hơn', '')
      + option('better_warranty', 'Bảo hành tốt hơn', '')
      + option('preferred_brand', 'Hãng ưu tiên', '')
      + option('client_approved', 'CĐT chấp thuận', '')
      + option('available_stock', 'Có hàng sẵn', '')
      + option('other',           'Lý do khác', '')
      + '</select></label>'
      + '<label class="span-4">Mức độ rủi ro<select name="riskLevel">'
      + option('low',    'Thấp', 'low')
      + option('medium', 'Trung bình', '')
      + option('high',   'Cao', '')
      + '</select></label>'
      + '<label class="span-12 compact-ta">Ghi chú rủi ro<textarea name="riskNote" placeholder="Mô tả rủi ro nếu có"></textarea></label>'
      + '<label class="span-12 compact-ta">Ghi chú cân giá<textarea name="pricingNote" placeholder="Ghi chú bổ sung hoặc lý do cụ thể"></textarea></label>';
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
      + input('contractNo', 'Số hợp đồng', '', 'required placeholder="VD: HD-2026-001"', 'span-4')
      + input('contractName', 'Tên hợp đồng', '', 'placeholder="VD: Hợp đồng cung cấp vòng bi"', 'span-5')
      + '<label class="span-3">Tiền tệ<select name="currency">'
      + option('VND', 'VND', currency)
      + option('USD', 'USD', currency)
      + option('EUR', 'EUR', currency)
      + option('JPY', 'JPY', currency)
      + option('CNY', 'CNY', currency)
      + option('SGD', 'SGD', currency)
      + option('KRW', 'KRW', currency)
      + '</select></label>'
      + input('signedDate', 'Ngày ký', '', 'type="date"', 'span-3')
      + input('effectiveDate', 'Ngày có hiệu lực', '', 'type="date"', 'span-3')
      + input('expiryDate', 'Ngày hết hạn', '', 'type="date"', 'span-3')
      + '<div class="span-3" style="background:var(--primary-bg);border:1px solid var(--primary-border);border-radius:9px;padding:8px 12px;font-size:13px">'
      + '<strong>Dòng vật tư:</strong> ' + API.esc(item.ten_vat_tu || rfqItemId)
      + (item.ma_vat_tu ? ' <span class="badge">' + API.esc(item.ma_vat_tu) + '</span>' : '')
      + '</div>'
      + input('contractQuantity', 'Số lượng HĐ', val(item, 'quantity', 'so_luong') || '', 'inputmode="decimal" placeholder="0"', 'span-3')
      + input('contractUnitPrice', 'Đơn giá HĐ (VND)', '', 'inputmode="numeric" placeholder="0"', 'span-3')
      + textarea('note', 'Ghi chú', '', '', 'span-12 compact-ta');
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
    openClarificationTimeline: openClarificationTimeline,
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
    _togglePicker: togglePicker,
    _pickOption: pickOption,
  };
})();
