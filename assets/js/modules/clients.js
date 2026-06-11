(function () {
  var state = AppState.list('clients');
  var sort = { by: '', dir: 'asc' };
  var _setupDone = false;

  // ─── lookup tables ─────────────────────────────────────────────────────────

  var EQUIPMENT_GROUPS = [
    ['turbine','Tuabin'],['generator','Máy phát điện'],['boiler','Lò hơi'],
    ['heater','Bộ sấy / gia nhiệt'],['primary_fan','Quạt gió sơ cấp (PA)'],
    ['secondary_fan','Quạt gió thứ cấp (SA/FD)'],['coal_mill','Máy nghiền than'],
    ['gearbox','Hộp số / giảm tốc'],['condenser','Bình ngưng'],
    ['feed_pump','Bơm nước cấp'],['transformer','Máy biến áp'],
    ['pump','Bơm'],['motor','Động cơ điện'],['valve','Van'],['other','Khác'],
  ];
  var VALID_GROUPS = EQUIPMENT_GROUPS.map(function (g) { return g[0]; });

  var CRITICAL_LEVELS = [
    ['critical','Thiết yếu (A)'],['normal','Bình thường (B)'],['low','Thấp (C)'],
  ];

  var ROLE_TYPES = [
    ['technical','Kỹ thuật'],['procurement','Mua sắm / QTKH'],
    ['commercial','Thương mại'],['finance','Tài chính'],
    ['safety','An toàn'],['production','Vận hành / Sản xuất'],
    ['management','Ban quản lý'],['other','Khác'],
  ];

  var CLIENT_TYPES = [
    ['company','Công ty / Tổ chức'],['individual','Cá nhân'],['other','Khác'],
  ];

  var CURRENCIES = ['VND', 'USD', 'EUR'];

  function groupLabel(key) { var g = EQUIPMENT_GROUPS.find(function(g){return g[0]===key;}); return g?g[1]:(key||''); }
  function critLabel(key)  { var c = CRITICAL_LEVELS.find(function(c){return c[0]===key;}); return c?c[1]:'Bình thường (B)'; }
  function roleLabel(key)  { var r = ROLE_TYPES.find(function(r){return r[0]===key;}); return r?r[1]:(key||''); }
  function clientTypeLabel(key) { var t = CLIENT_TYPES.find(function(t){return t[0]===key;}); return t?t[1]:(key||''); }

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

  function rfqStatCell(r) {
    var total = r.rfq_total || 0;
    if (!total) return '<span class="muted">—</span>';
    var parts = [];
    if (r.rfq_dang_khao_gia) parts.push('<span title="Đang khảo giá">ĐKG:' + r.rfq_dang_khao_gia + '</span>');
    if (r.rfq_da_bao)        parts.push('<span title="Đã báo">ĐB:' + r.rfq_da_bao + '</span>');
    if (r.rfq_trung)         parts.push('<span title="Trúng" style="color:var(--green)">T:' + r.rfq_trung + '</span>');
    if (r.rfq_khong_trung)   parts.push('<span title="Không trúng" style="color:var(--red)">KT:' + r.rfq_khong_trung + '</span>');
    if (r.rfq_treo)          parts.push('<span title="Treo" style="color:var(--orange)">Treo:' + r.rfq_treo + '</span>');
    if (r.rfq_tham_khao)     parts.push('<span title="Tham khảo">TK:' + r.rfq_tham_khao + '</span>');
    return '<span style="font-weight:600">' + total + '</span>'
      + (parts.length ? '<br><span style="font-size:11px;color:var(--text-muted)">' + parts.join(' ') + '</span>' : '');
  }

  function render() {
    syncSort();
    var canWrite = Utils.roleCanWrite();
    document.getElementById('clientRows').innerHTML = (state.rows || []).map(function (r) {
      var nameCell = canWrite
        ? '<span class="link-edit" onclick="ClientsModule.openEdit(\'' + API.esc(r.client_id) + '\')">' + API.esc(r.client_name) + '</span>'
        : API.esc(r.client_name);
      return '<tr>'
        + '<td>' + nameCell + '</td>'
        + '<td>' + API.esc(r.legal_name || '') + '</td>'
        + '<td>' + API.esc(r.plant_name || '') + '</td>'
        + '<td>' + API.esc(r.province || '') + '</td>'
        + '<td style="font-size:12px">' + API.esc(r.tax_code || '') + '</td>'
        + '<td style="font-size:12px">' + API.esc(r.email || '') + '</td>'
        + '<td style="font-size:12px;white-space:nowrap">' + API.esc(r.phone || '') + '</td>'
        + '<td style="font-size:12px">' + rfqStatCell(r) + '</td>'
        + '<td>' + API.esc(r.note || '') + '</td>'
        + '<td data-role-only="admin,manager" style="text-align:center;padding:0 4px">'
          + '<button type="button" class="btn-x-archive" title="Lưu trữ khách hàng" onclick="ClientsModule.archiveClient(\'' + API.esc(r.client_id) + '\')">✕</button>'
          + '</td>'
        + '</tr>';
    }).join('');
    document.getElementById('clientMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }

  // ─── client CRUD ───────────────────────────────────────────────────────────

  function openCreate() { openForm({}, [], [], [], []); }

  async function openEdit(id) {
    var row = (state.rows || []).find(function (r) { return r.client_id === id; }) || { client_id: id };
    try {
      var results = await Promise.all([
        API.get('getClientEquipment',    { clientId: id, limit: 200 }),
        API.get('getClientContacts',     { clientId: id }),
        API.get('getClientBankAccounts', { clientId: id }),
        API.get('getClientLegalHistory', { clientId: id }),
      ]);
      state.currentEquipment    = results[0].rows || [];
      state.currentContacts     = results[1].rows || [];
      state.currentBanks        = results[2].rows || [];
      state.currentLegalHistory = results[3].rows || [];
      openForm(row, state.currentEquipment, state.currentContacts, state.currentBanks, state.currentLegalHistory);
    } catch (err) { API.error(err); }
  }

  function openForm(row, equipment, contacts, banks, legalHistory) {
    var title = row.client_id ? 'CĐT: ' + (row.client_name || row.client_id) : 'Thêm khách hàng / CĐT';
    Utils.openModal(title, clientFields(row, equipment, contacts, banks, legalHistory), async function (data) {
      try {
        if (row.client_id) data.clientId = row.client_id;
        var result = await API.call(row.client_id ? 'updateClient' : 'createClient', data);
        Utils.closeModal();
        API.toast('Đã lưu khách hàng', 'success');
        await load(true);
        if (!row.client_id && result.client) await openEdit(result.client.client_id);
      } catch (err) { API.error(err); }
    });
    Auth.applyRoleUI();
  }

  // ─── client profile form ───────────────────────────────────────────────────

  function clientFields(r, equipment, contacts, banks, legalHistory) {
    r = r || {};
    var cid = r.client_id || '';

    var typeSel = '<select name="clientType">'
      + CLIENT_TYPES.map(function (t) {
          return '<option value="' + t[0] + '"' + ((r.client_type || 'company') === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
        }).join('')
      + '</select>';

    // Row 1: tên CĐT(4) + tên pháp nhân(4) + MST(2) + loại hình(2) = 12
    // Row 2: nhà máy(3) + tỉnh(1) + địa chỉ(6) = 10 → email/phone wrap
    // Row 3: email(3) + SĐT(2) + website(3) = 8
    // Row 4: ghi chú(12)
    var profileHtml = '<label class="span-4">Tên CĐT / khách hàng<input name="clientName" required value="' + API.esc(r.client_name || '') + '"></label>'
      + '<label class="span-4">Tên pháp nhân<input name="legalName" value="' + API.esc(r.legal_name || '') + '"></label>'
      + '<label class="span-2">MST (Mã số thuế)<input name="taxCode" value="' + API.esc(r.tax_code || '') + '"></label>'
      + '<label class="span-2">Loại hình' + typeSel + '</label>'
      + '<label class="span-3">Nhà máy<input name="plantName" value="' + API.esc(r.plant_name || '') + '"></label>'
      + '<label class="span-1">Tỉnh<input name="province" value="' + API.esc(r.province || '') + '"></label>'
      + '<label class="span-6">Địa chỉ<input name="address" value="' + API.esc(r.address || '') + '"></label>'
      + '<label class="span-3">Email<input name="email" type="email" value="' + API.esc(r.email || '') + '"></label>'
      + '<label class="span-2">SĐT<input name="phone" value="' + API.esc(r.phone || '') + '"></label>'
      + '<label class="span-3">Website<input name="website" value="' + API.esc(r.website || '') + '"></label>'
      + '<label class="span-12 compact-ta">Ghi chú<textarea name="note">' + API.esc(r.note || '') + '</textarea></label>';

    if (!cid) return profileHtml;

    return profileHtml
      + contactsSection(cid, contacts || [])
      + bankSection(cid, banks || [])
      + legalHistorySection(cid, legalHistory || [])
      + equipmentSection(cid, (equipment || []).filter(function (e) { return e.status !== 'archived'; }));
  }

  // ─── contacts section ──────────────────────────────────────────────────────

  function contactsSection(clientId, contacts) {
    var active = contacts.filter(function (c) { return c.status !== 'archived'; });
    var rows = active.length
      ? active.map(function (c) {
          var cid = API.esc(clientId); var coid = API.esc(c.contact_id);
          var primary = c.is_primary ? '<span class="badge" style="font-size:10px;background:var(--primary);color:#fff;border-color:var(--primary)">Chính</span> ' : '';
          return '<tr>'
            + '<td>' + primary + API.esc(c.contact_name || '') + '</td>'
            + '<td>' + API.esc(c.position || '') + '</td>'
            + '<td>' + API.esc(c.department || '') + '</td>'
            + '<td><span class="badge" style="font-size:10px">' + API.esc(roleLabel(c.role_type)) + '</span></td>'
            + '<td style="color:var(--text-muted);font-size:12px">' + API.esc(c.specialty_tags || '') + '</td>'
            + '<td>' + API.esc(c.phone || '') + '</td>'
            + '<td>' + API.esc(c.email || '') + '</td>'
            + '<td>' + API.esc(c.zalo || '') + '</td>'
            + '<td style="white-space:nowrap">'
            + '<button type="button" data-write onclick="ClientsModule.openContactForm(\'' + cid + '\',\'' + coid + '\')">Sửa</button> '
            + '<button type="button" data-write onclick="ClientsModule.archiveContact(\'' + coid + '\',\'' + cid + '\')">Lưu trữ</button>'
            + '</td>'
            + '</tr>';
        }).join('')
      : '<tr><td colspan="9" class="empty-state" style="border:0;min-height:40px">Chưa có liên hệ nào.</td></tr>';

    return '<div class="modal-section">'
      + '<div class="section-head"><h4>Liên hệ (' + active.length + ')</h4>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
      + '<button type="button" onclick="ClientsModule.downloadContactsTemplate()">Tải template</button>'
      + '<button type="button" data-write onclick="ClientsModule.importContactsCsv(\'' + API.esc(clientId) + '\')">Import CSV/XLSX</button>'
      + '<button type="button" class="primary" data-write onclick="ClientsModule.openContactForm(\'' + API.esc(clientId) + '\',\'\')">+ Thêm liên hệ</button>'
      + '</div></div>'
      + '<div class="table-wrap" style="margin-top:8px"><table style="min-width:700px"><thead><tr>'
      + '<th>Tên</th><th>Chức vụ</th><th>Phòng ban</th><th>Vai trò</th><th>Chuyên môn</th><th>SĐT</th><th>Email</th><th>Zalo</th><th style="width:110px"></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<input type="file" id="contactImportFile" accept=".csv,.xlsx,.xls" style="display:none">'
      + '</div>';
  }

  function openContactForm(clientId, contactId) {
    var c = contactId
      ? (state.currentContacts || []).find(function (x) { return x.contact_id === contactId; }) || {}
      : {};
    var roleSel = '<select name="roleType">'
      + ROLE_TYPES.map(function (r) {
          return '<option value="' + r[0] + '"' + ((c.role_type || 'other') === r[0] ? ' selected' : '') + '>' + r[1] + '</option>';
        }).join('')
      + '</select>';
    var html = '<label>Tên liên hệ<input name="contactName" required value="' + API.esc(c.contact_name || '') + '"></label>'
      + '<label>Chức vụ<input name="position" value="' + API.esc(c.position || '') + '"></label>'
      + '<label>Phòng ban<input name="department" value="' + API.esc(c.department || '') + '"></label>'
      + '<label>Vai trò' + roleSel + '</label>'
      + '<label>Chuyên môn (tags, phẩy cách)<input name="specialtyTags" value="' + API.esc(c.specialty_tags || '') + '"></label>'
      + '<label>SĐT<input name="phone" value="' + API.esc(c.phone || '') + '"></label>'
      + '<label>Email<input name="email" value="' + API.esc(c.email || '') + '"></label>'
      + '<label>Zalo<input name="zalo" value="' + API.esc(c.zalo || '') + '"></label>'
      + '<label class="check"><input type="checkbox" name="isPrimary" value="1"' + (c.is_primary ? ' checked' : '') + '> Đặt làm liên hệ chính</label>'
      + '<label>Ghi chú<textarea name="note">' + API.esc(c.note || '') + '</textarea></label>';

    Utils.openModal(contactId ? 'Sửa liên hệ' : 'Thêm liên hệ', html, async function (data) {
      try {
        data.clientId = clientId;
        if (contactId) data.contactId = contactId;
        await API.call(contactId ? 'updateClientContact' : 'createClientContact', data);
        Utils.closeModal();
        API.toast('Đã lưu liên hệ', 'success');
        await openEdit(clientId);
      } catch (err) { API.error(err); }
    });
    Auth.applyRoleUI();
  }

  async function archiveContact(contactId, clientId) {
    try {
      await API.call('archiveClientContact', { contactId: contactId });
      API.toast('Đã lưu trữ liên hệ', 'success');
      await openEdit(clientId);
    } catch (err) { API.error(err); }
  }

  function downloadContactsTemplate() {
    var headers = ['contact_name','department','position','role_type','specialty_tags','phone','email','zalo','note'];
    var example = ['Nguyễn Văn A','Kỹ thuật','Trưởng phòng','technical','tuabin, lò hơi','0901234567','a@example.com','0901234567',''];
    var csv = headers.join(',') + '\n' + example.map(function(v){ return '"'+String(v||'').replace(/"/g,'""')+'"'; }).join(',') + '\n';
    downloadBlob(csv, 'template_contacts.csv');
  }

  function importContactsCsv(clientId) {
    var input = getFileInput('contactImportFile', '.csv,.xlsx,.xls');
    input.value = '';
    input.onchange = function (evt) {
      var file = evt.target.files[0]; if (!file) return;
      parseXlsx(file, function (rows) {
        var valid = [], errors = [];
        var validRoles = ['technical','procurement','commercial','finance','safety','production','management','other'];
        rows.forEach(function (r, idx) {
          if (!String(r.contact_name || '').trim()) { errors.push('Dòng ' + (idx+2) + ': contact_name trống'); return; }
          var role = String(r.role_type || 'other').trim().toLowerCase();
          if (!validRoles.includes(role)) { errors.push('Dòng ' + (idx+2) + ': role_type "' + role + '" không hợp lệ'); return; }
          valid.push(r);
        });
        showImportPreview('Xác nhận nhập ' + valid.length + ' liên hệ', valid, errors,
          ['Tên','Vai trò','SĐT','Email'],
          function (r) { return [r.contact_name, r.role_type, r.phone||'', r.email||'']; },
          async function () {
            var result = await API.call('importClientContacts', { clientId: clientId, rows: valid });
            API.toast('Đã nhập ' + (result.created||0) + ' liên hệ' + (result.errors&&result.errors.length?', '+result.errors.length+' lỗi':''), 'success');
            await openEdit(clientId);
          }
        );
      });
    };
    input.click();
  }

  // ─── bank accounts section ─────────────────────────────────────────────────

  function bankSection(clientId, banks) {
    var active = banks.filter(function (b) { return b.status !== 'archived'; });
    var rows = active.length
      ? active.map(function (b) {
          var cid = API.esc(clientId); var bid = API.esc(b.bank_account_id);
          var primary = b.is_primary ? '<span class="badge" style="font-size:10px;background:var(--primary);color:#fff;border-color:var(--primary)">Chính</span> ' : '';
          return '<tr>'
            + '<td>' + primary + API.esc(b.account_name || '') + '</td>'
            + '<td>' + API.esc(b.bank_account || '') + '</td>'
            + '<td>' + API.esc(b.bank_name || '') + '</td>'
            + '<td>' + API.esc(b.branch_name || '') + '</td>'
            + '<td><span class="badge" style="font-size:10px">' + API.esc(b.currency || 'VND') + '</span></td>'
            + '<td style="white-space:nowrap">'
            + '<button type="button" data-write onclick="ClientsModule.openBankForm(\'' + cid + '\',\'' + bid + '\')">Sửa</button> '
            + '<button type="button" data-write onclick="ClientsModule.archiveBank(\'' + bid + '\',\'' + cid + '\')">Lưu trữ</button>'
            + '</td>'
            + '</tr>';
        }).join('')
      : '<tr><td colspan="6" class="empty-state" style="border:0;min-height:40px">Chưa có tài khoản ngân hàng.</td></tr>';

    return '<div class="modal-section">'
      + '<div class="section-head"><h4>Tài khoản ngân hàng (' + active.length + ')</h4>'
      + '<button type="button" class="primary" data-write onclick="ClientsModule.openBankForm(\'' + API.esc(clientId) + '\',\'\')">+ Thêm tài khoản</button>'
      + '</div>'
      + '<div class="table-wrap" style="margin-top:8px"><table><thead><tr>'
      + '<th>Tên tài khoản</th><th>Số tài khoản</th><th>Ngân hàng</th><th>Chi nhánh</th><th>Tiền tệ</th><th style="width:110px"></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function openBankForm(clientId, bankId) {
    var b = bankId
      ? (state.currentBanks || []).find(function (x) { return x.bank_account_id === bankId; }) || {}
      : {};
    var currSel = '<select name="currency">'
      + CURRENCIES.map(function (c) {
          return '<option value="' + c + '"' + ((b.currency || 'VND') === c ? ' selected' : '') + '>' + c + '</option>';
        }).join('')
      + '</select>';
    var html = '<label>Tên tài khoản<input name="accountName" value="' + API.esc(b.account_name || '') + '"></label>'
      + '<label>Số tài khoản<input name="bankAccount" required value="' + API.esc(b.bank_account || '') + '"></label>'
      + '<label>Ngân hàng<input name="bankName" required value="' + API.esc(b.bank_name || '') + '"></label>'
      + '<label>Chi nhánh<input name="branchName" value="' + API.esc(b.branch_name || '') + '"></label>'
      + '<label>Tiền tệ' + currSel + '</label>'
      + '<label class="check"><input type="checkbox" name="isPrimary" value="1"' + (b.is_primary ? ' checked' : '') + '> Đặt làm tài khoản chính</label>'
      + '<label>Ghi chú<textarea name="note">' + API.esc(b.note || '') + '</textarea></label>';

    Utils.openModal(bankId ? 'Sửa tài khoản ngân hàng' : 'Thêm tài khoản ngân hàng', html, async function (data) {
      try {
        data.clientId = clientId;
        if (bankId) data.bankAccountId = bankId;
        await API.call(bankId ? 'updateClientBankAccount' : 'createClientBankAccount', data);
        Utils.closeModal();
        API.toast('Đã lưu tài khoản ngân hàng', 'success');
        await openEdit(clientId);
      } catch (err) { API.error(err); }
    });
    Auth.applyRoleUI();
  }

  async function archiveBank(bankId, clientId) {
    try {
      await API.call('archiveClientBankAccount', { bankAccountId: bankId });
      API.toast('Đã lưu trữ tài khoản', 'success');
      await openEdit(clientId);
    } catch (err) { API.error(err); }
  }

  // ─── legal history section ─────────────────────────────────────────────────

  function legalHistorySection(clientId, records) {
    var rows = records.length
      ? records.map(function (h) {
          return '<tr>'
            + '<td>' + API.esc(h.effective_date || '') + '</td>'
            + '<td>' + API.esc(h.legal_name || '') + '</td>'
            + '<td>' + API.esc(h.tax_code || '') + '</td>'
            + '<td>' + API.esc(h.address || '') + '</td>'
            + '<td style="color:var(--text-muted)">' + API.esc(h.note || '') + '</td>'
            + '</tr>';
        }).join('')
      : '<tr><td colspan="5" class="empty-state" style="border:0;min-height:40px">Chưa có lịch sử pháp nhân.</td></tr>';

    return '<div class="modal-section">'
      + '<div class="section-head"><h4>Lịch sử pháp nhân (' + records.length + ')</h4>'
      + '<button type="button" data-write onclick="ClientsModule.openLegalHistoryForm(\'' + API.esc(clientId) + '\')">+ Ghi lịch sử mới</button>'
      + '</div>'
      + '<div class="table-wrap" style="margin-top:8px"><table><thead><tr>'
      + '<th>Ngày hiệu lực</th><th>Tên pháp nhân</th><th>MST</th><th>Địa chỉ</th><th>Ghi chú</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function openLegalHistoryForm(clientId) {
    var today = new Date().toISOString().slice(0, 10);
    var html = '<label>Ngày hiệu lực<input name="effectiveDate" type="date" required value="' + today + '"></label>'
      + '<label>Tên pháp nhân<input name="legalName" value=""></label>'
      + '<label>MST<input name="taxCode" value=""></label>'
      + '<label>Địa chỉ<input name="address" value=""></label>'
      + '<label>Ghi chú<textarea name="note"></textarea></label>';

    Utils.openModal('Ghi lịch sử pháp nhân', html, async function (data) {
      try {
        data.clientId = clientId;
        await API.call('addClientLegalHistory', data);
        Utils.closeModal();
        API.toast('Đã lưu lịch sử pháp nhân', 'success');
        await openEdit(clientId);
      } catch (err) { API.error(err); }
    });
  }

  // ─── equipment section ─────────────────────────────────────────────────────

  function equipmentSection(clientId, activeEq) {
    var eqRows = activeEq.length
      ? activeEq.map(function (e) {
          var cid = API.esc(clientId); var eid = API.esc(e.equipment_id);
          var critStyle = e.critical_level === 'critical' ? 'background:var(--red);color:#fff;border-color:var(--red)' : '';
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
      + '<div class="section-head"><h4>Thiết bị đang dùng (' + activeEq.length + ')</h4>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
      + '<button type="button" onclick="ClientsModule.downloadEquipmentTemplate()">Tải template CSV</button>'
      + '<button type="button" data-write onclick="ClientsModule.importEquipmentCsv(\'' + API.esc(clientId) + '\')">Import CSV/XLSX</button>'
      + '<button type="button" class="primary" data-write onclick="ClientsModule.openEquipmentForm(\'' + API.esc(clientId) + '\',\'\')">+ Thêm thiết bị</button>'
      + '</div></div>'
      + '<div class="table-wrap" style="margin-top:8px"><table style="min-width:920px"><thead><tr>'
      + '<th>Tổ máy</th><th>Nhóm</th><th>Tên thiết bị</th><th>Tag</th>'
      + '<th>OEM</th><th>Model gốc</th><th>Mã OEM</th>'
      + '<th>NSX thay thế</th><th>Model thay thế</th>'
      + '<th>Mức QT</th><th style="width:110px"></th>'
      + '</tr></thead><tbody>' + eqRows + '</tbody></table></div>'
      + '<input type="file" id="eqImportFile" accept=".csv,.xlsx,.xls" style="display:none">'
      + '</div>';
  }

  function openEquipmentForm(clientId, equipmentId) {
    var eq = equipmentId
      ? (state.currentEquipment || []).find(function (e) { return e.equipment_id === equipmentId; }) || {}
      : {};
    var groupSel = '<select name="equipmentGroup">'
      + EQUIPMENT_GROUPS.map(function (g) {
          return '<option value="' + g[0] + '"' + (eq.equipment_group === g[0] ? ' selected' : '') + '>' + API.esc(g[1]) + '</option>';
        }).join('') + '</select>';
    var critSel = '<select name="criticalLevel">'
      + CRITICAL_LEVELS.map(function (c) {
          return '<option value="' + c[0] + '"' + ((eq.critical_level || 'normal') === c[0] ? ' selected' : '') + '>' + API.esc(c[1]) + '</option>';
        }).join('') + '</select>';

    var html = '<label>Nhà máy / Tổ máy<input name="plantName" value="' + API.esc(eq.plant_name||'') + '"></label>'
      + '<label>Tổ số / Unit No<input name="unitNo" value="' + API.esc(eq.unit_no||'') + '"></label>'
      + '<label>Khu vực hệ thống<input name="systemArea" value="' + API.esc(eq.system_area||'') + '"></label>'
      + '<label>Nhóm thiết bị *' + groupSel + '</label>'
      + '<label>Tên thiết bị<input name="equipmentName" value="' + API.esc(eq.equipment_name||'') + '"></label>'
      + '<label>Tag thiết bị<input name="equipmentTag" value="' + API.esc(eq.equipment_tag||'') + '"></label>'
      + '<label>OEM (Nhà sản xuất gốc)<input name="oemManufacturer" value="' + API.esc(eq.oem_manufacturer||'') + '"></label>'
      + '<label>Model OEM<input name="oemModel" value="' + API.esc(eq.oem_model||'') + '"></label>'
      + '<label>Thông số kỹ thuật OEM<input name="oemSpec" value="' + API.esc(eq.oem_spec||'') + '"></label>'
      + '<label>Mã phụ tùng OEM<input name="oemPartNo" value="' + API.esc(eq.oem_part_no||'') + '"></label>'
      + '<label>NSX thay thế<input name="replacementManufacturer" value="' + API.esc(eq.replacement_manufacturer||'') + '"></label>'
      + '<label>Model thay thế<input name="replacementModel" value="' + API.esc(eq.replacement_model||'') + '"></label>'
      + '<label>Thông số thay thế<input name="replacementSpec" value="' + API.esc(eq.replacement_spec||'') + '"></label>'
      + '<label>Mã phụ tùng thay thế<input name="replacementPartNo" value="' + API.esc(eq.replacement_part_no||'') + '"></label>'
      + '<label>Mức quan trọng' + critSel + '</label>'
      + '<label>Ghi chú<textarea name="note">' + API.esc(eq.note||'') + '</textarea></label>';

    Utils.openModal(equipmentId ? 'Sửa thiết bị' : 'Thêm thiết bị', html, async function (data) {
      try {
        data.clientId = clientId;
        if (equipmentId) data.equipmentId = equipmentId;
        await API.call(equipmentId ? 'updateClientEquipment' : 'createClientEquipment', data);
        Utils.closeModal();
        API.toast('Đã lưu thiết bị', 'success');
        await openEdit(clientId);
      } catch (err) { API.error(err); }
    });
    Auth.applyRoleUI();
  }

  async function archiveEquipment(equipmentId, clientId) {
    try {
      await API.call('archiveClientEquipment', { equipmentId: equipmentId });
      API.toast('Đã lưu trữ thiết bị', 'success');
      await openEdit(clientId);
    } catch (err) { API.error(err); }
  }

  // ─── client list import / export ───────────────────────────────────────────

  function downloadClientTemplate() {
    var headers = ['client_name','legal_name','tax_code','client_type','plant_name','province','address','email','phone','website','note'];
    var example = ['Công ty CP Nhiệt điện A','Công ty Cổ phần Nhiệt điện A','0100000001','company','Nhà máy Nhiệt điện A','Hà Tĩnh','123 Đường B, Hà Tĩnh','contact@example.com','024 1234 5678','https://example.com',''];
    var csv = headers.join(',') + '\n' + example.map(function(v){return '"'+String(v||'').replace(/"/g,'""')+'"';}).join(',') + '\n';
    downloadBlob(csv, 'template_clients.csv');
  }

  function importClientsCsv() {
    var input = getFileInput('clientListImportFile', '.csv,.xlsx,.xls');
    input.value = '';
    input.onchange = function (evt) {
      var file = evt.target.files[0]; if (!file) return;
      parseXlsx(file, function (rows) {
        var valid = [], errors = [];
        rows.forEach(function (r, idx) {
          if (!String(r.client_name || '').trim()) { errors.push('Dòng ' + (idx+2) + ': client_name trống'); return; }
          valid.push(r);
        });
        showImportPreview('Xác nhận nhập ' + valid.length + ' khách hàng', valid, errors,
          ['Tên','Pháp nhân','MST','Nhà máy'],
          function (r) { return [r.client_name, r.legal_name||'', r.tax_code||'', r.plant_name||'']; },
          async function () {
            var created = 0, errs = [];
            for (var i = 0; i < valid.length; i++) {
              var r = valid[i];
              try {
                await API.call('createClient', {
                  clientName: String(r.client_name||'').trim(),
                  legalName: String(r.legal_name||'').trim(),
                  taxCode: String(r.tax_code||'').trim(),
                  clientType: String(r.client_type||'company').trim(),
                  plantName: String(r.plant_name||'').trim(),
                  province: String(r.province||'').trim(),
                  address: String(r.address||'').trim(),
                  email: String(r.email||'').trim(),
                  phone: String(r.phone||'').trim(),
                  website: String(r.website||'').trim(),
                  note: String(r.note||'').trim(),
                });
                created++;
              } catch(e) { errs.push('Dòng ' + (i+2) + ': ' + (e.message||'lỗi')); }
            }
            API.toast('Đã nhập ' + created + ' khách hàng' + (errs.length ? ', ' + errs.length + ' lỗi' : ''), 'success');
            await load(true);
          }
        );
      });
    };
    input.click();
  }

  function exportClientsCsv() {
    if (!state.rows || !state.rows.length) { API.toast('Không có dữ liệu để xuất', 'error'); return; }
    var headers = ['client_id','client_name','legal_name','tax_code','client_type','plant_name','province','address','email','phone','website','note'];
    var csv = headers.join(',') + '\n'
      + state.rows.map(function (r) {
          return headers.map(function (h) { return '"' + String(r[h] || '').replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n') + '\n';
    downloadBlob(csv, 'clients_export.csv');
  }

  // ─── equipment import (unchanged flow) ────────────────────────────────────

  function downloadEquipmentTemplate() {
    var headers = ['plant_name','unit_no','system_area','equipment_group','equipment_name','equipment_tag','oem_manufacturer','oem_model','oem_spec','oem_part_no','replacement_manufacturer','replacement_model','replacement_spec','replacement_part_no','critical_level','note'];
    var example = ['Nhà máy A','Tổ 1','Hệ thống hơi','turbine','Tuabin hơi 150MW','T1-TURB-001','Siemens','SST-400','50Hz 150MW','ABC12345','Doosan','DT300','','DEF67890','critical',''];
    var csv = headers.join(',') + '\n' + example.map(function(v){return '"'+String(v||'').replace(/"/g,'""')+'"';}).join(',') + '\n';
    downloadBlob(csv, 'template_equipment.csv');
  }

  function importEquipmentCsv(clientId) {
    var input = document.getElementById('eqImportFile');
    if (!input) return;
    if (typeof XLSX === 'undefined') { API.toast('Thư viện XLSX chưa tải. Tải lại trang.', 'error'); return; }
    input.value = '';
    input.onchange = function (evt) {
      var file = evt.target.files[0]; if (!file) return;
      parseXlsx(file, function (rows) {
        var valid = [], errors = [];
        rows.forEach(function (r, idx) {
          var group = String(r.equipment_group || '').trim().toLowerCase();
          if (!VALID_GROUPS.includes(group)) { errors.push('Dòng ' + (idx+2) + ': equipment_group "' + group + '" không hợp lệ'); return; }
          valid.push(r);
        });
        if (!valid.length) { API.toast('Không có dòng hợp lệ. ' + (errors[0]||''), 'error'); return; }
        showImportPreview('Xác nhận nhập ' + valid.length + ' thiết bị', valid, errors,
          ['Nhóm','Tên thiết bị','OEM','Model gốc'],
          function (r) { return [r.equipment_group, r.equipment_name||'', r.oem_manufacturer||'', r.oem_model||'']; },
          async function () {
            var result = await API.call('importClientEquipment', { clientId: clientId, rows: valid });
            var msg = 'Đã nhập ' + (result.created||0) + ' thiết bị';
            if (result.errors && result.errors.length) msg += ', ' + result.errors.length + ' lỗi';
            API.toast(msg, 'success');
            await openEdit(clientId);
          }
        );
      });
    };
    input.click();
  }

  // ─── shared helpers ────────────────────────────────────────────────────────

  function getFileInput(id, accept) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('input');
      el.type = 'file'; el.id = id; el.accept = accept; el.style.display = 'none';
      document.body.appendChild(el);
    }
    return el;
  }

  function parseXlsx(file, callback) {
    if (typeof XLSX === 'undefined') { API.toast('Thư viện XLSX chưa tải. Tải lại trang.', 'error'); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        callback(XLSX.utils.sheet_to_json(ws, { defval: '' }));
      } catch (err) { API.toast('Không đọc được file: ' + (err.message || ''), 'error'); }
    };
    reader.readAsArrayBuffer(file);
  }

  function showImportPreview(title, valid, errors, previewCols, rowMapper, onConfirm) {
    var errHtml = errors.length
      ? '<div style="background:var(--red-lt);border:1px solid #fca5a5;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px">'
        + '<strong>' + errors.length + ' dòng bỏ qua:</strong><br>'
        + errors.slice(0,5).map(function(l){return API.esc(l);}).join('<br>')
        + (errors.length>5?'<br>...':'') + '</div>'
      : '';
    var preview = valid.slice(0,5);
    var bodyHtml = errHtml
      + '<p style="margin:0 0 8px;font-size:13px"><strong>' + valid.length + '</strong> dòng hợp lệ sẽ được nhập'
      + (valid.length>5?' (hiển thị 5 dòng đầu).':'.') + '</p>'
      + '<div class="table-wrap"><table style="min-width:400px"><thead><tr>'
      + previewCols.map(function(h){return '<th>'+API.esc(h)+'</th>';}).join('')
      + '</tr></thead><tbody>'
      + preview.map(function(r){
          return '<tr>'+rowMapper(r).map(function(v){return '<td>'+API.esc(String(v||''))+'</td>';}).join('')+'</tr>';
        }).join('')
      + '</tbody></table></div>';
    Utils.openModal(title, bodyHtml, async function () {
      try { Utils.closeModal(); await onConfirm(); } catch (err) { API.error(err); }
    });
  }

  function downloadBlob(csv, filename) {
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  async function archiveClient(clientId) {
    var ok = await Utils.confirmDanger(
      'Lưu trữ khách hàng',
      'Lưu trữ "' + clientId + '"? Khách hàng sẽ bị ẩn khỏi danh sách. Gói thầu và thiết bị liên quan vẫn được giữ.',
      'Lưu trữ'
    );
    if (!ok) return;
    try {
      await API.call('archiveClient', { clientId: clientId });
      API.toast('Đã lưu trữ khách hàng', 'success');
      await load(true);
    } catch (err) { API.error(err); }
  }

  // ─── public API ────────────────────────────────────────────────────────────

  window.ClientsModule = {
    load: load,
    openCreate: openCreate,
    openEdit: openEdit,
    openContactForm: openContactForm,
    archiveContact: archiveContact,
    downloadContactsTemplate: downloadContactsTemplate,
    importContactsCsv: importContactsCsv,
    openBankForm: openBankForm,
    archiveBank: archiveBank,
    openLegalHistoryForm: openLegalHistoryForm,
    openEquipmentForm: openEquipmentForm,
    archiveEquipment: archiveEquipment,
    downloadEquipmentTemplate: downloadEquipmentTemplate,
    importEquipmentCsv: importEquipmentCsv,
    downloadClientTemplate: downloadClientTemplate,
    importClientsCsv: importClientsCsv,
    exportClientsCsv: exportClientsCsv,
    archiveClient: archiveClient,
  };
})();
