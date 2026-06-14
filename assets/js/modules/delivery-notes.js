(function () {
  var state = AppState.list('delivery-notes');
  var _setupDone = false;
  var _currentDetail = null; // { note, items } — kept for openAcceptanceForm

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
  var ACCEPT_LABEL = { pending: 'Chưa NT', accepted: 'Đã NT', partial: 'Một phần', rejected: 'Từ chối' };
  var PAYMENT_STYLE = {
    not_ready:  'background:#f3f4f6;color:#6b7280;border-color:#d1d5db',
    ready:      'background:#dcfce7;color:#15803d;border-color:#86efac',
    requested:  'background:#eff6ff;color:#1d4ed8;border-color:#93c5fd',
    paid:       'background:#f0fdf4;color:#14532d;border-color:#86efac',
  };
  var PAYMENT_LABEL = { not_ready: 'Chưa sẵn sàng', ready: 'Sẵn sàng TT', requested: 'Đã đề nghị', paid: 'Đã thanh toán' };

  function noteTypeLabel(v)   { return NOTE_TYPE_LABEL[v] || v || '—'; }
  function statusLabel(v)     { return v === 'active' ? 'Hoạt động' : v === 'archived' ? 'Lưu trữ' : (v || '—'); }
  function fmtDate(iso)       { return iso ? iso.slice(0, 10) : '—'; }
  function fmtNum(n)          { return (n != null && n !== '') ? String(Number(n)) : '0'; }
  function esc(v)             { return API.esc(v); }

  function isManager() {
    var role = AppState.get('user') && AppState.get('user').role;
    return role === 'admin' || role === 'manager';
  }
  function canWrite() {
    var role = AppState.get('user') && AppState.get('user').role;
    return role === 'admin' || role === 'manager' || role === 'purchasing';
  }

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    var el = document.getElementById('dnSearch');
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
  }

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
    var mgr = isManager();
    tbody.innerHTML = state.rows.map(function (r) {
      var rfqLabel = r.ma_goi_tbmt
        ? esc(r.ma_goi_tbmt) + (r.ten_goi ? ' <span style="color:var(--text-muted)">— ' + esc(r.ten_goi) + '</span>' : '')
        : (r.ten_goi ? esc(r.ten_goi) : '<span style="color:var(--text-faint)">—</span>');
      var acceptSt   = r.acceptance_status || 'pending';
      var paymentSt  = r.payment_request_status || 'not_ready';
      var archiveBtn = (mgr && r.status === 'active')
        ? '<button type="button" onclick="DeliveryNotesModule.archive(\''
            + esc(r.delivery_note_id) + '\',\'' + esc(r.delivery_note_no) + '\')"'
            + ' style="color:var(--red);border-color:var(--red);background:#fff;margin-left:4px">Lưu trữ</button>'
        : '';
      return '<tr>'
        + '<td><strong style="color:var(--primary-dk)">' + esc(r.delivery_note_no || '—') + '</strong></td>'
        + '<td>' + esc(fmtDate(r.delivery_date)) + '</td>'
        + '<td><span class="badge' + (r.note_type === 'return' ? '-orange' : '-blue') + '">'
            + esc(noteTypeLabel(r.note_type)) + '</span></td>'
        + '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + rfqLabel + '</td>'
        + '<td>' + esc(r.receiver_unit || '—') + '</td>'
        + '<td>' + esc(r.sender_unit   || '—') + '</td>'
        + '<td style="text-align:center">' + esc(fmtNum(r.item_count)) + '</td>'
        + '<td style="text-align:right">'  + esc(fmtNum(r.delivered_quantity_total)) + '</td>'
        + '<td style="text-align:right">'  + esc(fmtNum(r.accepted_quantity_total))  + '</td>'
        + '<td><span class="badge" style="' + (ACCEPT_STYLE[acceptSt] || '') + '">'
            + esc(ACCEPT_LABEL[acceptSt] || acceptSt) + '</span></td>'
        + '<td><span class="badge" style="' + (PAYMENT_STYLE[paymentSt] || '') + '">'
            + esc(PAYMENT_LABEL[paymentSt] || paymentSt) + '</span></td>'
        + '<td><span class="badge" style="' + (STATUS_STYLE[r.status] || '') + '">'
            + esc(statusLabel(r.status)) + '</span></td>'
        + '<td style="white-space:nowrap">'
            + '<button type="button" onclick="DeliveryNotesModule.openDetail(\'' + esc(r.delivery_note_id) + '\')">Xem</button>'
            + archiveBtn
        + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="13" style="text-align:center;color:var(--text-faint);padding:24px">Không có dữ liệu</td></tr>';
    if (more) more.classList.toggle('hidden', !state.hasMore);
  }

  async function openDetail(id) {
    try {
      var data = await API.call('getDeliveryNoteDetail', { deliveryNoteId: id });
      var n     = data.note;
      var items = data.items || [];
      _currentDetail = { note: n, items: items };

      var acceptSt  = n.acceptance_status  || 'pending';
      var paymentSt = n.payment_request_status || 'not_ready';

      var kv = [
        ['Mã đơn',     n.delivery_note_no],
        ['Loại',       noteTypeLabel(n.note_type)],
        ['Ngày giao',  fmtDate(n.delivery_date)],
        ['Trạng thái', statusLabel(n.status)],
        ['Bên nhận',   n.receiver_unit || '—'],
        ['Người nhận', n.receiver_name || '—'],
        ['Bên giao',   n.sender_unit   || '—'],
        ['Người giao', n.sender_name   || '—'],
      ];
      if (n.note) kv.push(['Ghi chú', n.note]);

      // Acceptance section
      var acceptKv = [
        ['Nghiệm thu', '<span class="badge" style="' + (ACCEPT_STYLE[acceptSt] || '') + '">' + esc(ACCEPT_LABEL[acceptSt] || acceptSt) + '</span>'],
        ['Ngày NT',    n.acceptance_date ? esc(fmtDate(n.acceptance_date)) : '<span style="color:var(--text-faint)">—</span>'],
        ['Thanh toán', '<span class="badge" style="' + (PAYMENT_STYLE[paymentSt] || '') + '">' + esc(PAYMENT_LABEL[paymentSt] || paymentSt) + '</span>'],
      ];
      if (n.acceptance_note) acceptKv.push(['Ghi chú NT', esc(n.acceptance_note)]);

      var kvHtml = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px 16px;margin-bottom:8px">'
        + kv.map(function (p) {
            return '<div style="display:flex;gap:6px;align-items:baseline">'
              + '<span style="color:var(--text-muted);font-size:12px;min-width:80px;flex:0 0 auto">' + esc(p[0]) + '</span>'
              + '<span style="font-size:13px;font-weight:500">' + p[1] + '</span>'
              + '</div>';
          }).join('')
        + '</div>';

      var acceptHtml = '<div style="border-top:1px solid var(--border);padding-top:8px;margin-bottom:8px;display:grid;grid-template-columns:repeat(2,1fr);gap:4px 16px">'
        + acceptKv.map(function (p) {
            return '<div style="display:flex;gap:6px;align-items:baseline">'
              + '<span style="color:var(--text-muted);font-size:12px;min-width:80px;flex:0 0 auto">' + esc(p[0]) + '</span>'
              + '<span style="font-size:13px;font-weight:500">' + p[1] + '</span>'
              + '</div>';
          }).join('')
        + '</div>';

      var itemsHtml = items.length
        ? '<div class="table-wrap" style="margin:0"><table>'
            + '<thead><tr>'
            + '<th style="width:80px">Mã VT</th>'
            + '<th>Tên vật tư</th>'
            + '<th style="width:150px">Quy cách</th>'
            + '<th style="width:90px">Hãng</th>'
            + '<th style="width:50px">ĐVT</th>'
            + '<th style="width:70px;text-align:right">SL giao</th>'
            + '<th style="width:70px;text-align:right">SL NT</th>'
            + '<th style="width:90px">Kết quả NT</th>'
            + '</tr></thead><tbody>'
            + items.map(function (it) {
                var itAccept = it.acceptance_status || 'pending';
                var itLabel  = { pending: 'Chờ NT', accepted: 'Đã NT', rejected: 'Từ chối' }[itAccept] || itAccept;
                return '<tr>'
                  + '<td>' + esc(it.ma_vat_tu      || '—') + '</td>'
                  + '<td>' + esc(it.ten_vat_tu      || '—') + '</td>'
                  + '<td>' + esc(it.required_model  || '—') + '</td>'
                  + '<td>' + esc(it.brand || it.manufacturer || '—') + '</td>'
                  + '<td>' + esc(it.unit             || '—') + '</td>'
                  + '<td style="text-align:right">' + esc(fmtNum(it.delivered_quantity)) + '</td>'
                  + '<td style="text-align:right">' + esc(fmtNum(it.accepted_quantity))  + '</td>'
                  + '<td><span class="badge" style="' + (ACCEPT_STYLE[itAccept] || '') + '">' + esc(itLabel) + '</span></td>'
                  + '</tr>';
              }).join('')
            + '</tbody></table></div>'
        : '<p style="color:var(--text-faint);margin:0">Chưa có dòng vật tư.</p>';

      var ntBtn = (canWrite() && n.status === 'active')
        ? '<div style="margin-top:12px;text-align:right">'
            + '<button type="button" onclick="DeliveryNotesModule.openAcceptanceForm()"'
            + ' style="background:var(--green);color:#fff;border-color:var(--green)">✓ Ghi nghiệm thu</button>'
            + '</div>'
        : '';

      var html = '<div class="span-12">' + kvHtml + acceptHtml + itemsHtml + ntBtn + '</div>';
      Utils.openModal('Chi tiết đơn giao hàng — ' + esc(n.delivery_note_no), html, null);
    } catch (e) { API.error(e); }
  }

  function openAcceptanceForm() {
    if (!_currentDetail) return;
    var n     = _currentDetail.note;
    var items = _currentDetail.items;

    var today = new Date().toISOString().slice(0, 10);
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
      + '<th style="width:180px">Tên vật tư</th>'
      + '<th style="width:70px;text-align:right">SL giao</th>'
      + '<th style="width:80px;text-align:right">SL NT</th>'
      + '<th style="width:110px">Kết quả</th>'
      + '<th style="width:140px">Lý do từ chối</th>'
      + '<th style="width:70px">Bảo hành (ngày)</th>'
      + '<th style="width:100px">Ngày bắt đầu BH</th>'
      + '</tr></thead><tbody>'
      + items.map(function (it, idx) {
          var prevStatus  = it.acceptance_status || 'pending';
          var prevAccepted = Number(it.accepted_quantity) || 0;
          var prevWarrantyDays  = it.warranty_days  != null ? String(it.warranty_days)  : '';
          var prevWarrantyStart = it.warranty_start_date || '';
          return '<tr data-idx="' + idx + '">'
            + '<td style="font-size:12px">' + esc(it.ten_vat_tu || '—') + '</td>'
            + '<td style="text-align:right">' + esc(fmtNum(it.delivered_quantity)) + '</td>'
            + '<td><input class="nt-qty" type="text" inputmode="numeric"'
            + ' value="' + (prevStatus === 'rejected' ? '0' : String(prevAccepted || fmtNum(it.delivered_quantity))) + '"'
            + ' style="width:60px;text-align:right" data-max="' + Number(it.delivered_quantity || 0) + '"></td>'
            + '<td><select class="nt-status" style="width:100%;font-size:12px">'
            + '<option value="pending"'   + (prevStatus === 'pending'   ? ' selected' : '') + '>Chờ NT</option>'
            + '<option value="accepted"'  + (prevStatus === 'accepted'  ? ' selected' : '') + '>Đã NT</option>'
            + '<option value="rejected"'  + (prevStatus === 'rejected'  ? ' selected' : '') + '>Từ chối</option>'
            + '</select></td>'
            + '<td><input class="nt-reason" type="text" value="' + esc(it.rejection_reason || '') + '" style="width:100%;font-size:12px"></td>'
            + '<td><input class="nt-warranty-days" type="text" inputmode="numeric" value="' + esc(prevWarrantyDays) + '" style="width:55px"></td>'
            + '<td><input class="nt-warranty-start" type="date" value="' + esc(prevWarrantyStart) + '" style="width:100%"></td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>'
      + '</div>';

    Utils.openModal('Ghi nghiệm thu — ' + esc(n.delivery_note_no), formHtml, _submitAcceptance);
  }

  function _tickAllAccepted() {
    var rows = document.querySelectorAll('#nt-form-' + Object.keys({}).length + ' tr[data-idx]');
    // Generic: select all rows in the acceptance table
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
      var tr       = rowEls[i];
      var it       = items[i];
      var status   = (tr.querySelector('.nt-status')       || {}).value || 'pending';
      var qtyRaw   = (tr.querySelector('.nt-qty')          || {}).value || '0';
      var reason   = (tr.querySelector('.nt-reason')       || {}).value || '';
      var wDays    = (tr.querySelector('.nt-warranty-days') || {}).value || '';
      var wStart   = (tr.querySelector('.nt-warranty-start')|| {}).value || '';
      var qty      = Math.max(0, parseFloat(qtyRaw.replace(/[^\d.]/g, '')) || 0);
      itemRows.push({
        deliveryNoteItemId: it.delivery_note_item_id,
        acceptanceStatus:   status,
        acceptedQuantity:   status === 'rejected' ? 0 : qty,
        rejectionReason:    reason || null,
        warrantyDays:       wDays ? (parseInt(wDays, 10) || null) : null,
        warrantyStartDate:  wStart || null,
      });
    }

    await API.call('recordDeliveryAcceptance', {
      deliveryNoteId: n.delivery_note_id,
      acceptanceDate: date,
      acceptanceNote: note,
      items: itemRows,
    });
    API.toast('Đã ghi nghiệm thu ' + n.delivery_note_no, 'success');
    load(true);
    // Re-open detail to show updated data
    openDetail(n.delivery_note_id);
  }

  async function archive(id, code) {
    var ok = await Utils.confirmDanger(
      'Lưu trữ đơn giao hàng',
      'Bạn có chắc muốn lưu trữ "' + code + '"? Đơn sẽ không sửa được sau khi lưu trữ.',
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
    load: load,
    openDetail: openDetail,
    openAcceptanceForm: openAcceptanceForm,
    _tickAllAccepted: _tickAllAccepted,
    archive: archive,
  };
})();
