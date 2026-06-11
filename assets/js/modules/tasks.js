(function () {
  var state = AppState.list('tasks');
  var sort = { by: '', dir: 'desc' };
  var _setupDone = false;
  var _suggestTimer = null;

  // ─── lookup tables ────────────────────────────────────────────────────────

  var STATUS_LIST = [
    ['dang_lam',    'Đang làm'],
    ['cho_phan_hoi','Chờ phản hồi'],
    ['tam_dung',    'Tạm dừng'],
    ['hoan_thanh',  'Hoàn thành'],
    ['huy_bo',      'Hủy bỏ'],
  ];

  var PRIORITY_LIST = [
    ['khan',      'Khẩn'],
    ['cao',       'Cao'],
    ['trung_binh','Trung bình'],
    ['thap',      'Thấp'],
  ];

  var STATUS_STYLE = {
    dang_lam:    'background:#dbeafe;color:#1d4ed8;border-color:#bfdbfe',
    cho_phan_hoi:'background:#fef9c3;color:#92400e;border-color:#fde68a',
    tam_dung:    'background:#f3f4f6;color:#374151;border-color:#d1d5db',
    hoan_thanh:  'background:#dcfce7;color:#15803d;border-color:#bbf7d0',
    huy_bo:      'background:#fee2e2;color:#dc2626;border-color:#fca5a5',
  };

  var PRIORITY_STYLE = {
    khan:      'background:#fee2e2;color:#dc2626;border-color:#fca5a5',
    cao:       'background:#ffedd5;color:#c2410c;border-color:#fdba74',
    trung_binh:'background:#f3f4f6;color:#374151;border-color:#d1d5db',
    thap:      'background:#f0fdf4;color:#15803d;border-color:#bbf7d0',
  };

  function statusLabel(v)   { var s = STATUS_LIST.find(function(x){return x[0]===v;}); return s?s[1]:(v||''); }
  function priorityLabel(v) { var p = PRIORITY_LIST.find(function(x){return x[0]===v;}); return p?p[1]:(v||''); }

  // ─── deadline helpers ─────────────────────────────────────────────────────

  function deadlineCell(deadline) {
    if (!deadline) return '<span style="color:var(--text-faint)">—</span>';
    var today = new Date(); today.setHours(0,0,0,0);
    var d = new Date(deadline + 'T00:00:00');
    var diff = Math.round((d - today) / 86400000);
    if (diff < 0)  return '<span style="color:var(--red);font-weight:600">' + API.esc(deadline) + '</span>';
    if (diff === 0) return '<span style="color:var(--primary);font-weight:600">' + API.esc(deadline) + '</span>';
    return '<span>' + API.esc(deadline) + '</span>';
  }

  function remainCell(deadline) {
    if (!deadline) return '<span style="color:var(--text-faint)">—</span>';
    var today = new Date(); today.setHours(0,0,0,0);
    var d = new Date(deadline + 'T00:00:00');
    var diff = Math.round((d - today) / 86400000);
    if (diff < 0)  return '<span style="color:var(--red);font-weight:600">Quá hạn ' + Math.abs(diff) + ' ngày</span>';
    if (diff === 0) return '<span style="color:var(--primary);font-weight:600">Hôm nay</span>';
    if (diff <= 7)  return '<span style="color:#ea7600;font-weight:600">Còn ' + diff + ' ngày</span>';
    return '<span style="color:var(--text-muted)">Còn ' + diff + ' ngày</span>';
  }

  function formatDate(iso) {
    if (!iso) return '';
    return iso.slice(0, 10);
  }

  // ─── setup + sort ─────────────────────────────────────────────────────────

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    var el = document.getElementById('taskSearch');
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
  }

  function syncSort() {
    document.querySelectorAll('#screen-tasks th[data-sort-key]').forEach(function (th) {
      var key = th.getAttribute('data-sort-key');
      if (!th.getAttribute('data-label')) th.setAttribute('data-label', th.textContent.replace(/[▲▼↕]/g,'').trim());
      var label = th.getAttribute('data-label');
      var active = sort.by === key;
      th.textContent = label + (active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕');
      th.style.cursor = 'pointer';
      th.onclick = function () {
        if (sort.by === key) { sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; }
        else { sort.by = key; sort.dir = 'asc'; }
        load(true);
      };
    });
  }

  // ─── mini cards ───────────────────────────────────────────────────────────

  function renderSummary(summary) {
    var el = document.getElementById('taskSummaryCards');
    if (!el || !summary) return;
    el.innerHTML = [
      { label: 'Đang làm',       count: summary.dang_lam,     style: 'border-left:3px solid #1d4ed8' },
      { label: 'Chờ phản hồi',   count: summary.cho_phan_hoi, style: 'border-left:3px solid #d97706' },
      { label: 'Sắp đến hạn',    count: summary.sap_den_han,  style: 'border-left:3px solid #ea7600' },
      { label: 'Quá hạn',        count: summary.qua_han,      style: 'border-left:3px solid #dc2626' },
    ].map(function (c) {
      return '<div class="metric-card" style="' + c.style + ';padding:12px 16px;min-width:110px">'
        + '<div style="font-size:22px;font-weight:700;line-height:1">' + (c.count || 0) + '</div>'
        + '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">' + c.label + '</div>'
        + '</div>';
    }).join('');
  }

  // ─── load + render ────────────────────────────────────────────────────────

  async function load(reset) {
    setupOnce();
    if (reset) { state.cursor = ''; state.rows = []; }
    state.q        = (document.getElementById('taskSearch')         || {}).value || '';
    state.status   = (document.getElementById('taskFilterStatus')   || {}).value || '';
    state.priority = (document.getElementById('taskFilterPriority') || {}).value || '';
    try {
      var params = { q: state.q, status: state.status, priority: state.priority, cursor: state.cursor, limit: 50 };
      if (sort.by) { params.sortBy = sort.by; params.sortDir = sort.dir; }
      var data = await API.get('getTasks', params);
      state.rows    = reset ? (data.rows || []) : (state.rows || []).concat(data.rows || []);
      state.cursor  = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
      renderSummary(data.summary);
    } catch (err) { API.error(err); }
  }

  function render() {
    syncSort();
    var canWrite = Utils.roleCanWrite();
    var canDelete = AppState.get('user') && ['admin','manager'].indexOf(AppState.get('user').role) >= 0;
    var offset = (state.rows || []).length - (state.rows || []).length; // always 0 for STT
    document.getElementById('taskRows').innerHTML = (state.rows || []).map(function (r, i) {
      var esc = API.esc;
      // status quick select
      var statusSel = canWrite
        ? '<select style="font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid #d1d5db;cursor:pointer;'
          + (STATUS_STYLE[r.status] || '') + '"'
          + ' onchange="TasksModule.quickStatus(\'' + esc(r.task_id) + '\',this.value,this)">'
          + STATUS_LIST.map(function (s) {
              return '<option value="' + s[0] + '"' + (r.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
            }).join('')
          + '</select>'
        : '<span class="badge" style="' + (STATUS_STYLE[r.status]||'') + '">' + esc(statusLabel(r.status)) + '</span>';
      // priority quick select
      var priSel = canWrite
        ? '<select style="font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid #d1d5db;cursor:pointer;'
          + (PRIORITY_STYLE[r.priority] || '') + '"'
          + ' onchange="TasksModule.quickPriority(\'' + esc(r.task_id) + '\',this.value,this)">'
          + PRIORITY_LIST.map(function (p) {
              return '<option value="' + p[0] + '"' + (r.priority === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
            }).join('')
          + '</select>'
        : '<span class="badge" style="' + (PRIORITY_STYLE[r.priority]||'') + '">' + esc(priorityLabel(r.priority)) + '</span>';

      var activityDate = formatDate(r.last_activity_at || r.updated_at);
      var followupCell = r.next_followup_date
        ? '<span style="font-size:12px">' + esc(r.next_followup_date) + '</span>'
        : '<span style="color:var(--text-faint)">—</span>';

      var editBtn = canWrite
        ? '<button type="button" class="btn-link" onclick="TasksModule.openEdit(\'' + esc(r.task_id) + '\')" style="margin-right:4px">Sửa</button>'
        : '';
      var delBtn = canDelete
        ? '<button type="button" class="btn-x-archive" title="Xóa task" onclick="TasksModule.deleteTask(\'' + esc(r.task_id) + '\')">✕</button>'
        : '';

      return '<tr>'
        + '<td style="text-align:center;color:var(--text-muted)">' + (i + 1) + '</td>'
        + '<td>' + esc(r.company_name || '') + '</td>'
        + '<td><span class="link-edit" onclick="TasksModule.openEdit(\'' + esc(r.task_id) + '\')">'
          + esc(r.title) + '</span>'
          + (r.progress_percent > 0 ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + esc(String(r.progress_percent)) + '%</div>' : '')
          + '</td>'
        + '<td style="color:var(--text-muted);font-size:12px">' + esc(r.start_date || '') + '</td>'
        + '<td>' + deadlineCell(r.deadline_date) + '</td>'
        + '<td>' + remainCell(r.deadline_date) + '</td>'
        + '<td>' + followupCell + '</td>'
        + '<td>' + statusSel + '</td>'
        + '<td>' + priSel + '</td>'
        + '<td style="font-size:11px;color:var(--text-muted)">' + esc(activityDate) + '</td>'
        + '<td style="white-space:nowrap">' + editBtn + delBtn + '</td>'
        + '</tr>';
    }).join('');
    document.getElementById('taskMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }

  // ─── quick status / priority ─────────────────────────────────────────────

  async function quickStatus(taskId, status, selectEl) {
    try {
      await API.call('quickUpdateTaskStatus', { taskId: taskId, status: status });
      // update local row so re-render doesn't flicker
      var row = (state.rows || []).find(function (r) { return r.task_id === taskId; });
      if (row) {
        row.status = status;
        if (selectEl) selectEl.style.cssText = 'font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid #d1d5db;cursor:pointer;' + (STATUS_STYLE[status] || '');
      }
      renderSummaryRefresh();
    } catch (err) { API.error(err); }
  }

  async function quickPriority(taskId, priority, selectEl) {
    try {
      await API.call('quickUpdateTaskPriority', { taskId: taskId, priority: priority });
      var row = (state.rows || []).find(function (r) { return r.task_id === taskId; });
      if (row) {
        row.priority = priority;
        if (selectEl) selectEl.style.cssText = 'font-size:11px;padding:2px 4px;border-radius:4px;border:1px solid #d1d5db;cursor:pointer;' + (PRIORITY_STYLE[priority] || '');
      }
    } catch (err) { API.error(err); }
  }

  async function renderSummaryRefresh() {
    try {
      var data = await API.get('getTasks', { q: '', status: '', priority: '', cursor: '', limit: 1 });
      renderSummary(data.summary);
    } catch (_) {}
  }

  // ─── delete ───────────────────────────────────────────────────────────────

  async function deleteTask(taskId) {
    var row = (state.rows || []).find(function (r) { return r.task_id === taskId; });
    var name = row ? row.title : taskId;
    var ok = await Utils.confirmDanger('Xóa task', 'Bạn có chắc muốn xóa "' + name + '"? Hành động này không thể hoàn tác.', 'Xóa');
    if (!ok) return;
    try {
      await API.call('deleteTask', { taskId: taskId });
      API.toast('Đã xóa task', 'success');
      await load(true);
    } catch (err) { API.error(err); }
  }

  // ─── company autocomplete ─────────────────────────────────────────────────

  function bindCompanyAutocomplete(input) {
    if (!input) return;
    input.addEventListener('input', function () {
      clearTimeout(_suggestTimer);
      var val = (input.value || '').trim();
      if (!val || val.length < 1) { clearDatalist(); return; }
      _suggestTimer = setTimeout(function () {
        API.get('suggestTaskCompanies', { q: val }).then(function (data) {
          var list = document.getElementById('taskCompanySuggest');
          if (!list) return;
          list.innerHTML = (data.suggestions || []).map(function (s) {
            return '<option value="' + API.esc(s) + '">';
          }).join('');
        }).catch(function () {});
      }, 300);
    });
  }

  function clearDatalist() {
    var list = document.getElementById('taskCompanySuggest');
    if (list) list.innerHTML = '';
  }

  // ─── modal create/edit ────────────────────────────────────────────────────

  function openCreate() {
    var today = new Date().toISOString().slice(0, 10);
    openForm({}, today);
  }

  async function openEdit(taskId) {
    var row = (state.rows || []).find(function (r) { return r.task_id === taskId; });
    if (!row) row = { task_id: taskId };
    openForm(row, row.start_date || new Date().toISOString().slice(0, 10));
  }

  function openForm(row, startDate) {
    var isEdit = !!row.task_id;
    var title = isEdit ? 'Sửa task: ' + API.esc(row.title || row.task_id) : 'Thêm task mới';

    var priSel = '<select name="priority">'
      + PRIORITY_LIST.map(function (p) {
          return '<option value="' + p[0] + '"' + ((row.priority || 'trung_binh') === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
        }).join('')
      + '</select>';

    var statusSel = '<select name="status" style="min-width:160px;max-width:220px">'
      + STATUS_LIST.map(function (s) {
          return '<option value="' + s[0] + '"' + ((row.status || 'dang_lam') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
        }).join('')
      + '</select>';

    // Row 1: company(3) + task_type(2) + title(5) + priority(2) = 12
    // Row 2: start_date(3) + deadline(3) + followup(3) + progress(3) = 12
    // Row 3: description full-width, large textarea
    // Row 4: latest_note full-width, medium textarea
    // Footer row: status select on left, separated by border-top
    var html = '<datalist id="taskCompanySuggest"></datalist>'

      // ── Row 1 ──────────────────────────────────────────────────────────────
      + '<label class="span-3">Công ty'
        + '<input name="companyName" list="taskCompanySuggest" autocomplete="off"'
        + ' value="' + API.esc(row.company_name || '') + '" placeholder="Nhập hoặc chọn công ty...">'
        + '</label>'
      + '<label class="span-2">Loại task'
        + '<input name="taskType" value="' + API.esc(row.task_type || '') + '" placeholder="Báo giá, Kỹ thuật...">'
        + '</label>'
      + '<label class="span-5">Tên task'
        + '<input name="title" required maxlength="300" value="' + API.esc(row.title || '') + '">'
        + '</label>'
      + '<label class="span-2">Ưu tiên' + priSel + '</label>'

      // ── Row 2 ──────────────────────────────────────────────────────────────
      + '<label class="span-3" style="color:var(--text-muted)">Ngày bắt đầu'
        + '<input type="text" value="' + API.esc(startDate || '') + '"'
        + ' readonly tabindex="-1"'
        + ' style="background:var(--bg);color:var(--text-muted);cursor:default;pointer-events:none">'
        + '</label>'
      + '<label class="span-3">Deadline'
        + '<input name="deadlineDate" type="date" value="' + API.esc(row.deadline_date || '') + '">'
        + '</label>'
      + '<label class="span-3">Follow-up tiếp theo'
        + '<input name="nextFollowupDate" type="date" value="' + API.esc(row.next_followup_date || '') + '">'
        + '</label>'
      + '<label class="span-3">Tiến độ %'
        + '<input name="progressPercent" type="number" min="0" max="100"'
        + ' value="' + API.esc(String(row.progress_percent != null ? row.progress_percent : 0)) + '">'
        + '</label>'

      // ── Row 3 ──────────────────────────────────────────────────────────────
      + '<label class="span-12">Mô tả chi tiết'
        + '<textarea name="description" style="min-height:220px;resize:vertical">'
        + API.esc(row.description || '') + '</textarea>'
        + '</label>'

      // ── Row 4 ──────────────────────────────────────────────────────────────
      + '<label class="span-12">Ghi chú / cập nhật gần nhất'
        + '<textarea name="latestNote" style="min-height:110px;resize:vertical">'
        + API.esc(row.latest_note || '') + '</textarea>'
        + '</label>'

      // ── Footer row: status left-aligned, visual separator from buttons ─────
      + '<div class="span-12" style="display:flex;align-items:center;gap:10px;padding-top:12px;margin-top:2px;border-top:1px solid var(--border)">'
        + '<span style="font-size:13px;color:#4b5563;font-weight:500;white-space:nowrap">Trạng thái</span>'
        + statusSel
        + '</div>';

    Utils.openModal(title, html, async function (data) {
      try {
        if (isEdit) data.taskId = row.task_id;
        await API.call(isEdit ? 'updateTask' : 'createTask', data);
        Utils.closeModal();
        API.toast(isEdit ? 'Đã cập nhật task' : 'Đã tạo task mới', 'success');
        await load(true);
      } catch (err) { API.error(err); }
    });

    setTimeout(function () {
      bindCompanyAutocomplete(document.querySelector('#modalBody input[name="companyName"]'));
    }, 0);
    Auth.applyRoleUI();
  }

  // ─── public interface ─────────────────────────────────────────────────────

  window.TasksModule = {
    init: function () { load(true); },
    load: load,
    openCreate: openCreate,
    openEdit: openEdit,
    deleteTask: deleteTask,
    quickStatus: quickStatus,
    quickPriority: quickPriority,
  };
})();
