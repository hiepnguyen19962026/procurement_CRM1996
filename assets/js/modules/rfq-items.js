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
  var _rfqAutocompleteRows = [];
  var _rfqAutocompleteInit = false;
  var _rfqAutocompleteTimer = null;
  var _rfqAutocompleteSeq = 0;
  var _exportColPanelInit = false;
  var _lastFilterParams = {};
  var _addendumSearchRows = [];
  var contractItemRowCache = {};
  var contractAddendumCache = {};
  var contractAddendumItemCache = {};
  var deliveryStatusFilters = {};
  var deadlineStatusFilters = {};
  var _donWorkflowState = null;
  var _beItems = [];
  var DELIVERY_SORT_KEYS = {
    delivered_quantity_total: true,
    remaining_quantity: true,
  };

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
      var deliveryWrap = document.querySelector('#screen-items .delivery-filter-wrap');
      if (deliveryWrap && !deliveryWrap.contains(e.target)) closeDeliveryFilterMenu();
      var deadlineWrap = document.querySelector('#screen-items .deadline-filter-wrap');
      if (deadlineWrap && !deadlineWrap.contains(e.target)) closeDeadlineFilterMenu();
    });
    window.addEventListener('resize', syncTopScroll);
  }

  async function initRfqAutocomplete() {
    if (!_rfqAutocompleteInit) {
      _rfqAutocompleteInit = true;
    }
    var pending = _pendingRfqFilter;
    if (pending) {
      _pendingRfqFilter = '';
      var rfqRow = null;
      try {
        var data = await API.get('getRfqs', { q: pending, limit: 20, autocomplete: '1' });
        _rfqAutocompleteRows = data.rows || [];
        rfqRow = _rfqAutocompleteRows.find(function (r) { return r.rfq_id === pending; }) || null;
      } catch (e) { /* keep the RFQ ID as fallback label */ }
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
    clearTimeout(_rfqAutocompleteTimer);
    _rfqAutocompleteSeq++;
    var sug = document.getElementById('itemRfqSuggestions');
    if (sug) { sug.innerHTML = ''; sug.classList.add('hidden'); }
  }

  function _renderRfqSuggestions(rows) {
    var sug = document.getElementById('itemRfqSuggestions');
    if (!sug) return;
    if (!rows.length) {
      sug.innerHTML = '<div class="rfq-sug-item" style="color:var(--text-muted)">Không tìm thấy</div>';
    } else {
      sug.innerHTML = rows.map(function (r) {
        var lbl = _rfqLabel(r);
        return '<div class="rfq-sug-item" onmousedown="RfqItemsModule._selectRfq(\'' + r.rfq_id.replace(/'/g, "\\'") + '\',\'' + lbl.replace(/'/g, "\\'") + '\')">' + API.esc(lbl) + '</div>';
      }).join('');
    }
    sug.classList.remove('hidden');
  }

  async function _searchRfqSuggestions(q, seq) {
    var sug = document.getElementById('itemRfqSuggestions');
    if (!sug) return;
    sug.innerHTML = '<div class="rfq-sug-item" style="color:var(--text-muted)">Đang tải...</div>';
    sug.classList.remove('hidden');
    try {
      var data = await API.get('getRfqs', { q: q, limit: 20, autocomplete: '1' });
      if (seq !== _rfqAutocompleteSeq) return;
      _rfqAutocompleteRows = data.rows || [];
      _renderRfqSuggestions(_rfqAutocompleteRows);
    } catch (err) {
      if (seq !== _rfqAutocompleteSeq) return;
      sug.innerHTML = '<div class="rfq-sug-item" style="color:var(--red)">Không tải được danh sách RFQ</div>';
      sug.classList.remove('hidden');
    }
  }

  function _queueRfqSearch(el) {
    clearTimeout(_rfqAutocompleteTimer);
    var q = (el && el.value || '').trim();
    var seq = ++_rfqAutocompleteSeq;
    _rfqAutocompleteTimer = setTimeout(function () {
      _searchRfqSuggestions(q, seq);
    }, 275);
  }

  function _onRfqInput(el) {
    _selectedRfqId = '';
    _queueRfqSearch(el);
  }

  function _onRfqFocus(el) {
    _queueRfqSearch(el);
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
        if (isDeliverySortKey(key)) render();
        else load(true);
      };
    });
  }

  function isDeliverySortKey(key) {
    return !!DELIVERY_SORT_KEYS[key];
  }

  function selectedDeliveryStatuses() {
    return Object.keys(deliveryStatusFilters).filter(function (key) { return deliveryStatusFilters[key]; });
  }

  function syncDeliveryFilterLabel() {
    var btn = document.getElementById('itemDeliveryFilterBtn');
    if (!btn) return;
    var count = selectedDeliveryStatuses().length;
    btn.textContent = count ? ('Giao hàng (' + count + ') ▼') : 'Giao hàng ▼';
  }

  function toggleDeliveryFilterMenu() {
    var menu = document.getElementById('itemDeliveryFilterMenu');
    if (!menu) return;
    menu.classList.toggle('hidden');
  }

  function closeDeliveryFilterMenu() {
    var menu = document.getElementById('itemDeliveryFilterMenu');
    if (menu) menu.classList.add('hidden');
  }

  function onDeliveryFilterChange(cb) {
    if (!cb) return;
    deliveryStatusFilters[cb.value] = !!cb.checked;
    syncDeliveryFilterLabel();
    render();
  }

  function selectedDeadlineStatuses() {
    return Object.keys(deadlineStatusFilters).filter(function (key) { return deadlineStatusFilters[key]; });
  }

  function syncDeadlineFilterLabel() {
    var btn = document.getElementById('itemDeadlineFilterBtn');
    if (!btn) return;
    var count = selectedDeadlineStatuses().length;
    btn.textContent = count ? ('Deadline (' + count + ') ▼') : 'Deadline ▼';
  }

  function toggleDeadlineFilterMenu() {
    var menu = document.getElementById('itemDeadlineFilterMenu');
    if (!menu) return;
    menu.classList.toggle('hidden');
  }

  function closeDeadlineFilterMenu() {
    var menu = document.getElementById('itemDeadlineFilterMenu');
    if (menu) menu.classList.add('hidden');
  }

  function onDeadlineFilterChange(cb) {
    if (!cb) return;
    deadlineStatusFilters[cb.value] = !!cb.checked;
    syncDeadlineFilterLabel();
    render();
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
        limit = known > 0 ? known + 50 : 25000;
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
      if (sort.by && !isDeliverySortKey(sort.by)) { params.sortBy = sort.by; params.sortDir = sort.dir; }
      _lastFilterParams = {
        q: params.q, q2: params.q2, q3: params.q3,
        rfqId: params.rfqId, status: params.status, techFilter: params.techFilter,
        sortBy: isDeliverySortKey(sort.by) ? '' : (sort.by || ''), sortDir: sort.dir || '',
      };
      var data = await API.get('getRfqItems', params);
      if (hasKeywordSearch()) {
        var addendumData = await API.get('searchContractAddendumItems', {
          q: state.q,
          q2: state.q2,
          q3: state.q3,
          rfqId: _selectedRfqId,
          limit: 50,
        });
        _addendumSearchRows = addendumData.rows || [];
      } else {
        _addendumSearchRows = [];
      }
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
    syncDeliveryFilterLabel();
    syncDeadlineFilterLabel();
    var baseRows = state.rows || [];
    var rows = sortDeliveryRows(filterDeadlineRows(filterDeliveryRows(baseRows)));
    renderAddendumSearchResults();
    var rfqFilter = _selectedRfqId;
    if (!baseRows.length && rfqFilter) {
      var rfqMeta = (AppState.list('rfqs').rows || []).find(function (r) { return r.rfq_id === rfqFilter; }) || null;
      var rfqInfo = rfqMeta
        ? '<div style="margin-bottom:14px;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:13px;text-align:left">'
          + '<div style="font-weight:600;margin-bottom:4px">' + API.esc(rfqMeta.rfq_id) + '</div>'
          + (rfqMeta.ten_goi ? '<div style="color:var(--text-muted)">Tên gói: <span style="color:var(--text)">' + API.esc(rfqMeta.ten_goi) + '</span></div>' : '')
          + ((rfqMeta.client_name || rfqMeta.nha_may_cdt) ? '<div style="color:var(--text-muted)">CĐT: <span style="color:var(--text)">' + API.esc(rfqMeta.client_name || rfqMeta.nha_may_cdt) + '</span></div>' : '')
          + '</div>'
        : '<div style="margin-bottom:10px;font-size:13px;color:var(--text-muted);text-align:left">RFQ: <strong>' + API.esc(rfqFilter) + '</strong></div>';
      document.getElementById('itemRows').innerHTML = '<tr><td colspan="38" style="padding:0;border:0">'
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
    if (baseRows.length && !rows.length) {
      document.getElementById('itemRows').innerHTML = '<tr><td colspan="38" style="text-align:center;color:var(--text-muted);padding:18px">Không có dòng vật tư phù hợp.</td></tr>';
      document.getElementById('itemMore').classList.toggle('hidden', !state.hasMore);
      Auth.applyRoleUI();
      var noMatchSelectAll = document.getElementById('itemSelectAll');
      if (noMatchSelectAll) noMatchSelectAll.checked = false;
      var noMatchDelSelBtn = document.getElementById('itemDeleteSelected');
      if (noMatchDelSelBtn) noMatchDelSelBtn.classList.add('hidden');
      var noMatchDelCnt = document.getElementById('itemDeleteCount');
      if (noMatchDelCnt) noMatchDelCnt.textContent = '0';
      var noMatchDeliveryBtn = document.getElementById('itemCreateDeliverySelected');
      if (noMatchDeliveryBtn) noMatchDeliveryBtn.classList.add('hidden');
      var noMatchDeliveryCnt = document.getElementById('itemDeliveryCount');
      if (noMatchDeliveryCnt) noMatchDeliveryCnt.textContent = '0';
      var noMatchBulkEditBtn = document.getElementById('itemBulkEditSelected');
      if (noMatchBulkEditBtn) noMatchBulkEditBtn.classList.add('hidden');
      var noMatchBulkEditCnt = document.getElementById('itemBulkEditCount');
      if (noMatchBulkEditCnt) noMatchBulkEditCnt.textContent = '0';
      updateCountInfo();
      syncTopScroll();
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
      var _baseQty = toQty(r.contract_quantity_total) || toQty(r.so_luong) || toQty(r.quantity) || 0;
      var _itemRemaining = Math.max(_baseQty - (toQty(r.delivered_quantity_total) || 0), 0);
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
        + renderCell(formatQty(r.delivered_quantity_total), false)
        + renderCell(formatQty(_itemRemaining), false)
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
        + renderCell(formatQty(r.delivered_quantity_total), false)
        + renderCell(formatQty(_itemRemaining), false)
        + deadlineCell(r)
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
    var deliveryBtn = document.getElementById('itemCreateDeliverySelected');
    if (deliveryBtn) deliveryBtn.classList.add('hidden');
    var deliveryCnt = document.getElementById('itemDeliveryCount');
    if (deliveryCnt) deliveryCnt.textContent = '0';
    var bulkEditBtn = document.getElementById('itemBulkEditSelected');
    if (bulkEditBtn) bulkEditBtn.classList.add('hidden');
    var bulkEditCnt = document.getElementById('itemBulkEditCount');
    if (bulkEditCnt) bulkEditCnt.textContent = '0';
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

  function _getSelectedItems() {
    var ids = _getSelectedItemIds();
    return ids.map(function (id) {
      return (state.rows || []).find(function (r) { return r.rfq_item_id === id; });
    }).filter(Boolean);
  }

  function todayYmd() {
    return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  function toQty(value) {
    var n = Number(String(value == null ? '' : value).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  }

  function formatQty(value) {
    var n = toQty(value);
    if (!n) return '';
    return n.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
  }

  function deadlineCell(row) {
    if (toQty(row.remaining_quantity) <= 0) return '<td class="muted-cell" style="text-align:center">-</td>';
    var date = row.delivery_deadline_date || '';
    if (!date || row.delivery_deadline_status === 'no_deadline') {
      return '<td class="muted-cell" style="text-align:center">chưa có</td>';
    }
    var days = Number(row.delivery_deadline_days_left);
    var note = '';
    if (Number.isFinite(days)) {
      note = days < 0
        ? '<div class="muted" style="font-size:11px;color:var(--red)">trễ ' + Math.abs(days) + ' ngày</div>'
        : '<div class="muted" style="font-size:11px">còn ' + days + ' ngày</div>';
    }
    return '<td style="text-align:center;white-space:nowrap">' + API.esc(date) + note + '</td>';
  }

  function matchesDeliveryStatus(row, key) {
    var contractQty = toQty(row.contract_quantity_total);
    var deliveredQty = toQty(row.delivered_quantity_total);
    var remainingQty = toQty(row.remaining_quantity);
    if (key === 'not_delivered') return deliveredQty <= 0;
    if (key === 'partial') return remainingQty > 0;
    if (key === 'complete') return contractQty > 0 && remainingQty <= 0 && deliveredQty <= contractQty;
    if (key === 'over') return contractQty > 0 && deliveredQty > contractQty;
    return false;
  }

  function matchesDeadlineStatus(row, key) {
    if (toQty(row.remaining_quantity) <= 0) return false;
    var status = row.delivery_deadline_status || '';
    if (key === 'due_7') return status === 'due_7';
    if (key === 'due_15') return status === 'due_7' || status === 'due_15';
    if (key === 'due_30') return status === 'due_7' || status === 'due_15' || status === 'due_30';
    if (key === 'overdue') return status === 'overdue';
    if (key === 'no_deadline') return status === 'no_deadline';
    return false;
  }

  function filterDeliveryRows(rows) {
    var filters = selectedDeliveryStatuses();
    if (!filters.length) return rows;
    return rows.filter(function (row) {
      return filters.some(function (key) { return matchesDeliveryStatus(row, key); });
    });
  }

  function filterDeadlineRows(rows) {
    var filters = selectedDeadlineStatuses();
    if (!filters.length) return rows;
    return rows.filter(function (row) {
      return filters.some(function (key) { return matchesDeadlineStatus(row, key); });
    });
  }

  function sortDeliveryRows(rows) {
    if (!isDeliverySortKey(sort.by)) return rows;
    var dir = sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var av = toQty(a[sort.by]);
      var bv = toQty(b[sort.by]);
      if (av === bv) return String(a.rfq_item_id || '').localeCompare(String(b.rfq_item_id || ''));
      return (av - bv) * dir;
    });
  }

  function confirmDeliveryChoice(title, message, yesLabel, noLabel) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = '<div class="confirm-box">'
        + '<div class="confirm-title">' + API.esc(title) + '</div>'
        + '<p class="confirm-desc">' + API.esc(message) + '</p>'
        + '<div class="confirm-actions">'
        + '<button type="button" class="btn-cancel">' + API.esc(noLabel || 'Không') + '</button>'
        + '<button type="button" class="primary">' + API.esc(yesLabel || 'Có') + '</button>'
        + '</div></div>';
      document.body.appendChild(overlay);
      function done(result) { document.body.removeChild(overlay); resolve(result); }
      overlay.querySelector('.primary').onclick = function () { done(true); };
      overlay.querySelector('.btn-cancel').onclick = function () { done(false); };
    });
  }

  async function openCreateDeliveryForSelected() {
    var items = _getSelectedItems();
    if (!items.length) { API.toast('Chọn ít nhất 1 dòng vật tư để tạo đơn giao hàng', 'warn'); return; }
    if (!Utils.roleCanWrite()) { API.toast('Không có quyền tạo đơn giao hàng', 'error'); return; }
    var rfqIds = Array.from(new Set(items.map(function (r) { return r.rfq_id || ''; }).filter(Boolean)));
    if (rfqIds.length !== 1) {
      API.toast('Chỉ tạo đơn giao hàng cho các dòng trong cùng một RFQ', 'warn');
      return;
    }
    var edit = await confirmDeliveryChoice(
      'Tạo đơn giao hàng',
      'Có thay đổi số lượng giao hàng không?',
      'Có',
      'Không'
    );
    if (!edit) {
      await submitDeliveryNote(items, items.map(function (r) {
        return { rfqItemId: r.rfq_item_id, deliveredQuantity: toQty(r.remaining_quantity) };
      }));
      return;
    }
    openDeliveryQuantityModal(items);
  }

  function deliveryQuantityTable(items) {
    var today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    function dlCell(d) {
      if (!d) return '<span style="color:var(--text-faint)">—</span>';
      var diff = Math.round((new Date(d + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
      return API.esc(d)
        + (Number.isFinite(diff)
            ? '<div style="font-size:10px;color:' + (diff < 0 ? 'var(--red)' : 'var(--text-muted)') + '">'
              + (diff < 0 ? 'Trễ ' + Math.abs(diff) + ' ng' : 'Còn ' + diff + ' ng') + '</div>'
            : '');
    }
    var th = 'style="font-size:11px;padding:4px 6px;white-space:nowrap;text-align:center"';
    var thead = '<thead><tr>'
      + '<th ' + th + '>STT</th>'
      + '<th ' + th + '>Mã vật tư</th>'
      + '<th ' + th + ' style="min-width:150px;text-align:left">Tên vật tư</th>'
      + '<th ' + th + ' style="min-width:110px;text-align:left">Quy cách / Model</th>'
      + '<th ' + th + ' style="min-width:90px;text-align:left">Hãng / NSX</th>'
      + '<th ' + th + ' style="min-width:100px;text-align:left">Thông số KT</th>'
      + '<th ' + th + ' style="min-width:80px;text-align:left">Vật liệu</th>'
      + '<th ' + th + '>ĐVT</th>'
      + '<th ' + th + '>SL HĐ</th>'
      + '<th ' + th + '>Đơn giá</th>'
      + '<th ' + th + ' style="min-width:90px">Deadline giao</th>'
      + '<th ' + th + '>Đã giao LK</th>'
      + '<th ' + th + '>Còn lại</th>'
      + '<th ' + th + ' style="min-width:90px">SL giao lần này</th>'
      + '<th ' + th + ' style="min-width:120px;text-align:left">Làm rõ</th>'
      + '<th ' + th + ' style="min-width:120px;text-align:left">Ghi chú dòng</th>'
      + '</tr></thead>';
    var stt = 0;
    var tbody = '<tbody>'
      + items.map(function (r) {
          stt++;
          var _baseQty = toQty(r.contract_quantity_total) || toQty(r.so_luong) || toQty(r.quantity) || 0;
          var remaining = Math.max(_baseQty - (toQty(r.delivered_quantity_total) || 0), 0);
          var td  = 'style="font-size:12px;padding:3px 6px;vertical-align:middle"';
          var tdr = 'style="font-size:12px;padding:3px 6px;vertical-align:middle;text-align:right"';
          var tdc = 'style="font-size:12px;padding:3px 6px;vertical-align:middle;text-align:center"';
          var price = r.contract_unit_price ? API.money(r.contract_unit_price) : '—';
          return '<tr data-rfq-item-id="' + API.esc(r.rfq_item_id) + '">'
            + '<td ' + tdc + '>' + stt + '</td>'
            + '<td ' + td  + ' style="font-family:monospace;font-size:11px;padding:3px 6px;vertical-align:middle">' + API.esc(r.ma_vat_tu || '') + '</td>'
            + '<td ' + td  + '>' + API.esc(r.ten_vat_tu || '') + '</td>'
            + '<td ' + td  + ' style="font-size:11px;padding:3px 6px;vertical-align:middle">' + API.esc(r.quy_cach_final || val(r, 'required_model', 'quy_cach_model_yeu_cau') || '') + '</td>'
            + '<td ' + td  + ' style="font-size:11px;padding:3px 6px;vertical-align:middle">' + API.esc(r.hang_final || val(r, 'manufacturer', 'hang_goc_nsx_goc') || '') + '</td>'
            + '<td ' + td  + ' style="font-size:11px;padding:3px 6px;vertical-align:middle">' + API.esc(r.thong_so_ky_thuat || '') + '</td>'
            + '<td ' + td  + ' style="font-size:11px;padding:3px 6px;vertical-align:middle">' + API.esc(r.vat_lieu || '') + '</td>'
            + '<td ' + tdc + '>' + API.esc(val(r, 'unit', 'don_vi') || '') + '</td>'
            + '<td ' + tdr + '>' + API.esc(formatQty(_baseQty) || '0') + '</td>'
            + '<td ' + tdr + ' style="font-size:11px;text-align:right;padding:3px 6px;vertical-align:middle">' + price + '</td>'
            + '<td ' + tdc + '>' + dlCell(r.delivery_deadline_date) + '</td>'
            + '<td ' + tdr + '>' + API.esc(formatQty(r.delivered_quantity_total) || '0') + '</td>'
            + '<td ' + tdr + '><strong>' + API.esc(formatQty(remaining) || '0') + '</strong></td>'
            + '<td><input data-qty data-rfq-item-id="' + API.esc(r.rfq_item_id) + '" inputmode="decimal" value="' + API.esc(remaining) + '" style="width:90px;text-align:right;font-size:12px"></td>'
            + lamRoCell(r)
            + '<td><input data-line-note type="text" placeholder="(tùy chọn)" style="width:150px;font-size:12px"></td>'
            + '</tr>';
        }).join('')
      + '</tbody>';
    return '<div style="overflow:auto">'
      + '<table class="quotes-mini-table" style="width:100%;min-width:1600px;border-collapse:collapse">'
      + thead + tbody
      + '</table></div>';
  }

  function openDeliveryQuantityModal(items) {
    var html = '<div class="span-12" style="font-size:13px;color:var(--text-muted);margin-bottom:4px">'
      + 'Nhập số lượng giao cho từng dòng vật tư. Có thể để 0 nếu chưa giao dòng đó.'
      + '</div>' + deliveryQuantityTable(items);
    Utils.openModal('Tạo đơn giao hàng', html, async function () {
      var rows = [];
      var invalid = false;
      var over = false;
      Array.prototype.forEach.call(document.querySelectorAll('#modalBody input[data-rfq-item-id]'), function (inp) {
        var id = inp.getAttribute('data-rfq-item-id');
        var item = items.find(function (r) { return r.rfq_item_id === id; });
        var qty = toQty(inp.value);
        if (qty < 0) invalid = true;
        if (item && qty + toQty(item.delivered_quantity_total) > toQty(item.contract_quantity_total)) over = true;
        rows.push({ rfqItemId: id, deliveredQuantity: qty });
      });
      if (invalid) {
        API.toast('Số lượng giao phải lớn hơn hoặc bằng 0', 'warn');
        return;
      }
      if (over) {
        var ok = await confirmDeliveryChoice(
          'Cảnh báo số lượng giao hàng',
          'Số lượng giao vượt số lượng hợp đồng. Bạn có muốn tiếp tục?',
          'Có',
          'Không'
        );
        if (!ok) return;
      }
      await submitDeliveryNote(items, rows);
    });
  }

  async function submitDeliveryNote(items, rows) {
    if (!items.length) return;
    var rfqId = items[0].rfq_id || '';
    try {
      await API.call('createDeliveryNote', {
        rfqId: rfqId,
        deliveryDate: todayYmd(),
        items: rows,
      });
      Utils.closeModal();
      API.toast('Đã tạo đơn giao hàng cho ' + rows.length + ' dòng vật tư', 'success');
      await load(true);
    } catch (err) {
      API.error(err);
    }
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
      var cached = _rfqAutocompleteRows.find(function (r) { return r.rfq_id === _selectedRfqId; });
      rfqSeed = cached
        ? { rfq_id: cached.rfq_id, ma_goi_tbmt: cached.ma_goi_tbmt, ten_goi: cached.ten_goi, client_name: cached.client_name, trang_thai_goi: cached.trang_thai_goi }
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
    setTimeout(bindRfqItemTotalCalculator, 0);
    Auth.applyRoleUI();
  }

  function hasKeywordSearch() {
    return !!String(state.q || '').trim() || !!String(state.q2 || '').trim() || !!String(state.q3 || '').trim();
  }

  function ensureAddendumSearchContainer() {
    var el = document.getElementById('itemAddendumSearchResults');
    if (el) return el;
    var screen = document.getElementById('screen-items');
    if (!screen) return null;
    var topScroll = document.getElementById('itemsTopScroll');
    if (!topScroll || !topScroll.parentNode) return null;
    el = document.createElement('div');
    el.id = 'itemAddendumSearchResults';
    topScroll.parentNode.insertBefore(el, topScroll);
    return el;
  }

  function renderAddendumSearchResults() {
    var el = ensureAddendumSearchContainer();
    if (!el) return;
    if (!hasKeywordSearch()) {
      el.innerHTML = '';
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    var rows = _addendumSearchRows || [];
    if (!rows.length) {
      el.innerHTML = '<div class="muted" style="font-size:12px;margin:8px 0 10px">Không có dòng phụ lục phù hợp.</div>';
      return;
    }
    el.innerHTML = '<div style="margin:8px 0 12px;border:1px solid var(--border);border-radius:8px;background:#fff;overflow:hidden">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--bg);border-bottom:1px solid var(--border)">'
      + '<strong style="font-size:13px">Kết quả phụ lục hợp đồng</strong>'
      + '<span class="muted" style="font-size:12px">' + API.esc(rows.length) + ' dòng</span>'
      + '</div>'
      + '<div class="quotes-table-wrap">'
      + '<table class="quotes-mini-table" style="min-width:980px"><thead><tr>'
      + '<th>Nguồn</th><th>Nội dung / mã / quy cách</th><th>RFQ</th><th>Hợp đồng / Phụ lục</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th><th></th>'
      + '</tr></thead><tbody>'
      + rows.map(addendumSearchRow).join('')
      + '</tbody></table></div></div>';
    Auth.applyRoleUI();
  }

  function addendumSearchRow(r) {
    var rfqLabel = r.ma_goi_tbmt || r.rfq_id || '-';
    return '<tr>'
      + '<td><span class="badge">Phụ lục HĐ</span></td>'
      + '<td><strong>' + hlEsc(r.item_name || '', state.q) + '</strong>'
      + (r.item_code ? '<div class="muted" style="font-size:11px">' + hlEsc(r.item_code, state.q) + '</div>' : '')
      + (r.spec ? '<div class="muted" style="font-size:11px">' + hlEsc(r.spec, state.q) + '</div>' : '')
      + '</td>'
      + '<td>' + hlEsc(rfqLabel, state.q) + (r.ten_goi ? '<div class="muted" style="font-size:11px">' + hlEsc(r.ten_goi, state.q) + '</div>' : '') + '</td>'
      + '<td>' + hlEsc(r.contract_no || '', state.q) + (r.addendum_no ? '<div class="muted" style="font-size:11px">PL: ' + hlEsc(r.addendum_no, state.q) + '</div>' : '') + '</td>'
      + '<td class="num">' + API.esc(r.quantity != null ? Number(r.quantity).toLocaleString('vi-VN') : '0') + '</td>'
      + '<td class="num">' + API.esc(r.unit_price ? API.money(r.unit_price) : '-') + '</td>'
      + '<td class="num"><strong>' + API.esc(r.line_total ? API.money(r.line_total) : '-') + '</strong></td>'
      + '<td style="text-align:center;white-space:nowrap">' + (r.rfq_id ? '<button type="button" class="btn btn-sm" onclick="RfqItemsModule.openRfqForAddendum(\'' + API.esc(r.rfq_id) + '\')">Mở RFQ</button>' : '<span class="muted">-</span>') + '</td>'
      + '</tr>';
  }

  function openRfqForAddendum(rfqId) {
    if (window.RfqsModule && typeof window.RfqsModule.openEdit === 'function') {
      window.RfqsModule.openEdit(rfqId);
      return;
    }
    filterByRfq(rfqId);
    load(true);
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
    var rfqStatus = r.trang_thai_goi || '';
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
      + input('thanhTienSauThue', 'Thành tiền sau thuế', r.thanh_tien_sau_thue, 'inputmode="numeric" readonly', 'span-3')
      + '<label class="span-3 readonly-field">Trạng thái dòng'
      + '<input value="' + API.esc(statusLabel(status)) + '" readonly tabindex="-1">'
      + '<input type="hidden" name="trangThaiDong" value="' + API.esc(status) + '">'
      + '</label>'
      + (rfqStatus ? '<label class="span-3 readonly-field">Trạng thái gói <small style="font-weight:400;color:var(--text-muted)">(RFQ)</small><input value="' + API.esc(rfqStatusLabel(rfqStatus)) + '" readonly tabindex="-1"></label>' : '')
      + latestClarificationSummary(r, clarifications)
      // Full-width specification fields
      + textarea('technicalParams', 'Quy cách / thông số kỹ thuật', val(r, 'technical_params', 'thong_so_ky_thuat'), '', 'span-12 compact-ta')
      + textarea('yeuCauKyThuatBoSung', 'Yêu cầu kỹ thuật bổ sung', r.yeu_cau_ky_thuat_bo_sung, '', 'span-12 compact-ta')
      + textarea('note', 'Ghi chú', r.note, '', 'span-12 compact-ta')
      + textarea('originFullText', 'Cột tổng hợp gốc để đối chiếu/export', r.origin_full_text, '', 'span-12 compact-ta')
      + input('warrantyPercent', 'Bảo hành (%) override - Để trống = dùng mặc định của gói thầu', r.warranty_percent ?? '', 'type="number" min="0" step="0.01"', 'span-6')
      + input('warrantyDays', 'Số ngày bảo hành override - Để trống = dùng mặc định của gói thầu', r.warranty_days ?? '', 'type="number" min="0" step="1"', 'span-6')
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
      + '<input id="' + pdfInputId + '" type="file" accept="application/pdf,.pdf" multiple>'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'rfq_item\', \'' + escId + '\', \'document_pdf\', \'' + pdfInputId + '\', \'' + escId + '\')">Upload PDF</button>'
      + '</div>'
      + '<div class="media-subhead" style="margin-top:16px"><strong style="font-size:13px">Ảnh vật tư</strong></div>'
      + imageGallery(imageFiles)
      + '<div data-write class="upload-row">'
      + '<label>Upload ảnh vật tư</label>'
      + '<input id="' + imageInputId + '" type="file" accept="image/jpeg,image/png,image/webp" multiple>'
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

  function rfqStatusLabel(value) {
    return {
      dang_khao_gia: 'Đang khảo giá',
      da_bao: 'Đã báo',
      trung: 'Trúng',
      khong_trung: 'Không trúng',
      treo: 'Treo',
      tham_khao: 'Tham khảo',
      archived: 'Lưu trữ',
    }[value] || value || '';
  }

  function calculateRfqItemTotal(source) {
    var quantity = Number(String(source.quantity == null ? '' : source.quantity).replace(',', '.'));
    var unitPrice = parseMoneyInput(source.donGiaSauThue);
    var taxRate = Number(String(source.thueSuat == null ? '' : source.thueSuat).replace(',', '.'));
    if (!Number.isFinite(quantity)) quantity = 0;
    if (!Number.isFinite(taxRate)) taxRate = 0;
    return Math.round(quantity * unitPrice * (1 + taxRate / 100));
  }

  function bindRfqItemTotalCalculator() {
    var body = document.getElementById('modalBody') || document;
    var qtyEl = body.querySelector('[name="quantity"]');
    var priceEl = body.querySelector('[name="donGiaSauThue"]');
    var taxEl = body.querySelector('[name="thueSuat"]');
    var totalEl = body.querySelector('[name="thanhTienSauThue"]');
    if (!qtyEl || !priceEl || !taxEl || !totalEl) return;
    function sync() {
      totalEl.value = String(calculateRfqItemTotal({
        quantity: qtyEl.value,
        donGiaSauThue: priceEl.value,
        thueSuat: taxEl.value,
      }));
    }
    qtyEl.addEventListener('input', sync);
    priceEl.addEventListener('input', sync);
    taxEl.addEventListener('input', sync);
    sync();
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
      + '<input id="' + pdfInputId + '" type="file" accept="application/pdf,.pdf" multiple style="max-width:170px">'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'quote\', \'' + API.esc(quoteId) + '\', \'quote_pdf\', \'' + pdfInputId + '\', \'' + API.esc(rfqItemId) + '\')">Upload</button>'
      + '</div>'
      + '<div class="media-label" style="margin-top:8px">Minh chứng báo giá</div>'
      + imageGallery(imageFiles)
      + '<div data-write style="margin-top:6px">'
      + '<input id="' + imageInputId + '" type="file" accept="image/jpeg,image/png,image/webp" multiple style="max-width:170px">'
      + '<button type="button" onclick="RfqItemsModule.uploadMediaFile(\'quote\', \'' + API.esc(quoteId) + '\', \'quote_evidence_image\', \'' + imageInputId + '\', \'' + API.esc(rfqItemId) + '\')">Upload ảnh</button>'
      + '</div></div>';
  }

  function mediaList(files, emptyText) {
    if (!files || !files.length) return '<div class="empty-state small">' + API.esc(emptyText || 'Chưa có file.') + '</div>';
    return '<ul class="media-list" style="margin:0;padding-left:18px;font-size:12px">'
      + files.map(function (f) {
        return '<li><a href="' + API.esc(API.mediaUrl(f.file_id, f.owner_type, f.owner_id)) + '" target="_blank" rel="noopener"><strong>' + API.esc(f.file_name || f.file_id) + '</strong></a>'
          + ' <span class="muted">(' + API.esc(formatSize(f.size_bytes)) + ', ' + API.esc(formatDate(f.created_at)) + ')</span></li>';
      }).join('')
      + '</ul>';
  }

  function imageGallery(files) {
    if (!files || !files.length) return '<div class="empty-state small">Chưa có ảnh.</div>';
    var gId = 'g' + (++_gallerySeq);
    _galleryRegistry[gId] = files.map(function (f) { return { fileId: f.file_id, ownerType: f.owner_type, ownerId: f.owner_id }; });
    return '<div class="media-gallery">'
      + files.map(function (f, i) {
        var src = API.mediaUrl(f.file_id, f.owner_type, f.owner_id);
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
    var files = input && input.files ? Array.from(input.files) : [];
    var isImage = fileKind === 'item_image' || fileKind === 'quote_evidence_image';
    if (!files.length) {
      if (isImage) {
        API.toast('Chọn ảnh trước khi upload', 'warn');
        return;
      }
      API.toast('Chọn file PDF trước khi upload', 'warn');
      return;
    }
    var succeeded = 0;
    var failed = [];
    var overTarget = 0;
    try {
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        API.toast('Đang upload ' + (i + 1) + '/' + files.length + ': ' + file.name, 'info');
        var form = new FormData();
        form.append('ownerType', ownerType);
        form.append('ownerId', ownerId);
        form.append('fileKind', fileKind);
        form.append('file', file);
        try {
          await API.upload(form);
          succeeded++;
          if (form.get('_overTarget') === '1') overTarget++;
        } catch (err) {
          failed.push(file.name + ': ' + (err.message || 'Lỗi upload'));
          API.toast('Lỗi file ' + file.name + ': ' + (err.message || 'Lỗi upload'), 'error');
        }
      }
    } finally {
      input.value = '';
    }
    if (succeeded) {
      var successText = 'Đã upload ' + succeeded + '/' + files.length + (isImage ? ' ảnh' : ' file PDF');
      if (overTarget) successText += ' (' + overTarget + ' ảnh lớn hơn khuyến nghị)';
      API.toast(successText, failed.length || overTarget ? 'warn' : 'success');
      await openEdit(rfqItemId);
    }
    if (failed.length) {
      API.toast('Không upload được: ' + failed.join('; '), 'error');
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
    var entry = _lightboxGroup[_lightboxIndex];
    if (!entry) return;
    var fileId = typeof entry === 'string' ? entry : entry.fileId;
    _ensureLightbox();
    var src = API.mediaUrl(fileId, entry.ownerType, entry.ownerId);
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

  function openMediaPreview(fileId, ownerType, ownerId) {
    _lightboxGroup = [{ fileId: fileId, ownerType: ownerType, ownerId: ownerId }];
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
    var deliveryBtn = document.getElementById('itemCreateDeliverySelected');
    var deliveryCnt = document.getElementById('itemDeliveryCount');
    var bulkEditBtn = document.getElementById('itemBulkEditSelected');
    var bulkEditCnt = document.getElementById('itemBulkEditCount');
    var canWrite = Utils.roleCanWrite();
    if (btn) btn.classList.toggle('hidden', !checked.length);
    if (cnt) cnt.textContent = checked.length;
    if (deliveryBtn) deliveryBtn.classList.toggle('hidden', !checked.length || !canWrite);
    if (deliveryCnt) deliveryCnt.textContent = checked.length;
    if (bulkEditBtn) bulkEditBtn.classList.toggle('hidden', !checked.length || !canWrite);
    if (bulkEditCnt) bulkEditCnt.textContent = checked.length;
  }

  function openBulkEditForSelected() {
    if (!Utils.roleCanWrite()) { API.toast('Không có quyền chỉnh sửa', 'warn'); return; }
    var items = _getSelectedItems();
    if (!items.length) { API.toast('Chưa chọn dòng nào', 'warn'); return; }
    var rfqId = _selectedRfqId;
    if (!rfqId) { API.toast('Cần lọc theo RFQ trước', 'warn'); return; }

    _beItems = items;

    function beFieldRow(chkId, valId, label, type, placeholder) {
      var extra = type === 'number' ? ' min="0" step="any"' : '';
      return '<tr>'
        + '<td style="padding:6px 10px 6px 0;width:170px;vertical-align:middle">'
        + '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">'
        + '<input type="checkbox" id="' + chkId + '" onchange="RfqItemsModule._beOnFieldChange(\'' + valId + '\', this.checked)">'
        + label + '</label></td>'
        + '<td style="padding:6px 0;vertical-align:middle">'
        + '<input type="' + type + '" id="' + valId + '" disabled placeholder="' + API.esc(placeholder) + '"'
        + extra + ' oninput="RfqItemsModule._beUpdatePreview()"'
        + ' style="width:100%;box-sizing:border-box;font-size:13px">'
        + '</td></tr>';
    }

    var html = '<div style="font-size:13px">'
      + '<p style="margin:0 0 10px;color:var(--text-muted)">Đã chọn <strong style="color:var(--text)">' + items.length + ' dòng</strong>. Chọn trường và nhập giá trị mới:</p>'
      + '<table style="width:100%;border-collapse:collapse;margin-bottom:12px"><tbody>'
      + beFieldRow('beChkUnit',     'beValUnit',     'ĐVT (đơn vị tính)',     'text',   'Đơn vị tính...')
      + beFieldRow('beChkQty',      'beValQty',      'Khối lượng',            'number', '0')
      + beFieldRow('beChkDelivery', 'beValDelivery', 'Thời gian giao hàng',   'text',   'VD: 30 ngày...')
      + beFieldRow('beChkNote',     'beValNote',     'Ghi chú',               'text',   'Ghi chú...')
      + '</tbody></table>'
      + '<div id="bePreviewArea"></div>'
      + '</div>';

    Utils.openModal('Sửa hàng loạt — ' + items.length + ' dòng', html, async function () {
      var activeFields = _beGetActiveFields();
      if (!activeFields.length) { API.toast('Chưa chọn trường nào để cập nhật', 'warn'); return; }

      var overwriteFields = [];
      var fieldValues = {};
      var validationError = null;
      activeFields.forEach(function (f) {
        if (validationError) return;
        overwriteFields.push(f.key);
        if (f.key === 'quantity') {
          var qty = parseFloat(f.newVal);
          if (isNaN(qty) || qty < 0) { validationError = 'Khối lượng phải là số >= 0'; return; }
          fieldValues[f.key] = qty;
        } else {
          fieldValues[f.key] = (f.newVal || '').trim();
        }
      });
      if (validationError) { API.toast(validationError, 'warn'); return; }

      var rows = _beItems.map(function (item) {
        var row = { rfq_item_id: item.rfq_item_id, ten_vat_tu: item.ten_vat_tu || '' };
        Object.keys(fieldValues).forEach(function (k) { row[k] = fieldValues[k]; });
        return row;
      });

      try {
        var result = await API.call('commitImportRows', {
          rfqId: rfqId,
          importMode: 'selective_update',
          overwriteFields: overwriteFields,
          sourceFileName: 'bulk-edit-ui',
          sourceSheetName: 'bulk_edit',
          rows: rows
        });
        var s = result.summary || {};
        var parts = [(s.updated || 0) + ' đã cập nhật'];
        if (s.skipped) parts.push(s.skipped + ' bỏ qua');
        if (s.skippedUnmatched) parts.push(s.skippedUnmatched + ' không tìm thấy');
        if (s.errors) parts.push(s.errors + ' lỗi');
        if (s.rowErrors && s.rowErrors.length) console.warn('[BulkEdit] rowErrors:', s.rowErrors.slice(0, 5));
        Utils.closeModal();
        API.toast(parts.join(', '), s.errors ? 'warn' : 'success');
        await load(true);
      } catch (err) { API.error(err); }
    });
  }

  function _beOnFieldChange(valId, checked) {
    var inp = document.getElementById(valId);
    if (inp) { inp.disabled = !checked; if (checked) setTimeout(function () { inp.focus(); }, 0); }
    _beUpdatePreview();
  }

  function _beGetActiveFields() {
    var DEFS = [
      { chkId: 'beChkUnit',     valId: 'beValUnit',     key: 'unit',          oldKey: 'don_vi',        label: 'ĐVT' },
      { chkId: 'beChkQty',      valId: 'beValQty',      key: 'quantity',      oldKey: 'so_luong',      label: 'Khối lượng' },
      { chkId: 'beChkDelivery', valId: 'beValDelivery', key: 'delivery_time', oldKey: 'delivery_time', label: 'TG giao' },
      { chkId: 'beChkNote',     valId: 'beValNote',     key: 'note',          oldKey: 'note',          label: 'Ghi chú' }
    ];
    return DEFS.map(function (f) {
      var chk = document.getElementById(f.chkId);
      var inp = document.getElementById(f.valId);
      if (!chk || !chk.checked) return null;
      return { key: f.key, oldKey: f.oldKey, label: f.label, newVal: inp ? inp.value : '' };
    }).filter(Boolean);
  }

  function _beUpdatePreview() {
    var area = document.getElementById('bePreviewArea');
    if (!area) return;
    var activeFields = _beGetActiveFields();
    if (!activeFields.length) { area.innerHTML = ''; return; }
    var rows = _beItems;
    var html = '<p style="font-size:12px;color:var(--text-muted);margin:0 0 6px">Xem trước — ' + rows.length + ' dòng sẽ được cập nhật:</p>'
      + '<div style="overflow:auto;max-height:240px">'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
      + '<thead><tr style="background:var(--bg)">'
      + '<th style="padding:4px 6px;text-align:left;white-space:nowrap;border-bottom:1px solid var(--border)">Mã VT</th>'
      + '<th style="padding:4px 6px;text-align:left;border-bottom:1px solid var(--border)">Tên vật tư</th>';
    activeFields.forEach(function (f) {
      html += '<th style="padding:4px 6px;text-align:center;white-space:nowrap;border-bottom:1px solid var(--border)">'
        + API.esc(f.label) + '<br><span style="font-weight:400;color:var(--text-muted)">Cũ → Mới</span></th>';
    });
    html += '</tr></thead><tbody>';
    rows.forEach(function (item, i) {
      html += '<tr style="border-top:1px solid var(--border)' + (i % 2 ? ';background:var(--bg)' : '') + '">'
        + '<td style="padding:3px 6px;white-space:nowrap">' + API.esc(item.ma_vat_tu || '') + '</td>'
        + '<td style="padding:3px 6px;max-width:220px" title="' + API.esc(item.ten_vat_tu || '') + '">'
        + API.esc((item.ten_vat_tu || '').slice(0, 45)) + '</td>';
      activeFields.forEach(function (f) {
        var oldVal = item[f.oldKey];
        html += '<td style="padding:3px 6px;text-align:center">'
          + '<span style="color:var(--text-muted)">' + API.esc(oldVal != null && oldVal !== '' ? String(oldVal) : '—') + '</span>'
          + ' → <strong style="color:var(--primary,#2563eb)">' + API.esc(f.newVal !== '' ? String(f.newVal) : '(trống)') + '</strong>'
          + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    area.innerHTML = html;
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
      + (Utils.roleCanLargeExport() ? '<button type="button" onclick="RfqItemsModule.exportPriceHistory(\'' + API.esc(item.rfq_item_id) + '\')">Xu&#7845;t CSV</button>' : '')
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
    rows.forEach(function (r) {
      if (r.contract_item_id) contractItemRowCache[r.contract_item_id] = r;
    });
    var contracts = uniqueContractsFromRows(rows);
    setTimeout(function () {
      contracts.forEach(function (c) { loadContractAddendums(c.contract_id); });
    }, 0);
    return '<div class="quotes-table-wrap">'
      + '<table class="quotes-mini-table">'
      + '<thead><tr>'
      + '<th>S&#7889; H&#272;</th><th>T&#234;n H&#272;</th><th>Ng&#224;y k&#253;</th>'
      + '<th>Nh&#224; CC</th><th>SL H&#272;</th><th>&#272;&#417;n gi&#225; H&#272;</th><th>Th&#224;nh ti&#7873;n H&#272;</th><th>H&#7841;n giao</th><th>T.t&#7879;</th><th>Tr&#7841;ng th&#225;i</th><th></th>'
      + '</tr></thead><tbody>'
      + rows.map(function (r) {
          var statusBadge = r.contract_status === 'archived'
            ? '<span class="badge" style="opacity:0.6">L&#432;u tr&#7919;</span>'
            : '<span class="badge" style="background:var(--green-bg);border-color:#86efac;color:var(--green)">Hi&#7879;u l&#7921;c</span>';
          var editBtn = r.contract_status === 'archived'
            ? ''
            : '<button type="button" class="btn btn-sm" data-write onclick="RfqItemsModule.openContractItemDeadlineModal(\'' + API.esc(r.contract_item_id || '') + '\')">S&#7917;a</button>';
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
            + '<td>' + contractDeadlineDisplay(r) + '</td>'
            + '<td>' + API.esc(r.contract_currency || 'VND') + '</td>'
            + '<td>' + statusBadge + '</td>'
            + '<td style="text-align:center">' + editBtn + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>'
      + contractAddendumPanels(contracts);
  }

  function uniqueContractsFromRows(rows) {
    var byId = {};
    (rows || []).forEach(function (r) {
      if (!r.contract_id || byId[r.contract_id]) return;
      byId[r.contract_id] = {
        contract_id: r.contract_id,
        contract_no: r.contract_no || '',
        contract_name: r.contract_name || '',
        contract_status: r.contract_status || '',
        original_contract_total: r.original_contract_total || 0,
      };
    });
    return Object.keys(byId).map(function (id) { return byId[id]; });
  }

  function contractAddendumPanels(contracts) {
    if (!contracts.length) return '';
    return '<div class="modal-section" style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">'
      + '<div class="section-head"><h4>Ph&#7909; l&#7909;c h&#7907;p &#273;&#7891;ng</h4></div>'
      + contracts.map(function (c) {
          var id = addendumContainerId(c.contract_id);
          var disabled = c.contract_status === 'archived' ? ' disabled style="opacity:.5;cursor:not-allowed"' : '';
          return '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:8px">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">'
              + '<div><strong>' + API.esc(c.contract_no || c.contract_id) + '</strong>'
              + (c.contract_name ? '<div class="muted" style="font-size:12px">' + API.esc(c.contract_name) + '</div>' : '')
              + '</div>'
              + '<button type="button" class="btn btn-sm" data-write onclick="RfqItemsModule.openContractAddendumModal(\'' + API.esc(c.contract_id) + '\')"' + disabled + '>+ Ph&#7909; l&#7909;c</button>'
            + '</div>'
            + '<div id="' + id + '" class="empty-state small" style="margin-top:8px">&#272;ang t&#7843;i ph&#7909; l&#7909;c...</div>'
          + '</div>';
        }).join('')
      + '</div>';
  }

  function addendumContainerId(contractId) {
    return 'add_' + String(contractId || '').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  async function loadContractAddendums(contractId) {
    var container = document.getElementById(addendumContainerId(contractId));
    if (!container) return;
    try {
      var data = await API.get('getContractAddendums', { contractId: contractId });
      contractAddendumCache[contractId] = data;
      (data.rows || []).forEach(function (r) {
        if (r.addendum_id) contractAddendumCache[r.addendum_id] = r;
      });
      container.innerHTML = renderContractAddendums(contractId, data);
      Auth.applyRoleUI();
    } catch (err) {
      container.textContent = 'Loi tai phu luc hop dong.';
      API.error(err);
    }
  }

  function renderContractAddendums(contractId, data) {
    var rows = data.rows || [];
    var summary = data.summary || {};
    return addendumSummary(summary)
      + '<div class="quotes-table-wrap" style="margin-top:8px">'
      + '<table class="quotes-mini-table contract-addendum-table"><thead><tr>'
      + '<th>S&#7889; PL</th><th>N&#7897;i dung</th><th>Ng&#224;y k&#253;</th>'
      + '<th>Gi&#225; tr&#7883; tr&#432;&#7899;c thu&#7871;</th><th>Thu&#7871; %</th><th>Gi&#225; tr&#7883; sau thu&#7871;</th>'
      + '<th>Gi&#225; tr&#7883; ph&#7909; l&#7909;c (+/-)</th><th>Tr&#7841;ng th&#225;i</th><th>URL</th><th>Thao t&#225;c</th>'
      + '</tr></thead><tbody>'
      + (rows.length ? rows.map(function (r) { return addendumRow(contractId, r); }).join('') : '<tr><td colspan="10" class="empty-state small">Ch&#432;a c&#243; ph&#7909; l&#7909;c.</td></tr>')
      + '</tbody></table></div>';
  }

  function addendumSummary(summary) {
    var original = summary.original_contract_total || 0;
    var addTotal = summary.addendum_total || 0;
    var current = summary.current_effective_value || (original + addTotal);
    var count = summary.active_addendum_count || 0;
    return '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:8px">'
      + summaryBox('Gi&#225; tr&#7883; H&#272; g&#7889;c', original)
      + summaryBox('T&#7893;ng ph&#7909; l&#7909;c', addTotal)
      + summaryBox('Gi&#225; tr&#7883; hi&#7879;n h&#224;nh', current)
      + '<div style="border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg)">'
        + '<div class="muted" style="font-size:11px">S&#7889; ph&#7909; l&#7909;c active</div>'
        + '<strong>' + API.esc(count) + '</strong>'
      + '</div>'
      + '</div>';
  }

  function summaryBox(label, value) {
    return '<div style="border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg)">'
      + '<div class="muted" style="font-size:11px">' + label + '</div>'
      + '<strong>' + API.esc(API.money(value) || '0') + '</strong>'
      + '</div>';
  }

  function addendumRow(contractId, r) {
    var archived = r.status === 'archived';
    var editBtn = archived ? '' : '<button type="button" class="btn btn-sm" data-write onclick="RfqItemsModule.openContractAddendumModal(\'' + API.esc(contractId) + '\',\'' + API.esc(r.addendum_id || '') + '\')">S&#7917;a</button>';
    var archiveBtn = archived ? '' : '<button type="button" class="btn btn-sm" data-role-only="admin,manager" onclick="RfqItemsModule.archiveContractAddendum(\'' + API.esc(r.addendum_id || '') + '\',\'' + API.esc(contractId) + '\')">L&#432;u tr&#7919;</button>';
    var addendumId = r.addendum_id || '';
    return '<tr>'
      + '<td><strong>' + API.esc(r.addendum_no || '') + '</strong></td>'
      + '<td class="contract-addendum-content">' + API.esc(r.addendum_name || '') + (r.note ? '<div class="muted" style="font-size:11px">' + API.esc(r.note) + '</div>' : '') + '</td>'
      + '<td>' + API.esc(r.signed_date || '') + '</td>'
      + '<td class="num">' + moneyOrDash(r.value_before_tax) + '</td>'
      + '<td class="num">' + API.esc(r.tax_rate != null ? r.tax_rate : 0) + '</td>'
      + '<td class="num"><strong>' + moneyOrDash(r.value_after_tax) + '</strong></td>'
      + '<td class="num">' + signedMoney(r.amount_delta) + '</td>'
      + '<td>' + addendumStatusBadge(r.status) + '</td>'
      + '<td style="text-align:center">' + addendumUrlCell(r.external_url) + '</td>'
      + '<td style="white-space:nowrap;text-align:center">' + editBtn + archiveBtn + '</td>'
      + '</tr>'
      + '<tr><td colspan="10" class="contract-addendum-detail-cell">'
      + '<button type="button" class="btn btn-sm contract-addendum-detail-toggle" onclick="RfqItemsModule.toggleContractAddendumItems(\'' + API.esc(contractId) + '\',\'' + API.esc(addendumId) + '\')">Chi ti&#7871;t v&#7853;t t&#432;/d&#7883;ch v&#7909;</button>'
      + '<div id="' + addendumItemsContainerId(addendumId) + '" class="contract-addendum-detail-panel hidden"></div>'
      + '</td></tr>';
  }

  function addendumItemsContainerId(addendumId) {
    return 'addi_' + String(addendumId || '').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  async function loadContractAddendumItems(contractId, addendumId) {
    var container = document.getElementById(addendumItemsContainerId(addendumId));
    if (!container) return;
    try {
      var data = await API.get('getContractAddendumItems', { addendumId: addendumId });
      (data.rows || []).forEach(function (r) {
        if (r.addendum_item_id) contractAddendumItemCache[r.addendum_item_id] = r;
      });
      container.innerHTML = renderContractAddendumItems(contractId, addendumId, data);
      Auth.applyRoleUI();
    } catch (err) {
      container.textContent = 'Lỗi tải dòng chi tiết phụ lục.';
      API.error(err);
    }
  }

  async function toggleContractAddendumItems(contractId, addendumId) {
    var container = document.getElementById(addendumItemsContainerId(addendumId));
    if (!container) return;
    var willOpen = container.classList.contains('hidden');
    container.classList.toggle('hidden', !willOpen);
    if (!willOpen) return;
    if (container.dataset.loaded === '1') return;
    container.innerHTML = '<div class="muted" style="font-size:12px;padding:6px 0">&#272;ang t&#7843;i chi ti&#7871;t v&#7853;t t&#432;/d&#7883;ch v&#7909;...</div>';
    await loadContractAddendumItems(contractId, addendumId);
    container.dataset.loaded = '1';
  }

  function renderContractAddendumItems(contractId, addendumId, data) {
    var rows = data.rows || [];
    var activeRows = rows.filter(function (r) { return r.status !== 'archived'; });
    var addendum = contractAddendumCache[addendumId] || data.addendum || {};
    var detailTotal = Number((data.summary || {}).detail_total || 0);
    var headerDelta = Number(addendum.amount_delta || 0);
    var warn = activeRows.length && detailTotal !== headerDelta
      ? '<div class="muted" style="color:var(--red);font-size:12px;margin-top:4px">T&#7893;ng chi ti&#7871;t kh&#225;c gi&#225; tr&#7883; ph&#7909; l&#7909;c</div>'
      : '';
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px">'
      + '<div><strong>T&#7893;ng chi ti&#7871;t: ' + API.esc(API.money(detailTotal) || '0') + '</strong>'
      + '<span class="muted" style="margin-left:10px">Gi&#225; tr&#7883; ph&#7909; l&#7909;c: ' + API.esc(API.money(headerDelta) || '0') + '</span>'
      + warn + '</div>'
      + '<button type="button" class="btn btn-sm" data-write onclick="RfqItemsModule.openContractAddendumItemModal(\'' + API.esc(contractId) + '\',\'' + API.esc(addendumId) + '\')">+ D&#242;ng chi ti&#7871;t</button>'
      + '</div>'
      + (rows.length ? '<div class="quotes-table-wrap"><table class="quotes-mini-table contract-addendum-detail-table"><thead><tr>'
      + '<th>Lo&#7841;i</th><th>M&#227;</th><th>N&#7897;i dung</th><th>Quy c&#225;ch</th><th>&#272;VT</th><th>SL</th><th>&#272;&#417;n gi&#225;</th><th>Th&#224;nh ti&#7873;n</th><th>Thu&#7871; %</th><th>Ghi ch&#250;</th><th>Thao t&#225;c</th>'
      + '</tr></thead><tbody>'
      + rows.map(function (r) { return addendumItemRow(contractId, addendumId, r); }).join('')
      + '</tbody></table></div>' : '<div class="muted contract-addendum-empty">Ch&#432;a c&#243; chi ti&#7871;t v&#7853;t t&#432;/d&#7883;ch v&#7909;.</div>');
  }

  function addendumItemRow(contractId, addendumId, r) {
    var archived = r.status === 'archived';
    var editBtn = archived ? '' : '<button type="button" class="btn btn-sm" data-write onclick="RfqItemsModule.openContractAddendumItemModal(\'' + API.esc(contractId) + '\',\'' + API.esc(addendumId) + '\',\'' + API.esc(r.addendum_item_id || '') + '\')">S&#7917;a</button>';
    var archiveBtn = archived ? '' : '<button type="button" class="btn btn-sm" data-role-only="admin,manager" onclick="RfqItemsModule.archiveContractAddendumItem(\'' + API.esc(contractId) + '\',\'' + API.esc(addendumId) + '\',\'' + API.esc(r.addendum_item_id || '') + '\')">X&#243;a</button>';
    return '<tr' + (archived ? ' style="opacity:.65"' : '') + '>'
      + '<td>' + API.esc(addendumItemTypeLabel(r.item_type)) + '</td>'
      + '<td>' + API.esc(r.item_code || '') + '</td>'
      + '<td>' + API.esc(r.item_name || '') + '</td>'
      + '<td>' + API.esc(r.spec || '') + '</td>'
      + '<td>' + API.esc(r.unit || '') + '</td>'
      + '<td class="num">' + API.esc(r.quantity != null ? Number(r.quantity).toLocaleString('vi-VN') : '0') + '</td>'
      + '<td class="num">' + moneyOrDash(r.unit_price) + '</td>'
      + '<td class="num"><strong>' + moneyOrDash(r.line_total) + '</strong></td>'
      + '<td class="num">' + API.esc(r.tax_rate != null ? r.tax_rate : 0) + '</td>'
      + '<td>' + API.esc(r.note || '') + '</td>'
      + '<td style="white-space:nowrap;text-align:center">' + editBtn + archiveBtn + '</td>'
      + '</tr>';
  }

  function addendumItemTypeLabel(type) {
    return { material: 'V&#7853;t t&#432;', service: 'D&#7883;ch v&#7909;', other: 'Kh&#225;c' }[type] || type || '';
  }

  function addendumItemTypeOptions(current) {
    return option('material', 'V&#7853;t t&#432;', current)
      + option('service', 'D&#7883;ch v&#7909;', current)
      + option('other', 'Kh&#225;c', current);
  }

  function openContractAddendumItemModal(contractId, addendumId, addendumItemId) {
    var row = addendumItemId ? (contractAddendumItemCache[addendumItemId] || {}) : {};
    var html = ''
      + '<label class="span-3">Loại<select name="itemType">' + addendumItemTypeOptions(row.item_type || 'material') + '</select></label>'
      + input('itemCode', 'Mã', row.item_code || '', 'maxlength="120"', 'span-3')
      + input('itemName', 'Nội dung *', row.item_name || '', 'required maxlength="500"', 'span-6')
      + input('spec', 'Quy cách', row.spec || '', 'maxlength="1000"', 'span-6')
      + input('unit', 'ĐVT', row.unit || '', 'maxlength="80"', 'span-2')
      + input('quantity', 'SL', row.quantity ?? '', 'type="number" min="0" step="0.001"', 'span-2')
      + input('unitPrice', 'Đơn giá', row.unit_price || '', 'inputmode="numeric"', 'span-3')
      + input('lineTotal', 'Thành tiền', row.line_total || '', 'inputmode="numeric" readonly', 'span-3')
      + input('taxRate', 'Thuế %', row.tax_rate ?? '', 'type="number" min="0" step="0.01"', 'span-2')
      + textarea('note', 'Ghi chú', row.note || '', '', 'span-12 compact-ta');
    Utils.openModal(addendumItemId ? 'Sửa dòng chi tiết phụ lục' : 'Thêm dòng chi tiết phụ lục', html, async function (form) {
      try {
        form.addendumId = addendumId;
        if (addendumItemId) form.addendumItemId = addendumItemId;
        await API.call(addendumItemId ? 'updateContractAddendumItem' : 'createContractAddendumItem', form);
        Utils.closeModal();
        API.toast('Đã lưu dòng chi tiết', 'success');
        await loadContractAddendumItems(contractId, addendumId);
      } catch (err) {
        API.error(err);
      }
    });
    setTimeout(bindAddendumItemTotalCalculator, 0);
    Auth.applyRoleUI();
  }

  function calculateAddendumItemTotal(source) {
    var quantity = Number(String(source.quantity == null ? '' : source.quantity).replace(',', '.'));
    var unitPrice = parseMoneyInput(source.unitPrice);
    var taxRate = Number(String(source.taxRate == null ? '' : source.taxRate).replace(',', '.'));
    if (!Number.isFinite(quantity)) quantity = 0;
    if (!Number.isFinite(taxRate) || taxRate < 0) taxRate = 0;
    return Math.round(quantity * unitPrice * (1 + taxRate / 100));
  }

  function bindAddendumItemTotalCalculator() {
    var body = document.getElementById('modalBody') || document;
    var qtyEl = body.querySelector('[name="quantity"]');
    var priceEl = body.querySelector('[name="unitPrice"]');
    var taxEl = body.querySelector('[name="taxRate"]');
    var totalEl = body.querySelector('[name="lineTotal"]');
    if (!qtyEl || !priceEl || !taxEl || !totalEl) return;
    function sync() {
      totalEl.value = String(calculateAddendumItemTotal({
        quantity: qtyEl.value,
        unitPrice: priceEl.value,
        taxRate: taxEl.value,
      }));
    }
    qtyEl.addEventListener('input', sync);
    priceEl.addEventListener('input', sync);
    taxEl.addEventListener('input', sync);
    sync();
  }

  async function archiveContractAddendumItem(contractId, addendumId, addendumItemId) {
    var ok = await Utils.confirmDanger('Xóa dòng chi tiết', 'Xóa dòng chi tiết phụ lục này?', 'Xóa');
    if (!ok) return;
    try {
      await API.call('archiveContractAddendumItem', { addendumItemId: addendumItemId });
      API.toast('Đã xóa dòng chi tiết.', 'success');
      await loadContractAddendumItems(contractId, addendumId);
    } catch (err) {
      API.error(err);
    }
  }

  function moneyOrDash(value) {
    return value ? API.esc(API.money(value)) : '<span class="muted">-</span>';
  }

  function signedMoney(value) {
    var n = Number(value || 0);
    var sign = n > 0 ? '+' : '';
    var color = n < 0 ? 'var(--red)' : 'inherit';
    return '<strong style="color:' + color + '">' + API.esc(sign + (API.money(n) || '0')) + '</strong>';
  }

  function addendumStatusBadge(status) {
    var labels = { draft: 'Nh&#225;p', active: 'Hi&#7879;u l&#7921;c', archived: 'L&#432;u tr&#7919;', cancelled: 'H&#7911;y' };
    var style = status === 'active'
      ? 'background:var(--green-bg);border-color:#86efac;color:var(--green)'
      : status === 'archived'
        ? 'opacity:.6'
        : '';
    return '<span class="badge" style="' + style + '">' + (labels[status] || API.esc(status || '')) + '</span>';
  }

  function addendumUrlCell(url) {
    if (!url || !/^https?:\/\//i.test(url)) return '<span class="muted">-</span>';
    return '<a class="btn btn-sm" href="' + API.esc(encodeURI(url)) + '" target="_blank" rel="noopener noreferrer" title="' + API.esc(url) + '">M&#7903;</a>';
  }

  function openContractAddendumModal(contractId, addendumId) {
    var row = addendumId ? (contractAddendumCache[addendumId] || {}) : {};
    var html = ''
      + input('addendumNo', 'Số phụ lục *', row.addendum_no || '', 'required placeholder="VD: VTPC1-0401-251013001-PL-01"', 'span-4')
      + input('addendumName', 'Tên phụ lục', row.addendum_name || '', 'placeholder="VD: Phụ lục bổ sung phạm vi"', 'span-5')
      + input('signedDate', 'Ngày ký', row.signed_date || '', 'type="date"', 'span-3')
      + input('valueBeforeTax', 'Giá trị trước thuế', row.value_before_tax || '', 'inputmode="numeric" placeholder="0"', 'span-3')
      + input('taxRate', 'Thuế %', row.tax_rate ?? '', 'type="number" min="0" step="0.01" placeholder="0"', 'span-2')
      + input('valueAfterTax', 'Giá trị sau thuế', row.value_after_tax || '', 'inputmode="numeric" placeholder="0" readonly', 'span-3')
      + input('amountDelta', 'Giá trị phụ lục (+/-)', row.amount_delta || '', 'inputmode="numeric" readonly', 'span-4')
      + '<div class="span-12 muted" style="font-size:12px;margin-top:-4px">Số âm là phụ lục giảm giá trị hợp đồng.</div>'
      + textarea('note', 'Ghi chú / nội dung', row.note || '', '', 'span-12 compact-ta')
      + input('externalUrl', 'URL', row.external_url || '', 'type="url" maxlength="2000" placeholder="https://drive.google.com/..."', 'span-12');
    Utils.openModal(addendumId ? 'Sửa phụ lục hợp đồng' : 'Thêm phụ lục hợp đồng', html, async function (form) {
      try {
        var calc = calculateAddendumValues(form);
        form.valueAfterTax = String(calc.valueAfterTax);
        form.amountDelta = String(calc.valueAfterTax);
        form.contractId = contractId;
        if (addendumId) form.addendumId = addendumId;
        await API.call(addendumId ? 'updateContractAddendum' : 'createContractAddendum', form);
        Utils.closeModal();
        API.toast('Đã lưu phụ lục', 'success');
        await loadContractAddendums(contractId);
      } catch (err) {
        API.error(err);
      }
    });
    setTimeout(bindAddendumValueCalculator, 0);
    Auth.applyRoleUI();
  }

  function parseMoneyInput(value) {
    var n = Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function calculateAddendumValues(source) {
    var beforeTax = parseMoneyInput(source.valueBeforeTax);
    var taxRate = Number(source.taxRate || 0);
    if (!Number.isFinite(taxRate) || taxRate < 0) taxRate = 0;
    return { valueAfterTax: Math.round(beforeTax * (1 + taxRate / 100)) };
  }

  function bindAddendumValueCalculator() {
    var body = document.getElementById('modalBody') || document;
    var beforeEl = body.querySelector('[name="valueBeforeTax"]');
    var taxEl = body.querySelector('[name="taxRate"]');
    var afterEl = body.querySelector('[name="valueAfterTax"]');
    var deltaEl = body.querySelector('[name="amountDelta"]');
    if (!beforeEl || !taxEl || !afterEl || !deltaEl) return;
    function sync() {
      var calc = calculateAddendumValues({ valueBeforeTax: beforeEl.value, taxRate: taxEl.value });
      afterEl.value = String(calc.valueAfterTax);
      deltaEl.value = String(calc.valueAfterTax);
    }
    beforeEl.addEventListener('input', sync);
    taxEl.addEventListener('input', sync);
    sync();
  }

  async function archiveContractAddendum(addendumId, contractId) {
    var ok = await Utils.confirmDanger('Lưu trữ phụ lục', 'Lưu trữ phụ lục này? Phụ lục sẽ không còn tính vào tổng giá trị active.', 'Lưu trữ');
    if (!ok) return;
    try {
      await API.call('archiveContractAddendum', { addendumId: addendumId });
      API.toast('Đã lưu trữ phụ lục', 'success');
      await loadContractAddendums(contractId);
    } catch (err) {
      API.error(err);
    }
  }

  function contractDeadlineDisplay(row) {
    var date = row.delivery_deadline_date || '';
    if (!date) return '<span class="muted-cell">chưa có</span>';
    var days = daysBetweenYmd(todayYmdVN(), date);
    var note = '';
    if (days !== null) {
      note = days < 0
        ? '<div class="muted" style="font-size:11px;color:var(--red)">trễ ' + Math.abs(days) + ' ngày</div>'
        : '<div class="muted" style="font-size:11px">còn ' + days + ' ngày</div>';
    }
    return '<strong>' + API.esc(date) + '</strong>' + note;
  }

  function todayYmdVN(date) {
    var vn = new Date((date || new Date()).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    return vn.getFullYear() + '-' + String(vn.getMonth() + 1).padStart(2, '0') + '-' + String(vn.getDate()).padStart(2, '0');
  }

  function daysBetweenYmd(fromYmd, toYmd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd || '') || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd || '')) return null;
    var from = new Date(fromYmd + 'T00:00:00Z');
    var to = new Date(toYmd + 'T00:00:00Z');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  }

  function contractDeadlineSection(row) {
    row = row || {};
    var type = row.delivery_trigger_type || 'contract_sign';
    return '<div class="span-12" style="border-top:1px solid var(--border);margin-top:4px;padding-top:12px">'
      + '<div style="font-weight:600;margin-bottom:8px">Thời hạn giao hàng</div>'
      + '<div class="form-grid" style="grid-template-columns:repeat(12,1fr);gap:10px">'
      + '<label class="span-4">Cách tính hạn giao<select name="deliveryTriggerType" onchange="RfqItemsModule._syncContractDeadlineFields()">'
      + option('contract_sign', 'Theo ngày ký HĐ', type)
      + option('award_notice', 'Theo thông báo trúng thầu', type)
      + option('delivery_notice', 'Theo lệnh giao hàng', type)
      + option('po_date', 'Theo PO', type)
      + option('manual', 'Nhập hạn giao thủ công', type)
      + '</select></label>'
      + input('deliveryLeadDays', 'Số ngày giao', row.delivery_lead_days ?? '', 'type="number" min="0" step="1" placeholder="ví dụ 45"', 'span-2 deadline-lead-field')
      + input('deliveryTriggerDate', 'Ngày bắt đầu tính', row.delivery_trigger_date || '', 'type="date"', 'span-3 deadline-trigger-date-field')
      + input('deliveryDeadlineDate', 'Hạn giao thủ công', row.delivery_deadline_date || '', 'type="date"', 'span-3 deadline-manual-date-field')
      + '</div>'
      + '</div>';
  }

  function _syncContractDeadlineFields() {
    var modal = document.getElementById('modalBody') || document;
    var typeEl = modal.querySelector('[name="deliveryTriggerType"]');
    if (!typeEl) return;
    var type = typeEl.value || 'contract_sign';
    var signedDateEl = modal.querySelector('[name="signedDate"]');
    var hasSignedDate = !!(signedDateEl && signedDateEl.value);
    var triggerWrap = modal.querySelector('.deadline-trigger-date-field');
    var manualWrap = modal.querySelector('.deadline-manual-date-field');
    var leadWrap = modal.querySelector('.deadline-lead-field');
    if (manualWrap) manualWrap.classList.toggle('hidden', type !== 'manual');
    if (leadWrap) leadWrap.classList.toggle('hidden', false);
    if (triggerWrap) {
      triggerWrap.classList.toggle('hidden', type === 'manual' || (type === 'contract_sign' && hasSignedDate));
    }
  }

  function validateContractDeadlinePayload(form) {
    var type = form.deliveryTriggerType || 'contract_sign';
    if (type === 'manual') {
      if (!form.deliveryDeadlineDate) {
        API.toast('Vui lòng nhập hạn giao thủ công.', 'warn');
        return false;
      }
      form.deliveryTriggerDate = form.deliveryTriggerDate || '';
      return true;
    }
    form.deliveryDeadlineDate = '';
    if (type === 'contract_sign' && form.signedDate) {
      form.deliveryTriggerDate = '';
    }
    if (type === 'award_notice' || type === 'delivery_notice' || type === 'po_date') {
      if (!form.deliveryTriggerDate) {
        API.toast('Vui lòng nhập ngày bắt đầu tính.', 'warn');
        return false;
      }
      if (form.deliveryLeadDays === '' || form.deliveryLeadDays == null) {
        API.toast('Vui lòng nhập số ngày giao hàng.', 'warn');
        return false;
      }
    }
    return true;
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
      + input('signedDate', 'Ngày ký', '', 'type="date" onchange="RfqItemsModule._syncContractDeadlineFields()"', 'span-3')
      + input('effectiveDate', 'Ngày có hiệu lực', '', 'type="date"', 'span-3')
      + input('expiryDate', 'Ngày hết hạn', '', 'type="date"', 'span-3')
      + '<div class="span-3" style="background:var(--primary-bg);border:1px solid var(--primary-border);border-radius:9px;padding:8px 12px;font-size:13px">'
      + '<strong>Dòng vật tư:</strong> ' + API.esc(item.ten_vat_tu || rfqItemId)
      + (item.ma_vat_tu ? ' <span class="badge">' + API.esc(item.ma_vat_tu) + '</span>' : '')
      + '</div>'
      + input('contractQuantity', 'Số lượng HĐ', val(item, 'quantity', 'so_luong') || '', 'inputmode="decimal" placeholder="0"', 'span-3')
      + input('contractUnitPrice', 'Đơn giá HĐ (VND)', '', 'inputmode="numeric" placeholder="0"', 'span-3')
      + contractDeadlineSection({})
      + textarea('note', 'Ghi chú', '', '', 'span-12 compact-ta');
    Utils.openModal('Tạo hợp đồng từ dòng vật tư', html, async function (form) {
      try {
        if (!validateContractDeadlinePayload(form)) return;
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
    setTimeout(_syncContractDeadlineFields, 0);
    Auth.applyRoleUI();
  }

  function openContractItemDeadlineModal(contractItemId) {
    var row = contractItemRowCache[contractItemId];
    if (!row) {
      API.toast('Không tìm thấy dòng hợp đồng', 'warn');
      return;
    }
    var html = ''
      + '<input type="hidden" name="signedDate" value="' + API.esc(row.signed_date || '') + '">'
      + '<div class="span-12" style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px">'
      + '<strong>' + API.esc(row.ten_vat_tu || row.contract_item_id || '') + '</strong>'
      + (row.contract_no ? '<div class="muted">HĐ: ' + API.esc(row.contract_no) + '</div>' : '')
      + '</div>'
      + contractDeadlineSection(row);
    Utils.openModal('Sửa thời hạn giao hàng', html, async function (form) {
      try {
        if (!validateContractDeadlinePayload(form)) return;
        form.contractItemId = contractItemId;
        await API.call('updateContractItem', form);
        Utils.closeModal();
        API.toast('Đã lưu thời hạn giao hàng', 'success');
        if (row.rfq_item_id) await loadContractItems(row.rfq_item_id);
        await load(true);
      } catch (err) {
        API.error(err);
      }
    });
    setTimeout(_syncContractDeadlineFields, 0);
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

  function getCurrentFilterParams() {
    return {
      q: _lastFilterParams.q || '',
      q2: _lastFilterParams.q2 || '',
      q3: _lastFilterParams.q3 || '',
      rfqId: _lastFilterParams.rfqId || '',
      status: _lastFilterParams.status || '',
      techFilter: _lastFilterParams.techFilter || '',
      sortBy: _lastFilterParams.sortBy || '',
      sortDir: _lastFilterParams.sortDir || '',
    };
  }

  async function exportCsv(template) {
    var tpl = template || 'chung';
    var selectedIds = _getSelectedItemIds();
    var cols = tpl === 'chung' ? _getExportCols() : [];
    var params = Object.assign({}, getCurrentFilterParams(), { exportTemplate: tpl });
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
    var selectedIds = _getSelectedItemIds();
    var cols = tpl === 'chung' ? _getExportCols() : [];
    var params = Object.assign({}, getCurrentFilterParams(), { exportTemplate: tpl });
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

  function _closeDonMenu() {
    var m = document.getElementById('rfqDonTplMenu');
    if (m) m.remove();
  }

  function openDonMenu(btn) {
    _closeDonMenu();
    var menu = document.createElement('div');
    menu.id = 'rfqDonTplMenu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--white,#fff);border:1px solid var(--border,#e5e7eb);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:200px;padding:4px 0;font-size:13px';
    var menuItems = [
      { key: 'don_giao_hang', label: 'Tạo đơn giao hàng' },
      { key: 'don_tra_hang',  label: 'Tạo đơn trả hàng' },
    ];
    menuItems.forEach(function (item) {
      var div = document.createElement('div');
      div.textContent = item.label;
      div.style.cssText = 'padding:8px 16px;cursor:pointer';
      div.onmouseenter = function () { div.style.background = 'var(--bg,#f3f4f6)'; };
      div.onmouseleave = function () { div.style.background = ''; };
      (function (k) {
        div.onclick = function () { _closeDonMenu(); openDonWorkflow(k); };
      }(item.key));
      menu.appendChild(div);
    });
    var rect = btn.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';
    document.body.appendChild(menu);
    setTimeout(function () {
      document.addEventListener('click', _closeDonMenu, { once: true });
    }, 0);
  }

  async function exportDon(type, format) {
    var selectedIds = _getSelectedItemIds();
    var params = Object.assign({}, getCurrentFilterParams(), { exportTemplate: type });
    if (selectedIds.length) params.selectedIds = selectedIds;
    var label = type === 'don_giao_hang' ? 'Đơn giao hàng' : 'Đơn trả hàng';

    try {
      var data = await API.call('exportRfqItemsJson', params);
      if (!data.ok) { API.error(data.error || 'Không thể xuất đơn'); return; }
      if (!data.row_count) { API.toast('Không có dữ liệu để xuất', 'warn'); return; }
      if (data.capped) API.toast('⚠ Kết quả bị giới hạn tối đa 5.000 dòng', 'warn');
      var rowMsg = selectedIds.length ? selectedIds.length + ' dòng đã chọn' : data.row_count + ' dòng';
      if (format === 'pdf') {
        _openDonPrintModal(data, label);
        API.toast('Xem trước ' + label + ' — ' + rowMsg, 'success');
      } else {
        _buildAndDownloadXlsx(data);
        API.toast('Đã xuất ' + label + ' XLSX — ' + rowMsg, 'success');
      }
    } catch (err) {
      API.error(err);
    }
  }

  // ---- Delivery note centered export workflow (don_giao_hang) ----

  async function openDonWorkflow(type) {
    var items = _getSelectedItems();
    if (!items.length) { API.toast('Chọn ít nhất 1 dòng vật tư', 'warn'); return; }
    if (!Utils.roleCanWrite()) { API.toast('Không có quyền tạo đơn giao hàng', 'error'); return; }
    var rfqIds = Array.from(new Set(items.map(function (r) { return r.rfq_id || ''; }).filter(Boolean)));
    if (rfqIds.length !== 1) { API.toast('Chỉ tạo đơn giao hàng cho các dòng trong cùng một RFQ', 'warn'); return; }
    var noteType = type === 'don_tra_hang' ? 'return' : 'delivery';
    _donWorkflowState = {
      type: type, noteType: noteType,
      items: items, rfqId: rfqIds[0],
      deliveryDate: todayYmd(),
      receiverUnit: '', receiverName: '',
      senderUnit: '', senderName: '',
      vehicleNo: '', headerNote: '',
      inputRows: null,
      qtyAdjust: false,
    };
    _openDonWorkflowStep1();
  }

  // Step 1: wide modal (modal--import-wide) — optional 16-column quantity adjustment table
  // needs horizontal space. Compact when "Không" is selected (table hidden).
  function _openDonWorkflowStep1() {
    var s         = _donWorkflowState;
    var typeLabel = s.type === 'don_giao_hang' ? 'Tạo đơn giao hàng' : 'Tạo đơn trả hàng';
    var d         = s.deliveryDate;
    var first     = s.items[0] || {};
    var maGoi     = first.ma_goi_tbmt || '';
    var tenGoi    = first.ten_goi     || '';
    var cdt       = first.ten_cdt || first.client_name || first.nha_may_cdt || '';
    var contractNo = first.contract_no || '';
    var fld = 'style="width:100%;font-size:13px"';
    var lbl = 'style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px"';

    // Context header: package identity separate from logistics form
    var ctxHtml = '<div style="background:var(--bg,#f9fafb);border:1px solid var(--border);border-radius:6px;'
      + 'padding:10px 16px;display:flex;flex-wrap:wrap;gap:10px 32px;align-items:flex-start">'
      + '<div><span style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">Mã gói</span>'
        + '<span style="font-size:13px;font-family:monospace;font-weight:600">'
        + (maGoi ? API.esc(maGoi) : '<span style="color:var(--text-faint)">—</span>') + '</span></div>'
      + '<div style="flex:1;min-width:200px"><span style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">Tên gói</span>'
        + '<span style="font-size:13px;font-weight:600">'
        + (tenGoi ? API.esc(tenGoi) : '<span style="color:var(--text-faint)">—</span>') + '</span></div>'
      + (cdt ? '<div style="flex:1;min-width:180px"><span style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">CĐT</span>'
        + '<span style="font-size:13px">' + API.esc(cdt) + '</span></div>' : '')
      + (contractNo ? '<div><span style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:2px">Số HĐ</span>'
        + '<span style="font-size:13px;font-family:monospace">' + API.esc(contractNo) + '</span></div>' : '')
      + '</div>';

    // 3-column logistics form
    var formHtml = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 20px">'
      + '<div><label ' + lbl + '>Ngày giao *</label>'
        + '<input id="donWfDate" name="donWfDate" type="date" value="' + API.esc(d) + '" ' + fld + '></div>'
      + '<div><label ' + lbl + '>Mã đơn (dự kiến)</label>'
        + '<input id="donWfPreviewNo" type="text" readonly value="..."'
        + ' style="width:100%;font-size:13px;color:var(--text-muted);background:var(--bg,#f9fafb)"></div>'
      + '<div><label ' + lbl + '>Biển số xe</label>'
        + '<input id="donWfVehicleNo" type="text" placeholder="(tùy chọn)" ' + fld + '></div>'
      + '<div><label ' + lbl + '>Bên nhận</label>'
        + '<input id="donWfReceiverUnit" type="text" value="' + API.esc(cdt) + '" placeholder="Tên đơn vị nhận" ' + fld + '></div>'
      + '<div><label ' + lbl + '>Người nhận</label>'
        + '<input id="donWfReceiverName" type="text" placeholder="Họ tên người nhận" ' + fld + '></div>'
      + '<div></div>'
      + '<div><label ' + lbl + '>Bên giao</label>'
        + '<input id="donWfSenderUnit" type="text" placeholder="Tên đơn vị giao" ' + fld
        + ' oninput="RfqItemsModule._donSenderAc(this)" autocomplete="off"></div>'
      + '<div><label ' + lbl + '>Người giao</label>'
        + '<input id="donWfSenderName" type="text" placeholder="Họ tên người giao" ' + fld + '></div>'
      + '<div></div>'
      + '<div style="grid-column:1/-1"><label ' + lbl + '>Ghi chú chung</label>'
        + '<input id="donWfNote" type="text" placeholder="(tùy chọn)" ' + fld + '></div>'
      + '</div>';

    var html = '<div class="span-12" style="display:grid;gap:14px">'
      + ctxHtml
      + formHtml
      + '<div style="border-top:1px solid var(--border);padding-top:12px">'
        + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'
          + '<span style="font-size:13px;font-weight:500">Điều chỉnh số lượng giao hàng?</span>'
          + '<button type="button" id="donWfQtyNo" onclick="RfqItemsModule._donStep1Qty(false)"'
            + ' style="padding:3px 14px;border-radius:6px;border:1px solid var(--border);background:var(--primary);color:#fff;font-weight:600;cursor:pointer">Không</button>'
          + '<button type="button" id="donWfQtyYes" onclick="RfqItemsModule._donStep1Qty(true)"'
            + ' style="padding:3px 14px;border-radius:6px;border:1px solid var(--border);background:var(--white);cursor:pointer">Có</button>'
        + '</div>'
        + '<div id="donWfQtyTable" style="display:none">' + deliveryQuantityTable(s.items) + '</div>'
      + '</div>'
      + '</div>';

    Utils.openModal(typeLabel + ' — Bước 1/2', html, _donStep1Submit);
    setTimeout(function () {
      var m = document.querySelector('#modal .modal');
      if (m) m.classList.add('modal--import-wide');
      _updateDonPreviewNo();
    }, 0);
  }

  function normDateVal(v) {
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((v + '').trim());
    return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : '';
  }

  async function _updateDonPreviewNo() {
    var s = _donWorkflowState;
    var inp = document.getElementById('donWfPreviewNo');
    if (!inp) return;
    var d = normDateVal((document.querySelector('[name="donWfDate"]') || {}).value || '') || s.deliveryDate;
    inp.value = '...';
    try {
      var res = await API.call('previewDeliveryNoteNo', { deliveryDate: d, noteType: s.noteType });
      if (res && res.ok) inp.value = res.no;
    } catch (e) { inp.value = '—'; }
  }

  var _donSenderAcTimer = null;
  function _donSenderAc(inp) {
    clearTimeout(_donSenderAcTimer);
    var dd = document.getElementById('don-sender-ac-dd');
    if (dd) dd.remove();
    var q = inp.value.trim();
    if (q.length < 2) return;
    _donSenderAcTimer = setTimeout(async function () {
      try {
        var data = await API.get('getClients', { q: q, limit: 8 });
        if (!data.ok || !data.rows || !data.rows.length) return;
        var dd2 = document.createElement('div');
        dd2.id = 'don-sender-ac-dd';
        dd2.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid var(--border-mid);'
          + 'border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.12);overflow:hidden';
        var rect = inp.getBoundingClientRect();
        dd2.style.top = (rect.bottom + 2) + 'px';
        dd2.style.left = rect.left + 'px';
        dd2.style.minWidth = rect.width + 'px';
        dd2.style.maxWidth = '420px';
        data.rows.forEach(function (c) {
          var name = c.plant_name || c.client_name || c.legal_name || '';
          if (!name) return;
          var it = document.createElement('div');
          it.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)';
          it.textContent = name;
          it.onmouseover = function () { it.style.background = 'var(--primary-lt,#fef3c7)'; };
          it.onmouseout  = function () { it.style.background = ''; };
          it.onmousedown = function (e) {
            e.preventDefault();
            inp.value = name;
            dd2.remove();
          };
          dd2.appendChild(it);
        });
        document.body.appendChild(dd2);
        setTimeout(function () {
          document.addEventListener('click', function () { dd2.remove(); }, { once: true });
        }, 10);
      } catch (e) {}
    }, 250);
  }

  function _donStep1Qty(show) {
    var table = document.getElementById('donWfQtyTable');
    var btnNo  = document.getElementById('donWfQtyNo');
    var btnYes = document.getElementById('donWfQtyYes');
    if (!table) return;
    if (_donWorkflowState) _donWorkflowState.qtyAdjust = !!show;
    table.style.display = show ? '' : 'none';
    if (show) {
      btnYes.style.background = 'var(--primary)'; btnYes.style.color = '#fff'; btnYes.style.fontWeight = '600';
      btnNo.style.background  = 'var(--white)';   btnNo.style.color  = '';     btnNo.style.fontWeight  = '';
    } else {
      btnNo.style.background  = 'var(--primary)'; btnNo.style.color  = '#fff'; btnNo.style.fontWeight  = '600';
      btnYes.style.background = 'var(--white)';   btnYes.style.color = '';     btnYes.style.fontWeight = '';
    }
  }

  async function _donStep1Submit() {
    var s       = _donWorkflowState;
    var dateVal = normDateVal((document.querySelector('[name="donWfDate"]') || {}).value || '');
    if (!dateVal) { API.toast('Vui lòng chọn ngày giao', 'warn'); return; }
    s.deliveryDate  = dateVal;
    s.receiverUnit  = (document.getElementById('donWfReceiverUnit') || {}).value || '';
    s.receiverName  = (document.getElementById('donWfReceiverName') || {}).value || '';
    s.senderUnit    = (document.getElementById('donWfSenderUnit')   || {}).value || '';
    s.senderName    = (document.getElementById('donWfSenderName')   || {}).value || '';
    s.vehicleNo     = (document.getElementById('donWfVehicleNo')    || {}).value || '';
    s.headerNote    = (document.getElementById('donWfNote')         || {}).value || '';

    var useTable = s.qtyAdjust === true;
    var inputRows = [];
    var invalid = false;
    var over = false;

    if (useTable) {
      var trows = document.querySelectorAll('#donWfQtyTable tbody tr[data-rfq-item-id]');
      Array.prototype.forEach.call(trows, function (tr) {
        var id      = tr.getAttribute('data-rfq-item-id');
        var item    = s.items.find(function (r) { return r.rfq_item_id === id; });
        var qtyInp  = tr.querySelector('input[data-qty]');
        var noteInp = tr.querySelector('input[data-line-note]');
        var qty     = toQty(qtyInp ? qtyInp.value : 0);
        if (qty < 0) invalid = true;
        if (item && qty + toQty(item.delivered_quantity_total) > toQty(item.contract_quantity_total)) over = true;
        inputRows.push({ rfqItemId: id, deliveredQuantity: qty, note: noteInp ? (noteInp.value || '') : '' });
      });
    } else {
      // "Không điều chỉnh": compute remaining from best available contract qty
      inputRows = s.items.map(function (r) {
        var contractQty = toQty(r.contract_quantity_total) || toQty(r.so_luong) || toQty(r.quantity) || 0;
        var deliveredBefore = toQty(r.delivered_quantity_total) || 0;
        var remaining = Math.max(contractQty - deliveredBefore, 0);
        return { rfqItemId: r.rfq_item_id, deliveredQuantity: remaining, note: '' };
      });
    }

    if (invalid) { API.toast('Số lượng giao phải lớn hơn hoặc bằng 0', 'warn'); return; }

    var zeroCount = inputRows.filter(function (r) { return r.deliveredQuantity === 0; }).length;
    if (zeroCount === inputRows.length) {
      API.toast('Tất cả dòng có số lượng bằng 0. Vui lòng chọn "Có" để điều chỉnh số lượng.', 'warn');
      return;
    }
    if (zeroCount > 0) {
      API.toast(zeroCount + ' dòng có SL = 0 đã bỏ qua.', 'warn');
      inputRows = inputRows.filter(function (r) { return r.deliveredQuantity > 0; });
    }
    if (over) {
      var ok = await confirmDeliveryChoice(
        'Cảnh báo số lượng',
        'Số lượng giao vượt số lượng hợp đồng. Bạn có muốn tiếp tục?',
        'Có', 'Không'
      );
      if (!ok) return;
    }

    s.inputRows = inputRows;
    Utils.closeModal();
    _openDonWorkflowStep2();
  }

  // Step 2: compact confirmation modal — no modal--import-wide, span-12 outer wrapper,
  // table-layout:fixed so all columns fit without horizontal scroll.
  function _openDonWorkflowStep2() {
    var s         = _donWorkflowState;
    var typeLabel  = s.type === 'don_giao_hang' ? 'Tạo đơn giao hàng' : 'Tạo đơn trả hàng';
    var prefix     = s.type === 'don_giao_hang' ? 'DGH' : 'DTH';
    var d          = s.deliveryDate;
    var previewNo  = prefix + '-' + d.slice(0, 4) + '-' + d.slice(5, 7) + d.slice(8, 10) + '-???';
    var totalQty   = s.inputRows.reduce(function (acc, r) { return acc + r.deliveredQuantity; }, 0);
    var first      = s.items[0] || {};
    var today      = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

    function kv(label, value) {
      return '<tr>'
        + '<td style="padding:4px 8px 4px 0;color:var(--text-muted);font-size:12px;white-space:nowrap;width:160px">' + label + '</td>'
        + '<td style="padding:4px 0;font-size:13px">' + API.esc(String(value || '—')) + '</td>'
        + '</tr>';
    }

    // Item preview rows
    var itemPreview = s.inputRows.map(function (inp) {
      var it  = s.items.find(function (x) { return x.rfq_item_id === inp.rfqItemId; }) || {};
      var dd  = it.delivery_deadline_date || '';
      var diff = dd ? Math.round((new Date(dd + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000) : null;
      var dlHtml = dd
        ? API.esc(dd) + (Number.isFinite(diff)
            ? ' <span style="font-size:10px;color:' + (diff < 0 ? 'var(--red)' : 'var(--text-muted)') + '">('
              + (diff < 0 ? 'Trễ ' + Math.abs(diff) : 'Còn ' + diff) + 'ng)</span>' : '')
        : '—';
      return '<tr>'
        + '<td style="padding:3px 8px;font-size:11px;font-family:monospace">' + API.esc(it.ma_vat_tu || '') + '</td>'
        + '<td style="padding:3px 8px;font-size:12px">' + API.esc(it.ten_vat_tu || '') + '</td>'
        + '<td style="padding:3px 8px;font-size:11px">' + dlHtml + '</td>'
        + '<td style="padding:3px 8px;text-align:right;font-weight:600">' + API.esc(String(inp.deliveredQuantity)) + '</td>'
        + '<td style="padding:3px 8px;font-size:11px;color:var(--text-muted)">' + API.esc(inp.note || '') + '</td>'
        + '</tr>';
    }).join('');

    var html = '<div class="span-12" style="display:grid;gap:16px">'
      + '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 32px">'
        + '<table style="width:100%;min-width:0;font-size:13px;border-collapse:collapse">'
        + kv('Loại đơn:', typeLabel)
        + kv('Mã đơn (dự kiến):', previewNo)
        + kv('Mã gói:', first.ma_goi_tbmt || '')
        + kv('Tên gói:', first.ten_goi || '')
        + ((first.ten_cdt || first.client_name || first.nha_may_cdt) ? kv('CĐT:', first.ten_cdt || first.client_name || first.nha_may_cdt) : '')
        + (first.contract_no ? kv('Số HĐ:', first.contract_no) : '')
        + '</table>'
        + '<table style="width:100%;min-width:0;font-size:13px;border-collapse:collapse">'
        + kv('Ngày giao:', s.deliveryDate)
        + kv('Bên nhận:', s.receiverUnit)
        + kv('Người nhận:', s.receiverName)
        + kv('Bên giao:', s.senderUnit)
        + kv('Người giao:', s.senderName)
        + (s.vehicleNo ? kv('Biển số xe:', s.vehicleNo) : '')
        + kv('Tổng dòng:', s.inputRows.length + ' dòng')
        + kv('Tổng SL giao:', formatQty(totalQty))
        + (s.headerNote ? kv('Ghi chú:', s.headerNote) : '')
        + '</table>'
      + '</div>'
      + '<div>'
        + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:500">Danh sách vật tư (' + s.inputRows.length + ' dòng)</div>'
        + '<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:4px">'
        + '<table style="width:100%;table-layout:fixed;font-size:12px;border-collapse:collapse">'
        + '<colgroup>'
          + '<col style="width:90px">'
          + '<col>'
          + '<col style="width:88px">'
          + '<col style="width:64px">'
          + '<col style="width:110px">'
        + '</colgroup>'
        + '<thead><tr style="background:var(--bg)">'
          + '<th style="padding:4px 8px;text-align:left;font-size:11px">Mã vật tư</th>'
          + '<th style="padding:4px 8px;text-align:left;font-size:11px">Tên vật tư</th>'
          + '<th style="padding:4px 8px;font-size:11px">Deadline</th>'
          + '<th style="padding:4px 8px;text-align:right;font-size:11px">SL giao</th>'
          + '<th style="padding:4px 8px;text-align:left;font-size:11px">Ghi chú</th>'
        + '</tr></thead>'
        + '<tbody>' + itemPreview + '</tbody>'
        + '</table></div>'
      + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:4px">'
        + '<button type="button" onclick="RfqItemsModule._donWorkflowAction(\'create\')" style="padding:6px 18px;border-radius:6px;background:var(--primary);color:#fff;border:none;font-weight:600;cursor:pointer">Tạo đơn</button>'
        + '<button type="button" onclick="RfqItemsModule._donWorkflowAction(\'xlsx\')" style="padding:6px 18px;border-radius:6px;background:var(--white);color:var(--text);border:1px solid var(--border);cursor:pointer">Tạo đơn &amp; xuất XLSX</button>'
        + '<button type="button" onclick="RfqItemsModule._donWorkflowAction(\'pdf\')" style="padding:6px 18px;border-radius:6px;background:var(--white);color:var(--text);border:1px solid var(--border);cursor:pointer">Tạo đơn &amp; xuất PDF</button>'
        + '<button type="button" onclick="Utils.closeModal()" style="padding:6px 18px;border-radius:6px;background:var(--white);color:var(--text-muted);border:1px solid var(--border);cursor:pointer">Hủy</button>'
      + '</div>'
      + '</div>';

    Utils.openModal(typeLabel + ' — Bước 2/2', html, null);
  }

  async function _donWorkflowAction(action) {
    var s = _donWorkflowState;
    if (!s) return;
    var typeLabel = s.type === 'don_giao_hang' ? 'Đơn giao hàng' : 'Đơn trả hàng';
    try {
      var data = await API.call('createDeliveryNote', {
        rfqId:        s.rfqId,
        noteType:     s.noteType,
        deliveryDate: s.deliveryDate,
        receiverUnit: s.receiverUnit,
        receiverName: s.receiverName,
        senderUnit:   s.senderUnit,
        senderName:   s.senderName,
        vehicleNo:    s.vehicleNo,
        note:         s.headerNote,
        items:        s.inputRows,
      });
      if (!data.ok) { API.error(data.error || 'Không thể tạo đơn giao hàng'); return; }
      var note      = data.note;
      var noteItems = data.items || [];
      Utils.closeModal();
      API.toast('Đã tạo ' + typeLabel + ' ' + (note.delivery_note_no || ''), 'success');
      await load(true);
      if (action === 'xlsx' || action === 'pdf') {
        var exportData = _buildExportDataFromRows(s.items, s.inputRows, s.type, note);
        if (!exportData || !exportData.rows.length) { API.toast('Không có dữ liệu để xuất', 'warn'); return; }
        if (action === 'pdf') {
          _openDonPrintModal(exportData, typeLabel);
        } else {
          _buildDonXlsxFromTemplate(exportData);
        }
      }
    } catch (err) {
      API.error(err);
    }
  }

  function _buildExportDataFromRows(rfqItems, inputRows, noteType, note) {
    var isDelivery = noteType === 'don_giao_hang';
    var first      = rfqItems[0] || {};
    var preface    = [first.ma_goi_tbmt || '', first.ten_goi || '', first.ten_cdt || ''];
    var noteNo     = (note && note.delivery_note_no) || '';
    var prefix     = isDelivery ? 'DGH' : 'DTH';
    var filename   = prefix + (noteNo ? '-' + noteNo : '') + '.xlsx';
    var stt = 0;
    var rows = [];
    inputRows.forEach(function (inp) {
      var r = rfqItems.find(function (x) { return x.rfq_item_id === inp.rfqItemId; });
      if (!r) return;
      stt++;
      rows.push([
        stt,
        r.stt_goc || '',
        r.ma_vat_tu || '',
        r.ten_vat_tu || '',
        r.required_model || r.quy_cach_model_yeu_cau || r.quy_cach_final || '',
        r.vat_lieu || r.nhan_hieu || r.hang_final || r.brand || '',
        inp.deliveredQuantity,
        r.unit || r.don_vi || '',
        r.manufacturer || r.hang_goc_nsx_goc || r.hang_final || r.nhan_hieu || r.brand || '',
        r.ma_mua_sam || '',
        '',
        r.note || r.ghi_chu || '',
      ]);
    });
    return {
      templateKey:   noteType,
      headers:       ['序号\nSTT','合同序号\nSTT hợp đồng','物资编号\nMã vật tư','名称\nTên vật tư','规格型号\nMã quy cách','材质/品牌\nChất liệu/Thương hiệu','数量\nSố lượng','单位\nĐơn vị','原设备供货商/生产厂/品牌\nNhà CC/NSX/Thương hiệu','MIS需求单号\nMã yêu cầu MIS','MIS订单号\nMã đơn hàng MIS','备注\nGhi chú'],
      rows:          rows,
      preface:       preface,
      textCols:      [2],
      longTextCols:  [3, 4, 5, 8, 11],
      leftAlignCols: [3, 4, 5, 8, 11],
      filename:      filename,
      row_count:     rows.length,
    };
  }

  // ---- Export from existing Delivery Note (called by DeliveryNotesModule) ----

  function exportDeliveryNoteDoc(note, items, format) {
    var noteType  = note.note_type === 'return' ? 'don_tra_hang' : 'don_giao_hang';
    var typeLabel = note.note_type === 'return' ? 'Đơn trả hàng' : 'Đơn giao hàng';
    var rfqItems  = items.map(function (it) {
      return {
        rfq_item_id:    it.rfq_item_id,
        stt_goc:        it.stt_goc,
        ma_vat_tu:      it.ma_vat_tu,
        ten_vat_tu:     it.ten_vat_tu,
        required_model: it.required_model || it.quy_cach_final || '',
        quy_cach_final: it.quy_cach_final,
        vat_lieu:       [it.vat_lieu, it.brand || it.hang_final].filter(Boolean).join(' / '),
        hang_final:     it.hang_final,
        brand:          it.brand,
        manufacturer:   it.manufacturer || it.hang_final || it.brand || '',
        unit:           it.unit,
        note:           it.note,
        ma_goi_tbmt:    note.ma_goi_tbmt || '',
        ten_goi:        note.ten_goi || '',
        ten_cdt:        noteType === 'don_giao_hang' ? (note.receiver_unit || note.client_name || '') : (note.sender_unit || note.client_name || ''),
      };
    });
    var inputRows = items.map(function (it) {
      return { rfqItemId: it.rfq_item_id, deliveredQuantity: it.delivered_quantity };
    });
    var data = _buildExportDataFromRows(rfqItems, inputRows, noteType, note);
    if (!data || !data.rows.length) { API.toast('Không có dữ liệu để xuất', 'warn'); return; }
    data.deliveryDate = note.delivery_date  || '';
    data.receiverName = note.receiver_name  || '';
    data.senderName   = note.sender_name    || '';
    data.senderUnit   = note.sender_unit    || '';
    data.vehicleNo    = note.vehicle_no     || '';
    if (format === 'pdf') {
      _openDonPrintModal(data, typeLabel);
    } else {
      _buildDonXlsxFromTemplate(data);
    }
  }

  // ---- End delivery note centered export workflow ----

  function _buildAndDownloadXlsx(data) {
    if (data.templateKey === 'don_giao_hang' || data.templateKey === 'don_tra_hang') {
      _buildDonXlsx(data);
      return;
    }
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

  // Template-based export: fetches pre-formatted .xlsx from /assets/templates/,
  // fills cell values only (preserves all borders/merges/colors from template),
  // clears unused data rows. Falls back to _buildDonXlsx if template not found.
  //
  // Template layout expected (see assets/templates/README.md):
  //   Row 5  (r=4): col C (c=2)=tenGoi, col I (c=8)=maGoiTbmt
  //   Row 6  (r=5): col C (c=2)=recv unit (delivery) or col I (c=8)=send unit (return)
  //   Rows 10–109 (r=9..108): 100 pre-formatted blank data rows, 12 columns A–L
  async function _buildDonXlsxFromTemplate(data) {
    var isDelivery  = data.templateKey === 'don_giao_hang';
    var tplFile     = isDelivery ? '/assets/templates/vt1-don-giao-hang.xlsx' : '/assets/templates/vt1-don-tra-hang.xlsx';
    var rows        = data.rows;
    var nRows       = rows.length;
    var preface     = data.preface || ['', '', ''];
    var maGoiTbmt   = preface[0] || '';
    var tenGoi      = preface[1] || '';
    var tenCdt      = preface[2] || '';
    var textColSet  = new Set(data.textCols || []);

    var resp = null;
    try { resp = await fetch(tplFile); } catch (e) { resp = null; }

    if (!resp || !resp.ok) {
      API.toast('⚠ Chưa có file mẫu (' + tplFile + '), dùng định dạng tạm thời', 'warn');
      _buildDonXlsx(data);
      return;
    }

    var ab = await resp.arrayBuffer();
    var wb = XLSX.read(new Uint8Array(ab), { type: 'array', cellStyles: true });
    // Workbook has a hidden "Task" sheet as SheetNames[0] — actual form is "DN"
    var wsName = wb.SheetNames.find(function(n) { return n === 'DN'; }) || wb.SheetNames[0];
    var ws = wb.Sheets[wsName];

    // Template cell positions (0-based)
    var INFO_ROW1  = 4;   // Row 5:  tenGoi at col C(2), maGoiTbmt at col I(8)
    var INFO_ROW2  = 5;   // Row 6:  recv/return unit at col C(2) or I(8)
    var DATA_START = 8;   // Row 9:  first data row (headers at row 8 = r=7)
    var DATA_ROWS  = 100; // template has 100 pre-formatted blank data rows
    var NCOLS      = 12;

    function setVal(r, c, v, asText) {
      var addr = XLSX.utils.encode_cell({ r: r, c: c });
      var sv = String(v == null ? '' : v);
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].t = 's';
      ws[addr].v = sv;
      ws[addr].w = sv;
      delete ws[addr].f;
      if (asText) ws[addr].z = '@';
    }

    // Fill info block
    setVal(INFO_ROW1, 2, tenGoi);
    setVal(INFO_ROW1, 8, maGoiTbmt);
    if (isDelivery) {
      setVal(INFO_ROW2, 2, tenCdt); // 收货单位
      setVal(INFO_ROW2, 8, '');
    } else {
      setVal(INFO_ROW2, 2, '');
      setVal(INFO_ROW2, 8, tenCdt); // 送货单位 for return
    }
    if (data.deliveryDate || data.senderName) {
      setVal(6, 2, data.deliveryDate || '');
      setVal(6, 8, data.senderName   || '');
    }

    // Fill or clear the 100 template data rows
    for (var i = 0; i < DATA_ROWS; i++) {
      var r = DATA_START + i;
      if (i < nRows) {
        var rowData = rows[i];
        for (var c = 0; c < NCOLS; c++) {
          setVal(r, c, rowData[c] == null ? '' : rowData[c], textColSet.has(c));
        }
      } else {
        for (var c = 0; c < NCOLS; c++) {
          var addr = XLSX.utils.encode_cell({ r: r, c: c });
          if (ws[addr]) { ws[addr].t = 's'; ws[addr].v = ''; ws[addr].w = ''; delete ws[addr].f; }
        }
      }
    }

    if (nRows > DATA_ROWS) API.toast('⚠ Số dòng (' + nRows + ') vượt quá 100 dòng mẫu — một số dòng cuối có thể thiếu định dạng', 'warn');

    XLSX.writeFile(wb, data.filename);
  }

  function _buildDonXlsx(data) {
    var isDelivery = data.templateKey === 'don_giao_hang';
    var headers = data.headers;
    var rows = data.rows;
    var nCols = 12;
    var nRows = rows.length;
    var preface = data.preface || ['', '', ''];
    var maGoiTbmt = preface[0] || '';
    var tenGoi    = preface[1] || '';
    var tenCdt    = preface[2] || '';
    var textColSet = new Set(data.textCols || []);
    var leftColSet = new Set(data.leftAlignCols || []);

    // Row index constants (0-based)
    var R_COMP    = 0;   // company name CN — left blank, filled in template file if needed
    var R_COMP_VN = 1;   // company name VN — left blank, filled in template file if needed
    var R_BLANK1  = 2;   // narrow blank
    var R_TITLE   = 3;   // 送货单/退货单 title
    var R_INFO1   = 4;   // contract name / contract code
    var R_INFO2   = 5;   // receiving unit / sending unit
    var R_INFO3   = 6;   // date / sender
    var R_BLANK2  = 7;   // narrow blank before table
    var R_HDR     = 8;   // bilingual column headers
    var R_DATA    = 9;   // data rows start
    var R_FTR_BLK = R_DATA + nRows;      // blank before footer
    var R_FTR     = R_DATA + nRows + 1;  // footer row

    function blankRow() {
      var a = [];
      for (var k = 0; k < nCols; k++) a.push('');
      return a;
    }

    // ── AoA ──────────────────────────────────────────────────────────────────
    var aoa = [];

    // Company-name header rows stay blank: the fixed client name was removed
    // (same as cleared cells A1/A2 in the .xlsx templates).
    aoa.push(blankRow()); // R_COMP
    aoa.push(blankRow()); // R_COMP_VN

    aoa.push(blankRow()); // R_BLANK1

    var rTitle = blankRow();
    rTitle[0] = isDelivery ? '送货单  ĐƠN GIAO HÀNG' : '退货单  ĐƠN TRẢ HÀNG';
    aoa.push(rTitle);

    // info row 1: contract name (left) / contract code (right)
    var rI1 = blankRow();
    rI1[0] = '合同名称:\nTên Hợp đồng:';
    rI1[2] = tenGoi;
    rI1[6] = '合同编号:\nMã Hợp đồng:';
    rI1[8] = maGoiTbmt;
    aoa.push(rI1);

    // info row 2: recv/send unit
    var rI2 = blankRow();
    rI2[0] = isDelivery ? '收货单位:\nĐơn vị nhận hàng:' : '退货单位:\nĐơn vị trả hàng:';
    rI2[2] = isDelivery ? tenCdt : '';
    rI2[6] = '送货单位:\nĐơn vị giao hàng:';
    rI2[8] = isDelivery ? '' : tenCdt;
    aoa.push(rI2);

    // info row 3: date / sender
    var rI3 = blankRow();
    rI3[0] = '日期:\nThời gian:';
    rI3[6] = '送货人:\nNgười giao hàng:';
    aoa.push(rI3);

    aoa.push(blankRow()); // R_BLANK2

    aoa.push(headers.slice()); // R_HDR

    for (var di = 0; di < nRows; di++) aoa.push(rows[di].slice());

    aoa.push(blankRow()); // R_FTR_BLK

    // footer: left = signature, right = date
    var rFtr = blankRow();
    rFtr[0] = '收货人签字:\nNgười nhận hàng ký tên:';
    rFtr[6] = '日期:\nThời gian:';
    aoa.push(rFtr);

    // ── Worksheet ────────────────────────────────────────────────────────────
    var ws = XLSX.utils.aoa_to_sheet(aoa);

    // Force Mã vật tư as text in data rows
    textColSet.forEach(function (ci) {
      for (var ri = R_DATA; ri < R_DATA + nRows; ri++) {
        var addr = XLSX.utils.encode_cell({ r: ri, c: ci });
        if (ws[addr]) { ws[addr].t = 's'; ws[addr].z = '@'; }
      }
    });

    // ── Merges ───────────────────────────────────────────────────────────────
    ws['!merges'] = [
      // Company name rows: full width
      { s: { r: R_COMP,    c: 0 }, e: { r: R_COMP,    c: 11 } },
      { s: { r: R_COMP_VN, c: 0 }, e: { r: R_COMP_VN, c: 11 } },
      // Document title: full width
      { s: { r: R_TITLE, c: 0 }, e: { r: R_TITLE, c: 11 } },
      // Info rows: [0-1] label | [2-5] value | [6-7] label | [8-11] value
      { s: { r: R_INFO1, c: 0 }, e: { r: R_INFO1, c: 1  } },
      { s: { r: R_INFO1, c: 2 }, e: { r: R_INFO1, c: 5  } },
      { s: { r: R_INFO1, c: 6 }, e: { r: R_INFO1, c: 7  } },
      { s: { r: R_INFO1, c: 8 }, e: { r: R_INFO1, c: 11 } },
      { s: { r: R_INFO2, c: 0 }, e: { r: R_INFO2, c: 1  } },
      { s: { r: R_INFO2, c: 2 }, e: { r: R_INFO2, c: 5  } },
      { s: { r: R_INFO2, c: 6 }, e: { r: R_INFO2, c: 7  } },
      { s: { r: R_INFO2, c: 8 }, e: { r: R_INFO2, c: 11 } },
      { s: { r: R_INFO3, c: 0 }, e: { r: R_INFO3, c: 1  } },
      { s: { r: R_INFO3, c: 2 }, e: { r: R_INFO3, c: 5  } },
      { s: { r: R_INFO3, c: 6 }, e: { r: R_INFO3, c: 7  } },
      { s: { r: R_INFO3, c: 8 }, e: { r: R_INFO3, c: 11 } },
      // Footer: left signature block [0-5], right date block [6-11]
      { s: { r: R_FTR, c: 0 }, e: { r: R_FTR, c: 5  } },
      { s: { r: R_FTR, c: 6 }, e: { r: R_FTR, c: 11 } },
    ];

    // ── Column widths (wch = average char width) ──────────────────────────────
    ws['!cols'] = [
      { wch: 5  }, // 0  序号 STT
      { wch: 8  }, // 1  合同序号 STT HĐ
      { wch: 14 }, // 2  物资编号 Mã vật tư
      { wch: 26 }, // 3  名称 Tên vật tư  (long)
      { wch: 18 }, // 4  规格型号 Mã quy cách
      { wch: 16 }, // 5  材质/品牌
      { wch: 9  }, // 6  数量 Số lượng
      { wch: 7  }, // 7  单位 Đơn vị
      { wch: 20 }, // 8  原设备供货商 Nhà CC/NSX
      { wch: 14 }, // 9  MIS需求单号
      { wch: 14 }, // 10 MIS订单号
      { wch: 16 }, // 11 备注 Ghi chú
    ];

    // ── Row heights (hpt = points; 1 pt ≈ 1/72 in) ────────────────────────────
    var rowHts = {};
    rowHts[R_COMP]    = 24;
    rowHts[R_COMP_VN] = 22;
    rowHts[R_BLANK1]  = 5;
    rowHts[R_TITLE]   = 34;
    rowHts[R_INFO1]   = 36;
    rowHts[R_INFO2]   = 36;
    rowHts[R_INFO3]   = 36;
    rowHts[R_BLANK2]  = 5;
    rowHts[R_HDR]     = 44;
    for (var dhi = 0; dhi < nRows; dhi++) rowHts[R_DATA + dhi] = 20;
    rowHts[R_FTR_BLK] = 10;
    rowHts[R_FTR]     = 34;

    ws['!rows'] = [];
    Object.keys(rowHts).forEach(function (ri) {
      ws['!rows'][parseInt(ri, 10)] = { hpt: rowHts[ri] };
    });

    // Freeze through column header row
    ws['!freeze'] = { xSplit: 0, ySplit: R_DATA };

    // Page setup: A4 portrait, fit to 1 page wide
    ws['!pageSetup'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0, fitToPage: true };
    ws['!margins']   = { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };

    // ── Styles ────────────────────────────────────────────────────────────────
    try {
      var thin   = { style: 'thin' };
      var border = { top: thin, bottom: thin, left: thin, right: thin };

      // Helper: ensure cell exists, apply style
      function cs(r, c, style) {
        var addr = XLSX.utils.encode_cell({ r: r, c: c });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = style;
      }

      // Company name rows
      cs(R_COMP, 0, {
        font: { bold: true, sz: 13 },
        alignment: { horizontal: 'center', vertical: 'center' },
      });
      cs(R_COMP_VN, 0, {
        font: { bold: true, sz: 12 },
        alignment: { horizontal: 'center', vertical: 'center' },
      });

      // Document title: bold, large, gray fill
      cs(R_TITLE, 0, {
        font: { bold: true, sz: 14 },
        alignment: { horizontal: 'center', vertical: 'center' },
        fill: { patternType: 'solid', fgColor: { rgb: 'D9D9D9' } },
      });

      // Info block: top-left cell of each merged region gets border + alignment
      var lblSt = {
        font: { bold: true, sz: 10 },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
        border: border,
      };
      var valSt = {
        font: { sz: 10 },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
        border: border,
      };
      [R_INFO1, R_INFO2, R_INFO3].forEach(function (r) {
        cs(r, 0, lblSt);  // left label  [cols 0-1]
        cs(r, 2, valSt);  // left value  [cols 2-5]
        cs(r, 6, lblSt);  // right label [cols 6-7]
        cs(r, 8, valSt);  // right value [cols 8-11]
      });

      // Table header row
      var hdrSt = {
        font: { bold: true, sz: 10 },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        fill: { patternType: 'solid', fgColor: { rgb: 'BDD7EE' } },
        border: border,
      };
      for (var hc = 0; hc < nCols; hc++) cs(R_HDR, hc, hdrSt);

      // Data rows
      for (var dr = R_DATA; dr < R_DATA + nRows; dr++) {
        for (var dc = 0; dc < nCols; dc++) {
          var da = XLSX.utils.encode_cell({ r: dr, c: dc });
          if (ws[da]) {
            ws[da].s = leftColSet.has(dc)
              ? { font: { sz: 10 }, alignment: { horizontal: 'left',   vertical: 'center', wrapText: true }, border: border }
              : { font: { sz: 10 }, alignment: { horizontal: 'center', vertical: 'center' },                  border: border };
          }
        }
      }

      // Footer: label + bottom border to serve as signature line
      var ftrSt = {
        font: { bold: true, sz: 10 },
        alignment: { horizontal: 'left', vertical: 'bottom', wrapText: true },
        border: { bottom: thin },
      };
      cs(R_FTR, 0, ftrSt); // left: 收货人签字 / Người nhận hàng ký tên
      cs(R_FTR, 6, ftrSt); // right: 日期 / Thời gian
    } catch (e) {}

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, data.filename);
  }

  function _openDonPrintModal(data, label) {
    var isDelivery = data.templateKey === 'don_giao_hang';
    var headers    = data.headers;
    var rows       = data.rows;
    var preface    = data.preface || ['', '', ''];
    var maGoiTbmt  = preface[0] || '';
    var tenGoi     = preface[1] || '';
    var tenCdt     = preface[2] || '';
    var leftColSet = new Set(data.leftAlignCols || []);
    var titleLabel = label || (isDelivery ? 'Đơn giao hàng' : 'Đơn trả hàng');

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
    }

    var titleText = isDelivery ? '送货单  ĐƠN GIAO HÀNG' : '退货单  ĐƠN TRẢ HÀNG';
    var recvLabel = isDelivery ? '收货单位:<br>Đơn vị nhận hàng:' : '退货单位:<br>Đơn vị trả hàng:';
    var recvVal   = isDelivery ? esc(tenCdt) : '';
    var sendVal   = isDelivery ? '' : esc(tenCdt);

    // ── Unified SVG layout — all borders are SVG vectors, zero CSS borders ──────
    // Layout constants (mm)
    var TTL_H     = 10;   // title bar
    var INF_ROW_H = 10;   // info block row height (3 rows)
    var HDR_H     = 16;   // item header
    var ROW_H     = 14;   // item data row (fixed — text clips, no layout shift)
    var FTR_H     = 22;   // footer area
    var nRows     = rows.length;

    var INF_Y  = TTL_H;
    var ITEM_Y = INF_Y + 3 * INF_ROW_H;
    var FTR_Y  = ITEM_Y + HDR_H + nRows * ROW_H;
    var DOC_H  = FTR_Y + FTR_H;

    // Column % widths
    var INF_W = [15, 35, 15, 35];  // info block: lb|val|lb|val
    var infL  = [0]; INF_W.forEach(function (w) { infL.push(infL[infL.length - 1] + w); });

    var ITEM_W = [3, 5, 9, 16, 14, 10, 6, 5, 14, 8, 6, 4];  // 12 item cols
    var itemL  = [0]; ITEM_W.forEach(function (w) { itemL.push(itemL[itemL.length - 1] + w); });

    // SVG drawing helpers — stroke-width 0.6 for all lines
    var SK = 'stroke="#000" stroke-width="0.6"';
    function epln(s) {  // plain HTML escape (no \n conversion)
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function vl(xp, y1, y2) { return '<line x1="'+xp+'%" y1="'+y1+'mm" x2="'+xp+'%" y2="'+y2+'mm" '+SK+'/>'; }
    function hl(y, x1, x2)  { return '<line x1="'+x1+'" y1="'+y+'mm" x2="'+x2+'" y2="'+y+'mm" '+SK+'/>'; }
    function sr(y, h)        { return '<rect x="0" y="'+y+'mm" width="100%" height="'+h+'mm" fill="none" '+SK+'/>'; }

    var sp = ['<svg width="100%" height="'+DOC_H+'mm" style="position:absolute;top:0;left:0;overflow:visible;display:block">'];
    // Title bar
    sp.push(sr(0, TTL_H));
    // Info block: outer rect + 3 vertical + 2 horizontal dividers
    sp.push(sr(INF_Y, 3 * INF_ROW_H));
    [1, 2, 3].forEach(function (ci) { sp.push(vl(infL[ci], INF_Y, INF_Y + 3 * INF_ROW_H)); });
    sp.push(hl(INF_Y + INF_ROW_H,     '0', '100%'));
    sp.push(hl(INF_Y + 2 * INF_ROW_H, '0', '100%'));
    // Item grid: outer rect + 11 vertical + header separator + row separators
    var itemH = HDR_H + nRows * ROW_H;
    sp.push(sr(ITEM_Y, itemH));
    for (var ci = 1; ci <= 11; ci++) sp.push(vl(itemL[ci], ITEM_Y, ITEM_Y + itemH));
    sp.push(hl(ITEM_Y + HDR_H, '0', '100%'));
    for (var ri = 1; ri < nRows; ri++) sp.push(hl(ITEM_Y + HDR_H + ri * ROW_H, '0', '100%'));
    // Footer: two separate signature lines (horizontal only, no box)
    var sigY = FTR_Y + 6;
    sp.push(hl(sigY, '2%',  '47%'));
    sp.push(hl(sigY, '53%', '98%'));
    sp.push('</svg>');
    var svgHtml = sp.join('');

    // Overlay helper: abs-positioned div that sits above the SVG for text content
    function od(lp, tm, wp, hm, html, styl) {
      return '<div style="position:absolute;left:'+lp+'%;top:'+tm+'mm;'
        +'width:'+wp+'%;height:'+hm+'mm;overflow:hidden;box-sizing:border-box;'+styl+'">'+html+'</div>';
    }
    var FC  = 'display:flex;align-items:center;justify-content:center;text-align:center;';
    var FL  = 'display:flex;align-items:center;justify-content:flex-start;text-align:left;';
    var P2  = 'padding:1mm 2mm;';
    var P15 = 'padding:1mm 1.5mm;';
    var F12B = 'font-size:12pt;font-weight:bold;line-height:1.2;'+P2;
    var F8B  = 'font-size:8pt;font-weight:bold;line-height:1.25;'+P2;
    var F8   = 'font-size:8pt;line-height:1.25;'+P2;
    var F7B  = 'font-size:7pt;font-weight:bold;line-height:1.15;padding:1mm 1mm;';

    var ovs = [];

    // Title bar (centered bold text)
    ovs.push(od(0, 0, 100, TTL_H, epln(titleText), FC + F12B));

    // Info block (3 rows × 4 cols)
    var infoRows = [
      [ { h: '合同名称:<br>Tên Hợp đồng:', v: esc(tenGoi)    },
        { h: '合同编号:<br>Mã Hợp đồng:',  v: esc(maGoiTbmt) } ],
      [ { h: recvLabel,                     v: recvVal         },
        { h: '送货单位:<br>Đơn vị giao hàng:', v: sendVal     } ],
      [ { h: '日期:<br>Thời gian:',         v: ''              },
        { h: '送货人:<br>Người giao hàng:', v: ''              } ],
    ];
    infoRows.forEach(function (row, ir) {
      var tm = INF_Y + ir * INF_ROW_H;
      ovs.push(od(infL[0], tm, INF_W[0], INF_ROW_H, row[0].h, FL + F8B));
      ovs.push(od(infL[1], tm, INF_W[1], INF_ROW_H, row[0].v, FL + F8 ));
      ovs.push(od(infL[2], tm, INF_W[2], INF_ROW_H, row[1].h, FL + F8B));
      ovs.push(od(infL[3], tm, INF_W[3], INF_ROW_H, row[1].v, FL + F8 ));
    });

    // Item header (bilingual, two <span> lines, centered)
    var FHDR = 'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;' + F7B;
    headers.forEach(function (h, ci) {
      var lines = String(h == null ? '' : h).split('\n');
      var html = lines.map(function (l) { return '<span style="display:block">'+epln(l)+'</span>'; }).join('');
      ovs.push(od(itemL[ci], ITEM_Y, ITEM_W[ci], HDR_H, html, FHDR));
    });

    // Item data rows
    rows.forEach(function (row, ri) {
      var tm = ITEM_Y + HDR_H + ri * ROW_H;
      row.forEach(function (v, ci) {
        var isL = leftColSet.has(ci);
        ovs.push(od(itemL[ci], tm, ITEM_W[ci], ROW_H,
          esc(String(v == null ? '' : v)),
          (isL ? FL : FC) + 'font-size:8pt;line-height:1.2;' + (isL ? P15 : P2)));
      });
    });

    // Footer text (below signature lines)
    ovs.push(od(2,  sigY, 45, FTR_H - 6, '收货人签字:<br>Người nhận hàng ký tên:', FL + F8B));
    ovs.push(od(53, sigY, 45, FTR_H - 6, '日期:<br>Thời gian:', FL + F8B));

    // @page lives here (top-level in DOM) — applies while element is in document
    var printCss = [
      '@page{size:A4 landscape;margin:8mm}',
      '.don-pa *{box-sizing:border-box}',
      '.don-pa{font-family:Arial,sans-serif;font-size:9pt;color:#000}',
      '.don-cn{text-align:center;font-weight:bold;font-size:12pt;margin-bottom:1px}',
      '.don-vn{text-align:center;font-weight:bold;font-size:10pt;margin-bottom:4px}',
    ].join('\n');

    var docHtml = '<style>' + printCss + '</style>'
      + '<div class="don-pa">'
      + '<div class="don-cn">越南永新一期电力有限公司</div>'
      + '<div class="don-vn">Công ty TNHH điện lực Vĩnh Tân 1</div>'
      + '<div style="position:relative;width:100%;height:' + DOC_H + 'mm">'
      +   svgHtml + ovs.join('')
      + '</div>'
      + '</div>';

    var existing = document.getElementById('donPrintBackdrop');
    if (existing) document.body.removeChild(existing);

    var backdrop = document.createElement('div');
    backdrop.id = 'donPrintBackdrop';
    backdrop.innerHTML =
        '<div id="donPrintToolbar">'
      +   '<span class="dpt-title">' + esc(titleLabel) + ' — ' + rows.length + ' dòng</span>'
      +   '<div class="dpt-actions">'
      +     '<button type="button" class="dpt-close" id="donPrintClose">Đóng</button>'
      +     '<button type="button" class="dpt-print" id="donPrintBtn">In đơn</button>'
      +   '</div>'
      + '</div>'
      + '<div id="donPrintScroll">'
      +   '<div id="donPrintPaper">' + docHtml + '</div>'
      + '</div>';

    document.body.appendChild(backdrop);

    function closeDonPreview() { document.body.removeChild(backdrop); }
    document.getElementById('donPrintClose').onclick = closeDonPreview;
    document.getElementById('donPrintBtn').onclick   = function () { window.print(); };
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
      var created  = s.created  || 0;
      var updated  = s.updated  || 0;
      var skipped  = s.skipped  || 0;
      var errors   = s.errors   || 0;
      var parts = ['cập nhật ' + updated, 'bỏ qua ' + skipped];
      if (errors)  parts.push(errors  + ' lỗi');
      if (created) parts.push('⚠ tạo mới ' + created + ' (không mong đợi trong chế độ này)');
      var toastType = (errors || created) ? 'warn' : 'success';
      Utils.closeModal();
      API.toast('Cập nhật DS vật tư: ' + parts.join(', ') + ' dòng', toastType);
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
              + '<input type="checkbox" name="overwriteField" value="' + API.esc(f) + '"' + (defaultChecked ? ' checked' : '') + ' onchange="RfqItemsModule._refreshOverwriteSummary()">'
              + API.esc(label) + hint + '</label>';
          }).join('')
        + '</div>'
        + '<div id="selectiveUpdateSummary" style="margin-top:6px;font-size:11px;color:var(--text-faint)"></div>'
        + '</div>'
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
    if (radio && radio.value === 'selective_update') _refreshOverwriteSummary();
  }

  function _refreshOverwriteSummary() {
    var el = document.getElementById('selectiveUpdateSummary');
    if (!el) return;
    var checked = Array.from(document.querySelectorAll('#importOverwriteSection input[name="overwriteField"]:checked'));
    if (!checked.length) { el.textContent = 'Chưa chọn trường nào.'; return; }
    var labels = checked.map(function (cb) {
      var pair = IMPORT_TARGET_FIELDS.find(function (p) { return p[0] === cb.value; });
      return pair ? pair[1] : cb.value;
    });
    el.innerHTML = 'Ghi đè: ' + labels.map(function (l) {
      return '<span style="background:var(--bg-alt,var(--bg));border:1px solid var(--border);border-radius:3px;padding:0 4px;margin-right:2px">' + API.esc(l) + '</span>';
    }).join('');
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

    // selective_update: confirm columns + row count before committing
    if (importMode === 'selective_update') {
      var fieldLabels = overwriteFields.map(function (f) {
        var pair = IMPORT_TARGET_FIELDS.find(function (p) { return p[0] === f; });
        return pair ? pair[1] : f;
      }).join(', ');
      var totalRows = (importMapState._pendingAllRows || []).length;
      var ok = await Utils.confirmDanger(
        'Xác nhận ghi đè hàng loạt',
        'Bạn sắp ghi đè ' + overwriteFields.length + ' cột (' + fieldLabels + ') trên ' + totalRows + ' dòng. Không thể hoàn tác. Tiếp tục?',
        'Tiếp tục',
        'Hủy'
      );
      if (!ok) { if (btn) btn.disabled = false; return; }
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
    var totalCreated = 0, totalUpdated = 0, totalSkipped = 0, totalSkippedUnmatched = 0, totalErrors = 0;
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
      totalSkippedUnmatched += Number(s.skippedUnmatched || 0);
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
        skippedUnmatched: totalSkippedUnmatched,
        errors: totalErrors,
        rowErrors: allRowErrors,
      },
    };
  }

  function renderImportResult(summary) {
    var area = document.getElementById('importMapArea');
    if (!area) return;
    var errors = summary.rowErrors || [];
    var unmatchedNote = Number(summary.skippedUnmatched || 0) > 0
      ? '<p style="margin:2px 0;color:var(--primary)">⚠ Không tìm thấy dòng khớp: ' + Number(summary.skippedUnmatched) + ' dòng bị bỏ qua (không có trong RFQ hiện tại)</p>'
      : '';
    var html = '<div style="border-left:3px solid ' + (summary.errors ? 'var(--primary)' : 'var(--green)') + ';padding-left:10px;margin-bottom:10px">'
      + '<p style="margin:2px 0"><strong>Import job:</strong> ' + API.esc(summary.jobId || '') + '</p>'
      + '<p style="margin:2px 0"><strong>Tổng:</strong> ' + Number(summary.totalRows || 0)
      + ' | Tạo mới: ' + Number(summary.created || 0)
      + ' | Cập nhật: ' + Number(summary.updated || 0)
      + ' | Bỏ qua: ' + Number(summary.skipped || 0)
      + ' | Lỗi: ' + Number(summary.errors || 0) + '</p>'
      + unmatchedNote
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
    openDonMenu: openDonMenu,
    openDonWorkflow: openDonWorkflow,
    _donStep1Qty: _donStep1Qty,
    _updateDonPreviewNo: _updateDonPreviewNo,
    _donSenderAc: _donSenderAc,
    _donWorkflowAction: _donWorkflowAction,
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
    _refreshOverwriteSummary: _refreshOverwriteSummary,
    _checkAndConfirmModeC: _checkAndConfirmModeC,
    _commitSimpleUpdate: _commitSimpleUpdate,
    filterByRfq: filterByRfq,
    openRfqForAddendum: openRfqForAddendum,
    loadPriceHistory: loadPriceHistory,
    exportPriceHistory: exportPriceHistory,
    loadContractItems: loadContractItems,
    openContractFromRfqItemModal: openContractFromRfqItemModal,
    openContractItemDeadlineModal: openContractItemDeadlineModal,
    openContractAddendumModal: openContractAddendumModal,
    archiveContractAddendum: archiveContractAddendum,
    toggleContractAddendumItems: toggleContractAddendumItems,
    openContractAddendumItemModal: openContractAddendumItemModal,
    archiveContractAddendumItem: archiveContractAddendumItem,
    openRevisionHistory: openRevisionHistory,
    archiveRfqItem: archiveRfqItem,
    exportDeliveryNoteDoc: exportDeliveryNoteDoc,
    openCreateDeliveryForSelected: openCreateDeliveryForSelected,
    toggleDeliveryFilterMenu: toggleDeliveryFilterMenu,
    onDeliveryFilterChange: onDeliveryFilterChange,
    toggleDeadlineFilterMenu: toggleDeadlineFilterMenu,
    onDeadlineFilterChange: onDeadlineFilterChange,
    _syncContractDeadlineFields: _syncContractDeadlineFields,
    toggleSelectAll: toggleSelectAll,
    onCheckChange: onCheckChange,
    openBulkEditForSelected: openBulkEditForSelected,
    _beOnFieldChange: _beOnFieldChange,
    _beUpdatePreview: _beUpdatePreview,
    deleteSelected: deleteSelected,
    deleteAll: deleteAll,
    quickEditBadge: quickEditBadge,
    _togglePicker: togglePicker,
    _pickOption: pickOption,
    _onRfqInput: _onRfqInput,
    _onRfqFocus: _onRfqFocus,
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
