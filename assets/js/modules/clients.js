(function () {
  var state = AppState.list('clients');
  var sort = { by: '', dir: 'asc' };
  var _setupDone = false;

  var EQUIPMENT_GROUPS = [
    ['turbine',        'Tuabin'],
    ['generator',      'Máy phát điện'],
    ['boiler',         'Lò hơi'],
    ['heater',         'Bộ sấy / gia nhiệt'],
    ['primary_fan',    'Quạt gió sơ cấp (PA)'],
    ['secondary_fan',  'Quạt gió thứ cấp (SA/FD)'],
    ['coal_mill',      'Máy nghiền than'],
    ['gearbox',        'Hộp số / giảm tốc'],
    ['condenser',      'Bình ngưng'],
    ['feed_pump',      'Bơm nước cấp'],
    ['transformer',    'Máy biến áp'],
    ['pump',           'Bơm'],
    ['motor',          'Động cơ điện'],
    ['valve',          'Van'],
    ['other',          'Khác'],
  ];
  var VALID_GROUPS = EQUIPMENT_GROUPS.map(function (g) { return g[0]; });

  var CRITICAL_LEVELS = [
    ['critical', 'Thiết yếu (A)'],
    ['normal',   'Bình thường (B)'],
    ['low',      'Thấp (C)'],
  ];

  function groupLabel(key) {
    var g = EQUIPMENT_GROUPS.find(function (g) { return g[0] === key; });
    return g ? g[1] : (key || '');
  }

  function critLabel(key) {
    var c = CRITICAL_LEVELS.find(function (c) { return c[0] === key; });
    return c ? c[1] : 'Bình thường (B)';
  }

  // ─── list screen ───────────────────────────────────────────────────────────

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    var el = document.getElementById('clientSearch');
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
  }

  function syncSort() {
    var def = 'client_id';
    document.querySelectorAll('#screen-clients th[data-sort-key]').forEach(function (th) {
      var key = th.getAttribute('data-sort-key');
      if (!th.getAttribute('data-label')) th.setAttribute('data-label', th.textContent.trim());
      var label = th.getAttribute('data-label');
      var active = (sort.by || def) === key;
      th.textContent = label + (active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕');
      th.onclick = function () {
        var cur = sort.by || def;
        if (cur === key) { sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; }
        else { sort.by = key; sort.dir = 'asc'; }
        load(true);
      };
    });
  }

  async function load(reset) {
    setupOnce();
    if (reset) state.cursor = '';
    state.q = document.getElementById('clientSearch').value || '';
    try {
      var params = { q: state.q, cursor: state.cursor, limit: 50 };
      if (sort.by) { params.sortBy = sort.by; params.sortDir = sort.dir; }
      var data = await API.get('getClients', params);
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }

  function render() {
    syncSort();
    var canWrite = Utils.roleCanWrite();
    document.getElementById('clientRows').innerHTML = (state.rows || []).map(function (r) {
      var nameCell = canWrite
        ? '<span class="link-edit" onclick="ClientsModule.openEdit(\'' + API.esc(r.client_id) + '\')">' + API.esc(r.client_name) + '</span>'
        : API.esc(r.client_name);
      return '<tr>'
        + '<td>' + API.esc(r.client_id) + '</td>'
        + '<td>' + nameCell + '</td>'
        + '<td>' + API.esc(r.plant_name) + '</td>'
        + '<td>' + API.esc(r.province) + '</td>'
        + '<td>' + API.esc(r.note) + '</td>'
        + '</tr>';
    }).join('');
    document.getElementById('clientMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }

  // ─── client CRUD ───────────────────────────────────────────────────────────

  function openCreate() { openForm({}, []); }

  async function openEdit(id) {
    var row = (state.rows || []).find(function (r) { return r.client_id === id; }) || { client_id: id };
    try {
      var eqData = await API.get('getClientEquipment', { clientId: id, limit: 200 });
      state.currentEquipment = eqData.rows || [];
      openForm(row, state.currentEquipment);
    } catch (err) { API.error(err); }
  }

  function openForm(row, equipment) {
    equipment = equipment || [];
    var title = row.client_id
      ? 'CĐT: ' + API.esc(row.client_name || row.client_id)
      : 'Thêm khách hàng / CĐT';
    Utils.openModal(title, clientFields(row, equipment), async function (data) {
      try {
        if (row.client_id) data.clientId = row.client_id;
        await API.call(row.client_id ? 'updateClient' : 'createClient', data);
        Utils.closeModal();
        API.toast('Đã lưu khách hàng', 'success');
        await load(true);
      } catch (err) { API.error(err); }
    });
    Auth.applyRoleUI();
  }

  function clientFields(r, equipment) {
    r = r || {};
    var clientId = r.client_id || '';
    var activeEq = (equipment || []).filter(function (e) { return e.status !== 'archived'; });

    var base = '<label>Tên CĐT / khách hàng<input name="clientName" required value="' + API.esc(r.client_name || '') + '"></label>'
      + '<label>Nhà máy<input name="plantName" value="' + API.esc(r.plant_name || '') + '"></label>'
      + '<label>Tỉnh / thành<input name="province" value="' + API.esc(r.province || '') + '"></label>'
      + '<label>Ghi chú<textarea name="note">' + API.esc(r.note || '') + '</textarea></label>';

    if (!clientId) return base;
    return base + equipmentSection(clientId, activeEq);
  }

  // ─── equipment section (inside client detail modal) ────────────────────────

  function equipmentSection(clientId, activeEq) {
    var eqRows = activeEq.length
      ? activeEq.map(function (e) {
          var cid = API.esc(clientId);
          var eid = API.esc(e.equipment_id);
          var critStyle = e.critical_level === 'critical'
            ? 'background:var(--red);color:#fff;border-color:var(--red)'
            : (e.critical_level === 'low' ? 'color:var(--text-muted)' : '');
          return '<tr>'
            + '<td>' + API.esc([e.plant_name, e.unit_no].filter(Boolean).join(' / ') || '') + '</td>'
            + '<td><span class="badge" style="font-size:11px">' + API.esc(groupLabel(e.equipment_group)) + '</span></td>'
            + '<td>' + API.esc(e.equipment_name || '') + '</td>'
            + '<td style="color:var(--text-muted)">' + API.esc(e.equipment_tag || '') + '</td>'
            + '<td>' + API.esc(e.oem_manufacturer || '') + '</td>'
            + '<td>' + API.esc(e.oem_model || '') + '</td>'
            + '<td style="color:var(--text-muted)">' + API.esc(e.oem_part_no || '') + '</td>'
            + '<td>' + API.esc(e.replacement_manufacturer || '') + '</td>'
            + '<td>' + API.esc(e.replacement_model || '') + '</td>'
            + '<td><span class="badge" style="font-size:11px;' + critStyle + '">' + API.esc(critLabel(e.critical_level)) + '</span></td>'
            + '<td style="white-space:nowrap">'
            + '<button type="button" data-write onclick="ClientsModule.openEquipmentForm(\'' + cid + '\',\'' + eid + '\')">Sửa</button> '
            + '<button type="button" data-write onclick="ClientsModule.archiveEquipment(\'' + eid + '\',\'' + cid + '\')">Lưu trữ</button>'
            + '</td>'
            + '</tr>';
        }).join('')
      : '<tr><td colspan="11" class="empty-state" style="border:0;min-height:48px">Chưa có thiết bị nào.</td></tr>';

    return '<div class="modal-section">'
      + '<div class="section-head">'
      + '<h4>Thiết bị đang dùng (' + activeEq.length + ')</h4>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
      + '<button type="button" onclick="ClientsModule.downloadEquipmentTemplate()">Tải template CSV</button>'
      + '<button type="button" data-write onclick="ClientsModule.importEquipmentCsv(\'' + API.esc(clientId) + '\')">Import CSV/XLSX</button>'
      + '<button type="button" class="primary" data-write onclick="ClientsModule.openEquipmentForm(\'' + API.esc(clientId) + '\',\'\')">+ Thêm thiết bị</button>'
      + '</div></div>'
      + '<div class="table-wrap" style="margin-top:8px"><table style="min-width:920px">'
      + '<thead><tr>'
      + '<th>Tổ máy</th><th>Nhóm</th><th>Tên thiết bị</th><th>Tag</th>'
      + '<th>OEM</th><th>Model gốc</th><th>Mã OEM</th>'
      + '<th>NSX thay thế</th><th>Model thay thế</th>'
      + '<th>Mức QT</th><th style="width:110px"></th>'
      + '</tr></thead>'
      + '<tbody>' + eqRows + '</tbody>'
      + '</table></div>'
      + '<input type="file" id="eqImportFile" accept=".csv,.xlsx,.xls" style="display:none">'
      + '</div>';
  }

  // ─── equipment CRUD ────────────────────────────────────────────────────────

  function openEquipmentForm(clientId, equipmentId) {
    var eq = equipmentId
      ? (state.currentEquipment || []).find(function (e) { return e.equipment_id === equipmentId; }) || {}
      : {};
    Utils.openModal(
      equipmentId ? 'Sửa thiết bị' : 'Thêm thiết bị',
      equipmentFields(eq),
      async function (data) {
        try {
          data.clientId = clientId;
          if (equipmentId) data.equipmentId = equipmentId;
          await API.call(equipmentId ? 'updateClientEquipment' : 'createClientEquipment', data);
          Utils.closeModal();
          API.toast('Đã lưu thiết bị', 'success');
          await openEdit(clientId);
        } catch (err) { API.error(err); }
      }
    );
    Auth.applyRoleUI();
  }

  function equipmentFields(eq) {
    eq = eq || {};
    var groupSel = '<select name="equipmentGroup">'
      + EQUIPMENT_GROUPS.map(function (g) {
          return '<option value="' + g[0] + '"' + (eq.equipment_group === g[0] ? ' selected' : '') + '>' + API.esc(g[1]) + '</option>';
        }).join('')
      + '</select>';
    var critSel = '<select name="criticalLevel">'
      + CRITICAL_LEVELS.map(function (c) {
          return '<option value="' + c[0] + '"' + ((eq.critical_level || 'normal') === c[0] ? ' selected' : '') + '>' + API.esc(c[1]) + '</option>';
        }).join('')
      + '</select>';

    return '<label>Nhà máy / Tổ máy<input name="plantName" value="' + API.esc(eq.plant_name || '') + '"></label>'
      + '<label>Tổ số / Unit No<input name="unitNo" value="' + API.esc(eq.unit_no || '') + '"></label>'
      + '<label>Khu vực hệ thống<input name="systemArea" value="' + API.esc(eq.system_area || '') + '"></label>'
      + '<label>Nhóm thiết bị *' + groupSel + '</label>'
      + '<label>Tên thiết bị<input name="equipmentName" value="' + API.esc(eq.equipment_name || '') + '"></label>'
      + '<label>Tag thiết bị<input name="equipmentTag" value="' + API.esc(eq.equipment_tag || '') + '"></label>'
      + '<label>OEM (Nhà sản xuất gốc)<input name="oemManufacturer" value="' + API.esc(eq.oem_manufacturer || '') + '"></label>'
      + '<label>Model OEM<input name="oemModel" value="' + API.esc(eq.oem_model || '') + '"></label>'
      + '<label>Thông số kỹ thuật OEM<input name="oemSpec" value="' + API.esc(eq.oem_spec || '') + '"></label>'
      + '<label>Mã phụ tùng OEM<input name="oemPartNo" value="' + API.esc(eq.oem_part_no || '') + '"></label>'
      + '<label>NSX thay thế<input name="replacementManufacturer" value="' + API.esc(eq.replacement_manufacturer || '') + '"></label>'
      + '<label>Model thay thế<input name="replacementModel" value="' + API.esc(eq.replacement_model || '') + '"></label>'
      + '<label>Thông số thay thế<input name="replacementSpec" value="' + API.esc(eq.replacement_spec || '') + '"></label>'
      + '<label>Mã phụ tùng thay thế<input name="replacementPartNo" value="' + API.esc(eq.replacement_part_no || '') + '"></label>'
      + '<label>Mức quan trọng' + critSel + '</label>'
      + '<label>Ghi chú<textarea name="note">' + API.esc(eq.note || '') + '</textarea></label>';
  }

  async function archiveEquipment(equipmentId, clientId) {
    try {
      await API.call('archiveClientEquipment', { equipmentId: equipmentId });
      API.toast('Đã lưu trữ thiết bị', 'success');
      await openEdit(clientId);
    } catch (err) { API.error(err); }
  }

  // ─── import CSV/XLSX ───────────────────────────────────────────────────────

  function downloadEquipmentTemplate() {
    var headers = [
      'plant_name', 'unit_no', 'system_area', 'equipment_group', 'equipment_name', 'equipment_tag',
      'oem_manufacturer', 'oem_model', 'oem_spec', 'oem_part_no',
      'replacement_manufacturer', 'replacement_model', 'replacement_spec', 'replacement_part_no',
      'critical_level', 'note',
    ];
    var example = [
      'Nhà máy A', 'Tổ 1', 'Hệ thống hơi', 'turbine', 'Tuabin hơi 150MW', 'T1-TURB-001',
      'Siemens', 'SST-400', '50Hz 150MW', 'ABC12345',
      'Doosan', 'DT300', '', 'DEF67890', 'critical', '',
    ];
    var csv = headers.join(',') + '\n'
      + example.map(function (v) { return '"' + String(v || '').replace(/"/g, '""') + '"'; }).join(',') + '\n';
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'template_equipment.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function importEquipmentCsv(clientId) {
    var input = document.getElementById('eqImportFile');
    if (!input) return;
    if (typeof XLSX === 'undefined') { API.toast('Thư viện XLSX chưa tải. Tải lại trang.', 'error'); return; }
    input.value = '';
    input.onchange = function (evt) {
      var file = evt.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = new Uint8Array(e.target.result);
          var wb = XLSX.read(data, { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          openImportPreview(clientId, rows);
        } catch (err) {
          API.toast('Không đọc được file: ' + (err.message || ''), 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  }

  function openImportPreview(clientId, rows) {
    var valid = [];
    var errorLines = [];
    rows.forEach(function (r, idx) {
      var group = String(r.equipment_group || '').trim().toLowerCase();
      if (!VALID_GROUPS.includes(group)) {
        errorLines.push('Dòng ' + (idx + 2) + ': equipment_group "' + group + '" không hợp lệ');
      } else {
        valid.push(r);
      }
    });

    if (!valid.length) {
      API.toast('Không có dòng hợp lệ. ' + (errorLines[0] || ''), 'error');
      return;
    }

    var errHtml = errorLines.length
      ? '<div style="background:var(--red-lt);border:1px solid #fca5a5;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px">'
        + '<strong>' + errorLines.length + ' dòng bỏ qua:</strong><br>'
        + errorLines.slice(0, 5).map(function (l) { return API.esc(l); }).join('<br>')
        + (errorLines.length > 5 ? '<br>...' : '')
        + '</div>'
      : '';

    var preview = valid.slice(0, 5);
    var bodyHtml = errHtml
      + '<p style="margin:0 0 8px;font-size:13px"><strong>' + valid.length + '</strong> thiết bị hợp lệ sẽ được nhập'
      + (valid.length > 5 ? ' (hiển thị 5 dòng đầu).' : '.') + '</p>'
      + '<div class="table-wrap"><table style="min-width:500px"><thead><tr>'
      + '<th>Nhóm</th><th>Tên thiết bị</th><th>OEM</th><th>Model gốc</th><th>Nhà máy</th>'
      + '</tr></thead><tbody>'
      + preview.map(function (r) {
          return '<tr>'
            + '<td>' + API.esc(String(r.equipment_group || '')) + '</td>'
            + '<td>' + API.esc(String(r.equipment_name || '')) + '</td>'
            + '<td>' + API.esc(String(r.oem_manufacturer || '')) + '</td>'
            + '<td>' + API.esc(String(r.oem_model || '')) + '</td>'
            + '<td>' + API.esc(String(r.plant_name || '')) + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>';

    Utils.openModal('Xác nhận nhập ' + valid.length + ' thiết bị', bodyHtml, async function () {
      try {
        var result = await API.call('importClientEquipment', { clientId: clientId, rows: valid });
        Utils.closeModal();
        var msg = 'Đã nhập ' + (result.created || 0) + ' thiết bị';
        if (result.errors && result.errors.length) msg += ', ' + result.errors.length + ' lỗi';
        API.toast(msg, 'success');
        await openEdit(clientId);
      } catch (err) { API.error(err); }
    });
  }

  // ─── public API ────────────────────────────────────────────────────────────

  window.ClientsModule = {
    load: load,
    openCreate: openCreate,
    openEdit: openEdit,
    openEquipmentForm: openEquipmentForm,
    archiveEquipment: archiveEquipment,
    downloadEquipmentTemplate: downloadEquipmentTemplate,
    importEquipmentCsv: importEquipmentCsv,
  };
})();
