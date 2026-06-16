(function () {
  var state = AppState.list('clarifications');
  var _setupDone = false;
  var _sortBy  = 'created_at';
  var _sortDir = 'desc';

  var TYPE_LABEL = {
    ask_supplier:         'Hỏi hãng',
    supplier_opinion:     'HSX ý kiến',
    supplier_reply:       'HSX phản hồi',
    ask_client:           'CĐT ý kiến',
    client_reply:         'CĐT phản hồi',
    replacement_proposal: 'Đề xuất thay thế',
    final_confirm:        'Final confirm',
    rejected:             'Từ chối',
    other:                'Khác',
  };

  var STATUS_LABEL = {
    processing:      'Đang xử lý',
    waiting_supplier:'Đang hỏi hãng',
    waiting_client:  'Đang chờ CĐT',
    need_more_info:  'Cần bổ sung',
    final_confirmed: 'Đã xác nhận',
    rejected:        'Bị từ chối',
    other:           'Khác',
  };

  var STATUS_STYLE = {
    final_confirmed:  'background:#dcfce7;color:#15803d;border-color:#86efac',
    rejected:         'background:#fee2e2;color:#dc2626;border-color:#fca5a5',
    waiting_supplier: 'background:#eff6ff;color:#1d4ed8;border-color:#93c5fd',
    waiting_client:   'background:#fef3c7;color:#b45309;border-color:#fcd34d',
    need_more_info:   'background:#fef3c7;color:#b45309;border-color:#fcd34d',
    processing:       'background:#f3f4f6;color:#6b7280;border-color:#d1d5db',
    other:            'background:#f3f4f6;color:#6b7280;border-color:#d1d5db',
  };

  function esc(v) { return API.esc(v); }

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    ['clarQ', 'clarQ2', 'clarQ3'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
    });
  }

  async function load(reset) {
    setupOnce();
    if (state.loading) return;
    state.loading = true;
    if (reset) {
      state.rows    = [];
      state.cursor  = '';
      state.hasMore = false;
      state.total   = null;
    }

    var params = {
      q:       (document.getElementById('clarQ')  || {}).value || '',
      q2:      (document.getElementById('clarQ2') || {}).value || '',
      q3:      (document.getElementById('clarQ3') || {}).value || '',
      sortBy:  _sortBy,
      sortDir: _sortDir,
      limit:   50,
    };
    if (state.cursor) params.cursor = state.cursor;

    try {
      var data = await API.call('listAllClarifications', params);
      if (reset) state.rows = data.rows || [];
      else       state.rows = (state.rows || []).concat(data.rows || []);
      state.hasMore = !!data.hasMore;
      state.cursor  = data.nextCursor || '';
      if (data.total != null) state.total = data.total;
    } catch (e) {
      API.error(e);
    }
    state.loading = false;
    render();
  }

  function render() {
    var tbody = document.getElementById('clarRows');
    var info  = document.getElementById('clarInfo');
    var more  = document.getElementById('clarMore');
    if (!tbody) return;

    if (info) {
      var t = state.total;
      info.textContent = t != null
        ? 'Tổng: ' + t + ' bản ghi' + (state.rows.length < t ? ', đang hiển thị ' + state.rows.length : '')
        : '';
    }

    tbody.innerHTML = (state.rows || []).map(function (r) {
      var iid = esc(r.rfq_item_id || '');
      var rid = esc(r.rfq_id || '');
      var st  = r.status_after || '';
      var stStyle = STATUS_STYLE[st] || 'background:#f3f4f6;color:#6b7280;border-color:#d1d5db';

      var idCell = '<td style="white-space:nowrap;font-size:11px;font-family:monospace">'
        + '<span class="link-edit" onclick="RfqItemsModule.openClarificationTimeline(\'' + iid + '\')">'
        + esc(r.clarification_id || '') + '</span></td>';

      var timeCell = '<td style="white-space:nowrap;font-size:12px">'
        + esc((r.created_at || '').slice(0, 10)) + '</td>';

      var maGoiCell = '<td style="font-family:monospace;font-size:12px">'
        + (rid
          ? '<span class="link-edit" onclick="RfqsModule.openEdit(\'' + rid + '\')">' + esc(r.ma_goi_tbmt || '—') + '</span>'
          : esc(r.ma_goi_tbmt || '—'))
        + '</td>';

      var tenGoiCell = '<td style="font-size:12px">'
        + (rid
          ? '<span class="link-edit" onclick="RfqsModule.openEdit(\'' + rid + '\')">' + esc(r.ten_goi || '—') + '</span>'
          : esc(r.ten_goi || '—'))
        + '</td>';

      var maVtCell = '<td style="font-family:monospace;font-size:12px">'
        + (iid
          ? '<span class="link-edit" onclick="RfqItemsModule.openEdit(\'' + iid + '\')">' + esc(r.ma_vat_tu || '—') + '</span>'
          : esc(r.ma_vat_tu || '—'))
        + '</td>';

      var tenVtCell = '<td style="font-size:12px">'
        + (iid
          ? '<span class="link-edit" onclick="RfqItemsModule.openEdit(\'' + iid + '\')">' + esc(r.ten_vat_tu || '—') + '</span>'
          : esc(r.ten_vat_tu || '—'))
        + '</td>';

      var typeCell = '<td><span class="badge" style="font-size:11px;white-space:nowrap">'
        + esc(TYPE_LABEL[r.clarification_type] || r.clarification_type || '—') + '</span></td>';

      var statusCell = '<td><span class="badge" style="font-size:11px;white-space:nowrap;' + stStyle + '">'
        + esc(STATUS_LABEL[st] || st || '—') + '</span></td>';

      var titleCell = '<td style="font-size:12px;cursor:pointer;color:var(--blue)"'
        + ' onclick="RfqItemsModule.openClarificationTimeline(\'' + iid + '\')"'
        + ' title="' + esc(r.title || '') + '">'
        + esc(r.title || '—') + '</td>';

      var preview  = (r.content || '').slice(0, 80);
      var ellipsis = r.content && r.content.length > 80 ? '…' : '';
      var contentCell = '<td style="font-size:12px;color:var(--text-muted);max-width:200px"'
        + ' title="' + esc(r.content || '') + '">'
        + esc(preview) + ellipsis + '</td>';

      var urlCell = (r.external_url && /^https?:\/\//i.test(r.external_url))
        ? '<td><a class="btn btn-sm" href="' + esc(encodeURI(r.external_url)) + '" target="_blank" rel="noopener noreferrer" title="' + esc(r.external_url) + '">Mở</a></td>'
        : '<td style="text-align:center;color:var(--text-faint);font-size:12px">—</td>';

      return '<tr>' + idCell + timeCell + maGoiCell + tenGoiCell + maVtCell + tenVtCell
        + typeCell + statusCell + titleCell + contentCell + urlCell + '</tr>';
    }).join('') || '<tr><td colspan="11" style="text-align:center;color:var(--text-faint);padding:24px">Không có dữ liệu</td></tr>';

    if (more) more.classList.toggle('hidden', !state.hasMore);
    updateSortHeaders();
  }

  function updateSortHeaders() {
    var thead = document.getElementById('clarThead');
    if (!thead) return;
    thead.querySelectorAll('th[data-sort]').forEach(function (th) {
      var key   = th.getAttribute('data-sort');
      var base  = th.getAttribute('data-label') || '';
      var arrow = key === _sortBy ? (_sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      th.textContent = base + arrow;
    });
  }

  function onSort(key) {
    if (_sortBy === key) {
      _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      _sortBy  = key;
      _sortDir = key === 'created_at' ? 'desc' : 'asc';
    }
    load(true);
  }

  window.ClarificationsModule = { load: load, onSort: onSort };
})();
