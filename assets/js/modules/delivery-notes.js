(function () {
  var state = AppState.list('delivery-notes');
  var _setupDone = false;

  var NOTE_TYPE_LABEL = { delivery: 'Giao hàng', 'return': 'Trả hàng' };
  var STATUS_STYLE = {
    active:   'background:#dcfce7;color:#15803d;border-color:#86efac',
    archived: 'background:#f3f4f6;color:#6b7280;border-color:#d1d5db',
  };

  function noteTypeLabel(v) { return NOTE_TYPE_LABEL[v] || v || '—'; }
  function statusLabel(v)   { return v === 'active' ? 'Hoạt động' : v === 'archived' ? 'Lưu trữ' : (v || '—'); }
  function fmtDate(iso)     { return iso ? iso.slice(0, 10) : '—'; }
  function fmtNum(n)        { return (n != null && n !== '') ? String(Number(n)) : '0'; }
  function esc(v)           { return API.esc(v); }

  function isManager() {
    var role = AppState.get('user') && AppState.get('user').role;
    return role === 'admin' || role === 'manager';
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
        + '<td><span class="badge" style="' + (STATUS_STYLE[r.status] || '') + '">'
            + esc(statusLabel(r.status)) + '</span></td>'
        + '<td style="white-space:nowrap">'
            + '<button type="button" onclick="DeliveryNotesModule.openDetail(\'' + esc(r.delivery_note_id) + '\')">Xem</button>'
            + archiveBtn
        + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--text-faint);padding:24px">Không có dữ liệu</td></tr>';
    if (more) more.classList.toggle('hidden', !state.hasMore);
  }

  async function openDetail(id) {
    try {
      var data = await API.call('getDeliveryNoteDetail', { deliveryNoteId: id });
      var n     = data.note;
      var items = data.items || [];
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

      var kvHtml = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px 16px;margin-bottom:12px">'
        + kv.map(function (p) {
            return '<div style="display:flex;gap:6px;align-items:baseline">'
              + '<span style="color:var(--text-muted);font-size:12px;min-width:80px;flex:0 0 auto">' + esc(p[0]) + '</span>'
              + '<span style="font-size:13px;font-weight:500">' + esc(p[1]) + '</span>'
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
            + '</tr></thead><tbody>'
            + items.map(function (it) {
                return '<tr>'
                  + '<td>' + esc(it.ma_vat_tu      || '—') + '</td>'
                  + '<td>' + esc(it.ten_vat_tu      || '—') + '</td>'
                  + '<td>' + esc(it.required_model  || '—') + '</td>'
                  + '<td>' + esc(it.brand || it.manufacturer || '—') + '</td>'
                  + '<td>' + esc(it.unit             || '—') + '</td>'
                  + '<td style="text-align:right">' + esc(fmtNum(it.delivered_quantity)) + '</td>'
                  + '</tr>';
              }).join('')
            + '</tbody></table></div>'
        : '<p style="color:var(--text-faint);margin:0">Chưa có dòng vật tư.</p>';

      var html = '<div class="span-12">' + kvHtml + itemsHtml + '</div>';
      Utils.openModal('Chi tiết đơn giao hàng — ' + esc(n.delivery_note_no), html, null);
    } catch (e) { API.error(e); }
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

  window.DeliveryNotesModule = { load: load, openDetail: openDetail, archive: archive };
})();
