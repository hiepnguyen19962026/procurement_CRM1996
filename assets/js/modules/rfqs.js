(function () {
  var state = AppState.list('rfqs');
  var sort = { by: '', dir: 'desc' };
  var _setupDone = false;

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    var el = document.getElementById('rfqSearch');
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') load(true); });
  }

  function syncSort() {
    var def = 'rfq_id';
    document.querySelectorAll('#screen-rfqs th[data-sort-key]').forEach(function (th) {
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
    state.q = document.getElementById('rfqSearch').value || '';
    try {
      var params = { q: state.q, status: document.getElementById('rfqStatus').value, cursor: state.cursor, limit: 50 };
      if (sort.by) { params.sortBy = sort.by; params.sortDir = sort.dir; }
      var data = await API.get('getRfqs', params);
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  function render() {
    syncSort();
    var canWrite = Utils.roleCanWrite();
    document.getElementById('rfqRows').innerHTML = (state.rows || []).map(function (r) {
      var maGoi = r.ma_goi_tbmt ? API.esc(r.ma_goi_tbmt) : '<span class="muted">—</span>';
      var maGoiCell = canWrite
        ? '<span class="link-edit" onclick="RfqsModule.openEdit(\'' + API.esc(r.rfq_id) + '\')">' + maGoi + '</span>'
        : maGoi;
      var tenGoiCell = canWrite
        ? '<span class="link-edit" onclick="RfqsModule.openEdit(\'' + API.esc(r.rfq_id) + '\')">' + API.esc(r.ten_goi) + '</span>'
        : API.esc(r.ten_goi);
      var cdtText = r.client_name || r.nha_may_cdt || '';
      var cdtCell = cdtText
        ? '<span class="link-edit" onclick="RfqsModule.drillDownClient(\'' + API.esc(r.client_id || '') + '\',\'' + API.esc(cdtText) + '\')">' + API.esc(cdtText) + '</span>'
        : '<span class="muted">—</span>';
      return '<tr>'
        + '<td>' + API.esc(r.rfq_id) + '</td>'
        + '<td>' + maGoiCell + '</td>'
        + '<td>' + tenGoiCell + '</td>'
        + '<td>' + cdtCell + '</td>'
        + '<td>' + valueOrDash(r.ngay_nhan_hoac_dang_tai) + '</td>'
        + '<td>' + valueOrDash(r.ngay_het_han) + '</td>'
        + '<td><button class="badge badge-items" onclick="RfqsModule.drillDown(\'' + API.esc(r.rfq_id) + '\')">' + API.esc(itemCountLabel(r.item_count)) + '</button></td>'
        + '<td>' + API.money(r.du_toan) + '</td>'
        + '<td><span class="badge">' + API.esc(statusLabel(r.trang_thai_goi)) + '</span></td>'
        + '<td>' + noteCell(r.note) + '</td>'
        + '</tr>';
    }).join('');
    document.getElementById('rfqMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }
  function openCreate() { openForm({}, [], []); }
  async function openEdit(id) {
    var r = (state.rows || []).find(function (r) { return r.rfq_id === id; }) || { rfq_id: id };
    try {
      var fetches = [API.get('getRfqContacts', { rfqId: id })];
      if (r.client_id) fetches.push(API.get('getClientContacts', { clientId: r.client_id }));
      var results = await Promise.all(fetches);
      state.currentRfqContacts  = results[0].rows || [];
      state.allClientContacts   = r.client_id ? ((results[1] || {}).rows || []) : [];
      openForm(r, state.currentRfqContacts, state.allClientContacts);
    } catch (err) { API.error(err); }
  }
  function openForm(r, rfqContacts, clientContacts) {
    rfqContacts    = rfqContacts    || [];
    clientContacts = clientContacts || [];
    Utils.openModal(r.rfq_id ? 'Sửa RFQ' : 'Thêm RFQ', fields(r, rfqContacts, clientContacts), async function (data) {
      try {
        if (r.rfq_id) data.rfqId = r.rfq_id;
        await API.call(r.rfq_id ? 'updateRfq' : 'createRfq', data);
        Utils.closeModal();
        API.toast('Đã lưu RFQ', 'success');
        await load(true);
        DashboardModule.load();
      } catch (err) { API.error(err); }
    });
    Auth.applyRoleUI();
  }
  function fields(r, rfqContacts, clientContacts) {
    var statuses = ['dang_khao_gia','da_bao','trung','khong_trung','treo','tham_khao'];
    var statusLabels = { dang_khao_gia:'Đang khảo giá', da_bao:'Đã báo', trung:'Trúng', khong_trung:'Không trúng', treo:'Treo', tham_khao:'Tham khảo' };
    var statSel = '<select name="trangThaiGoi">' + statuses.map(function(s){
      return '<option value="' + s + '"' + ((r.trang_thai_goi||'dang_khao_gia')===s?' selected':'') + '>' + statusLabels[s] + '</option>';
    }).join('') + '</select>';
    var base = '<label>Tên gói<input name="tenGoi" required value="' + API.esc(r.ten_goi||'') + '"></label>'
      + '<label>Client ID<input name="clientId" value="' + API.esc(r.client_id||'') + '"></label>'
      + '<label>Mã gói / TBMT<input name="maGoiTbmt" value="' + API.esc(r.ma_goi_tbmt||'') + '"></label>'
      + '<label>Nhà máy / CĐT<input name="nhaMayCdt" value="' + API.esc(r.nha_may_cdt||'') + '"></label>'
      + '<label>Ngày nhận / đăng tải<input name="ngayNhanHoacDangTai" type="date" value="' + API.esc(r.ngay_nhan_hoac_dang_tai||'') + '"></label>'
      + '<label>Ngày hết hạn<input name="ngayHetHan" type="date" value="' + API.esc(r.ngay_het_han||'') + '"></label>'
      + '<label>Dự toán<input name="duToan" inputmode="numeric" value="' + API.esc(r.du_toan||'') + '"></label>'
      + '<label>Trạng thái' + statSel + '</label>'
      + '<label>Ghi chú<textarea name="note">' + API.esc(r.note||'') + '</textarea></label>';
    if (r.rfq_id && r.client_id) base += rfqContactsSection(r.rfq_id, rfqContacts, clientContacts);
    return base;
  }
  function rfqContactsSection(rfqId, rfqContacts, clientContacts) {
    var rfqContactIds = rfqContacts.map(function (rc) { return rc.contact_id; });
    var active = clientContacts.filter(function (cc) { return cc.status !== 'archived'; });
    var rows = rfqContacts.length
      ? rfqContacts.map(function (rc) {
          var rcid = API.esc(rc.rfq_contact_id); var rid = API.esc(rfqId);
          return '<tr>'
            + '<td>' + API.esc(rc.contact_name || '') + '</td>'
            + '<td>' + API.esc(rc.position || '') + '</td>'
            + '<td>' + API.esc(rc.department || '') + '</td>'
            + '<td>' + API.esc(rc.support_role || '') + '</td>'
            + '<td>' + API.esc(rc.phone || '') + '</td>'
            + '<td>' + API.esc(rc.email || '') + '</td>'
            + '<td><button type="button" data-write onclick="RfqsModule.archiveRfqContact(\'' + rcid + '\',\'' + rid + '\')">Xóa khỏi gói</button></td>'
            + '</tr>';
        }).join('')
      : '<tr><td colspan="7" class="empty-state" style="border:0;min-height:40px">Chưa có liên hệ nào trong gói này.</td></tr>';
    var hasAvail = active.filter(function(cc){ return !rfqContactIds.includes(cc.contact_id); }).length > 0;
    var addBtn = hasAvail
      ? '<button type="button" data-write onclick="RfqsModule.openContactPicker(\'' + API.esc(rfqId) + '\')">+ Thêm liên hệ</button>'
      : '<button type="button" disabled>+ Thêm liên hệ</button>';
    return '<div class="modal-section">'
      + '<div class="section-head"><h4>Liên hệ trong gói (' + rfqContacts.length + ')</h4>' + addBtn + '</div>'
      + '<div class="table-wrap" style="margin-top:8px"><table><thead><tr>'
      + '<th>Tên</th><th>Chức vụ</th><th>Phòng ban</th><th>Vai trò trong gói</th><th>SĐT</th><th>Email</th><th style="width:120px"></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function openContactPicker(rfqId) {
    var r = (state.rows || []).find(function (r) { return r.rfq_id === rfqId; }) || {};
    var rfqContacts    = state.currentRfqContacts  || [];
    var clientContacts = state.allClientContacts   || [];
    var rfqContactIds  = rfqContacts.map(function (rc) { return rc.contact_id; });
    var available = clientContacts.filter(function (cc) {
      return cc.status !== 'archived' && !rfqContactIds.includes(cc.contact_id);
    });
    if (!available.length) { API.toast('Không còn liên hệ nào để thêm', 'error'); return; }
    var html = available.map(function (cc) {
      var ccid = API.esc(cc.contact_id);
      return '<div style="display:flex;align-items:flex-start;gap:8px;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">'
        + '<div style="flex:1">'
        + '<strong>' + API.esc(cc.contact_name) + '</strong>'
        + (cc.position ? ' — ' + API.esc(cc.position) : '')
        + (cc.department ? ' (' + API.esc(cc.department) + ')' : '')
        + '<br><span style="font-size:12px;color:var(--text-muted)">' + API.esc(cc.phone || '') + (cc.email ? ' / ' + API.esc(cc.email) : '') + '</span>'
        + '</div>'
        + '<div style="display:flex;flex-direction:column;gap:4px;min-width:170px">'
        + '<input id="sr-' + ccid + '" placeholder="Vai trò trong gói" style="font-size:12px">'
        + '<button type="button" style="font-size:12px" onclick="RfqsModule._addRfqContact(\'' + API.esc(rfqId) + '\',\'' + ccid + '\',\'sr-' + ccid + '\')">Thêm vào gói</button>'
        + '</div></div>';
    }).join('');
    Utils.openModal('Thêm liên hệ vào gói ' + API.esc(rfqId), html, null);
  }
  async function _addRfqContact(rfqId, contactId, inputId) {
    var inp = document.getElementById(inputId);
    var supportRole = inp ? inp.value.trim() : '';
    var r = (state.rows || []).find(function (r) { return r.rfq_id === rfqId; }) || {};
    try {
      await API.call('addRfqContact', { rfqId: rfqId, clientId: r.client_id || '', contactId: contactId, supportRole: supportRole });
      Utils.closeModal();
      API.toast('Đã thêm liên hệ vào gói', 'success');
      await openEdit(rfqId);
    } catch (err) { API.error(err); }
  }
  async function archiveRfqContact(rfqContactId, rfqId) {
    try {
      await API.call('archiveRfqContact', { rfqContactId: rfqContactId });
      API.toast('Đã xóa liên hệ khỏi gói', 'success');
      await openEdit(rfqId);
    } catch (err) { API.error(err); }
  }
  function valueOrDash(value) {
    return value ? API.esc(value) : '<span class="muted">—</span>';
  }
  function noteCell(value) {
    return value ? '<span class="rfq-note">' + API.esc(value) + '</span>' : '<span class="muted">—</span>';
  }
  function itemCountLabel(value) {
    var count = Number(value || 0);
    return '📋 ' + count + ' dòng';
  }
  function statusLabel(value) {
    return {
      dang_khao_gia: 'Đang khảo giá',
      da_bao: 'Đã báo',
      trung: 'Trúng',
      khong_trung: 'Không trúng',
      treo: 'Treo',
      tham_khao: 'Tham khảo',
    }[value] || value || '';
  }
  function drillDown(rfqId) {
    document.getElementById('itemRfqId').value = rfqId;
    var navBtn = document.querySelector('.nav button[data-screen="items"]');
    if (navBtn) navBtn.click();
  }
  function drillDownClient(clientId, clientName) {
    var el = document.getElementById('clientSearch');
    if (el) el.value = clientId || clientName || '';
    var navBtn = document.querySelector('.nav button[data-screen="clients"]');
    if (navBtn) navBtn.click();
  }
  window.RfqsModule = { load: load, openCreate: openCreate, openEdit: openEdit, drillDown: drillDown, drillDownClient: drillDownClient, openContactPicker: openContactPicker, _addRfqContact: _addRfqContact, archiveRfqContact: archiveRfqContact };
})();
