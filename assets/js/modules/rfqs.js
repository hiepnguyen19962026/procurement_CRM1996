(function () {
  var state = AppState.list('rfqs');
  var sort = { by: '', dir: 'desc' };
  var _setupDone = false;

  var STATUSES = ['dang_khao_gia','da_bao','trung','khong_trung','treo','tham_khao'];
  var STATUS_LABELS = {
    dang_khao_gia: 'Đang khảo giá',
    da_bao:        'Đã báo',
    trung:         'Trúng',
    khong_trung:   'Không trúng',
    treo:          'Treo',
    tham_khao:     'Tham khảo',
  };

  // ─── list ──────────────────────────────────────────────────────────────────

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
      // Status: clickable badge for write roles, plain badge for viewers
      var statCell = canWrite
        ? '<button class="badge rfq-stat-btn" data-rfq="' + API.esc(r.rfq_id) + '" onclick="RfqsModule.quickStatus(event,\'' + API.esc(r.rfq_id) + '\')">' + API.esc(STATUS_LABELS[r.trang_thai_goi] || r.trang_thai_goi || '') + '</button>'
        : '<span class="badge">' + API.esc(STATUS_LABELS[r.trang_thai_goi] || r.trang_thai_goi || '') + '</span>';
      return '<tr>'
        + '<td style="white-space:nowrap">' + API.esc(r.rfq_id) + '</td>'
        + '<td>' + maGoiCell + '</td>'
        + '<td>' + tenGoiCell + '</td>'
        + '<td>' + cdtCell + '</td>'
        + '<td style="white-space:nowrap">' + valueOrDash(r.ngay_nhan_hoac_dang_tai) + '</td>'
        + '<td style="white-space:nowrap">' + valueOrDash(r.ngay_het_han) + '</td>'
        + '<td style="white-space:nowrap"><button class="badge badge-items" onclick="RfqsModule.drillDown(\'' + API.esc(r.rfq_id) + '\')">' + API.esc(itemCountLabel(r.item_count)) + '</button></td>'
        + '<td style="white-space:nowrap;text-align:right">' + (API.money(r.du_toan) || '<span class="muted">—</span>') + '</td>'
        + '<td style="white-space:nowrap">' + statCell + '</td>'
        + '<td>' + noteCell(r.note) + '</td>'
        + '</tr>';
    }).join('');
    document.getElementById('rfqMore').classList.toggle('hidden', !state.hasMore);
    Auth.applyRoleUI();
  }

  // ─── status quick edit ─────────────────────────────────────────────────────

  function quickStatus(ev, rfqId) {
    ev.stopPropagation();
    var existing = document.getElementById('rfq-stat-pop');
    if (existing) {
      var wasThisRfq = existing.dataset.rfq === rfqId;
      existing.remove();
      if (wasThisRfq) return;
    }
    var r = (state.rows || []).find(function (x) { return x.rfq_id === rfqId; });
    if (!r) return;

    var pop = document.createElement('div');
    pop.id = 'rfq-stat-pop';
    pop.className = 'rfq-stat-pop';
    pop.dataset.rfq = rfqId;
    pop.innerHTML = STATUSES.map(function (s) {
      return '<button type="button" class="rfq-stat-item' + (r.trang_thai_goi === s ? ' active' : '') + '" data-val="' + s + '">'
        + API.esc(STATUS_LABELS[s]) + '</button>';
    }).join('');

    var rect = ev.currentTarget.getBoundingClientRect();
    pop.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;left:' + rect.left + 'px;';
    document.body.appendChild(pop);

    pop.querySelectorAll('.rfq-stat-item').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        pop.remove();
        await _setStatus(rfqId, btn.getAttribute('data-val'), r);
      });
    });

    function outsideClick(e) {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener('click', outsideClick, true);
      }
    }
    setTimeout(function () {
      document.addEventListener('click', outsideClick, true);
    }, 0);
  }

  async function _setStatus(rfqId, newStatus, r) {
    try {
      await API.call('updateRfq', {
        rfqId:                rfqId,
        tenGoi:               r.ten_goi || '',
        clientId:             r.client_id || '',
        maGoiTbmt:            r.ma_goi_tbmt || '',
        nhaMayCdt:            r.nha_may_cdt || '',
        ngayNhanHoacDangTai:  r.ngay_nhan_hoac_dang_tai || '',
        ngayHetHan:           r.ngay_het_han || '',
        duToan:               r.du_toan || '',
        trangThaiGoi:         newStatus,
        sourceFileId:         r.source_file_id || '',
        note:                 r.note || '',
      });
      var row = (state.rows || []).find(function (x) { return x.rfq_id === rfqId; });
      if (row) row.trang_thai_goi = newStatus;
      render();
      API.toast('Đã cập nhật trạng thái', 'success');
    } catch (err) { API.error(err); }
  }

  // ─── edit / create ─────────────────────────────────────────────────────────

  function openCreate() { openForm({}, [], []); }

  async function openEdit(id) {
    var r = (state.rows || []).find(function (r) { return r.rfq_id === id; }) || { rfq_id: id };
    try {
      var fetches = [API.get('getRfqContacts', { rfqId: id })];
      if (r.client_id) fetches.push(API.get('getClientContacts', { clientId: r.client_id }));
      var results = await Promise.all(fetches);
      state.currentRfqContacts = results[0].rows || [];
      state.allClientContacts  = r.client_id ? ((results[1] || {}).rows || []) : [];
      openForm(r, state.currentRfqContacts, state.allClientContacts);
    } catch (err) { API.error(err); }
  }

  function openForm(r, rfqContacts, clientContacts) {
    rfqContacts    = rfqContacts    || [];
    clientContacts = clientContacts || [];
    Utils.openModal(r.rfq_id ? 'Sửa RFQ: ' + (r.rfq_id) : 'Thêm RFQ', fields(r, rfqContacts, clientContacts), async function (data) {
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
    // wire client autocomplete after DOM is ready (Datepicker.init already called by openModal)
    setTimeout(function () { bindClientAc(r); }, 0);
  }

  // ─── form fields ───────────────────────────────────────────────────────────

  function fields(r, rfqContacts, clientContacts) {
    var statSel = '<select name="trangThaiGoi">' + STATUSES.map(function (s) {
      return '<option value="' + s + '"' + ((r.trang_thai_goi || 'dang_khao_gia') === s ? ' selected' : '') + '>' + STATUS_LABELS[s] + '</option>';
    }).join('') + '</select>';

    // Client autocomplete widget (hidden id input + search text input + dropdown + clear btn)
    var clientDisplayVal = r.client_name || (r.client_id && !r.nha_may_cdt ? r.client_id : '') || '';
    var hasClient = !!(r.client_id);
    var clientAc = '<div class="ac-wrap">'
      + '<input type="hidden" name="clientId" id="rfq-cac-id" value="' + API.esc(r.client_id || '') + '">'
      + '<div style="display:flex;gap:4px;align-items:center">'
      + '<input class="ac-input" id="rfq-cac-txt" data-client-autocomplete="true" autocomplete="off" placeholder="Gõ tên, MST, hoặc nhà máy..." value="' + API.esc(clientDisplayVal) + '"' + (hasClient ? ' readonly style="background:var(--bg);flex:1"' : ' style="flex:1"') + '>'
      + (hasClient ? '<button type="button" id="rfq-cac-clear" title="Đổi khách hàng" style="min-width:30px;padding:0 8px;font-size:13px;box-shadow:none">✕</button>' : '')
      + '</div>'
      + '<div class="ac-drop dp-hidden" id="rfq-cac-drop"></div>'
      + (hasClient ? '<small style="color:var(--text-muted);display:block;margin-top:2px">ID: ' + API.esc(r.client_id || '') + '</small>' : '')
      + '</div>';

    var base = '<label>Tên gói *<input name="tenGoi" required value="' + API.esc(r.ten_goi || '') + '"></label>'
      + '<label>Mã gói / TBMT<input name="maGoiTbmt" value="' + API.esc(r.ma_goi_tbmt || '') + '"></label>'
      + '<label>Khách hàng / CĐT' + clientAc + '</label>'
      + '<label>Nhà máy / Tên gọi tắt<input name="nhaMayCdt" id="rfq-nha-may" value="' + API.esc(r.nha_may_cdt || '') + '"></label>'
      + '<label>Ngày nhận / đăng tải<input name="ngayNhanHoacDangTai" type="date" value="' + API.esc(r.ngay_nhan_hoac_dang_tai || '') + '"></label>'
      + '<label>Ngày hết hạn<input name="ngayHetHan" type="date" value="' + API.esc(r.ngay_het_han || '') + '"></label>'
      + '<label>Dự toán (VNĐ)<input name="duToan" inputmode="numeric" value="' + API.esc(r.du_toan || '') + '"></label>'
      + '<label>Trạng thái' + statSel + '</label>'
      + '<label>Ghi chú<textarea name="note">' + API.esc(r.note || '') + '</textarea></label>';

    if (r.rfq_id) base += rfqContactsSection(r.rfq_id, rfqContacts, clientContacts, r.client_id || '');
    return base;
  }

  // ─── client autocomplete ───────────────────────────────────────────────────

  function bindClientAc(r) {
    var inp    = document.getElementById('rfq-cac-txt');
    var hidden = document.getElementById('rfq-cac-id');
    var drop   = document.getElementById('rfq-cac-drop');
    var nhaMay = document.getElementById('rfq-nha-may');
    if (!inp) return;

    var _t = null;

    // Wire clear button if already rendered (client pre-selected on open)
    var existingClear = document.getElementById('rfq-cac-clear');
    if (existingClear) existingClear.addEventListener('click', clearSelection);

    inp.addEventListener('input', function () {
      clearTimeout(_t);
      var q = inp.value.trim();
      hidden.value = '';
      if (!q) { drop.classList.add('dp-hidden'); return; }
      _t = setTimeout(async function () {
        try {
          var data = await API.get('getClients', { q: q, limit: 8 });
          renderDrop(data.rows || []);
        } catch (_) { drop.classList.add('dp-hidden'); }
      }, 220);
    });

    function renderDrop(rows) {
      if (!rows.length) { drop.classList.add('dp-hidden'); return; }
      drop.innerHTML = rows.map(function (c) {
        return '<div class="ac-item" tabindex="0" data-id="' + API.esc(c.client_id) + '" data-name="' + API.esc(c.client_name || '') + '" data-plant="' + API.esc(c.plant_name || '') + '">'
          + '<strong>' + API.esc(c.client_name || c.client_id) + '</strong>'
          + (c.plant_name || c.tax_code || c.province
              ? '<br><small>' + [c.plant_name, c.tax_code ? 'MST: ' + c.tax_code : '', c.province].filter(Boolean).map(function (x) { return API.esc(x); }).join(' · ') + '</small>'
              : '')
          + '</div>';
      }).join('');
      drop.classList.remove('dp-hidden');
    }

    drop.addEventListener('mousedown', function (e) {
      var item = e.target.closest('.ac-item');
      if (!item) return;
      e.preventDefault();
      hidden.value = item.getAttribute('data-id');
      inp.value    = item.getAttribute('data-name');
      if (nhaMay) nhaMay.value = item.getAttribute('data-plant') || '';
      drop.classList.add('dp-hidden');
      lockSelection(item.getAttribute('data-id'));
    });

    function lockSelection(clientId) {
      inp.readOnly = true;
      inp.style.background = 'var(--bg)';
      // create clear button if not already present
      var btn = document.getElementById('rfq-cac-clear');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'rfq-cac-clear';
        btn.title = 'Đổi khách hàng';
        btn.style.cssText = 'min-width:30px;padding:0 8px;font-size:13px;box-shadow:none';
        btn.textContent = '✕';
        btn.addEventListener('click', clearSelection);
        inp.parentNode.appendChild(btn);
      }
      // create/update ID badge
      var wrap = inp.closest('.ac-wrap');
      var badge = wrap && wrap.querySelector('[data-ac-badge]');
      if (!badge && wrap) {
        badge = document.createElement('small');
        badge.setAttribute('data-ac-badge', '1');
        badge.style.cssText = 'color:var(--text-muted);display:block;margin-top:2px';
        wrap.appendChild(badge);
      }
      if (badge) badge.textContent = 'ID: ' + clientId;
    }

    function clearSelection() {
      hidden.value = '';
      inp.value = '';
      inp.readOnly = false;
      inp.style.background = '';
      if (nhaMay) nhaMay.value = '';
      var btn = document.getElementById('rfq-cac-clear');
      if (btn) btn.remove();
      var wrap = inp.closest('.ac-wrap');
      var badge = wrap && wrap.querySelector('[data-ac-badge]');
      if (badge) badge.remove();
      inp.focus();
    }

    document.addEventListener('click', function close(e) {
      if (drop && !drop.contains(e.target) && e.target !== inp) {
        drop.classList.add('dp-hidden');
        document.removeEventListener('click', close);
      }
    });
  }

  // ─── rfq contacts section ──────────────────────────────────────────────────

  function rfqContactsSection(rfqId, rfqContacts, clientContacts, clientId) {
    if (!clientId) {
      return '<div class="modal-section">'
        + '<div class="section-head"><h4>Liên hệ trong gói</h4>'
        + '<button type="button" data-rfq-contact-add disabled style="opacity:.45;cursor:not-allowed">+ Thêm liên hệ</button>'
        + '</div>'
        + '<p style="color:var(--text-muted);font-size:13px;margin:4px 0 0">Vui lòng chọn CĐT trước khi thêm liên hệ.</p>'
        + '</div>';
    }

    var rfqContactIds = rfqContacts.map(function (rc) { return rc.contact_id; });
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

    return '<div class="modal-section">'
      + '<div class="section-head"><h4>Liên hệ trong gói (' + rfqContacts.length + ')</h4>'
      + '<button type="button" data-write data-rfq-contact-add onclick="RfqsModule.openContactPicker(\'' + API.esc(rfqId) + '\')">+ Thêm liên hệ</button>'
      + '</div>'
      + '<div class="table-wrap" style="margin-top:8px"><table><thead><tr>'
      + '<th>Tên</th><th>Chức vụ</th><th>Phòng ban</th><th>Vai trò trong gói</th><th>SĐT</th><th>Email</th><th style="width:120px"></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  // ─── contact picker ────────────────────────────────────────────────────────

  function openContactPicker(rfqId) {
    var r              = (state.rows || []).find(function (r) { return r.rfq_id === rfqId; }) || {};
    if (!r.client_id) {
      Utils.openModal('Chọn CĐT trước', '<p style="margin:0">Vui lòng chọn Chủ đầu tư (CĐT) cho gói thầu trước khi thêm liên hệ.</p>', null);
      return;
    }
    var rfqContacts    = state.currentRfqContacts || [];
    var clientContacts = state.allClientContacts  || [];
    var rfqContactIds  = rfqContacts.map(function (rc) { return rc.contact_id; });
    var activeContacts = clientContacts.filter(function (cc) { return cc.status !== 'archived'; });
    var available      = activeContacts.filter(function (cc) { return !rfqContactIds.includes(cc.contact_id); });

    if (activeContacts.length === 0) {
      // Client has no contacts at all
      Utils.openModal('Chưa có liên hệ', ''
        + '<p style="margin:0 0 12px">Khách hàng này chưa có liên hệ nào.</p>'
        + '<p style="margin:0"><button type="button" onclick="Utils.closeModal();ClientsModule.openEdit(\'' + API.esc(r.client_id || '') + '\')">→ Mở hồ sơ khách hàng để thêm liên hệ</button></p>',
        null
      );
      return;
    }

    if (!available.length) {
      Utils.openModal('Đã thêm đủ', '<p>Tất cả liên hệ của khách hàng đã có trong gói này.</p>', null);
      return;
    }

    var html = available.map(function (cc) {
      var ccid = API.esc(cc.contact_id);
      return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">'
        + '<div style="flex:1">'
        + '<strong>' + API.esc(cc.contact_name || '') + '</strong>'
        + (cc.position ? ' — ' + API.esc(cc.position) : '')
        + (cc.department ? ' (' + API.esc(cc.department) + ')' : '')
        + '<br><span style="font-size:12px;color:var(--text-muted)">'
        + [cc.phone, cc.email, cc.zalo].filter(Boolean).map(function (v) { return API.esc(v); }).join(' / ')
        + '</span></div>'
        + '<div style="display:flex;flex-direction:column;gap:4px;min-width:175px">'
        + '<input id="sr-' + ccid + '" placeholder="Vai trò trong gói (tuỳ chọn)" style="font-size:12px">'
        + '<button type="button" style="font-size:12px" onclick="RfqsModule._addRfqContact(\'' + API.esc(rfqId) + '\',\'' + ccid + '\',\'sr-' + ccid + '\')">Thêm vào gói</button>'
        + '</div></div>';
    }).join('');

    Utils.openModal('Thêm liên hệ vào gói ' + API.esc(rfqId), html, null);
  }

  async function _addRfqContact(rfqId, contactId, inputId) {
    var inp  = document.getElementById(inputId);
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

  // ─── helpers ───────────────────────────────────────────────────────────────

  function valueOrDash(value) {
    return value ? API.esc(value) : '<span class="muted">—</span>';
  }
  function noteCell(value) {
    return value ? '<span class="rfq-note">' + API.esc(value) + '</span>' : '<span class="muted">—</span>';
  }
  function itemCountLabel(value) {
    return '📋 ' + Number(value || 0) + ' dòng';
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

  window.RfqsModule = {
    load:             load,
    openCreate:       openCreate,
    openEdit:         openEdit,
    drillDown:        drillDown,
    drillDownClient:  drillDownClient,
    quickStatus:      quickStatus,
    openContactPicker: openContactPicker,
    _addRfqContact:   _addRfqContact,
    archiveRfqContact: archiveRfqContact,
  };
})();
