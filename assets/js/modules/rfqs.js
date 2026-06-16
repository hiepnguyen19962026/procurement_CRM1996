(function () {
  var state = AppState.list('rfqs');
  var sort = { by: '', dir: 'desc' };
  var _setupDone = false;
  var contractAddendumCache = {};
  var contractAddendumItemCache = {};
  var contractPartySuggestions = [];

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
        + urlCell(r.external_url, r.rfq_id)
        + '<td data-role-only="admin,manager" style="text-align:center;padding:0 4px">'
          + '<button type="button" class="btn-x-archive" title="Lưu trữ RFQ" onclick="RfqsModule.archiveRfq(\'' + API.esc(r.rfq_id) + '\')">✕</button>'
          + '</td>'
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
        externalUrl:          r.external_url || '',
      });
      var row = (state.rows || []).find(function (x) { return x.rfq_id === rfqId; });
      if (row) row.trang_thai_goi = newStatus;
      render();
      API.toast('Đã cập nhật trạng thái', 'success');
    } catch (err) { API.error(err); }
  }

  // ─── edit / create ─────────────────────────────────────────────────────────

  function openCreate() { openForm({}, [], [], []); }

  async function openEdit(id) {
    var r = (state.rows || []).find(function (r) { return r.rfq_id === id; });
    if (!r || !r.ten_goi) {
      try {
        var fetched = await API.get('getRfq', { rfqId: id });
        r = fetched.row || r || { rfq_id: id };
      } catch (_) { r = r || { rfq_id: id }; }
    }
    try {
      var fetches = [API.get('getRfqContacts', { rfqId: id }), API.get('getContracts', { rfqId: id, limit: 50 })];
      if (r.client_id) fetches.push(API.get('getClientContacts', { clientId: r.client_id }));
      var results = await Promise.all(fetches);
      state.currentRfqContacts = results[0].rows || [];
      state.currentRfqContracts = results[1].rows || [];
      state.allClientContacts  = r.client_id ? ((results[2] || {}).rows || []) : [];
      openForm(r, state.currentRfqContacts, state.allClientContacts, state.currentRfqContracts);
    } catch (err) { API.error(err); }
  }

  function openForm(r, rfqContacts, clientContacts, rfqContracts) {
    rfqContacts    = rfqContacts    || [];
    clientContacts = clientContacts || [];
    rfqContracts   = rfqContracts   || [];
    Utils.openModal(r.rfq_id ? 'Sửa RFQ: ' + (r.rfq_id) : 'Thêm RFQ', fields(r, rfqContacts, clientContacts, rfqContracts), async function (data) {
      // Guard: text in picker but no client selected from suggestions
      var cacTxt = document.getElementById('rfq-cac-txt');
      if (cacTxt && cacTxt.value.trim() && !data.clientId) {
        API.toast('Vui lòng chọn CĐT từ danh sách gợi ý', 'error');
        return;
      }
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
    setTimeout(function () {
      bindClientAc(r);
      if (r.rfq_id) loadRfqContractAddendums(r.rfq_id, rfqContracts);
    }, 0);
  }

  // ─── form fields ───────────────────────────────────────────────────────────

  function fields(r, rfqContacts, clientContacts, rfqContracts) {
    var statSel = '<select name="trangThaiGoi">' + STATUSES.map(function (s) {
      return '<option value="' + s + '"' + ((r.trang_thai_goi || 'dang_khao_gia') === s ? ' selected' : '') + '>' + STATUS_LABELS[s] + '</option>';
    }).join('') + '</select>';

    // Client autocomplete widget — one picker, no internal ID visible
    var clientDisplayVal = r.client_name || r.nha_may_cdt || '';
    var hasClient = !!(r.client_id);
    var initHelper = hasClient && r.nha_may_cdt && r.nha_may_cdt !== r.client_name
      ? 'Nhà máy/alias: ' + API.esc(r.nha_may_cdt)
      : '';
    var clientAc = '<div class="ac-wrap">'
      + '<input type="hidden" name="clientId" id="rfq-cac-id" value="' + API.esc(r.client_id || '') + '">'
      + '<input type="hidden" name="nhaMayCdt" id="rfq-nha-may" value="' + API.esc(r.nha_may_cdt || '') + '">'
      + '<div style="display:flex;gap:4px;align-items:center">'
      + '<input class="ac-input" id="rfq-cac-txt" data-client-autocomplete="true" autocomplete="off" placeholder="Gõ tên CĐT, MST, nhà máy/alias..." value="' + API.esc(clientDisplayVal) + '"' + (hasClient ? ' readonly style="background:var(--bg);flex:1"' : ' style="flex:1"') + '>'
      + (hasClient ? '<button type="button" id="rfq-cac-clear" title="Đổi khách hàng" style="min-width:30px;padding:0 8px;font-size:13px;box-shadow:none">✕</button>' : '')
      + '</div>'
      + '<div class="ac-drop dp-hidden" id="rfq-cac-drop"></div>'
      + '<small id="rfq-cac-helper" style="color:var(--text-muted);display:block;margin-top:2px">' + initHelper + '</small>'
      + '</div>';

    // Row 1: tên gói(5) + mã gói(3) + CĐT(4) = 12
    // Row 2: ngày nhận(2) + ngày hết hạn(2) + dự toán(3) + trạng thái(2) = 9
    // Row 3: ghi chú(12)
    var base = '<label class="span-5">Tên gói *<input name="tenGoi" required value="' + API.esc(r.ten_goi || '') + '"></label>'
      + '<label class="span-3">Mã gói / TBMT<input name="maGoiTbmt" value="' + API.esc(r.ma_goi_tbmt || '') + '"></label>'
      + '<label class="span-4">CĐT / pháp nhân phát thầu' + clientAc + '</label>'
      + '<label class="span-2">Ngày nhận / đăng tải<input name="ngayNhanHoacDangTai" type="date" value="' + API.esc(r.ngay_nhan_hoac_dang_tai || '') + '"></label>'
      + '<label class="span-2">Ngày hết hạn<input name="ngayHetHan" type="date" value="' + API.esc(r.ngay_het_han || '') + '"></label>'
      + '<label class="span-3">Dự toán (VNĐ)<input name="duToan" inputmode="numeric" value="' + API.esc(r.du_toan || '') + '"></label>'
      + '<label class="span-2">Trạng thái' + statSel + '</label>'
      + '<label class="span-2">Bảo hành (%)<input name="warrantyPercent" type="number" min="0" step="0.01" value="' + API.esc(r.warranty_percent ?? '') + '"></label>'
      + '<label class="span-2">Số ngày bảo hành<input name="warrantyDays" type="number" min="0" step="1" value="' + API.esc(r.warranty_days ?? '') + '"></label>'
      + '<label class="span-12 compact-ta">Ghi chú<textarea name="note">' + API.esc(r.note || '') + '</textarea></label>'
      + '<label class="span-12 compact-ta">Ghi chú 2<textarea name="note2" rows="5">' + API.esc(r.note2 || '') + '</textarea></label>'
      + '<label class="span-12">URL thư mục/tài liệu<input name="externalUrl" type="url" maxlength="2000" placeholder="https://drive.google.com/…" value="' + API.esc(r.external_url || '') + '"></label>';

    if (r.rfq_id) base += rfqContractsSection(r, rfqContracts) + rfqContactsSection(r.rfq_id, rfqContacts, clientContacts, r.client_id || '');
    return base;
  }

  // ─── client autocomplete ───────────────────────────────────────────────────

  function buildClientHelper(c) {
    var parts = [];
    if (c.plant_name)  parts.push('Nhà máy: ' + c.plant_name);
    if (c.legal_name)  parts.push('Pháp nhân: ' + c.legal_name);
    if (c.tax_code)    parts.push('MST: ' + c.tax_code);
    if (c.province)    parts.push('Tỉnh: ' + c.province);
    if (c.client_type) parts.push(c.client_type);
    return parts.map(function (p) { return API.esc(p); }).join(' · ');
  }

  function bindClientAc(r) {
    var inp    = document.getElementById('rfq-cac-txt');
    var hidden = document.getElementById('rfq-cac-id');
    var drop   = document.getElementById('rfq-cac-drop');
    var nhaMay = document.getElementById('rfq-nha-may');
    var helper = document.getElementById('rfq-cac-helper');
    if (!inp) return;

    var _t = null;

    // Wire clear button if already rendered (client pre-selected on open)
    var existingClear = document.getElementById('rfq-cac-clear');
    if (existingClear) existingClear.addEventListener('click', clearSelection);

    // Async pre-load full client data when editing existing RFQ
    if (r.client_id && inp.readOnly) {
      API.get('getClients', { q: r.client_id, limit: 5 }).then(function (data) {
        var match = (data.rows || []).find(function (c) { return c.client_id === r.client_id; });
        if (match) {
          inp.value = match.plant_name || match.client_name || match.legal_name || inp.value;
          if (nhaMay) nhaMay.value = match.plant_name || match.client_name || '';
          if (helper) helper.innerHTML = buildClientHelper(match);
        } else if (helper && !helper.textContent.trim()) {
          helper.innerHTML = '<span style="color:var(--red)">Chưa khớp CĐT trong danh mục</span>';
        }
      }).catch(function () {});
    }

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
        var primary = c.plant_name || c.client_name || c.legal_name || c.client_id;
        var secondary = [c.legal_name, c.tax_code ? 'MST: ' + c.tax_code : '', c.province, c.client_type].filter(Boolean);
        return '<div class="ac-item" tabindex="0"'
          + ' data-id="' + API.esc(c.client_id) + '"'
          + ' data-name="' + API.esc(primary) + '"'
          + ' data-plant="' + API.esc(c.plant_name || '') + '"'
          + ' data-legalname="' + API.esc(c.legal_name || '') + '"'
          + ' data-taxcode="' + API.esc(c.tax_code || '') + '"'
          + ' data-province="' + API.esc(c.province || '') + '"'
          + ' data-ctype="' + API.esc(c.client_type || '') + '">'
          + '<strong>' + API.esc(primary) + '</strong>'
          + (secondary.length ? '<br><small>' + secondary.map(function (x) { return API.esc(x); }).join(' · ') + '</small>' : '')
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
      var plantVal = item.getAttribute('data-plant') || item.getAttribute('data-name') || '';
      if (nhaMay) nhaMay.value = plantVal;
      drop.classList.add('dp-hidden');
      lockSelection({
        plant_name:  item.getAttribute('data-plant'),
        legal_name:  item.getAttribute('data-legalname'),
        tax_code:    item.getAttribute('data-taxcode'),
        province:    item.getAttribute('data-province'),
        client_type: item.getAttribute('data-ctype'),
      });
    });

    function lockSelection(clientData) {
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
      // update helper text (no internal ID shown)
      if (helper) helper.innerHTML = buildClientHelper(clientData);
    }

    function clearSelection() {
      hidden.value = '';
      inp.value = '';
      inp.readOnly = false;
      inp.style.background = '';
      if (nhaMay) nhaMay.value = '';
      if (helper) helper.textContent = '';
      var btn = document.getElementById('rfq-cac-clear');
      if (btn) btn.remove();
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

  // --- RFQ contract/addendum section ---------------------------------------

  function rfqContractsSection(rfq, contracts) {
    var rfqId = rfq.rfq_id || '';
    contracts = contracts || [];
    if (!contracts.length) {
      var canCreate = rfq.trang_thai_goi === 'trung';
      return '<div class="modal-section">'
        + (canCreate ? '<div style="display:flex;justify-content:flex-end;margin-bottom:8px"><button type="button" class="btn btn-sm" data-write onclick="RfqsModule.openRfqContractModal(\'' + API.esc(rfqId) + '\')">Tạo hợp đồng</button></div>' : '')
        + '<div class="section-head"><h4>Hợp đồng / Phụ lục</h4></div>'
        + '<p style="color:var(--text-muted);font-size:13px;margin:4px 0 0">RFQ này chưa có hợp đồng nên chưa thể thêm phụ lục.</p>'
        + '</div>';
    }
    return '<div class="modal-section">'
      + '<div class="section-head"><h4>Hợp đồng / Phụ lục (' + contracts.length + ')</h4></div>'
      + contracts.map(function (c) {
          var contractId = c.contract_id || '';
          var disabled = c.status === 'archived' ? ' disabled style="opacity:.5;cursor:not-allowed"' : '';
          return '<div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-top:8px">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">'
              + '<div><strong>' + API.esc(c.contract_no || contractId) + '</strong>'
              + (c.contract_name ? '<div class="muted" style="font-size:12px">' + API.esc(c.contract_name) + '</div>' : '')
              + '<div class="muted" style="font-size:12px">Giá trị gốc: ' + API.esc(API.money(c.original_contract_total || c.contract_total || 0) || '0') + '</div>'
              + '</div>'
              + '<button type="button" class="btn btn-sm" data-write onclick="RfqsModule.openContractAddendumModal(\'' + API.esc(rfqId) + '\',\'' + API.esc(contractId) + '\')"' + disabled + '>+ Phụ lục</button>'
            + '</div>'
            + '<div id="' + rfqAddendumContainerId(contractId) + '" class="empty-state small" style="margin-top:8px">Đang tải phụ lục...</div>'
          + '</div>';
        }).join('')
      + '</div>';
  }

  function rfqAddendumContainerId(contractId) {
    return 'rfq_add_' + String(contractId || '').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  function loadRfqContractAddendums(rfqId, contracts) {
    (contracts || []).forEach(function (c) {
      loadRfqContractAddendum(rfqId, c.contract_id);
    });
  }

  async function loadRfqContractAddendum(rfqId, contractId) {
    var container = document.getElementById(rfqAddendumContainerId(contractId));
    if (!container) return;
    try {
      var data = await API.get('getContractAddendums', { contractId: contractId });
      contractAddendumCache[contractId] = data;
      (data.rows || []).forEach(function (r) {
        if (r.addendum_id) contractAddendumCache[r.addendum_id] = r;
      });
      container.innerHTML = renderRfqContractAddendums(rfqId, contractId, data);
      setTimeout(function () {
        (data.rows || []).forEach(function (r) {
          if (r.addendum_id) loadRfqContractAddendumItems(rfqId, contractId, r.addendum_id);
        });
      }, 0);
      Auth.applyRoleUI();
    } catch (err) {
      container.textContent = 'Lỗi tải phụ lục hợp đồng.';
      API.error(err);
    }
  }

  function renderRfqContractAddendums(rfqId, contractId, data) {
    var rows = data.rows || [];
    return rfqAddendumSummary(data.summary || {})
      + '<div class="quotes-table-wrap" style="margin-top:8px">'
      + '<table class="quotes-mini-table"><thead><tr>'
      + '<th>Số PL</th><th>Tên phụ lục</th><th>Ngày ký</th>'
      + '<th>Trước thuế</th><th>Thuế %</th><th>Sau thuế</th>'
      + '<th>Tác động +/-</th><th>Trạng thái</th><th>URL</th><th></th>'
      + '</tr></thead><tbody>'
      + (rows.length ? rows.map(function (r) { return rfqAddendumRow(rfqId, contractId, r); }).join('') : '<tr><td colspan="10" class="empty-state small">Chưa có phụ lục.</td></tr>')
      + '</tbody></table></div>';
  }

  function rfqAddendumSummary(summary) {
    var original = summary.original_contract_total || 0;
    var addTotal = summary.addendum_total || 0;
    var current = summary.current_effective_value || (original + addTotal);
    return '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:8px">'
      + rfqSummaryBox('Giá trị HĐ gốc', original)
      + rfqSummaryBox('Tổng phụ lục', addTotal)
      + rfqSummaryBox('Giá trị hiện hành', current)
      + '<div style="border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg)">'
        + '<div class="muted" style="font-size:11px">Số phụ lục active</div>'
        + '<strong>' + API.esc(summary.active_addendum_count || 0) + '</strong>'
      + '</div>'
      + '</div>';
  }

  function rfqSummaryBox(label, value) {
    return '<div style="border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg)">'
      + '<div class="muted" style="font-size:11px">' + API.esc(label) + '</div>'
      + '<strong>' + API.esc(API.money(value) || '0') + '</strong>'
      + '</div>';
  }

  function rfqAddendumRow(rfqId, contractId, r) {
    var archived = r.status === 'archived';
    var editBtn = archived ? '' : '<button type="button" class="btn btn-sm" data-write onclick="RfqsModule.openContractAddendumModal(\'' + API.esc(rfqId) + '\',\'' + API.esc(contractId) + '\',\'' + API.esc(r.addendum_id || '') + '\')">Sửa</button>';
    var archiveBtn = archived ? '' : '<button type="button" class="btn btn-sm" data-role-only="admin,manager" onclick="RfqsModule.archiveContractAddendum(\'' + API.esc(rfqId) + '\',\'' + API.esc(r.addendum_id || '') + '\',\'' + API.esc(contractId) + '\')">Lưu trữ</button>';
    return '<tr>'
      + '<td><strong>' + API.esc(r.addendum_no || '') + '</strong></td>'
      + '<td>' + API.esc(r.addendum_name || '') + (r.note ? '<div class="muted" style="font-size:11px">' + API.esc(r.note) + '</div>' : '') + '</td>'
      + '<td>' + API.esc(r.signed_date || '') + '</td>'
      + '<td class="num">' + moneyOrDash(r.value_before_tax) + '</td>'
      + '<td class="num">' + API.esc(r.tax_rate != null ? r.tax_rate : 0) + '</td>'
      + '<td class="num"><strong>' + moneyOrDash(r.value_after_tax) + '</strong></td>'
      + '<td class="num">' + signedMoney(r.amount_delta) + '</td>'
      + '<td>' + addendumStatusBadge(r.status) + '</td>'
      + '<td style="text-align:center">' + addendumUrlCell(r.external_url) + '</td>'
      + '<td style="white-space:nowrap;text-align:center">' + editBtn + archiveBtn + '</td>'
      + '</tr>';
  }

  function renderRfqContractAddendums(rfqId, contractId, data) {
    var rows = data.rows || [];
    return rfqAddendumSummary(data.summary || {})
      + '<div class="quotes-table-wrap" style="margin-top:8px">'
      + '<table class="quotes-mini-table"><thead><tr>'
      + '<th>So PL</th><th>Noi dung</th><th>Ghi chu</th><th>Ngay ky</th>'
      + '<th>Truoc thue</th><th>Thue %</th><th>Sau thue</th>'
      + '<th>Tac dong +/-</th><th>Trang thai</th><th>URL</th><th></th>'
      + '</tr></thead><tbody>'
      + (rows.length ? rows.map(function (r) { return rfqAddendumRow(rfqId, contractId, r); }).join('') : '<tr><td colspan="11" class="empty-state small">Chua co phu luc.</td></tr>')
      + '</tbody></table></div>';
  }

  function rfqAddendumRow(rfqId, contractId, r) {
    var archived = r.status === 'archived';
    var editBtn = archived ? '' : '<button type="button" class="btn btn-sm" data-write onclick="RfqsModule.openContractAddendumModal(\'' + API.esc(rfqId) + '\',\'' + API.esc(contractId) + '\',\'' + API.esc(r.addendum_id || '') + '\')">Sua</button>';
    var archiveBtn = archived ? '' : '<button type="button" class="btn btn-sm" data-role-only="admin,manager" onclick="RfqsModule.archiveContractAddendum(\'' + API.esc(rfqId) + '\',\'' + API.esc(r.addendum_id || '') + '\',\'' + API.esc(contractId) + '\')">Luu tru</button>';
    var addendumId = r.addendum_id || '';
    return '<tr>'
      + '<td><strong>' + API.esc(r.addendum_no || '') + '</strong></td>'
      + '<td>' + API.esc(r.addendum_name || '') + '</td>'
      + '<td>' + API.esc(r.note || '') + '</td>'
      + '<td>' + API.esc(r.signed_date || '') + '</td>'
      + '<td class="num">' + moneyOrDash(r.value_before_tax) + '</td>'
      + '<td class="num">' + API.esc(r.tax_rate != null ? r.tax_rate : 0) + '</td>'
      + '<td class="num"><strong>' + moneyOrDash(r.value_after_tax) + '</strong></td>'
      + '<td class="num">' + signedMoney(r.amount_delta) + '</td>'
      + '<td>' + addendumStatusBadge(r.status) + '</td>'
      + '<td style="text-align:center">' + addendumUrlCell(r.external_url) + '</td>'
      + '<td style="white-space:nowrap;text-align:center">' + editBtn + archiveBtn + '</td>'
      + '</tr>'
      + '<tr><td colspan="11" style="background:var(--bg);padding:8px 10px">'
      + '<div id="' + rfqAddendumItemsContainerId(addendumId) + '" class="empty-state small">Dang tai dong chi tiet...</div>'
      + '</td></tr>';
  }

  function rfqAddendumItemsContainerId(addendumId) {
    return 'rfq_addi_' + String(addendumId || '').replace(/[^A-Za-z0-9_-]/g, '_');
  }

  async function loadRfqContractAddendumItems(rfqId, contractId, addendumId) {
    var container = document.getElementById(rfqAddendumItemsContainerId(addendumId));
    if (!container) return;
    try {
      var data = await API.get('getContractAddendumItems', { addendumId: addendumId });
      (data.rows || []).forEach(function (r) {
        if (r.addendum_item_id) contractAddendumItemCache[r.addendum_item_id] = r;
      });
      container.innerHTML = renderRfqContractAddendumItems(rfqId, contractId, addendumId, data);
      Auth.applyRoleUI();
    } catch (err) {
      container.textContent = 'Loi tai dong chi tiet phu luc.';
      API.error(err);
    }
  }

  function renderRfqContractAddendumItems(rfqId, contractId, addendumId, data) {
    var rows = data.rows || [];
    var addendum = contractAddendumCache[addendumId] || data.addendum || {};
    var detailTotal = Number((data.summary || {}).detail_total || 0);
    var headerDelta = Number(addendum.amount_delta || 0);
    var warn = detailTotal !== headerDelta
      ? '<div class="muted" style="color:var(--red);font-size:12px;margin-top:4px">T&#7893;ng chi ti&#7871;t kh&#225;c t&#225;c &#273;&#7897;ng gi&#225; tr&#7883; c&#7911;a ph&#7909; l&#7909;c.</div>'
      : '';
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px">'
      + '<div><strong>Tong chi tiet: ' + API.esc(API.money(detailTotal) || '0') + '</strong>'
      + '<span class="muted" style="margin-left:10px">Tac dong header: ' + API.esc(API.money(headerDelta) || '0') + '</span>'
      + warn + '</div>'
      + '<button type="button" class="btn btn-sm" data-write onclick="RfqsModule.openContractAddendumItemModal(\'' + API.esc(rfqId) + '\',\'' + API.esc(contractId) + '\',\'' + API.esc(addendumId) + '\')">+ Dong chi tiet</button>'
      + '</div>'
      + '<div class="quotes-table-wrap"><table class="quotes-mini-table"><thead><tr>'
      + '<th>Loai</th><th>Ma</th><th>Noi dung</th><th>Quy cach</th><th>DVT</th><th>SL</th><th>Don gia</th><th>Thanh tien</th><th>Thue %</th><th>Ghi chu</th><th>Thao tac</th>'
      + '</tr></thead><tbody>'
      + (rows.length ? rows.map(function (r) { return rfqAddendumItemRow(rfqId, contractId, addendumId, r); }).join('') : '<tr><td colspan="11" class="empty-state small">Chua co dong chi tiet.</td></tr>')
      + '</tbody></table></div>';
  }

  function rfqAddendumItemRow(rfqId, contractId, addendumId, r) {
    var archived = r.status === 'archived';
    var editBtn = archived ? '' : '<button type="button" class="btn btn-sm" data-write onclick="RfqsModule.openContractAddendumItemModal(\'' + API.esc(rfqId) + '\',\'' + API.esc(contractId) + '\',\'' + API.esc(addendumId) + '\',\'' + API.esc(r.addendum_item_id || '') + '\')">Sua</button>';
    var archiveBtn = archived ? '' : '<button type="button" class="btn btn-sm" data-role-only="admin,manager" onclick="RfqsModule.archiveContractAddendumItem(\'' + API.esc(rfqId) + '\',\'' + API.esc(contractId) + '\',\'' + API.esc(addendumId) + '\',\'' + API.esc(r.addendum_item_id || '') + '\')">Luu tru</button>';
    return '<tr' + (archived ? ' style="opacity:.65"' : '') + '>'
      + '<td>' + API.esc(rfqAddendumItemTypeLabel(r.item_type)) + '</td>'
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

  function rfqAddendumItemTypeLabel(type) {
    return { material: 'Material', service: 'Service', other: 'Other' }[type] || type || '';
  }

  function rfqAddendumItemTypeOptions(current) {
    var opts = [['material', 'Material'], ['service', 'Service'], ['other', 'Other']];
    return opts.map(function (o) {
      return '<option value="' + API.esc(o[0]) + '"' + (o[0] === current ? ' selected' : '') + '>' + API.esc(o[1]) + '</option>';
    }).join('');
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
    var labels = { draft: 'Nháp', active: 'Hiệu lực', archived: 'Lưu trữ', cancelled: 'Hủy' };
    var style = status === 'active'
      ? 'background:var(--green-bg);border-color:#86efac;color:var(--green)'
      : status === 'archived'
        ? 'opacity:.6'
        : '';
    return '<span class="badge" style="' + style + '">' + API.esc(labels[status] || status || '') + '</span>';
  }

  function addendumUrlCell(url) {
    if (!url || !/^https?:\/\//i.test(url)) return '<span class="muted">-</span>';
    return '<a class="btn btn-sm" href="' + API.esc(encodeURI(url)) + '" target="_blank" rel="noopener noreferrer" title="' + API.esc(url) + '">Mở</a>';
  }

  function input(name, label, value, attrs, cls) {
    return '<label' + (cls ? ' class="' + cls + '"' : '') + '>' + API.esc(label) + '<input name="' + API.esc(name) + '" ' + (attrs || '') + ' value="' + API.esc(value) + '"></label>';
  }

  function textarea(name, label, value, attrs, cls) {
    return '<label' + (cls ? ' class="' + cls + '"' : '') + '>' + API.esc(label) + '<textarea name="' + API.esc(name) + '" ' + (attrs || '') + '>' + API.esc(value) + '</textarea></label>';
  }

  function contractDefaultValue(rfq) {
    var keys = ['winning_value', 'actual_winning_value', 'gia_trung', 'gia_trung_thau', 'contract_total', 'du_toan'];
    for (var i = 0; i < keys.length; i++) {
      var v = rfq[keys[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '' && Number(v) > 0) return v;
    }
    return 0;
  }

  function openRfqContractModal(rfqId) {
    var rfq = (state.rows || []).find(function (r) { return r.rfq_id === rfqId; }) || { rfq_id: rfqId };
    contractPartySuggestions = [];
    var partyA = rfq.client_name || rfq.nha_may_cdt || '';
    var html = ''
      + input('contractNo', 'Mã hợp đồng *', '', 'required placeholder="VD: VTPC1-0401-251013001"', 'span-4')
      + input('signedDate', 'Ngày ký', '', 'type="date"', 'span-3')
      + input('contractTotal', 'Giá trị hợp đồng', contractDefaultValue(rfq), 'inputmode="numeric" placeholder="0"', 'span-5')
      + lookupInput('partyA', 'Bên A', partyA, 'rfq-contract-party-a', 'span-6')
      + lookupInput('partyB', 'Bên B', '', 'rfq-contract-party-b', 'span-6')
      + textarea('note', 'Ghi chú', '', '', 'span-12 compact-ta');
    Utils.openModal('Tạo hợp đồng từ RFQ', html, async function (form) {
      try {
        form.rfqId = rfqId;
        await API.call('createContract', form);
        API.toast('Đã tạo hợp đồng', 'success');
        await openEdit(rfqId);
      } catch (err) {
        API.error(err);
      }
    });
    setTimeout(function () {
      bindContractPartyLookups();
      preloadContractPartySuggestions();
    }, 0);
    Auth.applyRoleUI();
  }

  function lookupInput(name, label, value, id, cls) {
    return '<label class="' + API.esc(cls || '') + '">' + API.esc(label)
      + '<div class="ac-wrap">'
      + '<input class="ac-input" id="' + API.esc(id) + '" name="' + API.esc(name) + '" autocomplete="off" value="' + API.esc(value || '') + '">'
      + '<div class="ac-drop dp-hidden" id="' + API.esc(id) + '-drop"></div>'
      + '</div></label>';
  }

  function bindContractPartyLookups() {
    bindLookup('rfq-contract-party-a');
    bindLookup('rfq-contract-party-b');
  }

  async function preloadContractPartySuggestions() {
    try {
      var results = await Promise.all([
        API.get('getClients', { limit: 200 }).catch(function () { return { rows: [] }; }),
        API.get('getSuppliers', { limit: 200 }).catch(function () { return { rows: [] }; }),
      ]);
      contractPartySuggestions = mergeCompanySuggestions(results[0].rows || [], results[1].rows || []);
      ['rfq-contract-party-a', 'rfq-contract-party-b'].forEach(function (id) {
        var inp = document.getElementById(id);
        if (inp && inp.value.trim()) inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
    } catch (_) {}
  }

  function mergeCompanySuggestions(clients, suppliers) {
    var seen = {};
    var rows = [];
    function add(value, hint, searchParts) {
      value = String(value || '').trim();
      if (!value) return;
      var key = normalizeLookupText(value);
      if (seen[key]) return;
      seen[key] = true;
      rows.push({
        value: value,
        hint: (hint || []).filter(Boolean).join(' · '),
        search: normalizeLookupText([value].concat(searchParts || []).filter(Boolean).join(' ')),
      });
    }
    (clients || []).forEach(function (r) {
      add(r.client_name || r.plant_name || r.legal_name || '', [r.legal_name, r.tax_code ? 'MST: ' + r.tax_code : '', r.province], [r.legal_name, r.client_name, r.plant_name, r.tax_code, r.province]);
    });
    (suppliers || []).forEach(function (r) {
      add(r.supplier_name || '', [r.tax_code ? 'MST: ' + r.tax_code : '', r.country], [r.supplier_name, r.tax_code, r.country]);
    });
    return rows;
  }

  function normalizeLookupText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function renderLookupRows(drop, rows) {
    if (!rows.length) { drop.classList.add('dp-hidden'); return; }
    drop.innerHTML = rows.slice(0, 8).map(function (r) {
      return '<div class="ac-item" tabindex="0" data-val="' + API.esc(r.value) + '">'
        + '<strong>' + API.esc(r.value) + '</strong>'
        + (r.hint ? '<br><small>' + API.esc(r.hint) + '</small>' : '')
        + '</div>';
    }).join('');
    drop.classList.remove('dp-hidden');
  }

  async function fallbackCompanySuggestions(q) {
    try {
      var results = await Promise.all([
        API.get('getClients', { q: q, limit: 8 }).catch(function () { return { rows: [] }; }),
        API.get('getSuppliers', { q: q, limit: 8 }).catch(function () { return { rows: [] }; }),
      ]);
      return mergeCompanySuggestions(results[0].rows || [], results[1].rows || []);
    } catch (_) {
      return [];
    }
  }

  function bindLookup(inputId) {
    var inp = document.getElementById(inputId);
    var drop = document.getElementById(inputId + '-drop');
    if (!inp || !drop) return;
    var timer = null;
    inp.addEventListener('input', function () {
      clearTimeout(timer);
      var q = inp.value.trim();
      if (!q) { drop.classList.add('dp-hidden'); return; }
      timer = setTimeout(async function () {
        try {
          var needle = normalizeLookupText(q);
          var primaryFn = function (r) { return r.value || ''; };
          var secondaryFn = function (r) { return r.hint ? [r.hint] : []; };
          var localRows = contractPartySuggestions.filter(function (r) { return r.search.indexOf(needle) >= 0; });
          var data = { rows: localRows.length ? localRows : await fallbackCompanySuggestions(q) };
          var rows = data.rows || [];
          if (!rows.length) { drop.classList.add('dp-hidden'); return; }
          drop.innerHTML = rows.map(function (r) {
            var primary = primaryFn(r);
            var secondary = secondaryFn(r);
            return '<div class="ac-item" tabindex="0" data-val="' + API.esc(primary) + '">'
              + '<strong>' + API.esc(primary) + '</strong>'
              + (secondary.length ? '<br><small>' + secondary.map(function (x) { return API.esc(x); }).join(' · ') + '</small>' : '')
              + '</div>';
          }).join('');
          drop.classList.remove('dp-hidden');
        } catch (_) {
          drop.classList.add('dp-hidden');
        }
      }, 220);
    });
    drop.addEventListener('mousedown', function (e) {
      var item = e.target.closest('.ac-item');
      if (!item) return;
      e.preventDefault();
      inp.value = item.getAttribute('data-val') || '';
      drop.classList.add('dp-hidden');
    });
  }

  function openContractAddendumModal(rfqId, contractId, addendumId) {
    var row = addendumId ? (contractAddendumCache[addendumId] || {}) : {};
    var html = ''
      + input('addendumNo', 'Số phụ lục *', row.addendum_no || '', 'required placeholder="VD: VTPC1-0401-251013001-PL-01"', 'span-4')
      + input('addendumName', 'Tên phụ lục', row.addendum_name || '', 'placeholder="VD: Phụ lục bổ sung phạm vi"', 'span-5')
      + input('signedDate', 'Ngày ký', row.signed_date || '', 'type="date"', 'span-3')
      + input('valueBeforeTax', 'Giá trị trước thuế', row.value_before_tax || '', 'inputmode="numeric" placeholder="0"', 'span-3')
      + input('taxRate', 'Thuế %', row.tax_rate ?? '', 'type="number" min="0" step="0.01" placeholder="0"', 'span-2')
      + input('valueAfterTax', 'Giá trị sau thuế', row.value_after_tax || '', 'inputmode="numeric" placeholder="0" readonly', 'span-3')
      + input('amountDelta', 'Tác động giá trị hợp đồng', row.amount_delta || '', 'inputmode="numeric" readonly', 'span-4')
      + '<div class="span-12 muted" style="font-size:12px;margin-top:-4px">Tự tính từ giá trị sau thuế. Số âm là giảm giá trị hợp đồng.</div>'
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
        API.toast('Đã lưu phụ lục', 'success');
        await openEdit(rfqId);
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

  function openContractAddendumItemModal(rfqId, contractId, addendumId, addendumItemId) {
    var row = addendumItemId ? (contractAddendumItemCache[addendumItemId] || {}) : {};
    var html = ''
      + '<label class="span-3">Loai<select name="itemType">' + rfqAddendumItemTypeOptions(row.item_type || 'material') + '</select></label>'
      + input('itemCode', 'Ma', row.item_code || '', 'maxlength="120"', 'span-3')
      + input('itemName', 'Noi dung *', row.item_name || '', 'required maxlength="500"', 'span-6')
      + input('spec', 'Quy cach', row.spec || '', 'maxlength="1000"', 'span-6')
      + input('unit', 'DVT', row.unit || '', 'maxlength="80"', 'span-2')
      + input('quantity', 'SL', row.quantity ?? '', 'type="number" min="0" step="0.001"', 'span-2')
      + input('unitPrice', 'Don gia', row.unit_price || '', 'inputmode="numeric"', 'span-3')
      + input('lineTotal', 'Thanh tien', row.line_total || '', 'inputmode="numeric"', 'span-3')
      + input('taxRate', 'Thue %', row.tax_rate ?? '', 'type="number" min="0" step="0.01"', 'span-2')
      + textarea('note', 'Ghi chu', row.note || '', '', 'span-12 compact-ta');
    Utils.openModal(addendumItemId ? 'Sua dong chi tiet phu luc' : 'Them dong chi tiet phu luc', html, async function (form) {
      try {
        form.addendumId = addendumId;
        if (addendumItemId) form.addendumItemId = addendumItemId;
        await API.call(addendumItemId ? 'updateContractAddendumItem' : 'createContractAddendumItem', form);
        API.toast('Da luu dong chi tiet', 'success');
        await loadRfqContractAddendumItems(rfqId, contractId, addendumId);
      } catch (err) {
        API.error(err);
      }
    });
    Auth.applyRoleUI();
  }

  async function archiveContractAddendumItem(rfqId, contractId, addendumId, addendumItemId) {
    var ok = await Utils.confirmDanger('Luu tru dong chi tiet', 'Luu tru dong chi tiet phu luc nay?', 'Luu tru');
    if (!ok) return;
    try {
      await API.call('archiveContractAddendumItem', { addendumItemId: addendumItemId });
      API.toast('Da luu tru dong chi tiet', 'success');
      await loadRfqContractAddendumItems(rfqId, contractId, addendumId);
    } catch (err) {
      API.error(err);
    }
  }

  async function archiveContractAddendum(rfqId, addendumId, contractId) {
    var ok = await Utils.confirmDanger('Lưu trữ phụ lục', 'Lưu trữ phụ lục này? Phụ lục sẽ không còn tính vào tổng giá trị active.', 'Lưu trữ');
    if (!ok) return;
    try {
      await API.call('archiveContractAddendum', { addendumId: addendumId });
      API.toast('Đã lưu trữ phụ lục', 'success');
      await loadRfqContractAddendum(rfqId, contractId);
    } catch (err) {
      API.error(err);
    }
  }

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

  async function archiveRfq(rfqId) {
    var ok = await Utils.confirmDanger(
      'Lưu trữ RFQ',
      'Lưu trữ gói thầu "' + rfqId + '"? Gói sẽ bị ẩn khỏi danh sách. Dữ liệu vật tư và báo giá vẫn được giữ nguyên.',
      'Lưu trữ'
    );
    if (!ok) return;
    try {
      await API.call('archiveRfq', { rfqId: rfqId });
      API.toast('Đã lưu trữ RFQ', 'success');
      await load(true);
    } catch (err) { API.error(err); }
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  function valueOrDash(value) {
    return value ? API.esc(value) : '<span class="muted">—</span>';
  }
  function noteCell(value) {
    return value ? '<span class="rfq-note">' + API.esc(value) + '</span>' : '<span class="muted">—</span>';
  }
  function urlCell(url, rfqId) {
    if (!url || !/^https?:\/\//i.test(url)) {
      return '<td style="text-align:center;padding:0 4px">'
        + '<button type="button" class="btn btn-sm" onclick="RfqsModule.openEdit(\'' + API.esc(rfqId) + '\')">+ URL</button>'
        + '</td>';
    }
    return '<td style="text-align:center;padding:0 4px;white-space:nowrap">'
      + '<a class="btn btn-sm" href="' + API.esc(encodeURI(url)) + '" target="_blank" rel="noopener noreferrer" title="' + API.esc(url) + '">Mở</a>'
      + ' <button type="button" class="btn btn-sm" onclick="RfqsModule.openEdit(\'' + API.esc(rfqId) + '\')">Sửa</button>'
      + '</td>';
  }
  function itemCountLabel(value) {
    return '📋 ' + Number(value || 0) + ' dòng';
  }
  function drillDown(rfqId) {
    if (typeof RfqItemsModule !== 'undefined' && RfqItemsModule.filterByRfq) {
      RfqItemsModule.filterByRfq(rfqId);
    } else {
      document.getElementById('itemRfqId').value = rfqId;
    }
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
    openRfqContractModal: openRfqContractModal,
    openContractAddendumModal: openContractAddendumModal,
    archiveContractAddendum: archiveContractAddendum,
    openContractAddendumItemModal: openContractAddendumItemModal,
    archiveContractAddendumItem: archiveContractAddendumItem,
    archiveRfq:        archiveRfq,
  };
})();
