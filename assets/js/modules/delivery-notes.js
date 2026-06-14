(function () {
  var state = AppState.list('delivery-notes');
  var _setupDone = false;
  var _currentDetail = null;        // { note, items }
  var _selectedDetailIds = new Set(); // delivery_note_item_id values selected in detail

  var NOTE_TYPE_LABEL = { delivery: 'Giao hàng', 'return': 'Trả hàng' };
  var STATUS_STYLE = {
    active:   'background:#dcfce7;color:#15803d;border-color:#86efac',
    archived: 'background:#f3f4f6;color:#6b7280;border-color:#d1d5db',
  };
  var ACCEPT_STYLE = {
    pending:  'background:#f3f4f6;color:#6b7280;border-color:#d1d5db',
    accepted: 'background:#dcfce7;color:#15803d;border-color:#86efac',
    partial:  'background:#fef3c7;color:#b45309;border-color:#fcd34d',
    rejected: 'background:#fee2e2;color:#dc2626;border-color:#fca5a5',
  };
  var ACCEPT_LABEL  = { pending: 'Chưa NT', accepted: 'Đã NT', partial: 'Một phần', rejected: 'Từ chối' };
  var ITEM_ACCEPT_LABEL = { pending: 'Chờ NT', accepted: 'Đã NT', rejected: 'Từ chối' };
  var PAYMENT_STYLE = {
    not_ready:  'background:#f3f4f6;color:#6b7280;border-color:#d1d5db',
    ready:      'background:#dcfce7;color:#15803d;border-color:#86efac',
    requested:  'background:#eff6ff;color:#1d4ed8;border-color:#93c5fd',
    paid:       'background:#f0fdf4;color:#14532d;border-color:#86efac',
  };
  var PAYMENT_LABEL = { not_ready: 'Chưa sẵn sàng', ready: 'Sẵn sàng TT', requested: 'Đã đề nghị', paid: 'Đã thanh toán' };

  // --- Role helpers ---

  function isAdmin() {
    var u = AppState.get('user');
    return u && u.role === 'admin';
  }
  function isManager() {
    var u = AppState.get('user');
    return u && (u.role === 'admin' || u.role === 'manager');
  }
  function canWrite() {
    var u = AppState.get('user');
    return u && (u.role === 'admin' || u.role === 'manager' || u.role === 'purchasing');
  }

  // --- Format helpers ---

  function noteTypeLabel(v)  { return NOTE_TYPE_LABEL[v] || v || '—'; }
  function statusLabel(v)    { return v === 'active' ? 'Hoạt động' : v === 'archived' ? 'Lưu trữ' : (v || '—'); }
  function fmtDate(iso)      { return iso ? iso.slice(0, 10) : '—'; }
  function fmtNum(n)         { return (n != null && n !== '') ? String(Number(n)) : '0'; }
  function esc(v)            { return API.esc(v); }
  function fmtMoney(n) {
    if (n == null || n === '') return '—';
    var num = Number(n);
    if (!Number.isFinite(num) || num === 0) return '—';
    return num.toLocaleString('vi-VN');
  }
  function todayYmd() {
    return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  }

  function _deadlineCellHtml(deadlineDate) {
    if (!deadlineDate) return '—';
    var today = todayYmd();
    var diffMs = new Date(deadlineDate + 'T00:00:00') - new Date(today + 'T00:00:00');
    var diff   = Math.round(diffMs / 86400000);
    var note   = Number.isFinite(diff)
      ? (diff < 0
          ? '<div style="font-size:11px;color:var(--red)">Trễ ' + Math.abs(diff) + ' ngày</div>'
          : '<div style="font-size:11px;color:var(--text-muted)">Còn ' + diff + ' ngày</div>')
      : '';
    return esc(deadlineDate) + note;
  }

  function _warrantyCellHtml(it) {
    var days  = it.warranty_days;
    var start = it.warranty_start_date;
    var end   = it.warranty_end_date;
    if (!days && !start && !end) return '—';
    var parts = [];
    if (days) parts.push(esc(String(days)) + ' ngày');
    if (start) parts.push(esc(start.slice(0, 10)));
    if (end)   parts.push('→ ' + esc(end.slice(0, 10)));
    return parts.join('<br>');
  }

  function _clarCellHtml(it) {
    var count = Number(it.clarification_count || 0);
    if (!count) return '<span style="color:var(--text-faint)">—</span>';
    var title = it.latest_clarification_title || '';
    var rfqItemId = it.rfq_item_id || '';
    var onclick = rfqItemId
      ? ' onclick="if(typeof RfqItemsModule!==\'undefined\')RfqItemsModule.openClarificationTimeline(\'' + esc(rfqItemId) + '\')" style="cursor:pointer;color:var(--blue)"'
      : '';
    return '<div' + onclick + '>'
      + '<span class="badge" style="background:var(--blue-lt,#eff6ff);color:var(--blue,#1d4ed8);border-color:#93c5fd;font-size:11px">' + count + ' lần</span>'
      + (title ? '<div style="font-size:11px;margin-top:2px;max-width:150px;white-space:normal">' + esc(title.slice(0, 80)) + (title.length > 80 ? '…' : '') + '</div>' : '')
      + '</div>';
  }

  // --- Setup ---

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    var el = document.getElementById('dnSearch');
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
  }

  // --- List load + render ---

  async function load(reset) {
    setupOnce();
    if (state.loading) return;
    state.loading = true;
    if (reset) { state.rows = []; state.cursor = ''; state.hasMore = false; }

    var params = {
      q:        (document.getElementById('dnSearch')   || {}).value || '',
      noteType: (document.getElementById('dnNoteType') || {}).value || '',
      status:   (document.getElementById('dnStatus')   || {}).value || '',
      dateFrom: (document.getElementById('dnDateFrom') || {}).value || '',
      dateTo:   (document.getElementById('dnDateTo')   || {}).value || '',
      limit:    50,
    };
    if (state.cursor) params.cursor = state.cursor;

    try {
      var data = await API.call('getDeliveryNotes', params);
      if (reset) state.rows = data.rows || [];
      else state.rows = state.rows.concat(data.rows || []);
      state.hasMore = !!data.hasMore;
      state.cursor  = data.nextCursor || '';
    } catch (e) { API.error(e); }
    state.loading = false;
    render();
  }

  function render() {
    var tbody = document.getElementById('dnRows');
    var more  = document.getElementById('dnMore');
    if (!tbody) return;

    tbody.innerHTML = state.rows.map(function (r) {
      var acceptSt  = r.acceptance_status || 'pending';
      var paymentSt = r.payment_request_status || 'not_ready';
      var adm = isAdmin();
      var mgr = isManager();

      // Action buttons
      var canDel = adm && r.status === 'active'
        && (!r.acceptance_status || r.acceptance_status === 'pending')
        && (!r.payment_request_status || r.payment_request_status === 'not_ready');
      var canArchive = mgr && !adm && r.status === 'active';
      var actionBtns = '';
      if (canDel) {
        actionBtns += '<button type="button" onclick="DeliveryNotesModule.deleteDN(\''
          + esc(r.delivery_note_id) + '\',\'' + esc(r.delivery_note_no) + '\')"'
          + ' style="color:var(--red);border-color:var(--red);background:#fff">Xóa</button>';
      }
      if (canArchive) {
        actionBtns += '<button type="button" onclick="DeliveryNotesModule.archive(\''
          + esc(r.delivery_note_id) + '\',\'' + esc(r.delivery_note_no) + '\')"'
          + ' style="color:var(--text-muted);border-color:var(--border);background:#fff">Lưu trữ</button>';
      }

      // Mã đơn cell — clickable, note as sub-line
      var noteSubline = r.note
        ? '<div style="font-size:11px;color:var(--text-muted);margin-top:1px">Ghi chú: ' + esc(r.note.slice(0, 60)) + (r.note.length > 60 ? '…' : '') + '</div>'
        : '';
      var noteNoCell = '<td>'
        + '<span class="link-edit" style="font-weight:600;font-size:13px" onclick="DeliveryNotesModule.openDetail(\'' + esc(r.delivery_note_id) + '\')">'
        + esc(r.delivery_note_no || '—') + '</span>'
        + noteSubline + '</td>';

      // Tên gói — drilldown via RfqsModule if available
      var tenGoiCell = r.rfq_id && r.ten_goi
        ? '<span class="link-edit" onclick="if(typeof RfqsModule!==\'undefined\')RfqsModule.drillDown(\'' + esc(r.rfq_id) + '\')">' + esc(r.ten_goi) + '</span>'
        : esc(r.ten_goi || '—');

      return '<tr>'
        + noteNoCell
        + '<td>' + esc(fmtDate(r.delivery_date)) + '</td>'
        + '<td><span class="badge' + (r.note_type === 'return' ? '-orange' : '-blue') + '">' + esc(noteTypeLabel(r.note_type)) + '</span></td>'
        + '<td style="font-family:monospace;font-size:12px">' + esc(r.ma_goi_tbmt || '—') + '</td>'
        + '<td>' + tenGoiCell + '</td>'
        + '<td style="font-size:12px">' + esc(r.receiver_unit || '—') + '</td>'
        + '<td style="font-size:12px">' + esc(r.sender_unit   || '—') + '</td>'
        + '<td style="text-align:center">'  + esc(fmtNum(r.item_count)) + '</td>'
        + '<td style="text-align:right">'   + esc(fmtNum(r.delivered_quantity_total)) + '</td>'
        + '<td style="text-align:right">'   + esc(fmtNum(r.accepted_quantity_total)) + '</td>'
        + '<td><span class="badge" style="' + (ACCEPT_STYLE[acceptSt] || '') + '">' + esc(ACCEPT_LABEL[acceptSt] || acceptSt) + '</span></td>'
        + '<td><span class="badge" style="' + (PAYMENT_STYLE[paymentSt] || '') + '">' + esc(PAYMENT_LABEL[paymentSt] || paymentSt) + '</span></td>'
        + '<td><span class="badge" style="' + (STATUS_STYLE[r.status] || '') + '">' + esc(statusLabel(r.status)) + '</span></td>'
        + '<td style="white-space:nowrap">' + actionBtns + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="14" style="text-align:center;color:var(--text-faint);padding:24px">Không có dữ liệu</td></tr>';

    if (more) more.classList.toggle('hidden', !state.hasMore);
  }

  // --- Detail ---

  async function openDetail(id) {
    try {
      var data = await API.call('getDeliveryNoteDetail', { deliveryNoteId: id });
      var n     = data.note;
      var items = data.items || [];
      _currentDetail = { note: n, items: items };
      _selectedDetailIds = new Set();

      var acceptSt  = n.acceptance_status  || 'pending';
      var paymentSt = n.payment_request_status || 'not_ready';

      // Header KV
      var kvPairs = [
        ['Mã đơn',      n.delivery_note_no],
        ['Loại',        noteTypeLabel(n.note_type)],
        ['Ngày giao',   fmtDate(n.delivery_date)],
        ['Bên nhận',    n.receiver_unit  || '—'],
        ['Người nhận',  n.receiver_name  || '—'],
        ['Bên giao',    n.sender_unit    || '—'],
        ['Người giao',  n.sender_name    || '—'],
        ['Trạng thái',  statusLabel(n.status)],
      ];
      if (n.vehicle_no) kvPairs.push(['Biển số xe', n.vehicle_no]);
      if (n.ma_goi_tbmt || n.ten_goi) {
        kvPairs.push(['Mã gói', n.ma_goi_tbmt || '—']);
        kvPairs.push(['Tên gói', n.ten_goi   || '—']);
      }
      if (n.note) kvPairs.push(['Ghi chú', n.note]);

      var kvHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 16px;margin-bottom:8px">'
        + kvPairs.map(function (p) {
            return '<div style="display:flex;gap:6px;align-items:baseline">'
              + '<span style="color:var(--text-muted);font-size:12px;min-width:90px;flex:0 0 auto">' + esc(p[0]) + '</span>'
              + '<span style="font-size:13px;font-weight:500">' + (typeof p[1] === 'string' ? esc(p[1]) : (p[1] || '')) + '</span>'
              + '</div>';
          }).join('')
        + '</div>';

      // Acceptance section
      var acceptKv = [
        ['Nghiệm thu', '<span class="badge" style="' + (ACCEPT_STYLE[acceptSt] || '') + '">' + esc(ACCEPT_LABEL[acceptSt] || acceptSt) + '</span>'],
        ['Ngày NT',    n.acceptance_date ? esc(fmtDate(n.acceptance_date)) : '<span style="color:var(--text-faint)">—</span>'],
        ['Thanh toán', '<span class="badge" style="' + (PAYMENT_STYLE[paymentSt] || '') + '">' + esc(PAYMENT_LABEL[paymentSt] || paymentSt) + '</span>'],
      ];
      if (n.acceptance_note) acceptKv.push(['Ghi chú NT', esc(n.acceptance_note)]);
      var acceptHtml = '<div style="border-top:1px solid var(--border);padding-top:8px;margin-bottom:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 16px">'
        + acceptKv.map(function (p) {
            return '<div style="display:flex;gap:6px;align-items:baseline">'
              + '<span style="color:var(--text-muted);font-size:12px;min-width:90px;flex:0 0 auto">' + esc(p[0]) + '</span>'
              + '<span style="font-size:13px;font-weight:500">' + p[1] + '</span>'
              + '</div>';
          }).join('')
        + '</div>';

      // Action bar
      var canAct = canWrite() && n.status === 'active';
      var actionBar = canAct
        ? '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">'
            + '<button type="button" onclick="DeliveryNotesModule.openEditHeader()"'
            + ' style="font-size:12px;padding:3px 10px;color:var(--text-muted)">Sửa thông tin đơn</button>'
            + '<button type="button" onclick="DeliveryNotesModule.openFastAcceptance()"'
            + ' style="background:var(--green,#15803d);color:#fff;border-color:var(--green,#15803d);font-size:12px;padding:3px 10px">Ghi nghiệm thu</button>'
            + '<button type="button" onclick="DeliveryNotesModule.openAdvancedAcceptance()"'
            + ' style="font-size:12px;padding:3px 10px">NT chi tiết</button>'
            + '</div>'
        : '';

      var itemsHtml = _renderDetailItems(items, n);

      var html = '<div class="span-12">' + kvHtml + acceptHtml + actionBar + itemsHtml + '</div>';
      Utils.openModal('Chi tiết: ' + esc(n.delivery_note_no), html, null);

      // Full-screen detail modal
      setTimeout(function () {
        var m = document.querySelector('#modal .modal');
        if (m) {
          m.style.width    = 'calc(100vw - 40px)';
          m.style.maxWidth = 'none';
          m.style.height   = 'calc(100vh - 40px)';
          m.style.maxHeight = 'none';
        }
      }, 0);
    } catch (e) { API.error(e); }
  }

  function _renderDetailItems(items, note) {
    if (!items.length) return '<p style="color:var(--text-faint);margin:0">Chưa có dòng vật tư.</p>';

    var thStyle = 'style="font-size:11px;padding:4px 6px;white-space:nowrap;text-align:center"';
    var thead = '<thead><tr>'
      + '<th ' + thStyle + ' style="width:32px"><input type="checkbox" id="dnDetailSelectAll" onchange="DeliveryNotesModule._toggleSelectAllDetail(this.checked)"></th>'
      + '<th ' + thStyle + ' style="width:80px">Mã gói</th>'
      + '<th ' + thStyle + ' style="min-width:100px">Tên gói</th>'
      + '<th ' + thStyle + ' style="width:45px">STT</th>'
      + '<th ' + thStyle + ' style="width:80px">Mã VT</th>'
      + '<th ' + thStyle + ' style="min-width:160px">Tên vật tư</th>'
      + '<th ' + thStyle + ' style="min-width:110px">Quy cách</th>'
      + '<th ' + thStyle + ' style="width:90px">Hãng / NSX</th>'
      + '<th ' + thStyle + ' style="min-width:110px">Thông số KT</th>'
      + '<th ' + thStyle + ' style="width:75px">Vật liệu</th>'
      + '<th ' + thStyle + ' style="width:50px">ĐVT</th>'
      + '<th ' + thStyle + ' style="width:65px;text-align:right">SL HĐ</th>'
      + '<th ' + thStyle + ' style="width:85px;text-align:right">Đơn giá</th>'
      + '<th ' + thStyle + ' style="width:105px">Deadline giao</th>'
      + '<th ' + thStyle + ' style="width:70px;text-align:right">Đã giao LK</th>'
      + '<th ' + thStyle + ' style="width:70px;text-align:right">SL giao</th>'
      + '<th ' + thStyle + ' style="min-width:120px">Làm rõ</th>'
      + '<th ' + thStyle + ' style="width:60px;text-align:right">Đã NT</th>'
      + '<th ' + thStyle + ' style="width:60px;text-align:right">Chờ NT</th>'
      + '<th ' + thStyle + ' style="width:80px">Kết quả NT</th>'
      + '<th ' + thStyle + ' style="min-width:100px">Lý do không đạt</th>'
      + '<th ' + thStyle + ' style="min-width:110px">Bảo hành</th>'
      + '<th ' + thStyle + ' style="min-width:100px">Ghi chú</th>'
      + '</tr></thead>';

    var tdS = 'style="font-size:12px;padding:4px 6px;vertical-align:top"';
    var tdR = 'style="font-size:12px;padding:4px 6px;vertical-align:top;text-align:right"';
    var tdC = 'style="font-size:12px;padding:4px 6px;vertical-align:top;text-align:center"';

    var maGoi  = note.ma_goi_tbmt || '—';
    var tenGoi = note.ten_goi     || '—';

    var tbody = '<tbody>' + items.map(function (it) {
      var itAccept = it.acceptance_status || 'pending';
      var itLabel  = ITEM_ACCEPT_LABEL[itAccept] || itAccept;
      var choDel   = Math.max(0, Number(it.delivered_quantity || 0) - Number(it.accepted_quantity || 0));
      var quyC     = it.quy_cach_final || it.required_model || '—';
      var hang     = it.hang_final || it.manufacturer || it.brand || '—';

      return '<tr>'
        + '<td ' + tdC + '><input type="checkbox" class="dn-item-sel" value="' + esc(it.delivery_note_item_id) + '"'
          + ' onchange="DeliveryNotesModule._onDetailItemCheck(this)"></td>'
        + '<td ' + tdS + ' style="font-size:11px;font-family:monospace;padding:4px 6px;vertical-align:top">' + esc(maGoi) + '</td>'
        + '<td ' + tdS + '>' + esc(tenGoi) + '</td>'
        + '<td ' + tdC + '>' + esc(it.stt_goc || '—') + '</td>'
        + '<td ' + tdS + ' style="font-family:monospace;font-size:11px;padding:4px 6px;vertical-align:top">' + esc(it.ma_vat_tu || '—') + '</td>'
        + '<td ' + tdS + '>' + esc(it.ten_vat_tu || '—') + '</td>'
        + '<td ' + tdS + ' style="font-size:11px;padding:4px 6px;vertical-align:top">' + esc(quyC) + '</td>'
        + '<td ' + tdS + ' style="font-size:11px;padding:4px 6px;vertical-align:top">' + esc(hang) + '</td>'
        + '<td ' + tdS + ' style="font-size:11px;padding:4px 6px;vertical-align:top">' + esc(it.thong_so_ky_thuat || '—') + '</td>'
        + '<td ' + tdS + ' style="font-size:11px;padding:4px 6px;vertical-align:top">' + esc(it.vat_lieu || '—') + '</td>'
        + '<td ' + tdC + '>' + esc(it.unit || '—') + '</td>'
        + '<td ' + tdR + '>' + esc(fmtNum(it.contract_quantity)) + '</td>'
        + '<td ' + tdR + ' style="font-size:11px;text-align:right;padding:4px 6px;vertical-align:top">' + fmtMoney(it.contract_unit_price) + '</td>'
        + '<td ' + tdC + '>' + _deadlineCellHtml(it.delivery_deadline_date) + '</td>'
        + '<td ' + tdR + '>' + esc(fmtNum(it.cumulative_delivered_qty)) + '</td>'
        + '<td ' + tdR + ' style="font-weight:600;text-align:right;padding:4px 6px;vertical-align:top">' + esc(fmtNum(it.delivered_quantity)) + '</td>'
        + '<td ' + tdS + '>' + _clarCellHtml(it) + '</td>'
        + '<td ' + tdR + '>' + esc(fmtNum(it.accepted_quantity)) + '</td>'
        + '<td ' + tdR + ' style="color:' + (choDel > 0 ? 'var(--primary-dk,#b45309)' : 'var(--text-muted)') + ';text-align:right;padding:4px 6px;vertical-align:top">'
          + esc(String(choDel)) + '</td>'
        + '<td ' + tdC + '><span class="badge" style="' + (ACCEPT_STYLE[itAccept] || '') + ';font-size:11px">' + esc(itLabel) + '</span></td>'
        + '<td ' + tdS + ' style="font-size:11px;color:var(--red);padding:4px 6px;vertical-align:top">' + esc(it.rejection_reason || '') + '</td>'
        + '<td ' + tdS + ' style="font-size:11px;padding:4px 6px;vertical-align:top">' + _warrantyCellHtml(it) + '</td>'
        + '<td ' + tdS + ' style="font-size:11px;padding:4px 6px;vertical-align:top">' + esc(it.note || '') + '</td>'
        + '</tr>';
    }).join('') + '</tbody>';

    return '<div style="overflow-x:auto;margin:0">'
      + '<table style="min-width:1800px;font-size:12px;border-collapse:collapse">'
      + thead + tbody
      + '</table></div>';
  }

  // --- Item selection in detail ---

  function _toggleSelectAllDetail(checked) {
    _selectedDetailIds = new Set();
    var cbs = document.querySelectorAll('#modal .dn-item-sel');
    cbs.forEach(function (cb) {
      cb.checked = !!checked;
      if (checked) _selectedDetailIds.add(cb.value);
    });
  }

  function _onDetailItemCheck(cb) {
    if (cb.checked) {
      _selectedDetailIds.add(cb.value);
    } else {
      _selectedDetailIds.delete(cb.value);
      var allCb = document.getElementById('dnDetailSelectAll');
      if (allCb) allCb.checked = false;
    }
  }

  // --- Fast acceptance ---

  function openFastAcceptance() {
    if (!_currentDetail) return;
    if (!_selectedDetailIds.size) {
      API.toast('Vui lòng chọn vật tư cần ghi nghiệm thu.', 'warn');
      return;
    }
    var n     = _currentDetail.note;
    var items = _currentDetail.items;
    var today = todayYmd();

    var selectedItems = items.filter(function (it) {
      return _selectedDetailIds.has(it.delivery_note_item_id);
    });

    var summaryRows = selectedItems.map(function (it) {
      return '<tr>'
        + '<td style="font-size:12px;padding:3px 6px">' + esc(it.ten_vat_tu || '—') + '</td>'
        + '<td style="font-size:12px;padding:3px 6px;text-align:right">' + esc(fmtNum(it.delivered_quantity)) + '</td>'
        + '<td style="font-size:12px;padding:3px 6px;text-align:right;color:var(--green)">' + esc(fmtNum(it.delivered_quantity)) + ' (mặc định)</td>'
        + '</tr>';
    }).join('');

    var html = '<div style="display:grid;gap:14px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px">'
      + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Ngày nghiệm thu *</label>'
        + '<input id="fnt-date" type="date" value="' + today + '" style="width:100%"></div>'
      + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Số ngày bảo hành</label>'
        + '<input id="fnt-warranty" type="text" inputmode="numeric" placeholder="(tùy chọn)" style="width:100%"></div>'
      + '<div style="grid-column:1/-1"><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Ghi chú nghiệm thu</label>'
        + '<input id="fnt-note" type="text" placeholder="(tùy chọn)" style="width:100%"></div>'
      + '</div>'
      + '<div>'
        + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">Vật tư đã chọn (' + selectedItems.length + ' dòng):</div>'
        + '<div style="overflow-x:auto"><table style="width:100%;min-width:400px;font-size:12px">'
          + '<thead><tr>'
          + '<th style="padding:3px 6px;text-align:left">Tên vật tư</th>'
          + '<th style="padding:3px 6px;text-align:right">SL giao</th>'
          + '<th style="padding:3px 6px;text-align:right">SL NT</th>'
          + '</tr></thead><tbody>' + summaryRows + '</tbody>'
        + '</table></div>'
      + '</div>'
      + '</div>';

    Utils.openModal('Ghi nghiệm thu nhanh — ' + esc(n.delivery_note_no), html, _submitFastAcceptance);
  }

  async function _submitFastAcceptance() {
    var detail = _currentDetail;
    if (!detail || !_selectedDetailIds.size) return;

    var dateVal = (document.getElementById('fnt-date')    || {}).value || '';
    var wDaysRaw = (document.getElementById('fnt-warranty') || {}).value || '';
    var ntNote   = (document.getElementById('fnt-note')    || {}).value || '';

    if (!dateVal) { API.toast('Vui lòng chọn ngày nghiệm thu', 'warn'); return; }
    var warrantyDays = wDaysRaw ? (parseInt(wDaysRaw, 10) || null) : null;

    var items = detail.items;
    // Build ALL items — selected get new acceptance, unselected keep current state.
    var itemRows = items.map(function (it) {
      if (_selectedDetailIds.has(it.delivery_note_item_id)) {
        return {
          deliveryNoteItemId: it.delivery_note_item_id,
          acceptanceStatus:   'accepted',
          acceptedQuantity:   Number(it.delivered_quantity) || 0,
          warrantyDays:       warrantyDays,
          warrantyStartDate:  dateVal,
          warrantyEndDate:    null, // backend computes from days + start
        };
      }
      return {
        deliveryNoteItemId: it.delivery_note_item_id,
        acceptanceStatus:   it.acceptance_status  || 'pending',
        acceptedQuantity:   Number(it.accepted_quantity) || 0,
        rejectionReason:    it.rejection_reason   || null,
        warrantyDays:       it.warranty_days      || null,
        warrantyStartDate:  it.warranty_start_date || null,
        warrantyEndDate:    it.warranty_end_date   || null,
      };
    });

    try {
      await API.call('recordDeliveryAcceptance', {
        deliveryNoteId: detail.note.delivery_note_id,
        acceptanceDate: dateVal,
        acceptanceNote: ntNote,
        items: itemRows,
      });
      API.toast('Đã ghi nghiệm thu ' + _selectedDetailIds.size + ' dòng vật tư', 'success');
      Utils.closeModal();
      await load(true);
      await openDetail(detail.note.delivery_note_id);
    } catch (e) { API.error(e); }
  }

  // --- Advanced acceptance (keep existing logic, renamed) ---

  function openAdvancedAcceptance() {
    if (!_currentDetail) return;
    var n     = _currentDetail.note;
    var items = _currentDetail.items;
    var today = todayYmd();
    var formId = 'nt-form-' + Date.now();

    var formHtml = '<div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-bottom:12px">'
      + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Ngày nghiệm thu</label>'
        + '<input id="nt-date" type="date" value="' + today + '" style="width:100%"></div>'
      + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Ghi chú nghiệm thu</label>'
        + '<input id="nt-note" type="text" placeholder="(tùy chọn)" style="width:100%"></div>'
      + '</div>'
      + '<div style="margin-bottom:6px;text-align:right">'
        + '<button type="button" id="nt-tick-all" onclick="DeliveryNotesModule._tickAllAccepted()"'
          + ' style="font-size:12px;padding:4px 10px">✓ Chọn tất cả Đã NT</button>'
      + '</div>'
      + '<div class="table-wrap" style="margin:0"><table id="' + formId + '">'
        + '<thead><tr>'
          + '<th style="min-width:160px">Tên vật tư</th>'
          + '<th style="width:70px;text-align:right">SL giao</th>'
          + '<th style="width:80px;text-align:right">SL NT</th>'
          + '<th style="width:110px">Kết quả</th>'
          + '<th style="width:140px">Lý do từ chối</th>'
          + '<th style="width:70px">BH (ngày)</th>'
          + '<th style="width:100px">Ngày bắt đầu BH</th>'
        + '</tr></thead><tbody>'
      + items.map(function (it, idx) {
          var prevStatus       = it.acceptance_status || 'pending';
          var prevAccepted     = Number(it.accepted_quantity) || 0;
          var prevWarrantyDays = it.warranty_days  != null ? String(it.warranty_days)  : '';
          var prevWarrantyStart = it.warranty_start_date || '';
          return '<tr data-idx="' + idx + '">'
            + '<td style="font-size:12px">' + esc(it.ten_vat_tu || '—') + '</td>'
            + '<td style="text-align:right">' + esc(fmtNum(it.delivered_quantity)) + '</td>'
            + '<td><input class="nt-qty" type="text" inputmode="numeric"'
              + ' value="' + (prevStatus === 'rejected' ? '0' : String(prevAccepted || fmtNum(it.delivered_quantity))) + '"'
              + ' style="width:60px;text-align:right" data-max="' + Number(it.delivered_quantity || 0) + '"></td>'
            + '<td><select class="nt-status" style="width:100%;font-size:12px">'
              + '<option value="pending"'  + (prevStatus === 'pending'  ? ' selected' : '') + '>Chờ NT</option>'
              + '<option value="accepted"' + (prevStatus === 'accepted' ? ' selected' : '') + '>Đã NT</option>'
              + '<option value="rejected"' + (prevStatus === 'rejected' ? ' selected' : '') + '>Từ chối</option>'
              + '</select></td>'
            + '<td><input class="nt-reason" type="text" value="' + esc(it.rejection_reason || '') + '" style="width:100%;font-size:12px"></td>'
            + '<td><input class="nt-warranty-days" type="text" inputmode="numeric" value="' + esc(prevWarrantyDays) + '" style="width:55px"></td>'
            + '<td><input class="nt-warranty-start" type="date" value="' + esc(prevWarrantyStart) + '" style="width:100%"></td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>'
      + '</div>';

    Utils.openModal('NT chi tiết — ' + esc(n.delivery_note_no), formHtml, _submitAcceptance);
  }

  function _tickAllAccepted() {
    var table = document.querySelector('table[id^="nt-form-"]');
    if (!table) return;
    table.querySelectorAll('tr[data-idx]').forEach(function (tr) {
      var statusSel = tr.querySelector('.nt-status');
      var qtyInput  = tr.querySelector('.nt-qty');
      if (statusSel) statusSel.value = 'accepted';
      if (qtyInput)  qtyInput.value  = qtyInput.dataset.max || '0';
    });
  }

  async function _submitAcceptance() {
    var table = document.querySelector('table[id^="nt-form-"]');
    if (!table || !_currentDetail) return;
    var n     = _currentDetail.note;
    var items = _currentDetail.items;

    var date = (document.getElementById('nt-date') || {}).value || '';
    var note = (document.getElementById('nt-note') || {}).value || '';

    var itemRows = [];
    var rowEls   = table.querySelectorAll('tr[data-idx]');
    for (var i = 0; i < rowEls.length; i++) {
      var tr     = rowEls[i];
      var it     = items[i];
      var status = (tr.querySelector('.nt-status')        || {}).value || 'pending';
      var qtyRaw = (tr.querySelector('.nt-qty')           || {}).value || '0';
      var reason = (tr.querySelector('.nt-reason')        || {}).value || '';
      var wDays  = (tr.querySelector('.nt-warranty-days') || {}).value || '';
      var wStart = (tr.querySelector('.nt-warranty-start')|| {}).value || '';
      var qty    = Math.max(0, parseFloat(qtyRaw.replace(/[^\d.]/g, '')) || 0);
      itemRows.push({
        deliveryNoteItemId: it.delivery_note_item_id,
        acceptanceStatus:   status,
        acceptedQuantity:   status === 'rejected' ? 0 : qty,
        rejectionReason:    reason || null,
        warrantyDays:       wDays ? (parseInt(wDays, 10) || null) : null,
        warrantyStartDate:  wStart || null,
      });
    }

    try {
      await API.call('recordDeliveryAcceptance', {
        deliveryNoteId:  n.delivery_note_id,
        acceptanceDate:  date,
        acceptanceNote:  note,
        items:           itemRows,
      });
      API.toast('Đã ghi nghiệm thu ' + n.delivery_note_no, 'success');
      Utils.closeModal();
      await load(true);
      await openDetail(n.delivery_note_id);
    } catch (e) { API.error(e); }
  }

  // --- Edit header ---

  function openEditHeader() {
    if (!_currentDetail) return;
    var n = _currentDetail.note;
    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;grid-column:span 12">'
      + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Ngày giao hàng *</label>'
        + '<input id="eh-date" type="date" value="' + esc(n.delivery_date || '') + '" style="width:100%"></div>'
      + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Bên nhận</label>'
        + '<input id="eh-receiver-unit" type="text" value="' + esc(n.receiver_unit || '') + '" placeholder="Tên đơn vị nhận" style="width:100%"></div>'
      + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Người nhận</label>'
        + '<input id="eh-receiver-name" type="text" value="' + esc(n.receiver_name || '') + '" placeholder="Họ tên người nhận" style="width:100%"></div>'
      + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Bên giao</label>'
        + '<input id="eh-sender-unit" type="text" value="' + esc(n.sender_unit || '') + '" placeholder="Tên đơn vị giao" style="width:100%"></div>'
      + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Người giao</label>'
        + '<input id="eh-sender-name" type="text" value="' + esc(n.sender_name || '') + '" placeholder="Họ tên người giao" style="width:100%"></div>'
      + '<div><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Biển số xe</label>'
        + '<input id="eh-vehicle-no" type="text" value="' + esc(n.vehicle_no || '') + '" placeholder="(tùy chọn)" style="width:100%"></div>'
      + '<div style="grid-column:1/-1"><label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:2px">Ghi chú</label>'
        + '<input id="eh-note" type="text" value="' + esc(n.note || '') + '" placeholder="(tùy chọn)" style="width:100%"></div>'
      + '</div>';
    Utils.openModal('Sửa thông tin đơn — ' + esc(n.delivery_note_no), html, _submitEditHeader);
  }

  async function _submitEditHeader() {
    var n = _currentDetail && _currentDetail.note;
    if (!n) return;
    var date = (document.getElementById('eh-date') || {}).value || '';
    if (!date) { API.toast('Vui lòng chọn ngày giao hàng', 'warn'); return; }
    try {
      await API.call('updateDeliveryNote', {
        deliveryNoteId: n.delivery_note_id,
        deliveryDate:   date,
        receiverUnit:   (document.getElementById('eh-receiver-unit') || {}).value || '',
        receiverName:   (document.getElementById('eh-receiver-name') || {}).value || '',
        senderUnit:     (document.getElementById('eh-sender-unit')   || {}).value || '',
        senderName:     (document.getElementById('eh-sender-name')   || {}).value || '',
        vehicleNo:      (document.getElementById('eh-vehicle-no')    || {}).value || '',
        note:           (document.getElementById('eh-note')          || {}).value || '',
      });
      API.toast('Đã cập nhật thông tin đơn', 'success');
      Utils.closeModal();
      await load(true);
      await openDetail(n.delivery_note_id);
    } catch (e) { API.error(e); }
  }

  // --- Admin delete ---

  async function deleteDN(id, code) {
    var ok = await Utils.confirmDanger(
      'Xóa đơn giao hàng',
      'Xóa vĩnh viễn "' + code + '"? Chỉ xóa được khi chưa có nghiệm thu hoặc thanh toán. Không thể khôi phục.',
      'Xóa vĩnh viễn'
    );
    if (!ok) return;
    try {
      await API.call('deleteDeliveryNote', { deliveryNoteId: id });
      API.toast('Đã xóa ' + code, 'success');
      load(true);
    } catch (e) { API.error(e); }
  }

  // --- Archive (manager) ---

  async function archive(id, code) {
    var ok = await Utils.confirmDanger(
      'Lưu trữ đơn giao hàng',
      'Lưu trữ "' + code + '"? Đơn sẽ không sửa được sau khi lưu trữ.',
      'Lưu trữ'
    );
    if (!ok) return;
    try {
      await API.call('archiveDeliveryNote', { deliveryNoteId: id });
      API.toast('Đã lưu trữ ' + code, 'success');
      load(true);
    } catch (e) { API.error(e); }
  }

  window.DeliveryNotesModule = {
    load:                   load,
    openDetail:             openDetail,
    openEditHeader:         openEditHeader,
    openFastAcceptance:     openFastAcceptance,
    openAdvancedAcceptance: openAdvancedAcceptance,
    _tickAllAccepted:       _tickAllAccepted,
    _toggleSelectAllDetail: _toggleSelectAllDetail,
    _onDetailItemCheck:     _onDetailItemCheck,
    archive:                archive,
    deleteDN:               deleteDN,
  };
})();
