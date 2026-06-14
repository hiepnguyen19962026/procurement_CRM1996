(function () {
  var state = AppState.list('rfqItems');
  var sort = { by: '', dir: 'desc' };
  var _setupDone = false;
  var clarificationDataCache = {};
  var _lightboxEl = null;
  var _lightboxGroup = [];
  var _lightboxIndex = 0;
  var _gallerySeq = 0;
  var _galleryRegistry = {};
  var _supDebounce = null;
  var _pendingRfqFilter = '';
  var _selectedRfqId = '';
  var _rfqListCache = [];
  var _rfqAutocompleteInit = false;
  var _exportColPanelInit = false;

  // Must mirror EXPORT_COL_HEADERS in src/worker/handlers/rfq-items.js
  var EXPORT_ALL_COLS = [
    'Mã gói', 'Tên gói',
    'STT', 'Mã mua sắm', 'Mã vật tư',
    'Tên vật tư / Danh mục hàng hóa', 'Ký mã hiệu / Model', 'Nhãn hiệu',
    'Năm sản xuất', 'Xuất xứ', 'Hãng sản xuất', 'Quy cách / thông số kỹ thuật',
    'Vật liệu', 'Phụ tùng chuyên dụng', 'Yêu cầu kỹ thuật bổ sung',
    'Đơn vị tính', 'Khối lượng', 'Thuế suất', 'Đơn giá', 'Thành tiền', 'Đơn giá HĐ', 'Thành tiền HĐ',
    'Thời gian giao hàng', 'Ghi chú', 'Làm rõ',
  ];

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    ['itemSearch', 'itemSearch2', 'itemSearch3'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
    });
    document.addEventListener('click', function (e) {
      var wrap = document.querySelector('.rfq-autocomplete-wrap');
      if (wrap && !wrap.contains(e.target)) _hideRfqSuggestions();
    });
    window.addEventListener('resize', syncTopScroll);
  }

  async function initRfqAutocomplete() {
    if (!_rfqAutocompleteInit) {
      _rfqAutocompleteInit = true;
      var rfqs = AppState.list('rfqs').rows || [];
      if (!rfqs.length) {
        try {
          var data = await API.get('getRfqs', { limit: 2000 });
          AppState.list('rfqs').rows = data.rows || [];
        } catch (e) { /* ignore — combobox stays empty */ }
      }
      _rfqListCache = AppState.list('rfqs').rows || [];
    }
    var pending = _pendingRfqFilter;
    if (pending) {
      _pendingRfqFilter = '';
      var rfqRow = _rfqListCache.find(function (r) { return r.rfq_id === pending; });
      _selectedRfqId = pending;
      var inp = document.getElementById('itemRfqInput');
      if (inp) inp.value = rfqRow ? (rfqRow.ten_goi || rfqRow.rfq_id) : pending;
    }
  }

  function filterByRfq(rfqId) {
    _pendingRfqFilter = rfqId;
  }

  function _rfqLabel(r) {
    return r.ten_goi ? r.ten_goi + (r.ma_goi_tbmt ? ' — ' + r.ma_goi_tbmt : '') : r.rfq_id;
  }

  function _hideRfqSuggestions() {
    var sug = document.getElementById('itemRfqSuggestions');
    if (sug) { sug.innerHTML = ''; sug.classList.add('hidden'); }
  }

  function _onRfqInput(el) {
    _selectedRfqId = '';
    var q = (el.value || '').toLowerCase().trim();
    var sug = document.getElementById('itemRfqSuggestions');
    if (!sug) return;
    if (!q) { _hideRfqSuggestions(); return; }
    var matches = _rfqListCache.filter(function (r) {
      return (_rfqLabel(r) + ' ' + r.rfq_id).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 40);
    if (!matches.length) {
      sug.innerHTML = '<div class="rfq-sug-item" style="color:var(--text-muted)">Không tìm thấy</div>';
    } else {
      sug.innerHTML = matches.map(function (r) {
        var lbl = _rfqLabel(r);
        return '<div class="rfq-sug-item" onmousedown="RfqItemsModule._selectRfq(\'' + r.rfq_id.replace(/'/g, "\\'") + '\',\'' + lbl.replace(/'/g, "\\'") + '\')">' + API.esc(lbl) + '</div>';
      }).join('');
    }
    sug.classList.remove('hidden');
  }

  function _onRfqKeydown(e) {
    if (e.key === 'Escape') {
      _selectedRfqId = '';
      var inp = document.getElementById('itemRfqInput');
      if (inp) inp.value = '';
      _hideRfqSuggestions();
    } else if (e.key === 'Enter') {
      _hideRfqSuggestions();
      load(true);
    }
  }

  function _selectRfq(rfqId, label) {
    _selectedRfqId = rfqId;
    var inp = document.getElementById('itemRfqInput');
    if (inp) inp.value = label;
    _hideRfqSuggestions();
    load(true);
  }

  function syncSort() {
    document.querySelectorAll('#screen-items th[data-sort-key]').forEach(function (th) {
      var key = th.getAttribute('data-sort-key');
      if (!th.getAttribute('data-label')) th.setAttribute('data-label', th.textContent.trim());
      var label = th.getAttribute('data-label');
      var active = sort.by === key;
      th.classList.toggle('sort-active', active);
      var arrow = active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕';
      th.innerHTML = '<span class="rfqi-th-label">' + label + '</span><span class="rfqi-sort-mark">' + arrow + '</span>';
      th.onclick = function () {
        if (sort.by === key) { sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; }
        else { sort.by = key; sort.dir = 'asc'; }
        load(true);
      };
    });
  }

  async function load(reset) {
    setupOnce();
    await initRfqAutocomplete();
    if (reset) state.cursor = '';
    state.q = document.getElementById('itemSearch').value || '';
    state.q2 = (document.getElementById('itemSearch2') || {}).value || '';
    state.q3 = (document.getElementById('itemSearch3') || {}).value || '';
    try {
      var pageSizeEl = document.getElementById('itemPageSize');
      var pageSizeVal = pageSizeEl ? pageSizeEl.value : '500';
      var limit;
      if (pageSizeVal === 'all') {
        var known = state.totalCount || 0;
        if (known > 2000) {
          var ok = await Utils.confirmDanger(
            'Tải toàn bộ dữ liệu',
            'Bạn đang tải ' + known.toLocaleString('vi-VN') + ' dòng vật tư. Có thể mất vài giây.',
            'Tiếp tục tải',
            'Huỷ'
          );
          if (!ok) return;
        }
        limit = known > 0 ? known + 50 : 10000;
      } else {
        limit = Number(pageSizeVal) || 500;
      }
      var params = {
        q: state.q,
        q2: state.q2,
        q3: state.q3,
        rfqId: _selectedRfqId,
        status: document.getElementById('itemStatus').value,
        techFilter: (document.getElementById('itemTechFilter') || {}).value || '',
        cursor: state.cursor,
        limit: limit,
      };
      if (sort.by) { params.sortBy = sort.by; params.sortDir = sort.dir; }
      var data = await API.get('getRfqItems', params);
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      if (data.totalCount != null) state.totalCount = Number(data.totalCount);
      render();
    } catch (err) {
      API.error(err);
    }
  }

  function val(r, canonical, legacy) {
    return r[canonical] ?? (legacy ? r[legacy] : '') ?? '';
  }

  function hlEsc(text, q) {
    var safe = API.esc(String(text === null || text === undefined ? '' : text));
    if (!q) return safe;
    try {
      var pattern = API.esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return safe.replace(new RegExp('(' + pattern + ')', 'gi'), '<mark>$1</mark>');
    } catch (e) {
      return safe;
    }
  }

  function renderCell(value, muted) {
    var text = value === undefined || value === null || value === '' ? '-' : value;
    if (text === '-') return '<td' + (muted ? ' class="muted-cell"' : '') + '>-</td>';
    return '<td>' + hlEsc(String(text), state.q) + '</td>';
  }

  // finalOrOrigCell — shows finalVal as primary text.
  // When finalVal differs from origVal, origVal appears as a muted sub-line to preserve audit visibility.
  function finalOrOrigCell(finalVal, origVal) {
    var primary = finalVal || '';
    var original = origVal || '';
    if (!primary) return renderCell(original, true);
    var diff = original && original !== primary;
    return '<td>'
      + hlEsc(primary, state.q)
      + (diff ? '<div class="muted" style="font-size:11px">' + hlEsc(original, state.q) + '</div>' : '')
      + '</td>';
  }

  function urlCell(url, rfqItemId) {
    var escId = API.esc(rfqItemId || '');
    if (!url || !/^https?:\/\//i.test(url)) {
      return '<td style="text-align:center;padding:0 4px">'
        + (escId ? '<button type="button" class="btn btn-sm" onclick="RfqItemsModule.openEdit(\'' + escId + '\')">+ URL</button>' : '-')
        + '</td>';
    }
    return '<td style="text-align:center;padding:0 4px;white-space:nowrap">'
      + '<a class="btn btn-sm" href="' + API.esc(encodeURI(url)) + '" target="_blank" rel="noopener noreferrer" title="' + API.esc(url) + '">Mở</a>'
      + (escId ? ' <button type="button" class="btn btn-sm" onclick="RfqItemsModule.openEdit(\'' + escId + '\')">Sửa</button>' : '')
      + '</td>';
  }

  function render() {
    syncSort();
    var rows = state.rows || [];
    var rfqFilter = _selectedRfqId;
    if (!rows.length && rfqFilter) {
      var rfqMeta = (AppState.list('rfqs').rows || []).find(function (r) { return r.rfq_id === rfqFilter; }) || null;
      var rfqInfo = rfqMeta
        ? '<div style="margin-bottom:14px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:13px;text-align:left">'
          + '<div style="font-weight:600;margin-bottom:4px">' + API.esc(rfqMeta.rfq_id) + '</div>'
          + (rfqMeta.ten_goi ? '<div style="color:var(--text-muted)">Tên gói: <span style="color:var(--text)">' + API.esc(rfqMeta.ten_goi) + '</span></div>' : '')
          + ((rfqMeta.client_name || rfqMeta.nha_may_cdt) ? '<div style="color:var(--text-muted)">CĐT: <span style="color:var(--text)">' + API.esc(rfqMeta.client_name || rfqMeta.nha_may_cdt) + '</span></div>' : '')
          + '</div>'
        : '<div style="margin-bottom:10px;font-size:13px;color:var(--text-muted);text-align:left">RFQ: <strong>' + API.esc(rfqFilter) + '</strong></div>';
      document.getElementById('itemRows').innerHTML = '<tr><td colspan="32" style="padding:0;border:0">'
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
      var nameInner = '<strong>' + hlEsc(r.ten_vat_tu, state.q) + '</strong>'
        + '<div class="muted">' + hlEsc(val(r, 'technical_params', 'thong_so_ky_thuat'), state.q) + '</div>';
      var nameCell = canWrite
        ? '<td><span class="link-edit" onclick="RfqItemsModule.openEdit(\'' + API.esc(r.rfq_item_id) + '\')">'
          + '<strong>' + hlEsc(r.ten_vat_tu, state.q) + '</strong></span>'
          + '<div class="muted">' + hlEsc(val(r, 'technical_params', 'thong_so_ky_thuat'), state.q) + '</div>'
          + mediaBadges(r) + '</td>'
        : '<td>' + nameInner + mediaBadges(r) + '</td>';
      return '<tr>'
        + '<td style="padding:0 4px;text-align:center;width:28px"><input type="checkbox" class="item-check" value="' + API.esc(r.rfq_item_id) + '" onchange="RfqItemsModule.onCheckChange()"></td>'
        + renderCell(r.ma_goi_tbmt, true)
        + renderCell(r.ten_goi || '', true)
        + renderCell(r.stt_goc, true)
        + renderCell(r.ma_mua_sam, true)
        + renderCell(r.ma_vat_tu, true)
        + nameCell
        + finalOrOrigCell(r.quy_cach_final, val(r, 'required_model', 'quy_cach_model_yeu_cau'))
        + renderCell(val(r, 'brand', 'nhan_hieu'), true)
        + renderCell(val(r, 'manufacture_year', 'nam_san_xuat'), true)
        + finalOrOrigCell(r.xuat_xu_final, val(r, 'origin_country', 'xuat_xu'))
        + finalOrOrigCell(r.hang_final, val(r, 'manufacturer', 'hang_goc_nsx_goc'))
        + renderCell(val(r, 'technical_params', 'thong_so_ky_thuat'), true)
        + renderCell(r.vat_lieu, true)
        + renderCell(r.phu_tung_chuyen_dung, true)
        + renderCell(r.yeu_cau_ky_thuat_bo_sung, true)
        + renderCell(val(r, 'unit', 'don_vi'), true)
        + renderCell(val(r, 'quantity', 'so_luong') || 0, false)
        + renderCell(r.thue_suat != null && r.thue_suat !== 0 ? r.thue_suat + '%' : '', true)
        + renderCell(API.money(r.don_gia_truoc_thue || r.don_gia_sau_thue), true)
        + renderCell(API.money(r.thanh_tien_sau_thue), true)
        + renderCell(API.money(r.gia_hop_dong), true)
        + renderCell(r.gia_hop_dong ? API.money(r.gia_hop_dong * (parseFloat(val(r, 'quantity', 'so_luong')) || 0)) : '', true)
        + renderCell(r.delivery_time, true)
        + renderCell(r.note, true)
        + urlCell(r.external_url, r.rfq_item_id)
        + quotesSummaryCell(r)
        + lamRoCell(r)
        + '<td>' + technicalSummary(r) + '</td>'
        + '<td><span class="badge">' + API.esc(statusLabel(r.trang_thai_dong)) + '</span></td>'
        + '<td class="muted-cell" style="text-align:center">' + revisionBadge(r) + '</td>'
        + '<td data-role-only="admin,manager" style="text-align:center;padding:0 4px">'
          + '<button type="button" class="btn-x-archive" title="Lưu trữ dòng vật tư" onclick="RfqItemsModule.archiveRfqItem(\'' + API.esc(r.rfq_item_id) + '\')">✕</button>'
          + '</td>'
        + '</tr>';
    }).join('');
    document.getElementById('itemMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
    var selectAll = document.getElementById('itemSelectAll');
    if (selectAll) selectAll.checked = false;
    var rfqId = _selectedRfqId;
    var delAllBtn = document.getElementById('itemDeleteAll');
    if (delAllBtn) delAllBtn.classList.toggle('hidden', !rfqId);
    var delSelBtn = document.getElementById('itemDeleteSelected');
    if (delSelBtn) delSelBtn.classList.add('hidden');
    var delCnt = document.getElementById('itemDeleteCount');
    if (delCnt) delCnt.textContent = '0';
    updateCountInfo();
    syncTopScroll();
  }

  function updateCountInfo() {
    var el = document.getElementById('itemCountInfo');
    if (!el) return;
    var rows = state.rows || [];
    if (!rows.length) { el.textContent = ''; return; }
    var rfqId = _selectedRfqId;
    var total = state.totalCount || rows.length;
    var formatted = total.toLocaleString('vi-VN');
    if (rfqId) {
      el.textContent = 'RFQ hiện tại: ' + formatted + ' dòng vật tư';
    } else {
      el.textContent = 'Tổng: ' + formatted + ' dòng vật tư';
    }
  }

  function quotesSummaryCell(r) {
    var count = Number(r.quote_count || 0);
    var escId = API.esc(r.rfq_item_id);
    if (!count) {
      return '<td style="text-align:center"><button type="button" class="btn-link-sm" data-write'
        + ' onclick="RfqItemsModule.openQuoteForm(\'' + escId + '\')"'
        + ' title="Thêm báo giá cho dòng này">Báo giá</button></td>';
    }
    var priceLines = '';
    if (r.quote_prices_json) {
      try {
        var prices = JSON.parse(r.quote_prices_json);
        var shown = prices.slice(0, 5);
        priceLines = shown.map(function (q) {
          var sup = q.n ? (q.n.length > 14 ? q.n.slice(0, 14) + '…' : q.n) : '';
          return '<div style="font-size:11px;color:var(--text-muted);white-space:nowrap;line-height:1.35">'
            + API.money(q.p)
            + (sup ? ' <span style="opacity:.65">· ' + API.esc(sup) + '</span>' : '')
            + '</div>';
        }).join('');
        if (prices.length > 5) priceLines += '<div style="font-size:10px;color:var(--text-faint)">…</div>';
      } catch (_) {
        priceLines = r.min_price_vnd_incl_tax
          ? '<div style="font-size:11px;color:var(--text-muted)">' + API.money(r.min_price_vnd_incl_tax) + '</div>'
          : '';
      }
    } else if (r.min_price_vnd_incl_tax) {
      priceLines = '<div style="font-size:11px;color:var(--text-muted)">' + API.money(r.min_price_vnd_incl_tax) + '</div>';
    }
    return '<td style="text-align:center">'
      + '<span class="badge badge-clickable" onclick="RfqItemsModule.openEdit(\'' + escId + '\')" title="Xem danh sách báo giá">'
      + count + ' báo giá</span>'
      + priceLines + '</td>';
  }

  function mediaBadges(r) {
    var imgs = Number(r.image_count || 0);
    var docs = Number(r.file_count || 0);
    if (!imgs && !docs) return '';
    var parts = [];
    if (imgs) parts.push('📷 ' + imgs);
    if (docs) parts.push('📎 ' + docs);
    return '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + parts.join('  ') + '</div>';
  }

  function technicalSummary(r) {
    var count = Number(r.clarification_count || 0);
    var techStatus = r.clarification_status || r.trang_thai_ky_thuat;
    var badge = '<span class="badge badge-clickable" title="Xem lịch sử xác nhận kỹ thuật" onclick="RfqItemsModule.openClarificationTimeline(\'' + API.esc(r.rfq_item_id) + '\')">'
      + API.esc(technicalStatusLabel(techStatus)) + '</span>';
    return '<div class="tech-summary">'
      + badge
      + '<span>' + API.esc(count + ' lần trao đổi') + '</span>'
      + '</div>';
  }

  function lamRoCell(r) {
    var title = r.latest_clarification_title || '';
    var count = Number(r.clarification_count || 0);
    if (!title) {
      return '<td class="muted-cell" style="font-size:11px;color:var(--text-faint);text-align:center">—</td>';
    }
    var escaped = API.esc(title);
    if (count > 1) {
      // Multiple clarifications — clicking opens the existing clarification timeline
      return '<td style="font-size:11px;cursor:pointer;color:var(--blue)" title="' + escaped + ' (click để xem tất cả làm rõ)" onclick="RfqItemsModule.openClarificationTimeline(\'' + API.esc(r.rfq_item_id) + '\')">'
        + escaped + '</td>';
    }
    return '<td style="font-size:11px" title="' + escaped + '">' + escaped + '</td>';
  }

  // --- Export column panel (req 4) ---

  function initExportColPanel() {
    if (_exportColPanelInit) return;
    _exportColPanelInit = true;
    var panel = document.getElementById('itemExportColPanel');
    if (!panel) return;
    var html = '<span style="font-weight:600;margin-right:6px;white-space:nowrap">Cột xuất CSV:</span>';
    EXPORT_ALL_COLS.forEach(function (col, i) {
      html += '<label style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap">'
        + '<input type="checkbox" id="xkCol_' + i + '" value="' + API.esc(col) + '" checked> '
        + API.esc(col) + '</label>';
    });
    html += '<button style="margin-left:8px;font-size:11px;padding:3px 8px;min-height:unset" onclick="RfqItemsModule._exportColAll(true)">Tất cả</button>'
      + '<button style="margin-left:4px;font-size:11px;padding:3px 8px;min-height:unset" onclick="RfqItemsModule._exportColAll(false)">Bỏ tất cả</button>';
    panel.innerHTML = html;
  }

  function toggleExportColPanel() {
    var panel = document.getElementById('itemExportColPanel');
    if (!panel) return;
    initExportColPanel();
    panel.classList.toggle('hidden');
  }

  function _exportColAll(checked) {
    var panel = document.getElementById('itemExportColPanel');
    if (!panel) return;
    Array.prototype.forEach.call(panel.querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.checked = checked;
    });
  }

  function _getExportCols() {
    var panel = document.getElementById('itemExportColPanel');
    // Panel hidden or not initialized = export all columns (send empty array to backend)
    if (!panel || panel.classList.contains('hidden') || !_exportColPanelInit) return [];
    var all = Array.prototype.slice.call(panel.querySelectorAll('input[type=checkbox]'));
    var checked = all.filter(function (cb) { return cb.checked; });
    // All checked or none checked = all columns (send empty = backend default)
    if (!checked.length || checked.length === all.length) return [];
    return checked.map(function (cb) { return cb.value; });
  }

  function _getSelectedItemIds() {
    return Array.prototype.filter.call(
      document.querySelectorAll('#itemRows .item-check'),
      function (cb) { return cb.checked; }
    ).map(function (cb) { return cb.value; });
  }

  // --- Revision history ---

  function revisionBadge(r) {
    var n = Number(r.current_revision_no || 0);
    if (!n) return '';
    return '<span class="link-edit" title="Xem lịch sử thay đổi quy cách" onclick="RfqItemsModule.openRevisionHistory(\''
      + API.esc(r.rfq_item_id) + '\')">' + n + '</span>';
  }

  function openRevisionHistory(rfqItemId) {
    var item = (state.rows || []).find(function (r) { return r.rfq_item_id === rfqItemId; }) || {};
    API.get('getItemRevisions', { rfqItemId: rfqItemId }).then(function (data) {
      Utils.openModal(
        'Lịch sử thay đổi quy cách' + (item.ten_vat_tu ? ' — ' + item.ten_vat_tu : ''),
        revisionHistoryHtml(data.rows || []),
        null
      );
    }).catch(API.error);
  }

  function revisionHistoryHtml(revisions) {
    if (!revisions.length) {
      return '<div class="span-12"><div class="empty-state small">Chưa có lịch sử thay đổi quy cách.</div></div>';
    }
    var FIELDS = [
      { key: 'ma_mua_sam',       label: 'Mã mua sắm' },
      { key: 'ma_vat_tu',        label: 'Mã vật tư' },
      { key: 'ten_vat_tu',       label: 'Tên vật tư' },
      { key: 'required_model',   label: 'Model yêu cầu' },
      { key: 'manufacturer',     label: 'Hãng SX' },
      { key: 'brand',            label: 'Nhãn hiệu' },
      { key: 'origin_country',   label: 'Xuất xứ' },
      { key: 'technical_params', label: 'Thông số KT' },
      { key: 'note',             label: 'Ghi chú' },
      { key: 'quy_cach_final',   label: 'Model final' },
      { key: 'hang_final',       label: 'Hãng final' },
      { key: 'xuat_xu_final',    label: 'Xuất xứ final' },
    ];
    return '<div class="span-12">'
      + '<div class="quotes-table-wrap"><table class="quotes-mini-table"><thead><tr>'
      + '<th>Rev.</th><th>Ngày</th><th>Người tạo</th><th>Trao đổi</th>'
      + FIELDS.map(function (f) { return '<th>' + API.esc(f.label) + '</th>'; }).join('')
      + '</tr></thead><tbody>'
      + revisions.map(function (r) {
          var revBadge = r.revision_no === 0
            ? '<span class="badge badge-grey">Gốc</span>'
            : '<span class="badge badge-orange">' + r.revision_no + '</span>';
          return '<tr>'
            + '<td style="text-align:center">' + revBadge + '</td>'
            + '<td style="white-space:nowrap;font-size:11px">' + API.esc(formatDate(r.created_at)) + '</td>'
            + '<td>' + API.esc(r.created_by_name || r.created_by || '-') + '</td>'
            + '<td style="font-size:12px">' + API.esc(r.clarification_title || '-') + '</td>'
            + FIELDS.map(function (f) {
                return '<td>' + API.esc(r[f.key] || '-') + '</td>';
              }).join('')
            + '</tr>';
        }).join('')
      + '</tbody></table></div>'
      + '</div>';
  }

  // Shows a professional confirmation overlay (Promise-based).
  // Resolves true if user confirms, false if user cancels.
  function showRevisionConfirm() {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = '<div class="confirm-box">'
        + '<div class="confirm-title">Xác nhận thay đổi quy cách vật tư?</div>'
        + '<p class="confirm-desc">Hệ thống sẽ lưu lại lịch sử quy cách trước khi cập nhật quy cách final mới cho dòng vật tư này.</p>'
        + '<div class="confirm-actions">'
        + '<button type="button" class="btn-cancel" id="revConfirmNo">Không — chỉ lưu trao đổi</button>'
        + '<button type="button" class="btn-primary" id="revConfirmYes">Có, xác nhận thay đổi</button>'
        + '</div></div>';
      document.body.appendChild(overlay);
      overlay.querySelector('#revConfirmYes').onclick = function () {
        document.body.removeChild(overlay);
        resolve(true);
      };
      overlay.querySelector('#revConfirmNo').onclick = function () {
        document.body.removeChild(overlay);
        resolve(false);
      };
    });
  }

  function quickEditBadge(ev, rfqItemId) {
    ev.stopPropagation();
    var btn = ev.currentTarget;
    var clarificationId = btn.dataset.clid;
    var field = btn.dataset.field;
    var chips = field === 'clarification_type' ? TYPE_CHIPS : STATUS_CHIPS;

    var existing = document.getElementById('tcl-badge-pop');
    if (existing) {
      var wasSame = existing.dataset.clid === clarificationId && existing.dataset.field === field;
      existing.remove();
      if (wasSame) return;
    }

    var row = clarificationDataCache[clarificationId];
    var currentVal = row ? (field === 'clarification_type' ? row.clarification_type : row.status_after) : '';

    var pop = document.createElement('div');
    pop.id = 'tcl-badge-pop';
    pop.className = 'picker-list';
    pop.dataset.clid = clarificationId;
    pop.dataset.field = field;
    pop.innerHTML = chips.map(function (c) {
      return '<button type="button" class="picker-option' + (c.value === currentVal ? ' active' : '') + '" data-val="' + API.esc(c.value) + '">'
        + '<span class="chip chip-' + c.color + '" style="font-size:11px;padding:2px 7px">' + API.esc(c.label) + '</span>'
        + '</button>';
    }).join('');

    var rect = btn.getBoundingClientRect();
    pop.style.cssText = 'position:fixed;z-index:400;top:' + (rect.bottom + 4) + 'px;left:' + rect.left + 'px;min-width:160px;';
    document.body.appendChild(pop);

    pop.querySelectorAll('.picker-option').forEach(function (opt) {
      opt.addEventListener('click', async function (e) {
        e.stopPropagation();
        pop.remove();
        document.removeEventListener('click', outsideClick, true);
        await _applyQuickBadgeEdit(clarificationId, field, opt.getAttribute('data-val'), rfqItemId, row);
      });
    });

    function outsideClick(e) {
      if (!pop.contains(e.target) && !btn.contains(e.target)) {
        pop.remove();
        document.removeEventListener('click', outsideClick, true);
      }
    }
    setTimeout(function () { document.addEventListener('click', outsideClick, true); }, 0);
  }

  async function _applyQuickBadgeEdit(clarificationId, field, newVal, rfqItemId, cachedRow) {
    var row = cachedRow;
    if (!row) {
      try {
        var data = await API.get('getTechnicalClarifications', { rfqItemId: rfqItemId });
        row = (data.rows || []).find(function (r) { return r.clarification_id === clarificationId; }) || {};
        clarificationDataCache[clarificationId] = row;
      } catch (err) { API.error(err); return; }
    }
    var newType   = field === 'clarification_type' ? newVal : (row.clarification_type || '');
    var newStatus = field === 'status_after'       ? newVal : (row.status_after       || '');
    var isFinal   = newType === 'final_confirm' || newStatus === 'final_confirmed';
    var confirmRevision = false;
    if (isFinal) { confirmRevision = await showRevisionConfirm(); }
    try {
      await API.call('updateTechnicalClarification', {
        rfqItemId:            rfqItemId,
        clarificationId:      clarificationId,
        clarificationType:    newType,
        statusAfter:          newStatus,
        title:                row.title || '',
        content:              row.content || '',
        oldModel:             row.old_model || '',
        proposedModel:        row.proposed_model || '',
        proposedManufacturer: row.proposed_manufacturer || '',
        proposedOrigin:       row.proposed_origin || '',
        rawNote:              row.raw_note || '',
        confirmRevision:      confirmRevision,
      });
      var msg = isFinal && confirmRevision
        ? 'Đã cập nhật và tạo lịch sử thay đổi quy cách'
        : 'Đã cập nhật';
      API.toast(msg, 'success');
      await load(true);
      openClarificationTimeline(rfqItemId);
    } catch (err) { API.error(err); }
  }

  function openCreate() {
    state.currentMedia = {};
    state.currentMaster = {};
    var rfqSeed = {};
    if (_selectedRfqId) {
      var cached = _rfqListCache.find(function (r) { return r.rfq_id === _selectedRfqId; });
      rfqSeed = cached
        ? { rfq_id: cached.rfq_id, ma_goi_tbmt: cached.ma_goi_tbmt, ten_goi: cached.ten_goi, client_name: cached.client_name }
        : { rfq_id: _selectedRfqId };
    }
    openForm(rfqSeed, [], [], [], {});
  }

  function safeGet(action, params, fallback) {
    return API.get(action, params).catch(function (err) {
      console.warn('[rfq-items] safeGet ' + action + ' failed:', err && err.message);
      return fallback;
    });
  }

  async function openEdit(id) {
    var row = (state.rows || []).find(function (r) { return r.rfq_item_id === id; });
    if (!row || !row.ten_vat_tu) {
      try {
        var fetched = await API.get('getRfqItem', { rfqItemId: id });
        row = fetched.row || row || { rfq_item_id: id };
      } catch (_) { row = row || { rfq_item_id: id }; }
    }
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
          var action = row.clarification_id ? 'updateTechnicalClarification' : 'createTechnicalClarification';
          // When type=final_confirm or status=final_confirmed, ask user to confirm spec revision.
          var isFinal = form.clarificationType === 'final_confirm' || form.statusAfter === 'final_confirmed';
          if (isFinal) {
            var confirmed = await showRevisionConfirm();
            form.confirmRevision = confirmed;
          }
          await API.call(action, form);
          _clarSugSaveAll(form);
          Utils.closeModal();
          var msg = isFinal && form.confirmRevision
            ? 'Đã lưu trao đổi và tạo lịch sử thay đổi quy cách'
            : 'Đã lưu trao đổi kỹ thuật';
          API.toast(msg, 'success');
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
      rows.forEach(function (r) { clarificationDataCache[r.clarification_id] = r; });
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
          ? rows.map(function (r) { return timelineItem(rfqItemId, r, canWrite); }).join('')
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
    var isCreate = !r.rfq_item_id;
    var rfqPreFilled = isCreate && !!r.rfq_id;
    // readonly when editing (always) or when creating with a pre-filled rfq_id
    var rfqIdIsReadonly = !isCreate || rfqPreFilled;
    // context banner shown only on create
    var contextBlock = '';
    if (isCreate) {
      if (rfqPreFilled) {
        contextBlock = '<div class="span-12" style="background:var(--primary-bg);border:1px solid var(--primary-border);border-radius:8px;padding:8px 12px;font-size:13px;line-height:1.5;margin-bottom:2px">'
          + '<strong style="color:var(--primary-dk)">Gói thầu:</strong> '
          + (r.ma_goi_tbmt ? '<span class="badge">' + API.esc(r.ma_goi_tbmt) + '</span>&ensp;' : '')
          + API.esc(r.ten_goi || r.rfq_id)
          + (r.client_name ? '&ensp;<span style="color:var(--text-muted)">·</span>&ensp;<strong style="color:var(--primary-dk)">CĐT:</strong> ' + API.esc(r.client_name) : '')
          + '</div>';
      } else {
        contextBlock = '<div class="span-12" style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:8px 12px;font-size:13px;color:#b91c1c;margin-bottom:2px">'
          + '⚠ Chưa chọn gói thầu. Nhập RFQ ID bên dưới hoặc lọc gói thầu từ màn hình danh sách trước.'
          + '</div>';
      }
    }
    return contextBlock
      // Row 1: identifiers (2+1+2+3) + quantities (1+1+1+1) = 12
      + '<label class="span-2' + (rfqIdIsReadonly ? ' readonly-field' : '') + '">RFQ ID'
      + '<input name="rfqId" value="' + API.esc(r.rfq_id || '') + '"'
      + (rfqIdIsReadonly ? ' readonly tabindex="-1"' : ' placeholder="VD: RFQ-2026-00001" required')
      + '></label>'
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
      + input('externalUrl', 'URL thư mục/tài liệu', r.external_url || '', 'placeholder="https://drive.google.com/…" maxlength="2000" type="url"', 'span-12')
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
      + '<div class="section-head"><h4>Master v&#7853;t t&#432;</h4>'
      + '<small style="font-weight:400;color:var(--text-muted);font-size:12px">Gom c&#249;ng 1 v&#7853;t t&#432; qua nhi&#7873;u g&#243;i &#8212; tra l&#7883;ch s&#7917; gi&#225;</small>'
      + '</div>'
      + (linked
        ? '<div class="timeline-item">'
          + masterItemSummary(linked)
          + '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">'
          + '<button type="button" onclick="RfqItemsModule.refreshMasterItem(\'' + API.esc(item.rfq_item_id) + '\')">L&#224;m m&#7899;i</button>'
          + '<button type="button" data-write onclick="RfqItemsModule.unlinkMasterItem(\'' + API.esc(item.rfq_item_id) + '\')">B&#7887; li&#234;n k&#7871;t</button>'
          + '</div></div>'
        : '<details>'
          + '<summary style="cursor:pointer;font-size:13px;padding:4px 0;color:var(--text-muted)">Li&#234;n k&#7871;t ho&#7863;c t&#7841;o master item&#8230;</summary>'
          + '<div class="empty-state small" style="margin-top:8px">Ch&#432;a li&#234;n k&#7871;t master item.</div>'
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
          + '</details>'
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
    var escId = API.esc(item.rfq_item_id);
    return '<section class="modal-section media-section">'
      + '<div class="section-head"><h4>Tài liệu dòng vật tư</h4></div>'
      + '<div class="media-subhead"><strong style="font-size:13px">Tài liệu PDF</strong></div>'
      + mediaList(pdfFiles, 'Chưa có file PDF.')
      + '<div data-write class="upload-row">'
      + '<label>Upload tài liệu PDF</label>'
      + '<input id="' + pdfInputId + '" type="file" accept="application/pdf,.pdf">'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'rfq_item\', \'' + escId + '\', \'document_pdf\', \'' + pdfInputId + '\', \'' + escId + '\')">Upload PDF</button>'
      + '</div>'
      + '<div class="media-subhead" style="margin-top:16px"><strong style="font-size:13px">Ảnh vật tư</strong></div>'
      + imageGallery(imageFiles)
      + '<div data-write class="upload-row">'
      + '<label>Upload ảnh vật tư</label>'
      + '<input id="' + imageInputId + '" type="file" accept="image/jpeg,image/png,image/webp">'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'rfq_item\', \'' + escId + '\', \'item_image\', \'' + imageInputId + '\', \'' + escId + '\')">Upload ảnh</button>'
      + '</div>'
      + '</section>';
  }

  function technicalSection(item, rows) {
    if (!item.rfq_item_id) return '';
    var canWrite = Utils.roleCanWrite();
    rows.forEach(function (r) { clarificationDataCache[r.clarification_id] = r; });
    return '<section class="modal-section technical-section">'
      + '<div class="section-head"><h4>Xác nhận kỹ thuật</h4><button type="button" data-write onclick="RfqItemsModule.openClarificationForm(\'' + API.esc(item.rfq_item_id) + '\')">+ Thêm trao đổi</button></div>'
      + (rows.length ? rows.map(function (r) { return timelineItem(item.rfq_item_id, r, canWrite); }).join('') : '<div class="empty-state small">Chưa có trao đổi kỹ thuật.</div>')
      + '</section>';
  }

  function timelineItem(rfqItemId, r, canWrite) {
    var clid = API.esc(r.clarification_id);
    var itemId = API.esc(rfqItemId);
    var typeBadge = canWrite
      ? '<button type="button" class="badge ' + typeBadgeClass(r.clarification_type) + '" style="font-size:11px;padding:2px 7px;white-space:nowrap;cursor:pointer"'
        + ' data-clid="' + clid + '" data-field="clarification_type"'
        + ' onclick="RfqItemsModule.quickEditBadge(event,\'' + itemId + '\')">'
        + API.esc(typeLabel(r.clarification_type)) + ' ▾</button>'
      : '<span class="badge ' + typeBadgeClass(r.clarification_type) + '" style="font-size:11px;padding:2px 7px;white-space:nowrap">' + API.esc(typeLabel(r.clarification_type)) + '</span>';
    var statusBadge = canWrite
      ? '<button type="button" class="badge ' + statusBadgeClass(r.status_after) + '" style="font-size:11px;padding:2px 7px;white-space:nowrap;cursor:pointer"'
        + ' data-clid="' + clid + '" data-field="status_after"'
        + ' onclick="RfqItemsModule.quickEditBadge(event,\'' + itemId + '\')">'
        + API.esc(technicalStatusLabel(r.status_after)) + ' ▾</button>'
      : '<span class="badge ' + statusBadgeClass(r.status_after) + '" style="font-size:11px;padding:2px 7px;white-space:nowrap">' + API.esc(technicalStatusLabel(r.status_after)) + '</span>';
    var modelChange = (r.old_model || r.proposed_model)
      ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">' + API.esc(r.old_model || '—') + ' → ' + API.esc(r.proposed_model || '—') + '</div>'
      : '';
    var propSpec = (r.proposed_manufacturer || r.proposed_origin)
      ? '<div style="font-size:12px;color:var(--text-muted)">' + API.esc([r.proposed_manufacturer, r.proposed_origin].filter(Boolean).join(' · ')) + '</div>'
      : '';
    return '<article class="timeline-item" style="display:grid;grid-template-columns:130px 1fr auto;gap:8px;align-items:start;padding:7px 9px;margin-bottom:4px">'
      + '<div style="display:flex;flex-direction:column;gap:3px">'
      + typeBadge
      + statusBadge
      + '<span style="font-size:11px;color:var(--text-muted);margin-top:2px">' + API.esc(formatDate(r.created_at)) + '</span>'
      + '</div>'
      + '<div style="min-width:0">'
      + '<strong style="font-size:13px">' + API.esc(r.title) + '</strong>'
      + (r.content ? '<div style="font-size:12px;margin-top:3px;white-space:pre-wrap">' + API.esc(r.content) + '</div>' : '')
      + modelChange + propSpec
      + (r.attachment_file_id ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">📎 ' + API.esc(r.attachment_file_name || r.attachment_file_id) + '</div>' : '')
      + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:3px;align-items:flex-end">'
      + (r.external_url && /^https?:\/\//i.test(r.external_url)
          ? '<a class="btn btn-sm" href="' + API.esc(encodeURI(r.external_url)) + '" target="_blank" rel="noopener noreferrer" title="' + API.esc(r.external_url) + '">Mở</a>'
          : '<button type="button" class="btn btn-sm" data-role-only="admin,manager" onclick="RfqItemsModule.openClarificationForm(\'' + itemId + '\', \'' + clid + '\')">+ URL</button>')
      + '<button type="button" data-role-only="admin,manager" style="font-size:12px;min-height:28px;padding:3px 8px" onclick="RfqItemsModule.openClarificationForm(\'' + itemId + '\', \'' + clid + '\')">Sửa</button>'
      + '</div>'
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

  // Clarification form suggestions. localStorage only — persists across sessions.
  var CLARSUG_PREFIX = 'procurement_crm:tech_clarification_recent:';
  var CLARSUG_MAX = 8;
  var CLARSUG_MAX_LEN = 500;
  var CLAR_TITLE_STATIC = [
    'Thay đổi quy cách vật tư', 'Thay đổi HSX', 'Thay đổi xuất xứ',
    'Thay đổi chất liệu', 'Thay đổi đơn vị tính', 'Thay đổi thời gian giao hàng',
    'Ngừng sản xuất', 'Model thay thế', 'Làm rõ kỹ thuật',
    'Bổ sung tài liệu kỹ thuật', 'Bổ sung catalogue', 'Bổ sung CO CQ', 'Bổ sung datasheet',
  ];

  function _clarSugLoad(key) {
    try { return JSON.parse(localStorage.getItem(CLARSUG_PREFIX + key) || '[]'); }
    catch (e) { return []; }
  }

  function _clarSugSaveAll(form) {
    ['title', 'content', 'proposedModel', 'proposedManufacturer', 'proposedOrigin', 'rawNote', 'externalUrl'].forEach(function (f) {
      var v = String(form[f] || '').trim();
      if (!v || v.length > CLARSUG_MAX_LEN) return;
      try {
        var arr = _clarSugLoad(f);
        arr = [v].concat(arr.filter(function (x) { return x !== v; })).slice(0, CLARSUG_MAX);
        localStorage.setItem(CLARSUG_PREFIX + f, JSON.stringify(arr));
      } catch (e) { /* quota / private browsing */ }
    });
  }

  function _clarSugDatalist(id, staticItems, recentKey) {
    var recent = recentKey ? _clarSugLoad(recentKey) : [];
    var combined = recent.concat((staticItems || []).filter(function (s) { return recent.indexOf(s) < 0; }));
    if (!combined.length) return '';
    return '<datalist id="' + id + '">'
      + combined.map(function (v) { return '<option value="' + API.esc(v) + '">'; }).join('')
      + '</datalist>';
  }

  function _clarRecentBar(fieldKey, name) {
    var recent = _clarSugLoad(fieldKey);
    if (!recent.length) return '';
    return '<div class="clar-recent-bar">'
      + recent.map(function (v) {
          var display = v.length > 45 ? v.slice(0, 45) + '…' : v;
          return '<button type="button" class="clar-recent-chip" onclick="RfqItemsModule._clarPickRecent('
            + JSON.stringify(name) + ',' + JSON.stringify(v) + ')">' + API.esc(display) + '</button>';
        }).join('')
      + '</div>';
  }

  function _clarPickRecent(targetName, value) {
    var el = document.querySelector('#modalBody [name="' + targetName + '"]');
    if (el) { el.value = value; el.focus(); }
  }

  function _clarUrlShowRecent(inputEl) {
    var dropdown = inputEl.nextElementSibling;
    if (!dropdown || !dropdown.classList.contains('clar-url-dropdown')) return;
    var recent = _clarSugLoad('externalUrl').slice(0, 5);
    if (!recent.length) { dropdown.classList.add('hidden'); return; }
    // position:fixed escapes modal overflow:hidden / overflow-x:clip clipping
    var rect = inputEl.getBoundingClientRect();
    var maxW = Math.min(900, window.innerWidth - 24);
    dropdown.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;left:' + rect.left + 'px'
      + ';width:' + maxW + 'px;max-height:220px;overflow-x:auto;overflow-y:auto;z-index:1000;';
    dropdown.innerHTML = recent.map(function (url) {
      return '<div class="clar-url-item" title="' + API.esc(url) + '"'
        + ' onmousedown="event.preventDefault();RfqItemsModule._clarPickUrl(this,' + JSON.stringify(url) + ')">'
        + API.esc(url) + '</div>';
    }).join('');
    dropdown.classList.remove('hidden');
  }

  function _clarUrlHide(inputEl) {
    var dropdown = inputEl.nextElementSibling;
    if (dropdown && dropdown.classList.contains('clar-url-dropdown')) dropdown.classList.add('hidden');
  }

  function _clarPickUrl(itemEl, url) {
    var wrap = itemEl.closest('.clar-url-wrap');
    if (!wrap) return;
    var input = wrap.querySelector('input[name="externalUrl"]');
    if (input) input.value = url;
    var dropdown = wrap.querySelector('.clar-url-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }

  function clarificationFields(item, r) {
    var type = r.clarification_type || 'ask_supplier';
    var status = r.status_after || 'waiting_supplier';
    return ''
      + '<div class="span-4">' + renderPickerDropdown('Loại trao đổi', 'clarificationType', TYPE_CHIPS, type) + '</div>'
      + '<div class="span-4">' + renderPickerDropdown('Trạng thái sau trao đổi', 'statusAfter', STATUS_CHIPS, status) + '</div>'
      + '<div class="span-4"></div>'
      + _clarSugDatalist('dl-clar-title', CLAR_TITLE_STATIC, 'title')
      + _clarSugDatalist('dl-clar-proposedModel', [], 'proposedModel')
      + _clarSugDatalist('dl-clar-proposedManufacturer', [], 'proposedManufacturer')
      + _clarSugDatalist('dl-clar-proposedOrigin', [], 'proposedOrigin')
      + input('title', 'Tiêu đề', r.title || '', 'required list="dl-clar-title"', 'span-12')
      + '<label class="span-12 compact-ta">Nội dung' + _clarRecentBar('content', 'content') + '<textarea name="content">' + API.esc(r.content || '') + '</textarea></label>'
      + input('oldModel', 'Model cũ', r.old_model || val(item, 'required_model', 'quy_cach_model_yeu_cau'), '', 'span-3')
      + input('proposedModel', 'Model đề xuất / final', r.proposed_model || item.quy_cach_final || '', 'list="dl-clar-proposedModel"', 'span-3')
      + input('proposedManufacturer', 'Hãng SX đề xuất', r.proposed_manufacturer || item.hang_final || '', 'list="dl-clar-proposedManufacturer"', 'span-3')
      + input('proposedOrigin', 'Xuất xứ đề xuất', r.proposed_origin || item.xuat_xu_final || '', 'list="dl-clar-proposedOrigin"', 'span-3')
      + '<label class="span-12 compact-ta">Ghi chú gốc' + _clarRecentBar('rawNote', 'rawNote') + '<textarea name="rawNote">' + API.esc(r.raw_note || '') + '</textarea></label>'
      + '<label class="span-12">URL tài liệu'
      + '<div class="clar-url-wrap">'
      + '<input name="externalUrl" type="url" placeholder="Link Google Drive / file phương án / công văn…" maxlength="2000" value="' + API.esc(r.external_url || '') + '"'
      + ' onfocus="RfqItemsModule._clarUrlShowRecent(this)" onblur="RfqItemsModule._clarUrlHide(this)">'
      + '<div class="clar-url-dropdown hidden"></div>'
      + '</div></label>';
    // updateFinal is auto-applied by backend when type=final_confirm or status=final_confirmed
  }

  function latestClarificationSummary(item, clarifications) {
    var rfqItemId = item.rfq_item_id || '';
    var escId = API.esc(rfqItemId);
    if (!clarifications || !clarifications.length) {
      return '<div class="span-3" data-latest-clarification style="font-size:12px">'
        + '<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Làm rõ vật tư / Xác nhận kỹ thuật</div>'
        + '<span class="clar-summary-empty">Chưa có trao đổi kỹ thuật.</span>'
        + (rfqItemId ? '<div style="margin-top:6px"><button type="button" style="font-size:12px;min-height:28px;padding:3px 10px" onclick="RfqItemsModule.openClarificationForm(\'' + escId + '\')">+ Thêm trao đổi</button></div>' : '')
        + '</div>';
    }
    var c = clarifications[0];
    var preview = (c.content || '').slice(0, 80) + ((c.content || '').length > 80 ? '…' : '');
    return '<div class="span-3" data-latest-clarification style="font-size:12px">'
      + '<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">Làm rõ vật tư / Xác nhận kỹ thuật</div>'
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
        + ' <button type="button" data-role-only="admin,manager" class="btn-danger-sm" onclick="RfqItemsModule.deleteQuote(\''
          + API.esc(rfqItemId) + '\', \'' + API.esc(r.quote_id) + '\')">Xóa</button>'
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
    var gId = 'g' + (++_gallerySeq);
    _galleryRegistry[gId] = files.map(function (f) { return f.file_id; });
    return '<div class="media-gallery">'
      + files.map(function (f, i) {
        var src = API.mediaUrl(f.file_id);
        return '<button type="button" class="media-thumb" onclick="RfqItemsModule.openMediaPreviewAt(\'' + gId + '\',' + i + ')" title="' + API.esc(f.file_name || f.file_id) + '">'
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

  function _ensureLightbox() {
    if (_lightboxEl) return;
    _lightboxEl = document.createElement('div');
    _lightboxEl.className = 'media-lightbox';
    _lightboxEl.innerHTML =
      '<div class="media-lightbox-inner" onclick="event.stopPropagation()">'
      + '<div class="media-lightbox-nav">'
      + '<button type="button" class="media-lightbox-prev" onclick="RfqItemsModule._prevImage()">&#8249;</button>'
      + '<span class="media-lightbox-counter"></span>'
      + '<button type="button" class="media-lightbox-next" onclick="RfqItemsModule._nextImage()">&#8250;</button>'
      + '</div>'
      + '<img class="media-lightbox-img" src="" alt="">'
      + '<a class="media-lightbox-link" href="" target="_blank" rel="noopener">&#8599; M&#7903; tab m&#7899;i</a>'
      + '</div>';
    _lightboxEl.addEventListener('click', function () { closeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (!_lightboxEl || !_lightboxEl.classList.contains('active')) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') _prevImage();
      else if (e.key === 'ArrowRight') _nextImage();
    });
    document.body.appendChild(_lightboxEl);
  }

  function _refreshLightbox() {
    var fileId = _lightboxGroup[_lightboxIndex];
    if (!fileId) return;
    _ensureLightbox();
    var src = API.mediaUrl(fileId);
    _lightboxEl.querySelector('.media-lightbox-img').src = src;
    _lightboxEl.querySelector('.media-lightbox-link').href = src;
    var total = _lightboxGroup.length;
    var nav     = _lightboxEl.querySelector('.media-lightbox-nav');
    var counter = _lightboxEl.querySelector('.media-lightbox-counter');
    var prevBtn = _lightboxEl.querySelector('.media-lightbox-prev');
    var nextBtn = _lightboxEl.querySelector('.media-lightbox-next');
    if (nav)     nav.style.display = total > 1 ? 'flex' : 'none';
    if (counter) counter.textContent = total > 1 ? (_lightboxIndex + 1) + ' / ' + total : '';
    if (prevBtn) prevBtn.disabled = _lightboxIndex <= 0;
    if (nextBtn) nextBtn.disabled = _lightboxIndex >= total - 1;
    _lightboxEl.classList.add('active');
  }

  function openMediaPreview(fileId) {
    _lightboxGroup = [fileId];
    _lightboxIndex = 0;
    _refreshLightbox();
  }

  function openMediaPreviewAt(groupId, idx) {
    var group = _galleryRegistry[groupId] || [];
    _lightboxGroup = group;
    _lightboxIndex = Math.max(0, Math.min(idx, group.length - 1));
    _refreshLightbox();
  }

  function _prevImage() {
    if (_lightboxIndex > 0) { _lightboxIndex--; _refreshLightbox(); }
  }

  function _nextImage() {
    if (_lightboxIndex < _lightboxGroup.length - 1) { _lightboxIndex++; _refreshLightbox(); }
  }

  function closeLightbox() {
    if (_lightboxEl) _lightboxEl.classList.remove('active');
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

  async function archiveRfqItem(rfqItemId) {
    var ok = await Utils.confirmDanger(
      'Lưu trữ dòng vật tư',
      'Dòng vật tư sẽ bị ẩn khỏi danh sách. Dữ liệu liên quan (báo giá, trao đổi kỹ thuật, lịch sử quy cách) vẫn được giữ nguyên.',
      'Lưu trữ'
    );
    if (!ok) return;
    try {
      await API.call('archiveRfqItem', { rfqItemId: rfqItemId });
      API.toast('Đã lưu trữ dòng vật tư', 'success');
      await load(true);
    } catch (err) { API.error(err); }
  }

  function toggleSelectAll(chk) {
    Array.prototype.forEach.call(document.querySelectorAll('#itemRows .item-check'), function (cb) {
      cb.checked = chk.checked;
    });
    onCheckChange();
  }

  function onCheckChange() {
    var checked = Array.prototype.filter.call(
      document.querySelectorAll('#itemRows .item-check'),
      function (cb) { return cb.checked; }
    );
    var btn = document.getElementById('itemDeleteSelected');
    var cnt = document.getElementById('itemDeleteCount');
    if (btn) btn.classList.toggle('hidden', !checked.length);
    if (cnt) cnt.textContent = checked.length;
  }

  async function deleteSelected() {
    var checked = Array.prototype.filter.call(
      document.querySelectorAll('#itemRows .item-check'),
      function (cb) { return cb.checked; }
    );
    if (!checked.length) return;
    var ids = checked.map(function (cb) { return cb.value; });
    var ok = await Utils.confirmDanger(
      'Xóa vĩnh viễn ' + ids.length + ' dòng vật tư',
      'Thao tác này xóa vĩnh viễn ' + ids.length + ' dòng và toàn bộ dữ liệu liên quan (báo giá, trao đổi kỹ thuật, quyết định giá, hợp đồng). Không thể hoàn tác.',
      'Xóa vĩnh viễn'
    );
    if (!ok) return;
    try {
      var result = await API.call('hardDeleteRfqItems', { rfqItemIds: ids });
      API.toast('Đã xóa ' + (result.deleted || ids.length) + ' dòng', 'success');
      load(true);
    } catch (err) { API.error(err); }
  }

  async function deleteAll() {
    var rfqId = _selectedRfqId;
    if (!rfqId) { API.toast('Lọc theo RFQ ID trước khi xóa', 'warn'); return; }

    var safeData;
    try {
      safeData = await API.call('checkRfqImportSafety', { rfqId: rfqId });
    } catch (e) {
      API.toast('Không thể kiểm tra dữ liệu liên quan: ' + (e.message || e), 'error');
      return;
    }

    var counts = safeData.counts || {};
    var totalItemCount = Number(counts.totalItemCount || 0);
    if (!totalItemCount) { API.toast('Không có dòng vật tư nào để xóa', 'warn'); return; }

    var hasContracts = Number(counts.contractCount || 0) > 0;
    var rfqWon = counts.rfqStatus === 'trung' || counts.rfqStatus === 'archived';
    var hasClarOrQuotes = Number(counts.clarificationCount || 0) > 0
      || Number(counts.quoteCount || 0) > 0
      || Number(counts.pricingCount || 0) > 0;

    var confirmed = false;

    if (hasContracts || rfqWon) {
      confirmed = await Utils.confirmTyping(
        'Cảnh báo nghiêm trọng: RFQ đã có dữ liệu kết quả',
        'RFQ này đã có dữ liệu hợp đồng hoặc trạng thái kết quả thầu. Việc xóa toàn bộ DS vật tư có thể làm mất khả năng truy vết giữa dòng vật tư, báo giá, cân giá và kết quả/hợp đồng. Chỉ tiếp tục nếu bạn chắc chắn muốn xóa và tự chịu trách nhiệm về dữ liệu liên quan.',
        'XOA_TOAN_BO_RFQ_ITEMS'
      ) === true;
    } else if (hasClarOrQuotes) {
      var parts = [];
      if (Number(counts.clarificationCount || 0) > 0) parts.push(counts.clarificationCount + ' clarification kỹ thuật');
      if (Number(counts.quoteCount || 0) > 0) parts.push(counts.quoteCount + ' báo giá NCC');
      if (Number(counts.pricingCount || 0) > 0) parts.push(counts.pricingCount + ' quyết định cân giá');
      confirmed = await Utils.confirmDanger(
        'Cảnh báo: RFQ đã có dữ liệu liên quan',
        'RFQ này hiện có ' + totalItemCount + ' dòng vật tư và đã phát sinh dữ liệu liên quan: ' + parts.join(', ') + '. Nếu tiếp tục, toàn bộ DS vật tư và các dữ liệu liên quan này sẽ bị xóa. Chỉ thực hiện nếu bạn chắc chắn muốn làm lại danh sách vật tư từ đầu.',
        'Tôi hiểu, tiếp tục xóa',
        'Quay lại'
      );
    } else {
      confirmed = await Utils.confirmDanger(
        'Xác nhận xóa toàn bộ DS vật tư',
        'RFQ này hiện có ' + totalItemCount + ' dòng vật tư và chưa phát sinh dữ liệu liên kết như clarification kỹ thuật, báo giá NCC, cân giá hoặc hợp đồng. Nếu tiếp tục, hệ thống sẽ xóa toàn bộ DS vật tư của RFQ này. Thao tác này không thể hoàn tác.',
        'Xóa toàn bộ DS vật tư',
        'Hủy'
      );
    }

    if (!confirmed) return;
    try {
      var result = await API.call('hardDeleteAllRfqItems', { rfqId: rfqId });
      API.toast('Đã xóa ' + (result.deleted || 0) + ' dòng vật tư', 'success');
      load(true);
    } catch (err) { API.error(err); }
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

  async function deleteQuote(rfqItemId, quoteId) {
    var ok = await Utils.confirmDanger(
      'Xóa báo giá',
      'Báo giá này sẽ bị xóa vĩnh viễn khỏi hệ thống và không thể khôi phục. File đính kèm (nếu có) sẽ xử lý sau.',
      'Xóa vĩnh viễn'
    );
    if (!ok) return;
    try {
      await API.call('deleteSupplierQuote', { quoteId: quoteId });
      API.toast('Đã xóa báo giá', 'success');
      await openEdit(rfqItemId);
    } catch (err) {
      API.error(err);
    }
  }

  function quoteFields(r) {
    var sourceChannel = r.source_channel || '';
    var vndDisplay = r.price_vnd_incl_tax ? API.money(r.price_vnd_incl_tax) : '';
    return ''
      // Row 1: nguồn (2+3+7) = 12
      + quoteReferenceFields(r, sourceChannel)
      // Row 2: supplier typeahead (5) + hãng (3) + ngày báo giá (2) = 10; currency/rate as hidden
      + supplierTypeaheadBlock(r)
      + input('manufacturer', 'Hãng sản xuất', r.manufacturer || '', 'placeholder="VD: SKF"', 'span-3')
      + input('quoteDate', 'Ngày báo giá', r.quote_date || '', 'type="date"', 'span-2')
      + '<input type="hidden" name="currency" value="VND">'
      + '<input type="hidden" name="exchangeRate" value="1">'
      // Row 3: giá (3) + thuế (1) + VND+thuế (3) + giao hàng (2) + hiệu lực (2) + bảo hành (1) = 12
      + input('quotedPrice', 'Giá báo VND', r.quoted_price || '', 'inputmode="decimal" placeholder="0"', 'span-3')
      + input('taxRate', 'Thuế (%)', r.tax_rate || 0, 'inputmode="decimal" placeholder="0"', 'span-1')
      + '<label class="span-3 readonly-field">VND + Thuế<input value="' + API.esc(vndDisplay) + '" readonly tabindex="-1"></label>'
      + input('leadTime', 'Thời gian giao hàng', r.lead_time || '', 'placeholder="VD: 4-6 tuần"', 'span-2')
      + input('validUntil', 'Hiệu lực đến', r.valid_until || '', 'type="date"', 'span-2')
      + input('warranty', 'Bảo hành (ngày)', r.warranty || '', 'inputmode="numeric" placeholder="VD: 365"', 'span-1')
      + textarea('note', 'Ghi chú', r.note || '', '', 'span-12 compact-ta');
  }

  function supplierTypeaheadBlock(r) {
    var name = API.esc(r.supplier_name || '');
    var id = API.esc(r.supplier_id || '');
    return '<div class="span-5">'
      + '<label style="display:grid;gap:6px;margin-bottom:0;font-size:13px;color:var(--text-muted);font-weight:500">Tên nhà cung cấp'
      + '<input id="sqSupName" name="supplierName" value="' + name + '"'
      + ' autocomplete="off" placeholder="Nhập để tìm trong danh sách..."'
      + ' oninput="RfqItemsModule._onSupplierInput(this)">'
      + '</label>'
      + '<input type="hidden" name="supplierId" id="sqSupId" value="' + id + '">'
      + '<div id="sqSupResults" class="sup-dropdown hidden"></div>'
      + '</div>';
  }

  function _onSupplierInput(inputEl) {
    var q = (inputEl.value || '').trim();
    var hiddenEl = document.getElementById('sqSupId');
    if (hiddenEl) hiddenEl.value = '';
    clearTimeout(_supDebounce);
    var resEl = document.getElementById('sqSupResults');
    if (!q) {
      if (resEl) resEl.classList.add('hidden');
      return;
    }
    _supDebounce = setTimeout(function () {
      API.get('getSuppliers', { q: q, limit: 10 })
        .then(function (data) {
          var rows = data.rows || [];
          if (!resEl) return;
          if (!rows.length) {
            resEl.innerHTML = '<div class="sup-dropdown-empty">Không tìm thấy — tên sẽ được lưu tự do</div>';
            resEl.classList.remove('hidden');
            return;
          }
          resEl.innerHTML = rows.map(function (s) {
            var sub = [
              s.tax_code ? 'MST: ' + s.tax_code : '',
              s.contact_name || '',
              s.phone || '',
            ].filter(Boolean).join(' · ');
            return '<button type="button" class="sup-dropdown-item"'
              + ' onclick="RfqItemsModule._selectSupplier(\''
              + API.esc(s.supplier_name) + '\', \'' + API.esc(s.supplier_id) + '\')">'
              + '<strong>' + API.esc(s.supplier_name) + '</strong>'
              + (sub ? '<span>' + API.esc(sub) + '</span>' : '')
              + '</button>';
          }).join('');
          resEl.classList.remove('hidden');
        })
        .catch(function () {
          if (resEl) resEl.classList.add('hidden');
        });
    }, 280);
  }

  function _selectSupplier(name, id) {
    var nameEl = document.getElementById('sqSupName');
    var idEl = document.getElementById('sqSupId');
    var resEl = document.getElementById('sqSupResults');
    if (nameEl) nameEl.value = name;
    if (idEl) idEl.value = id;
    if (resEl) resEl.classList.add('hidden');
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
      + textarea('sourceRef', 'Ghi chú nguồn / tham chiếu', r.source_ref || '', 'placeholder="VD: email subject, Zalo/Wechat người gửi, tên file báo giá, số báo giá..."', 'span-7 compact-ta');
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
    'Đơn vị tính', 'Khối lượng', 'Thuế suất', 'Đơn giá', 'Thành tiền', 'Đơn giá HĐ',
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
    'Giá hợp đồng': 'giaHopDong',
    'Đơn giá HĐ': 'giaHopDong',
    'Thời gian giao hàng': 'deliveryTime',
    'Ghi chú': 'note',
    'Cột tổng hợp gốc để đối chiếu/export': 'originFullText',
    'rfqItemId (Không sửa)': 'rfqItemId',
  };

  var csvState = { headers: null, rows: null };
  var importMapState = { headers: null, rows: null, fileName: '', sheetName: 'csv', workbook: null, templates: [] };

  // Identity/business-state fields — default unchecked in selective_update to protect row identity
  var IMPORT_SENSITIVE_FIELDS = new Set(['rfq_item_id', 'stt_goc', 'ma_mua_sam', 'ma_vat_tu', 'ten_vat_tu']);
  // Final clarification fields — default unchecked; user must explicitly enable overwrite
  var IMPORT_FINAL_FIELDS = new Set(['quy_cach_final', 'hang_final', 'xuat_xu_final', 'ghi_chu_final']);

  var IMPORT_TARGET_FIELDS = [
    ['', '- Không import -'],
    ['rfq_item_id', 'rfq_item_id (update)'],
    ['ten_vat_tu', 'Tên vật tư *'],
    ['stt_goc', 'STT'],
    ['ma_mua_sam', 'Mã mua sắm'],
    ['ma_vat_tu', 'Mã vật tư'],
    ['required_model', 'Ký mã hiệu / Model'],
    ['manufacturer', 'Hãng sản xuất'],
    ['brand', 'Nhãn hiệu'],
    ['manufacture_year', 'Năm sản xuất'],
    ['origin_country', 'Xuất xứ'],
    ['technical_params', 'Thông số kỹ thuật'],
    ['vat_lieu', 'Vật liệu'],
    ['phu_tung_chuyen_dung', 'Phụ tùng chuyên dụng'],
    ['unit', 'Đơn vị tính'],
    ['quantity', 'Khối lượng'],
    ['yeu_cau_ky_thuat_bo_sung', 'Yêu cầu kỹ thuật bổ sung'],
    ['thue_suat', 'Thuế suất'],
    ['don_gia_truoc_thue', 'Đơn giá (trước thuế)'],
    ['don_gia_sau_thue', 'Đơn giá (sau thuế)'],
    ['thanh_tien_sau_thue', 'Thành tiền'],
    ['gia_hop_dong', 'Đơn giá HĐ'],
    ['note', 'Ghi chú'],
    ['delivery_time', 'Thời gian giao hàng'],
    ['origin_full_text', 'Cột tổng hợp gốc'],
    ['quy_cach_final', 'Quy cách cuối (Final)'],
    ['hang_final', 'Hãng cuối (Final)'],
    ['xuat_xu_final', 'Xuất xứ cuối (Final)'],
    ['ghi_chu_final', 'Ghi chú cuối (Final)'],
  ];

  // Export: template columns + Thành tiền HĐ (computed, export-only) + rfqItemId
  var EXPORT_HEADERS = (function () {
    var h = TEMPLATE_HEADERS.slice();
    h.splice(h.indexOf('Đơn giá HĐ') + 1, 0, 'Thành tiền HĐ');
    h.push('rfqItemId (Không sửa)');
    return h;
  }());

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
      r.gia_hop_dong,
      r.gia_hop_dong ? r.gia_hop_dong * (parseFloat(val(r, 'quantity', 'so_luong')) || 0) : '',
      r.delivery_time,
      r.note,
      r.rfq_item_id,
    ];
  }

  async function exportCsv(template) {
    var tpl = template || 'chung';
    var statusEl = document.getElementById('itemStatus');
    var techEl = document.getElementById('itemTechFilter');
    var selectedIds = _getSelectedItemIds();
    var cols = tpl === 'chung' ? _getExportCols() : [];
    var params = {
      rfqId: _selectedRfqId,
      q: state.q || '',
      q2: state.q2 || '',
      q3: state.q3 || '',
      status: statusEl ? statusEl.value : '',
      techFilter: techEl ? techEl.value : '',
      sortBy: sort.by || '',
      sortDir: sort.dir || '',
      exportTemplate: tpl,
    };
    if (selectedIds.length) params.selectedIds = selectedIds;
    if (cols.length) params.cols = cols;
    try {
      var data = await API.call('exportRfqItemsCsv', params);
      if (!data.ok) { API.error(data.error || 'Không thể xuất CSV'); return; }
      if (!data.row_count) { API.toast('Không có dữ liệu để xuất', 'warn'); return; }
      if (data.capped) API.toast('⚠ Kết quả bị giới hạn tối đa 5.000 dòng', 'warn');
      var rowMsg = selectedIds.length ? selectedIds.length + ' dòng đã chọn' : data.row_count + ' dòng';
      downloadCsvBlob(data.csv, data.filename);
      API.toast('Đã xuất ' + rowMsg, 'success');
    } catch (err) {
      API.error(err);
    }
  }

  function _closeExportMenu() {
    var m = document.getElementById('rfqExportTplMenu');
    if (m) m.remove();
  }

  function openExportMenu(btn) {
    _closeExportMenu();
    var menu = document.createElement('div');
    menu.id = 'rfqExportTplMenu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--white,#fff);border:1px solid var(--border,#e5e7eb);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:170px;padding:4px 0;font-size:13px';
    var items = [
      { key: 'chung', label: 'Chung' },
      { key: 'vt1_lam_ro_1', label: 'VT1-Làm rõ 1' },
      { key: 'vt1_lam_ro_2', label: 'VT1-Làm rõ 2' },
      { key: 'kq_muasamcong', label: 'Kq Muasamcong' },
    ];
    items.forEach(function (item) {
      var div = document.createElement('div');
      div.textContent = item.label;
      div.style.cssText = 'padding:8px 16px;cursor:pointer';
      div.onmouseenter = function () { div.style.background = 'var(--bg,#f3f4f6)'; };
      div.onmouseleave = function () { div.style.background = ''; };
      div.onclick = function () { _closeExportMenu(); exportCsv(item.key); };
      menu.appendChild(div);
    });
    var rect = btn.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';
    document.body.appendChild(menu);
    setTimeout(function () {
      document.addEventListener('click', _closeExportMenu, { once: true });
    }, 0);
  }

  function _closeExcelMenu() {
    var m = document.getElementById('rfqExcelTplMenu');
    if (m) m.remove();
  }

  function openExcelMenu(btn) {
    _closeExcelMenu();
    var menu = document.createElement('div');
    menu.id = 'rfqExcelTplMenu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--white,#fff);border:1px solid var(--border,#e5e7eb);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:170px;padding:4px 0;font-size:13px';
    var items = [
      { key: 'chung', label: 'Chung' },
      { key: 'vt1_lam_ro_1', label: 'VT1-Làm rõ 1' },
      { key: 'vt1_lam_ro_2', label: 'VT1-Làm rõ 2' },
      { key: 'kq_muasamcong', label: 'Kq Muasamcong' },
    ];
    items.forEach(function (item) {
      var div = document.createElement('div');
      div.textContent = item.label;
      div.style.cssText = 'padding:8px 16px;cursor:pointer';
      div.onmouseenter = function () { div.style.background = 'var(--bg,#f3f4f6)'; };
      div.onmouseleave = function () { div.style.background = ''; };
      div.onclick = function () { _closeExcelMenu(); exportExcel(item.key); };
      menu.appendChild(div);
    });
    var rect = btn.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';
    document.body.appendChild(menu);
    setTimeout(function () {
      document.addEventListener('click', _closeExcelMenu, { once: true });
    }, 0);
  }

  async function exportExcel(template) {
    var tpl = template || 'chung';
    var statusEl = document.getElementById('itemStatus');
    var techEl = document.getElementById('itemTechFilter');
    var selectedIds = _getSelectedItemIds();
    var cols = tpl === 'chung' ? _getExportCols() : [];
    var params = {
      rfqId: _selectedRfqId,
      q: state.q || '',
      q2: state.q2 || '',
      q3: state.q3 || '',
      status: statusEl ? statusEl.value : '',
      techFilter: techEl ? techEl.value : '',
      sortBy: sort.by || '',
      sortDir: sort.dir || '',
      exportTemplate: tpl,
    };
    if (selectedIds.length) params.selectedIds = selectedIds;
    if (cols.length) params.cols = cols;
    try {
      var data = await API.call('exportRfqItemsJson', params);
      if (!data.ok) { API.error(data.error || 'Không thể xuất Excel'); return; }
      if (!data.row_count) { API.toast('Không có dữ liệu để xuất', 'warn'); return; }
      if (data.capped) API.toast('⚠ Kết quả bị giới hạn tối đa 5.000 dòng', 'warn');
      _buildAndDownloadXlsx(data);
      var rowMsg = selectedIds.length ? selectedIds.length + ' dòng đã chọn' : data.row_count + ' dòng';
      API.toast('Đã xuất Excel ' + rowMsg, 'success');
    } catch (err) {
      API.error(err);
    }
  }

  function _buildAndDownloadXlsx(data) {
    var preface = data.preface || [];
    var headers = data.headers;
    var rows = data.rows;
    var textColSet = new Set(data.textCols || []);
    var longColSet = new Set(data.longTextCols || []);
    var leftColSet = new Set(data.leftAlignCols != null ? data.leftAlignCols : (data.longTextCols || []));
    var nCols = headers.length;
    var nRows = rows.length;
    var PREFACE_COUNT = 3;
    var HEADER_ROW = PREFACE_COUNT;      // 0-based: row index 3
    var DATA_START = HEADER_ROW + 1;     // 0-based: row index 4

    // AoA: 3 preface rows + 1 header row + data rows
    var aoa = [
      [preface[0] || ''],
      [preface[1] || ''],
      [preface[2] || ''],
      headers,
    ].concat(rows);
    var ws = XLSX.utils.aoa_to_sheet(aoa);

    // Force text type on numeric-looking columns in data rows only
    textColSet.forEach(function (ci) {
      for (var ri = DATA_START; ri < DATA_START + nRows; ri++) {
        var addr = XLSX.utils.encode_cell({ r: ri, c: ci });
        if (ws[addr]) { ws[addr].t = 's'; ws[addr].z = '@'; }
      }
    });

    // Column widths: long text = 35, others = 14
    ws['!cols'] = headers.map(function (h, ci) {
      return { wch: longColSet.has(ci) ? 35 : 14 };
    });

    // Freeze rows 1–4 (preface + header stay pinned while scrolling data)
    ws['!freeze'] = { xSplit: 0, ySplit: DATA_START };

    try {
      // Preface rows: bold, left
      for (var pr = 0; pr < PREFACE_COUNT; pr++) {
        var pAddr = XLSX.utils.encode_cell({ r: pr, c: 0 });
        if (ws[pAddr]) ws[pAddr].s = { font: { bold: true }, alignment: { horizontal: 'left', vertical: 'center' } };
      }
      // Header row: bold + center
      for (var c = 0; c < nCols; c++) {
        var hAddr = XLSX.utils.encode_cell({ r: HEADER_ROW, c: c });
        if (ws[hAddr]) ws[hAddr].s = { font: { bold: true }, alignment: { horizontal: 'center', vertical: 'center' } };
      }
      // Data rows: left+wrap for semantic long-text cols, center for everything else
      for (var r = DATA_START; r < DATA_START + nRows; r++) {
        for (var c = 0; c < nCols; c++) {
          var addr = XLSX.utils.encode_cell({ r: r, c: c });
          if (ws[addr]) {
            ws[addr].s = leftColSet.has(c)
              ? { alignment: { horizontal: 'left', vertical: 'center', wrapText: true } }
              : { alignment: { horizontal: 'center', vertical: 'center' } };
          }
        }
      }
    } catch (e) { /* style API not available */ }

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, data.filename);
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

  function openImportMapping(opts) {
    var defaultMode = (opts && opts.defaultMode) || 'update_changed';
    var modalTitle = defaultMode === 'selective_update' ? 'Cập nhật danh sách vật tư' : 'Upload danh sách vật tư';
    importMapState = { headers: null, rows: null, fileName: '', sheetName: 'csv', workbook: null, templates: [], _defaultMode: defaultMode };
    var rfqId = _selectedRfqId;
    var html;
    if (defaultMode === 'selective_update') {
      html = ''
        + '<div class="modal-section" style="border-top:0;margin-top:0;padding-top:0">'
        + '<label>RFQ ID<input id="importMapRfqId" value="' + API.esc(rfqId) + '" placeholder="RFQ ID"></label>'
        + '<label style="display:block;margin-top:10px">CSV / XLSX file<input type="file" id="importMapCsvFile" accept=".csv,.xlsx" onchange="RfqItemsModule._onImportMapFileChange(this)"></label>'
        + '<div id="importMapArea" style="color:var(--text-muted);font-size:13px;margin-top:10px">Chọn file CSV hoặc XLSX để xem preview.</div>'
        + '</div>';
    } else {
      html = ''
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
    }
    Utils.openModal(modalTitle, html, null);
    var _iwModal = document.querySelector('#modal .modal');
    if (_iwModal) _iwModal.classList.add('modal--import-wide');
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
    if (importMapState._defaultMode === 'selective_update') { _renderSimpleUpdatePreview(area); return; }
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
      + '<div style="overflow:auto;max-height:min(260px,28vh);margin-bottom:12px"><table class="quotes-mini-table"><thead><tr><th>Source Header</th><th>Target Field</th><th>Mẫu dữ liệu</th></tr></thead><tbody>'
      + mappingRows + '</tbody></table></div>'
      + '<div id="importPreviewTopScroll" style="overflow-x:auto;overflow-y:hidden;height:17px;margin-bottom:1px"><div style="height:1px"></div></div>'
      + '<div id="importPreviewTableWrap" style="overflow-x:auto;overflow-y:auto;max-height:min(380px,40vh)">'
      + '<table class="quotes-mini-table" style="min-width:max-content"><thead><tr>' + previewHead + '</tr></thead><tbody>' + previewBody + '</tbody></table></div>';
    setTimeout(_syncImportPreviewScroll, 50);
  }

  function _syncImportPreviewScroll() {
    var topBar = document.getElementById('importPreviewTopScroll');
    var wrap = document.getElementById('importPreviewTableWrap');
    if (!topBar || !wrap) return;
    var inner = topBar.firstElementChild;
    if (inner) inner.style.width = wrap.scrollWidth + 'px';
    var _lock = false;
    topBar.onscroll = function () { if (_lock) return; _lock = true; wrap.scrollLeft = topBar.scrollLeft; _lock = false; };
    wrap.onscroll = function () { if (_lock) return; _lock = true; topBar.scrollLeft = wrap.scrollLeft; _lock = false; };
  }

  function _renderSimpleUpdatePreview(area) {
    var headers = importMapState.headers;
    var rows = importMapState.rows || [];
    var rfqId = (document.getElementById('importMapRfqId') || {}).value || '';
    var mapping = {};
    headers.forEach(function (h) {
      var t = guessTargetField(h);
      if (t) mapping[h] = t;
    });
    if (Object.values(mapping).indexOf('ten_vat_tu') < 0) {
      area.innerHTML = '<p style="color:var(--red);font-weight:600">Không nhận ra cột Tên vật tư. Vui lòng dùng template chuẩn (Tải template CSV).</p>';
      return;
    }
    importMapState._autoMapping = mapping;
    importMapState._pendingRfqId = rfqId;
    var sheetSelectorHtml = '';
    if (importMapState.workbook && importMapState.workbook.SheetNames.length > 1) {
      var sheetOptions = importMapState.workbook.SheetNames.map(function (s) {
        return '<option value="' + API.esc(s) + '"' + (s === importMapState.sheetName ? ' selected' : '') + '>' + API.esc(s) + '</option>';
      }).join('');
      sheetSelectorHtml = '<div style="margin-bottom:8px"><label style="font-size:13px;font-weight:600">Sheet: <select id="importMapSheetSelect" onchange="RfqItemsModule._onImportMapSheetChange(this)" style="margin-left:4px;font-size:13px">' + sheetOptions + '</select></label></div>';
    }
    var checkboxRow = headers.map(function (h) {
      var targetField = mapping[h] || '';
      if (!targetField || targetField === 'rfq_item_id') {
        return '<th style="text-align:center;padding:3px 6px;background:var(--bg);border-bottom:1px solid var(--border)"><span style="color:var(--text-faint);font-size:11px">—</span></th>';
      }
      var defaultChecked = false;
      var fieldLabel = (IMPORT_TARGET_FIELDS.find(function (p) { return p[0] === targetField; }) || ['', targetField])[1];
      return '<th style="text-align:center;padding:0 6px;background:var(--bg);border-bottom:1px solid var(--border)">'
        + '<div class="rfq-update-preview-cb-wrap">'
        + '<input type="checkbox" class="rfq-update-preview-checkbox" name="overwriteColField" value="' + API.esc(targetField) + '"'
        + (defaultChecked ? ' checked' : '') + ' title="' + API.esc(fieldLabel) + '">'
        + '</div></th>';
    }).join('');
    var headerRow = headers.map(function (h) {
      var targetField = mapping[h] || '';
      return '<th style="white-space:nowrap;padding:4px 8px' + (targetField ? '' : ';color:var(--text-faint)') + '">' + API.esc(h) + '</th>';
    }).join('');
    var dataRows = rows.slice(0, 20).map(function (r) {
      return '<tr>' + headers.map(function (h, i) {
        return '<td style="padding:3px 8px;white-space:nowrap">' + API.esc(r[i] || '') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var sheetLabel = importMapState.sheetName && importMapState.sheetName !== 'csv'
      ? ' · Sheet: <strong>' + API.esc(importMapState.sheetName) + '</strong>' : '';
    area.innerHTML = sheetSelectorHtml
      + '<p style="margin:0 0 4px;color:var(--text-muted);font-size:13px">File: <strong>' + API.esc(importMapState.fileName || '-') + '</strong>' + sheetLabel + ' — ' + rows.length + ' dòng.</p>'
      + '<p style="margin:0 0 8px;font-size:12px;color:var(--text-muted)">Chọn cột cần cập nhật. Cột không chọn sẽ giữ nguyên dữ liệu cũ.</p>'
      + '<div id="importPreviewTopScroll" style="overflow-x:auto;overflow-y:hidden;height:17px;margin-bottom:1px"><div style="height:1px"></div></div>'
      + '<div id="importPreviewTableWrap" style="overflow-x:auto;overflow-y:auto;max-height:min(420px,45vh)">'
      + '<table class="quotes-mini-table" style="min-width:max-content"><thead>'
      + '<tr>' + checkboxRow + '</tr>'
      + '<tr>' + headerRow + '</tr>'
      + '</thead><tbody>' + dataRows + '</tbody></table></div>'
      + '<div style="display:flex;gap:8px;margin-top:10px">'
      + '<button type="button" class="primary" onclick="RfqItemsModule._commitSimpleUpdate()">Xác nhận cập nhật</button>'
      + '<button type="button" onclick="Utils.closeModal()">Hủy</button>'
      + '</div>';
    setTimeout(_syncImportPreviewScroll, 50);
  }

  async function _commitSimpleUpdate() {
    var rfqId = importMapState._pendingRfqId || (document.getElementById('importMapRfqId') || {}).value || '';
    var mapping = importMapState._autoMapping;
    if (!rfqId) { API.toast('Thiếu RFQ ID', 'warn'); return; }
    if (!mapping || !importMapState.rows || !importMapState.rows.length) { API.toast('Chưa có dữ liệu file', 'warn'); return; }
    var overwriteFields = [];
    document.querySelectorAll('#importMapArea input[name="overwriteColField"]:checked').forEach(function (cb) {
      if (cb.value) overwriteFields.push(cb.value);
    });
    if (!overwriteFields.length) { API.toast('Vui lòng chọn ít nhất một cột cần cập nhật.', 'warn'); return; }
    var btn = document.querySelector('#importMapArea button.primary');
    if (btn) btn.disabled = true;
    var area = document.getElementById('importMapArea');
    if (area) area.insertAdjacentHTML('afterbegin', '<p style="color:var(--text-muted)">Đang cập nhật...</p>');
    try {
      var allRows = mappedRowsForCommit(mapping);
      var data = await commitInChunks(
        rfqId, '', '', importMapState.fileName, importMapState.sheetName || 'csv',
        allRows, 'selective_update', overwriteFields
      );
      var s = data.summary || {};
      Utils.closeModal();
      API.toast('Cập nhật xong: tạo mới ' + (s.created || 0) + ', cập nhật ' + (s.updated || 0) + ', bỏ qua ' + (s.skipped || 0) + ' dòng', 'success');
      await load(true);
      if (typeof RfqsModule !== 'undefined') await RfqsModule.load(true);
    } catch (err) {
      API.error(err);
      if (btn) btn.disabled = false;
    }
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
    if (h === 'rfqitemid' || h === 'rfq_item_id' || h.startsWith('rfqitemid')) return 'rfq_item_id';
    if (h === 'stt' || h === 'sttgoc') return 'stt_goc';
    if (h.indexOf('mamuasam') >= 0) return 'ma_mua_sam';
    if (h.indexOf('mavattu') >= 0 || h.indexOf('mahang') >= 0) return 'ma_vat_tu';
    if (h.indexOf('tenvattu') >= 0 || h.indexOf('danhmuchanghoa') >= 0 || h === 'tenhang') return 'ten_vat_tu';
    if (h.indexOf('thongso') >= 0 && h.indexOf('kythuat') >= 0) return 'technical_params';
    if (h.indexOf('quycach') >= 0 || h.indexOf('model') >= 0 || h.indexOf('kymahieu') >= 0) return 'required_model';
    if (h === 'hsx' || h.indexOf('hangsanxuat') >= 0) return 'manufacturer';
    if (h.indexOf('nhanhieu') >= 0) return 'brand';
    if (h.indexOf('namsanxuat') >= 0 || h.indexOf('namsxuat') >= 0) return 'manufacture_year';
    if (h.indexOf('xuatxu') >= 0) return 'origin_country';
    if (h.indexOf('vatlieu') >= 0) return 'vat_lieu';
    if (h.indexOf('phutung') >= 0) return 'phu_tung_chuyen_dung';
    if (h.indexOf('donvi') >= 0 || h === 'dvt') return 'unit';
    if (h.indexOf('soluong') >= 0 || h.indexOf('khoiluong') >= 0) return 'quantity';
    if (h.indexOf('yeucaukythuat') >= 0) return 'yeu_cau_ky_thuat_bo_sung';
    if (h.indexOf('thuesuat') >= 0) return 'thue_suat';
    if (h.indexOf('giahopdong') >= 0 || h.indexOf('giahd') >= 0) return 'gia_hop_dong';
    if (h.indexOf('dongia') >= 0) return 'don_gia_truoc_thue';
    if (h.indexOf('thanhtien') >= 0) return 'thanh_tien_sau_thue';
    if (h.indexOf('deadline') >= 0 || h.indexOf('thoigiancap') >= 0 || h.indexOf('giaohang') >= 0) return 'delivery_time';
    if (h.indexOf('ghichu') >= 0) return 'note';
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
    var allRows = mappedRowsForCommit(mapping);
    if (area) area.insertAdjacentHTML('afterbegin', '<p style="color:var(--text-muted)">Đang kiểm tra dữ liệu...</p>');
    try {
      var preview = await previewAllRows(rfqId, allRows);
      renderImportPreview(area, rfqId, ownerKey, templateId, allRows, preview, mapping);
    } catch (err) {
      API.error(err);
    }
  }

  async function previewAllRows(rfqId, allRows) {
    var CHUNK_SIZE = 500;
    var totalSummary = { total: 0, new: 0, exact_duplicate: 0, changed_same_key: 0, weak_key: 0 };
    var allPreviewRows = [];
    for (var i = 0; i < allRows.length; i += CHUNK_SIZE) {
      var chunk = allRows.slice(i, i + CHUNK_SIZE);
      var data = await API.call('previewImportRows', { rfqId: rfqId, rows: chunk });
      var s = data.summary || {};
      totalSummary.total += Number(s.total || 0);
      totalSummary.new += Number(s.new || 0);
      totalSummary.exact_duplicate += Number(s.exact_duplicate || 0);
      totalSummary.changed_same_key += Number(s.changed_same_key || 0);
      totalSummary.weak_key += Number(s.weak_key || 0);
      if (Array.isArray(data.rows)) allPreviewRows = allPreviewRows.concat(data.rows);
    }
    return { summary: totalSummary, rows: allPreviewRows };
  }

  function renderImportPreview(area, rfqId, ownerKey, templateId, allRows, preview, mapping) {
    if (!area) return;
    importMapState._pendingRfqId = rfqId;
    importMapState._pendingOwnerKey = ownerKey;
    importMapState._pendingTemplateId = templateId;
    importMapState._pendingAllRows = allRows;
    importMapState._pendingMapping = mapping || {};

    var s = preview.summary || {};
    var allDupe = s.total > 0 && s.exact_duplicate === s.total;
    var warnHtml = allDupe
      ? '<p style="color:var(--primary);font-weight:600;margin:4px 0">⚠ File này có vẻ đã import rồi — toàn bộ ' + s.total + ' dòng đều trùng khớp chính xác.</p>'
      : '';

    var badgeStyle = 'display:inline-block;padding:1px 7px;border-radius:10px;font-size:12px;margin:0 2px;';
    var summaryHtml = '<div style="margin-bottom:8px">'
      + '<span style="' + badgeStyle + 'background:var(--green);color:#fff">' + (s.new || 0) + ' mới</span>'
      + '<span style="' + badgeStyle + 'background:var(--blue);color:#fff">' + (s.changed_same_key || 0) + ' thay đổi</span>'
      + '<span style="' + badgeStyle + 'background:var(--text-muted);color:#fff">' + (s.exact_duplicate || 0) + ' trùng y chang</span>'
      + (s.weak_key ? '<span style="' + badgeStyle + 'background:var(--primary);color:#fff">' + s.weak_key + ' thiếu key</span>' : '')
      + '</div>';

    // Build overwrite checkboxes from currently mapped target fields
    var mappedTargets = Object.values(mapping || {});
    var uniqueTargets = mappedTargets.filter(function (f, i) { return f && mappedTargets.indexOf(f) === i && f !== 'rfq_item_id'; });
    var overwriteCheckboxHtml = uniqueTargets.length
      ? '<div id="importOverwriteSection" style="display:none;border:1px solid var(--border-mid);border-radius:6px;padding:8px 12px;margin-top:8px">'
        + '<p style="margin:0 0 8px;font-size:12px;font-weight:600">Chọn trường cần cập nhật (dòng đã tồn tại):</p>'
        + '<div style="display:flex;flex-wrap:wrap;gap:5px 16px">'
        + uniqueTargets.map(function (f) {
            var isSensitive = IMPORT_SENSITIVE_FIELDS.has(f);
            var isFinal = IMPORT_FINAL_FIELDS.has(f);
            var defaultChecked = !isSensitive && !isFinal;
            var label = (IMPORT_TARGET_FIELDS.find(function (p) { return p[0] === f; }) || ['', f])[1];
            var hint = isSensitive ? ' <span style="color:var(--text-faint);font-size:10px">(nhận dạng)</span>'
                     : isFinal    ? ' <span style="color:var(--text-faint);font-size:10px">(final)</span>' : '';
            return '<label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">'
              + '<input type="checkbox" name="overwriteField" value="' + API.esc(f) + '"' + (defaultChecked ? ' checked' : '') + '>'
              + API.esc(label) + hint + '</label>';
          }).join('')
        + '</div></div>'
      : '';

    var defMode = importMapState._defaultMode || 'update_changed';
    var modeHtml = '<fieldset style="border:1px solid var(--border-mid);border-radius:6px;padding:8px 12px;margin-bottom:6px">'
      + '<legend style="font-size:12px;padding:0 4px">Chọn chế độ import</legend>'
      + '<label style="display:block;margin:4px 0"><input type="radio" name="importMode" value="update_changed"' + (defMode === 'update_changed' ? ' checked' : '') + ' onchange="RfqItemsModule._onImportModeChange(this)"> <strong>Upload DS vật tư</strong> — thêm dòng mới, cập nhật dòng đã có (tất cả trường được map)</label>'
      + '<label style="display:block;margin:4px 0"><input type="radio" name="importMode" value="selective_update"' + (defMode === 'selective_update' ? ' checked' : '') + ' onchange="RfqItemsModule._onImportModeChange(this)"> <strong>Cập nhật có chọn lọc</strong> — chỉ cập nhật trường được chọn bên dưới</label>'
      + '<label style="display:block;margin:4px 0"><input type="radio" name="importMode" value="clear_and_reimport"' + (defMode === 'clear_and_reimport' ? ' checked' : '') + ' onchange="RfqItemsModule._onImportModeChange(this)"> <strong>Xóa toàn bộ &amp; Import lại</strong> — xóa hết dòng vật tư của RFQ rồi nhập lại từ đầu</label>'
      + '</fieldset>'
      + overwriteCheckboxHtml;

    var previewRows = preview.rows || [];
    var rowsHtml = '';
    if (previewRows.length) {
      var statusLabel = { new: 'Mới', exact_duplicate: 'Trùng y chang', changed_same_key: 'Có thay đổi', weak_key: 'Thiếu key' };
      var statusColor = { new: 'var(--green)', exact_duplicate: 'var(--text-muted)', changed_same_key: 'var(--blue)', weak_key: 'var(--primary)' };
      rowsHtml = '<details style="margin-bottom:10px;margin-top:8px"><summary style="cursor:pointer;font-size:13px">Chi tiết từng dòng (' + previewRows.length + ')</summary>'
        + '<div style="max-height:200px;overflow-y:auto;margin-top:6px">'
        + '<table style="width:100%;font-size:12px;border-collapse:collapse">'
        + '<thead><tr><th style="text-align:left;padding:2px 4px">Dòng</th><th style="text-align:left;padding:2px 4px">STT</th><th style="text-align:left;padding:2px 4px">Mã vật tư</th><th style="text-align:left;padding:2px 4px">Tên vật tư</th><th style="padding:2px 4px">Trạng thái</th></tr></thead>'
        + '<tbody>'
        + previewRows.slice(0, 200).map(function (r) {
            var col = statusColor[r.status] || 'inherit';
            var lbl = statusLabel[r.status] || r.status;
            var changed = r.changedFields && r.changedFields.length ? ' <small style="color:var(--text-muted)">(' + r.changedFields.join(', ') + ')</small>' : '';
            return '<tr><td style="padding:2px 4px">' + API.esc(r.sourceRowNumber) + '</td>'
              + '<td style="padding:2px 4px">' + API.esc(r.stt || '') + '</td>'
              + '<td style="padding:2px 4px">' + API.esc(r.ma_vat_tu || '') + '</td>'
              + '<td style="padding:2px 4px">' + API.esc(r.ten_vat_tu || '') + '</td>'
              + '<td style="padding:2px 4px;color:' + col + ';white-space:nowrap">' + API.esc(lbl) + changed + '</td></tr>';
          }).join('')
        + '</tbody></table></div></details>';
    }

    var btnHtml = '<div style="display:flex;gap:8px;margin-top:8px">'
      + '<button type="button" class="primary" onclick="RfqItemsModule._doCommitImport()">Xác nhận import</button>'
      + '<button type="button" onclick="RfqItemsModule._cancelImport()">Huỷ</button>'
      + '</div>';

    var existing = area.firstElementChild;
    if (existing && existing.tagName === 'P' && existing.textContent.indexOf('Đang kiểm tra') >= 0) existing.remove();

    var wrapper = document.createElement('div');
    wrapper.id = 'importPreviewPanel';
    wrapper.style.cssText = 'border:1px solid var(--border-mid);border-radius:8px;padding:12px;margin-bottom:12px;background:var(--bg-card,var(--bg))';
    wrapper.innerHTML = '<p style="margin:0 0 6px;font-weight:600">Xem trước import — ' + API.esc(importMapState.fileName || '') + '</p>'
      + warnHtml + summaryHtml + modeHtml + rowsHtml + btnHtml;
    area.insertBefore(wrapper, area.firstChild);
    if (defMode !== 'update_changed') {
      var preSelectedRadio = wrapper.querySelector('input[name="importMode"][value="' + defMode + '"]');
      if (preSelectedRadio) _onImportModeChange(preSelectedRadio);
    }
  }

  function _onImportModeChange(radio) {
    var section = document.getElementById('importOverwriteSection');
    if (section) section.style.display = radio && radio.value === 'selective_update' ? '' : 'none';
  }

  async function _doCommitImport() {
    var btn = document.querySelector('#importPreviewPanel button.primary');
    if (btn) btn.disabled = true;
    var rfqId = importMapState._pendingRfqId;
    var ownerKey = importMapState._pendingOwnerKey;
    var templateId = importMapState._pendingTemplateId;
    var allRows = importMapState._pendingAllRows;
    if (!rfqId || !allRows || !allRows.length) { API.toast('Không có dữ liệu pending', 'warn'); if (btn) btn.disabled = false; return; }

    var modeEl = document.querySelector('#importPreviewPanel input[name="importMode"]:checked');
    var importMode = modeEl ? modeEl.value : 'update_changed';

    // Collect overwrite fields for selective_update mode
    var overwriteFields = [];
    if (importMode === 'selective_update') {
      document.querySelectorAll('#importOverwriteSection input[name="overwriteField"]:checked').forEach(function (cb) {
        overwriteFields.push(cb.value);
      });
      if (!overwriteFields.length) {
        API.toast('Chọn ít nhất 1 trường cần cập nhật', 'warn');
        if (btn) btn.disabled = false;
        return;
      }
    }

    // Mode C: safety check before proceeding
    if (importMode === 'clear_and_reimport') {
      var confirmed = await _checkAndConfirmModeC(rfqId, allRows);
      if (!confirmed) { if (btn) btn.disabled = false; return; }
    }

    var area = document.getElementById('importMapArea');
    if (area) area.insertAdjacentHTML('afterbegin', '<p style="color:var(--text-muted)">Đang commit import...</p>');
    try {
      var data = await commitInChunks(rfqId, ownerKey, templateId, importMapState.fileName, importMapState.sheetName || 'csv', allRows, importMode, overwriteFields);
      var panel = document.getElementById('importPreviewPanel');
      if (panel) panel.remove();
      renderImportResult(data.summary || {});
      await load(true);
      if (typeof RfqsModule !== 'undefined') await RfqsModule.load(true);
    } catch (err) {
      API.error(err);
      if (btn) btn.disabled = false;
    }
  }

  async function _checkAndConfirmModeC(rfqId, allRows) {
    var counts;
    try {
      var safeData = await API.call('checkRfqImportSafety', { rfqId: rfqId });
      counts = safeData.counts || {};
    } catch (e) {
      API.toast('Không thể kiểm tra dữ liệu liên quan: ' + (e.message || e), 'error');
      return false;
    }

    var hasContracts = Number(counts.contractCount || 0) > 0;
    var hasClarOrQuotes = Number(counts.clarificationCount || 0) > 0 || Number(counts.quoteCount || 0) > 0 || Number(counts.pricingCount || 0) > 0;

    if (hasContracts) {
      // Case 3: has contract items — require typed confirmation
      var typed = await Utils.confirmTyping(
        'Cảnh báo nghiêm trọng: RFQ đã có hợp đồng',
        'RFQ này có ' + Number(counts.contractCount) + ' vật tư đã phát sinh hợp đồng. Xóa toàn bộ danh sách vật tư sẽ xóa cả dữ liệu hợp đồng liên quan và không thể hoàn tác. Gõ XOA_TOAN_BO_RFQ_ITEMS để xác nhận.',
        'XOA_TOAN_BO_RFQ_ITEMS'
      );
      return typed === true;
    }

    if (hasClarOrQuotes) {
      // Case 2: has clarifications or quotes — strong warning
      return await Utils.confirmDanger(
        'Cảnh báo: RFQ đã có dữ liệu liên quan',
        'RFQ này đã phát sinh dữ liệu nghiệp vụ như clarification kỹ thuật, báo giá NCC hoặc quyết định cân giá. Nếu tiếp tục, các dữ liệu liên quan hiện có sẽ bị xóa cùng danh sách vật tư. Khuyến nghị sử dụng "Cập nhật có chọn lọc" nếu chỉ cần sửa một số cột. Bạn vẫn muốn xóa toàn bộ và import lại từ đầu?',
        'Vẫn xóa và import lại',
        'Quay lại'
      );
    }

    // Case 1: no linked data — simple confirm
    return await Utils.confirmDanger(
      'Xác nhận xóa toàn bộ & import lại',
      'RFQ này chưa có dữ liệu liên kết. Hệ thống sẽ xóa toàn bộ danh sách vật tư hiện tại và import lại từ file đang chọn. Thao tác này không thể hoàn tác.',
      'Xóa và import lại',
      'Hủy'
    );
  }

  function _cancelImport() {
    var panel = document.getElementById('importPreviewPanel');
    if (panel) panel.remove();
    // Clear the "Đang kiểm tra..." message if still present
    var area = document.getElementById('importMapArea');
    if (area) {
      var p = area.firstElementChild;
      if (p && p.tagName === 'P' && p.textContent.indexOf('Đang kiểm tra') >= 0) p.remove();
    }
  }

  async function commitInChunks(rfqId, ownerKey, templateId, sourceFileName, sourceSheetName, allRows, importMode, overwriteFields) {
    var CHUNK_SIZE = 500;
    var totalCreated = 0, totalUpdated = 0, totalSkipped = 0, totalErrors = 0;
    var allRowErrors = [];
    var lastJobId = '';
    for (var i = 0; i < allRows.length; i += CHUNK_SIZE) {
      var chunk = allRows.slice(i, i + CHUNK_SIZE);
      var payload = {
        rfqId: rfqId,
        ownerKey: ownerKey,
        templateId: templateId,
        sourceFileName: sourceFileName,
        sourceSheetName: sourceSheetName,
        importMode: importMode || 'update_changed',
        rows: chunk,
      };
      if (overwriteFields && overwriteFields.length) payload.overwriteFields = overwriteFields;
      if (importMode === 'clear_and_reimport' && i === 0) payload.clearBeforeImport = true;
      var data = await API.call('commitImportRows', payload);
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
      if (!payload.rfqId) payload.rfqId = _selectedRfqId;
      if (!payload.rfqId) { errs.push('Dòng ' + rowNum + ': Thiếu rfqId'); continue; }
      if (!payload.tenVatTu) { errs.push('Dòng ' + rowNum + ': Thiếu Tên vật tư'); continue; }
      var action = payload.rfqItemId ? 'updateRfqItem' : 'createRfqItem';
      payload.silent = true; // suppress per-row audit; importCsv logs its own summary via commitImportRows
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
    var importRfqId = _selectedRfqId;
    // log one summary audit entry to replace the suppressed per-row entries
    if (importRfqId && (ok > 0 || errs.length > 0)) {
      var _rfqRowForLog = (AppState.list('rfqs').rows || []).find(function (r) { return r.rfq_id === importRfqId; });
      API.call('logRfqItemImportSummary', {
        rfqId: importRfqId,
        rfqName: _rfqRowForLog ? (_rfqRowForLog.ten_goi || '') : '',
        created: ok,
        updated: 0,
        errors: errs.length,
      }).catch(function () {});
    }
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

  var _topScrollLock = false;
  function syncTopScroll() {
    var top = document.getElementById('itemsTopScroll');
    if (!top) return;
    var wrap = top.nextElementSibling;
    if (!wrap) return;
    var inner = top.firstElementChild;
    if (!inner) return;
    inner.style.width = wrap.scrollWidth + 'px';
    top.onscroll = function () {
      if (_topScrollLock) return;
      _topScrollLock = true;
      wrap.scrollLeft = top.scrollLeft;
      _topScrollLock = false;
    };
    wrap.onscroll = function () {
      if (_topScrollLock) return;
      _topScrollLock = true;
      top.scrollLeft = wrap.scrollLeft;
      _topScrollLock = false;
    };
  }

  window.RfqItemsModule = {
    load: load,
    openCreate: openCreate,
    openEdit: openEdit,
    openClarificationForm: openClarificationForm,
    openClarificationTimeline: openClarificationTimeline,
    openQuoteForm: openQuoteForm,
    archiveQuote: archiveQuote,
    deleteQuote: deleteQuote,
    openPricingForm: openPricingForm,
    refreshMasterItem: refreshMasterItem,
    createMasterFromRfqItem: createMasterFromRfqItem,
    linkMasterItem: linkMasterItem,
    unlinkMasterItem: unlinkMasterItem,
    searchMasterItemsForLink: searchMasterItemsForLink,
    uploadMediaFile: uploadMediaFile,
    openMediaPreview: openMediaPreview,
    openMediaPreviewAt: openMediaPreviewAt,
    _prevImage: _prevImage,
    _nextImage: _nextImage,
    downloadTemplate: downloadTemplate,
    exportCsv: exportCsv,
    openExportMenu: openExportMenu,
    openExcelMenu: openExcelMenu,
    toggleExportColPanel: toggleExportColPanel,
    _exportColAll: _exportColAll,
    importCsv: importCsv,
    openImportMapping: openImportMapping,
    _onCsvFileChange: _onCsvFileChange,
    _onImportMapFileChange: _onImportMapFileChange,
    _onImportMapSheetChange: _onImportMapSheetChange,
    loadImportTemplates: loadImportTemplates,
    applyImportTemplate: applyImportTemplate,
    saveImportTemplate: saveImportTemplate,
    commitImportMapping: commitImportMapping,
    _doCommitImport: _doCommitImport,
    _cancelImport: _cancelImport,
    _onImportModeChange: _onImportModeChange,
    _checkAndConfirmModeC: _checkAndConfirmModeC,
    _commitSimpleUpdate: _commitSimpleUpdate,
    filterByRfq: filterByRfq,
    loadPriceHistory: loadPriceHistory,
    exportPriceHistory: exportPriceHistory,
    loadContractItems: loadContractItems,
    openContractFromRfqItemModal: openContractFromRfqItemModal,
    openRevisionHistory: openRevisionHistory,
    archiveRfqItem: archiveRfqItem,
    toggleSelectAll: toggleSelectAll,
    onCheckChange: onCheckChange,
    deleteSelected: deleteSelected,
    deleteAll: deleteAll,
    quickEditBadge: quickEditBadge,
    _togglePicker: togglePicker,
    _pickOption: pickOption,
    _onRfqInput: _onRfqInput,
    _onRfqKeydown: _onRfqKeydown,
    _selectRfq: _selectRfq,
    _clarPickRecent: _clarPickRecent,
    _clarUrlShowRecent: _clarUrlShowRecent,
    _clarUrlHide: _clarUrlHide,
    _clarPickUrl: _clarPickUrl,
    _onSupplierInput: _onSupplierInput,
    _selectSupplier: _selectSupplier,
    val: val,
    quotesSummaryCell: quotesSummaryCell,
    technicalSummary: technicalSummary,
  };
})();
