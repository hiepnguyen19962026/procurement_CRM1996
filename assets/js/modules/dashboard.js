(function () {
  var _lastData = null;
  var _trackedSort = { by: null, dir: 'asc' };

  // VN timezone date helpers (UTC+7)
  function todayVN() {
    var d = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function vnDateAdd(days) {
    var d = new Date(Date.now() + 7 * 60 * 60 * 1000 + days * 86400000);
    return d.toISOString().slice(0, 10);
  }

  async function load(force) {
    try {
      var data = await API.get('getDashboardV2', force ? { force: '1' } : {});
      _lastData = data.data || {};
      renderStats(_lastData);
      renderPanels(_lastData);
    } catch (err) { API.error(err); }
  }

  // Kept for backward compat – called from old NSX stats button if still in HTML
  function openNsxStats() {
    if (!_lastData) { API.toast('Đang tải dữ liệu, vui lòng thử lại.', 'info'); return; }
    var quotes = _lastData.quotes || {};
    var top = quotes.top_suppliers || [];
    var byChannel = quotes.by_channel || [];
    var topHtml = top.length
      ? '<div class="table-wrap" style="margin-bottom:14px"><table style="min-width:0"><thead><tr>'
        + '<th>Nhà cung cấp</th><th style="text-align:right">Số báo giá</th>'
        + '</tr></thead><tbody>'
        + top.map(function (r) {
            return '<tr><td>' + API.esc(r.name) + '</td>'
              + '<td style="text-align:right;font-weight:600">' + r.cnt + '</td></tr>';
          }).join('') + '</tbody></table></div>'
      : '<p style="color:var(--text-muted);margin:0 0 14px">Chưa có dữ liệu báo giá.</p>';
    var channelHtml = byChannel.length
      ? '<p style="font-size:13px;font-weight:600;margin:0 0 8px">Theo kênh nguồn</p>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
        + byChannel.map(function (c) {
            return '<span class="badge">' + API.esc(channelLabel(c.channel))
              + ': <strong>' + c.cnt + '</strong></span>';
          }).join('') + '</div>'
      : '';
    Utils.openModal('Thống kê nhà cung cấp (NSX)',
      '<div style="grid-column:1/-1">' + topHtml + channelHtml + '</div>',
      function () { Utils.closeModal(); }
    );
  }

  // ── Navigation helpers ────────────────────────────────────────────────────

  function navToRfq(rfqId) {
    if (rfqId && window.RfqsModule) RfqsModule.openEdit(rfqId);
  }

  function navToTask(taskId) {
    if (taskId && window.TasksModule) TasksModule.openEdit(taskId);
  }

  function navToItem(rfqItemId) {
    if (window.RfqItemsModule) RfqItemsModule.openEdit(rfqItemId);
  }

  function navToClar(rfqItemId) {
    if (rfqItemId && window.RfqItemsModule) RfqItemsModule.openClarificationTimeline(rfqItemId);
  }

  function navToClient(clientId) {
    if (clientId && window.ClientsModule) ClientsModule.openEdit(clientId);
  }

  // ── KPI cards ─────────────────────────────────────────────────────────────

  function renderStats(d) {
    var rfq  = d.rfq            || {};
    var clar = d.clarifications || {};
    var cs   = clar.by_status   || {};

    var dkqTotal = rfq.dkq_total   || 0;
    var dkqDue3  = rfq.dkq_due3    || 0;
    var dkqOver  = rfq.dkq_overdue || 0;
    var colorA   = dkqOver > 0 ? 'red' : dkqDue3 > 0 ? 'orange' : 'blue';

    var trungCount = rfq.trung_count      || 0;
    var trungValue = rfq.trung_value      || 0;
    var trungItems = rfq.trung_item_count || 0;

    var tkCount = rfq.tham_khao_count || 0;

    var clarTotal = (cs.waiting_supplier || 0) + (cs.waiting_client || 0)
                  + (cs.need_more_info   || 0) + (cs.processing     || 0);
    var clarParts = [];
    if (cs.waiting_supplier) clarParts.push('Chờ NCC: ' + cs.waiting_supplier);
    if (cs.need_more_info)   clarParts.push('Cần bổ sung: ' + cs.need_more_info);
    if (cs.waiting_client)   clarParts.push('Chờ CĐT: ' + cs.waiting_client);
    if (cs.processing)       clarParts.push('Đang xử lý: ' + cs.processing);

    document.getElementById('dashboardStats').innerHTML = [
      kpiCard('Đang khảo giá',          dkqTotal + ' gói', rfq.total + ' gói tổng cộng', null, colorA),
      kpiCard('Tham khảo',              tkCount, null, null, ''),
      kpiCard('Clarification cần xử lý', clarTotal, clarParts.length ? clarParts.join(' · ') : null, null, clarTotal > 0 ? 'orange' : ''),
    ].join('');
  }

  function kpiCard(label, mainText, sub1, sub2, colorHint) {
    var borderColor = {
      red:    'var(--red)',
      orange: '#d97706',
      green:  'var(--green)',
      blue:   'var(--blue)',
    }[colorHint] || 'var(--border)';
    return '<div class="metric" style="border-left:3px solid ' + borderColor + '">'
      + '<span>' + API.esc(label) + '</span>'
      + '<strong>' + API.esc(String(mainText)) + '</strong>'
      + (sub1 != null ? '<small>' + API.esc(String(sub1)) + '</small>' : '')
      + (sub2 != null ? '<small>' + API.esc(String(sub2)) + '</small>' : '')
      + '</div>';
  }

  // ── Panels ────────────────────────────────────────────────────────────────

  function renderPanels(d) {
    document.getElementById('dashboardPanels').innerHTML =
      panelTasks(d.tasks || {})
      + panelFollowup(d.tasks || {})
      + panelTrackedRfqs(d.rfq || {})
      + panelWonRfqs(d.rfq || {})
      + panelClarifications(d.clarifications || {});
  }

  // ── "Việc cần làm" – top 20 active tasks ─────────────────────────────────

  function panelTasks(tasks) {
    var rows = tasks.top20 || [];
    var today = todayVN();
    var d3 = vnDateAdd(3);
    return panel('Việc cần làm',
      rows.length
        ? miniTable(
            ['ID', 'Task', 'Công ty', 'Deadline', 'Ưu tiên', 'Trạng thái'],
            rows.map(function (r) {
              var dl = r.deadline_date || '';
              var dlHtml;
              if (!dl) {
                dlHtml = '<span style="color:var(--text-faint)">—</span>';
              } else if (dl < today) {
                dlHtml = '<span class="badge" style="background:var(--red);color:#fff">Quá hạn: ' + API.esc(dl) + '</span>';
              } else if (dl <= d3) {
                dlHtml = '<span class="badge" style="background:#d97706;color:#fff">' + API.esc(dl) + '</span>';
              } else {
                dlHtml = API.esc(dl);
              }
              return '<tr style="cursor:pointer" onclick="DashboardModule._navToTask(\'' + API.esc(r.task_id) + '\')">'
                + '<td><small style="color:var(--text);font-weight:600;font-size:11px;white-space:nowrap">' + API.esc(r.task_id || '') + '</small></td>'
                + '<td>' + API.esc(r.title || '') + (r.latest_note ? '<br><small style="color:var(--text-muted)">' + API.esc(r.latest_note) + '</small>' : '') + '</td>'
                + '<td>' + API.esc(r.company_name || '—') + '</td>'
                + '<td>' + dlHtml + '</td>'
                + '<td>' + taskPrioritySel(r.task_id, r.priority) + '</td>'
                + '<td>' + taskStatusSel(r.task_id, r.status) + '</td>'
                + '</tr>';
            }).join(''),
            'dashboard-tasks-wrap'
          )
        : empty('Không có task đang thực hiện.'),
      'dash-panel-tasks'
    );
  }

  // ── "Follow-up" – tasks with deadline: Quá hạn / Hôm nay / Trong 7 ngày ──

  function panelFollowup(tasks) {
    var rows  = tasks.followup || [];
    var today = todayVN();
    var d7    = vnDateAdd(7);

    var overdue   = rows.filter(function (r) { return (r.deadline_date || '') < today && (r.deadline_date || '') !== ''; });
    var todayRows = rows.filter(function (r) { return r.deadline_date === today; });
    var next7Rows = rows.filter(function (r) { return r.deadline_date > today && r.deadline_date <= d7; });

    var headers = ['ID', 'Task', 'Công ty', 'Deadline', 'Ưu tiên', 'Trạng thái'];

    function fuRows(list) {
      return list.map(function (r) {
        return '<tr style="cursor:pointer" onclick="DashboardModule._navToTask(\'' + API.esc(r.task_id) + '\')">'
          + '<td><small style="color:var(--text);font-weight:600;font-size:11px;white-space:nowrap">' + API.esc(r.task_id || '') + '</small></td>'
          + '<td>' + API.esc(r.title || '') + (r.latest_note ? '<br><small style="color:var(--text-muted)">' + API.esc(r.latest_note) + '</small>' : '') + '</td>'
          + '<td>' + API.esc(r.company_name || '—') + '</td>'
          + '<td>' + API.esc(r.deadline_date || '') + '</td>'
          + '<td>' + taskPrioritySel(r.task_id, r.priority) + '</td>'
          + '<td>' + taskStatusSel(r.task_id, r.status) + '</td>'
          + '</tr>';
      }).join('');
    }

    function fuSection(title, list, color) {
      return '<div style="margin-bottom:14px">'
        + '<p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:' + color + ';margin:0 0 4px">'
        + API.esc(title) + (list.length ? ' (' + list.length + ')' : '') + '</p>'
        + (list.length
            ? miniTable(headers, fuRows(list), 'dashboard-tasks-wrap')
            : '<div style="color:var(--text-faint);font-size:12px;padding:4px 0">Không có.</div>')
        + '</div>';
    }

    var hasAny = overdue.length || todayRows.length || next7Rows.length;
    return panel('Follow-up (deadline gần)',
      hasAny
        ? fuSection('Quá hạn', overdue,   'var(--red)')
          + fuSection('Hôm nay', todayRows, '#d97706')
          + fuSection('Trong 7 ngày', next7Rows, 'var(--blue)')
        : empty('Không có task nào hết hạn trong 7 ngày tới.'),
      'dash-panel-followup'
    );
  }

  // ── "RFQ đang theo dõi" – dang_khao_gia + tham_khao + da_bao, top 30, sortable ──

  function trackedRfqTableHtml(rows) {
    var today = todayVN();

    var sorted = rows.slice();
    if (_trackedSort.by) {
      sorted.sort(function (a, b) {
        var va, vb;
        if (_trackedSort.by === 'ma_goi') { va = a.ma_goi_tbmt || ''; vb = b.ma_goi_tbmt || ''; }
        else if (_trackedSort.by === 'ten_goi') { va = a.ten_goi || ''; vb = b.ten_goi || ''; }
        else if (_trackedSort.by === 'status') { va = a.trang_thai_goi || ''; vb = b.trang_thai_goi || ''; }
        else if (_trackedSort.by === 'du_toan') {
          va = Number(a.du_toan || 0); vb = Number(b.du_toan || 0);
          return _trackedSort.dir === 'asc' ? va - vb : vb - va;
        } else if (_trackedSort.by === 'item_count') {
          va = Number(a.item_count || 0); vb = Number(b.item_count || 0);
          return _trackedSort.dir === 'asc' ? va - vb : vb - va;
        } else if (_trackedSort.by === 'deadline') {
          var da = a.ngay_het_han || '';
          var db = b.ngay_het_han || '';
          var ga = !da ? 2 : da >= today ? 0 : 1;
          var gb = !db ? 2 : db >= today ? 0 : 1;
          if (ga !== gb) return _trackedSort.dir === 'asc' ? ga - gb : gb - ga;
          if (ga === 0) return _trackedSort.dir === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
          if (ga === 1) return _trackedSort.dir === 'asc' ? db.localeCompare(da) : da.localeCompare(db);
          return 0;
        }
        if (va === undefined) return 0;
        return _trackedSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }

    function arrow(key) {
      if (_trackedSort.by !== key) return ' <span style="opacity:.35">↕</span>';
      return _trackedSort.dir === 'asc' ? ' ▲' : ' ▼';
    }
    function th(label, key) {
      return '<th class="dash-th-sort" onclick="DashboardModule._sortTracked(\'' + key + '\')">'
        + API.esc(label) + arrow(key) + '</th>';
    }

    if (!sorted.length) {
      return '<div class="empty-state small">Không có RFQ đang theo dõi.</div>';
    }

    var thead = '<thead><tr>'
      + th('Mã gói', 'ma_goi')
      + th('Tên gói', 'ten_goi')
      + th('Trạng thái', 'status')
      + th('Hạn nộp', 'deadline')
      + th('Số dòng VT', 'item_count')
      + th('Dự toán', 'du_toan')
      + '<th>URL</th>'
      + '</tr></thead>';

    var rowsHtml = sorted.map(function (r) {
      var dl = r.ngay_het_han || '';
      var daysLeft = dl ? Math.round((new Date(dl).getTime() - new Date(today).getTime()) / 86400000) : null;
      var dlHtml;
      if (!dl) {
        dlHtml = '<span style="color:var(--text-faint)">—</span>';
      } else if (dl < today) {
        dlHtml = '<span class="badge" style="background:var(--red);color:#fff">Quá hạn: ' + API.esc(dl) + '</span>';
      } else if (dl === today) {
        dlHtml = '<span class="badge" style="background:#d97706;color:#fff">Hôm nay</span>';
      } else if (daysLeft !== null && daysLeft <= 3) {
        dlHtml = '<span class="badge" style="background:#f59e0b;color:#fff">Còn ' + daysLeft + ' ngày</span>';
      } else {
        dlHtml = API.esc(dl);
      }
      return '<tr style="cursor:pointer" onclick="DashboardModule._navToRfq(\'' + API.esc(r.rfq_id) + '\')">'
        + '<td><strong class="link-edit">' + API.esc(r.ma_goi_tbmt || r.rfq_id) + '</strong></td>'
        + '<td>' + API.esc(r.ten_goi || '') + '</td>'
        + '<td>' + rfqStatusSel(r.rfq_id, r.trang_thai_goi || '') + '</td>'
        + '<td>' + dlHtml + '</td>'
        + itemPill(r.rfq_id, r.item_count)
        + '<td class="num">' + (r.du_toan ? fmtMoney(r.du_toan) : '<span style="color:var(--text-faint)">—</span>') + '</td>'
        + urlCell(r.external_url)
        + '</tr>';
    }).join('');

    return '<div class="table-wrap dashboard-table-wrap" style="margin-top:6px">'
      + '<table class="quotes-mini-table">' + thead + '<tbody>' + rowsHtml + '</tbody></table>'
      + '</div>';
  }

  function panelTrackedRfqs(rfq) {
    var rows = rfq.tracked_list || [];
    return '<section class="panel" id="dash-panel-tracked-rfq"><h3>RFQ đang theo dõi</h3>'
      + '<div id="dash-tracked-rfq-inner">' + trackedRfqTableHtml(rows) + '</div>'
      + '</section>';
  }

  // ── "RFQ vừa trúng" ───────────────────────────────────────────────────────

  function panelWonRfqs(rfq) {
    var rows = rfq.won_list || [];
    return panel('RFQ vừa trúng',
      rows.length
        ? miniTable(
            ['Mã gói', 'Tên gói', 'Giá trị dự toán', 'Số dòng VT', 'Cập nhật', 'URL'],
            rows.map(function (r) {
              var upd = (r.updated_at || '').slice(0, 10);
              return '<tr style="cursor:pointer" onclick="DashboardModule._navToRfq(\'' + API.esc(r.rfq_id) + '\')">'
                + '<td><strong class="link-edit">' + API.esc(r.ma_goi_tbmt || r.rfq_id) + '</strong></td>'
                + '<td>' + API.esc(r.ten_goi) + '</td>'
                + '<td class="num">' + (r.du_toan ? fmtMoney(r.du_toan) : '<span style="color:var(--text-faint)">—</span>') + '</td>'
                + itemPill(r.rfq_id, r.item_count)
                + '<td style="color:var(--text-muted);white-space:nowrap">' + API.esc(upd) + '</td>'
                + urlCell(r.external_url)
                + '</tr>';
            }).join('')
          )
        : empty('Chưa có RFQ trúng nào.')
    );
  }

  // ── "Vật tư vừa làm rõ" ──────────────────────────────────────────────────

  function panelClarifications(clar) {
    var rows = clar.latest30 || [];
    return panel('Vật tư vừa làm rõ',
      rows.length
        ? miniTable(
            ['Thời gian', 'Vật tư', 'Tên gói', 'Loại', 'Trạng thái', 'ID làm rõ', 'Tóm tắt', 'URL'],
            rows.map(function (r) {
              var summary = r.title || r.proposed_model || r.proposed_manufacturer || r.proposed_origin || '—';
              var dt = (r.created_at || '').slice(0, 16).replace('T', ' ');
              var datePart = dt.slice(0, 10);
              var timePart = dt.slice(11, 16);
              var bestUrl = r.clar_url || r.item_url || r.rfq_url || '';
              return '<tr>'
                + '<td style="color:var(--text-muted);font-size:12px">' + API.esc(datePart) + '<br>' + API.esc(timePart) + '</td>'
                + '<td><span class="link-edit" onclick="DashboardModule._navToItem(\'' + API.esc(r.rfq_item_id) + '\')">'
                  + API.esc(r.ten_vat_tu || r.rfq_item_id) + '</span>'
                  + (r.ma_vat_tu ? '<br><small style="color:var(--text-faint)">' + API.esc(r.ma_vat_tu) + '</small>' : '') + '</td>'
                + '<td style="max-width:140px"><span class="link-edit" onclick="DashboardModule._navToRfq(\'' + API.esc(r.rfq_id) + '\')">'
                  + API.esc(r.ten_goi || r.rfq_id || '') + '</span></td>'
                + '<td>' + clarTypeSel(r.clarification_id, r.clarification_type) + '</td>'
                + '<td>' + clarStatusSel(r.clarification_id, r.status_after) + '</td>'
                + '<td style="white-space:nowrap"><small style="color:var(--text);font-weight:600;font-size:11px">' + API.esc(r.clarification_id || '') + '</small></td>'
                + '<td style="max-width:260px">'
                  + '<span class="link-edit" onclick="DashboardModule._navToClar(\'' + API.esc(r.rfq_item_id) + '\')">'
                  + API.esc(summary) + '</span></td>'
                + urlCell(bestUrl)
                + '</tr>';
            }).join('')
          )
        : empty('Chưa có clarification nào.'),
      'dash-panel-clars'
    );
  }

  // ── "Kết quả trúng & Hợp đồng" ───────────────────────────────────────────

  function panelContracts(contracts, rfq) {
    var rows = contracts.latest || [];
    var trungCount = rfq.trung_count || 0;
    var trungValue = rfq.trung_value || 0;
    var summary = '<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)">'
      + '<div><p style="font-size:12px;color:var(--text-muted);margin:0">RFQ đã trúng</p>'
      + '<strong style="font-size:22px">' + trungCount + '</strong>'
      + '<p style="font-size:12px;color:var(--text-muted);margin:0">' + fmtMoney(trungValue) + ' VND dự toán</p></div>'
      + '<div><p style="font-size:12px;color:var(--text-muted);margin:0">Hợp đồng đang hiệu lực</p>'
      + '<strong style="font-size:22px">' + (contracts.active || 0) + '</strong>'
      + '<p style="font-size:12px;color:var(--text-muted);margin:0">' + fmtMoney(contracts.total_value_active) + ' VND</p></div>'
      + '</div>';
    return panel('Kết quả trúng & Hợp đồng',
      summary
      + (rows.length
          ? miniTable(
              ['Số HĐ', 'Tên HĐ', 'Ngày ký', 'Giá trị'],
              rows.map(function (r) {
                return '<tr>'
                  + '<td><strong>' + API.esc(r.contract_no) + '</strong></td>'
                  + '<td>' + API.esc(r.contract_name || '') + '</td>'
                  + '<td>' + API.esc(r.signed_date || '') + '</td>'
                  + '<td class="num">' + (r.contract_total ? fmtMoney(r.contract_total) : '-') + '</td>'
                  + '</tr>';
              }).join('')
            )
          : empty('Chưa có hợp đồng đang hiệu lực.'))
    );
  }

  // ── Old panels – kept in code, not called from renderPanels ──────────────

  function panelRecentRfqs(rfq) {
    var rows = rfq.newest || [];
    var today = todayVN();
    return panel('RFQ gần đây',
      rows.length
        ? miniTable(
            ['Mã gói', 'Tên gói', 'Trạng thái', 'Hạn nộp'],
            rows.map(function (r) {
              var deadline = r.ngay_het_han || '';
              var isOverdue = deadline && deadline < today;
              return '<tr>'
                + '<td>' + API.esc(r.ma_goi_tbmt || r.rfq_id) + '</td>'
                + '<td>' + API.esc(r.ten_goi) + '</td>'
                + '<td><span class="badge">' + API.esc(rfqStatusLabel(r.trang_thai_goi)) + '</span></td>'
                + '<td' + (isOverdue ? ' style="color:var(--red)"' : '') + '>' + API.esc(deadline) + '</td>'
                + '</tr>';
            }).join('')
          )
        : empty('Chưa có RFQ nào.')
    );
  }

  function panelTopSuppliers(quotes) {
    var top = quotes.top_suppliers || [];
    var byChannel = quotes.by_channel || [];
    var channelHtml = byChannel.length
      ? '<p style="font-size:12px;color:var(--text-muted);margin:10px 0 4px">Theo kênh:</p>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
        + byChannel.map(function (c) {
            return '<span class="badge">' + API.esc(channelLabel(c.channel)) + ' <strong>' + c.cnt + '</strong></span>';
          }).join('') + '</div>'
      : '';
    return panel('Top NCC báo giá nhiều nhất',
      (top.length
        ? miniTable(['Nhà cung cấp', 'Số báo giá'],
            top.map(function (r) {
              return '<tr><td>' + API.esc(r.name) + '</td><td class="num">' + r.cnt + '</td></tr>';
            }).join(''))
        : empty('Chưa có báo giá.')) + channelHtml
    );
  }

  function panelCoverage(items, quotes) {
    return panel('Độ phủ báo giá & master item',
      '<div class="coverage-grid">'
      + coverageStat('Có báo giá', items.with_quotes, items.total, items.quote_coverage_pct)
      + coverageStat('Liên kết master', items.with_master_link, items.total, items.master_link_pct)
      + '</div>'
      + '<p style="font-size:12px;color:var(--text-muted);margin:0">'
      + '7 ngày qua: <strong>' + (quotes.last_7_days || 0) + '</strong> báo giá mới'
      + ' · 30 ngày: <strong>' + (quotes.last_30_days || 0) + '</strong>'
      + ' · Tổng active: <strong>' + (quotes.total || 0) + '</strong></p>'
    );
  }

  function coverageStat(label, count, total, pct) {
    return '<div>'
      + '<p style="font-size:12px;color:var(--text-muted);margin:0 0 2px">' + API.esc(label) + '</p>'
      + '<p style="font-size:22px;font-weight:700;margin:0;line-height:1.2">' + (count || 0)
      + '<span style="font-size:13px;font-weight:400;color:var(--text-muted)">&nbsp;/ ' + (total || 0) + ' (' + (pct || 0) + '%)</span></p>'
      + '</div>';
  }

  function panelImports(imports) {
    var jobs = imports.latest_jobs || [];
    var errCount = imports.error_count_last_30_days || 0;
    var errBanner = errCount > 0
      ? '<p style="color:var(--red);font-size:13px;font-weight:600;margin:0 0 8px">⚠ ' + errCount + ' lỗi import trong 30 ngày qua</p>'
      : '<p style="color:var(--green);font-size:13px;margin:0 0 8px">Không có lỗi import trong 30 ngày qua</p>';
    return panel('Import gần đây',
      errBanner + (jobs.length
        ? miniTable(['File', 'RFQ', 'Tạo', 'Cập nhật', 'Lỗi'],
            jobs.map(function (j) {
              var hasErr = j.error_count > 0;
              return '<tr>'
                + '<td>' + API.esc(j.source_file_name || j.job_id) + '</td>'
                + '<td>' + API.esc(j.rfq_id || '') + '</td>'
                + '<td class="num">' + (j.created_count || 0) + '</td>'
                + '<td class="num">' + (j.updated_count || 0) + '</td>'
                + '<td class="num"' + (hasErr ? ' style="color:var(--red);font-weight:600"' : '') + '>'
                  + (j.error_count || 0) + '</td>'
                + '</tr>';
            }).join(''))
        : empty('Chưa có job import.'))
    );
  }

  function panelMasterItems(masterItems) {
    var rows = masterItems.top_by_quote_count || [];
    return panel('Master item được hỏi giá nhiều nhất',
      rows.length
        ? miniTable(['Mã VT', 'Tên vật tư', 'Số BG'],
            rows.map(function (r) {
              return '<tr>'
                + '<td>' + API.esc(r.ma_vat_tu || '-') + '</td>'
                + '<td>' + API.esc(r.ten_vat_tu) + '</td>'
                + '<td class="num">' + r.quote_count + '</td>'
                + '</tr>';
            }).join(''))
        : empty('Chưa có dữ liệu master item.')
    );
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  function panel(title, bodyHtml, id) {
    return '<section class="panel"' + (id ? ' id="' + id + '"' : '') + '><h3>' + API.esc(title) + '</h3>' + bodyHtml + '</section>';
  }

  function rePanelById(id, html) {
    var el = document.getElementById(id);
    if (el) el.outerHTML = html;
  }

  function miniTable(headers, bodyRows, extraClass) {
    var thead = '<thead><tr>'
      + headers.map(function (h) { return '<th>' + API.esc(h) + '</th>'; }).join('')
      + '</tr></thead>';
    return '<div class="table-wrap dashboard-table-wrap' + (extraClass ? ' ' + extraClass : '') + '" style="margin-top:6px">'
      + '<table class="quotes-mini-table">' + thead + '<tbody>' + bodyRows + '</tbody></table>'
      + '</div>';
  }

  function empty(text) {
    return '<div class="empty-state small">' + API.esc(text) + '</div>';
  }

  function fmtMoney(value) {
    return Number(value || 0).toLocaleString('vi-VN');
  }

  function urlCell(url) {
    if (!url || !/^https?:\/\//i.test(url)) {
      return '<td style="text-align:center;color:var(--text-faint)">—</td>';
    }
    return '<td style="text-align:center"><a href="' + API.esc(url) + '" target="_blank" rel="noopener noreferrer"'
      + ' onclick="event.stopPropagation()" style="font-size:12px;color:var(--blue,#2563eb);text-decoration:none">Mở</a></td>';
  }

  function itemPill(rfqId, count) {
    var n = Number(count || 0);
    return '<td style="text-align:center"><span class="badge"'
      + ' style="background:var(--blue-lt,#eff6ff);color:var(--blue,#2563eb);cursor:pointer;white-space:nowrap"'
      + ' onclick="event.stopPropagation();DashboardModule._openItemsModal(\'' + API.esc(rfqId) + '\')">'
      + n + ' dòng</span></td>';
  }

  async function openItemsModal(rfqId) {
    var rfqData = (_lastData || {}).rfq || {};
    var found = (rfqData.tracked_list || []).find(function (r) { return r.rfq_id === rfqId; })
             || (rfqData.won_list || []).find(function (r) { return r.rfq_id === rfqId; });
    var rfqName = found ? (found.ten_goi || found.ma_goi_tbmt || rfqId) : rfqId;
    Utils.openModal('Vật tư — ' + rfqName,
      '<div style="grid-column:1/-1"><p style="margin:0;color:var(--text-muted);font-size:13px">Đang tải...</p></div>',
      null
    );
    try {
      var data = await API.get('getRfqItems', { rfqId: rfqId, limit: 500 });
      var rows = (data.rows || []).filter(function (r) { return r.trang_thai_dong !== 'archived'; });
      var bodyEl = document.getElementById('modalBody');
      if (!bodyEl) return;
      if (!rows.length) {
        bodyEl.innerHTML = '<div style="grid-column:1/-1"><p style="color:var(--text-muted)">Không có vật tư nào.</p></div>';
        return;
      }
      function rCell(v, m) {
        var t = (v === null || v === undefined || v === '') ? '-' : String(v);
        if (t === '-') return '<td' + (m ? ' class="muted-cell"' : '') + '>-</td>';
        return '<td>' + API.esc(t) + '</td>';
      }
      var statusMap = {
        chua_xu_ly: 'Chưa XL', dang_hoi_gia: 'Đang hỏi', du_gia: 'Đủ giá',
        da_bao_cdt: 'Đã báo CĐT', can_xac_nhan_ky_thuat: 'Cần XN KT', da_final: 'Final',
      };
      var v = RfqItemsModule.val;
      var headers = [
        'STT', 'Mã mua sắm', 'Mã vật tư', 'Tên vật tư',
        'Model', 'Nhãn hiệu', 'Năm SX', 'Xuất xứ', 'Hãng SX',
        'Thông số KT', 'Vật liệu', 'Phụ tùng', 'Yêu cầu KT bổ sung',
        'ĐVT', 'KL', 'Thuế',
        'Đơn giá ST', 'Thành tiền ST', 'Đơn giá HĐ', 'Thành tiền HĐ',
        'Giao hàng', 'Ghi chú', 'URL', 'Báo giá', 'XN kỹ thuật', 'Trạng thái',
      ];
      var rowsHtml = rows.map(function (r) {
        var escId = API.esc(r.rfq_item_id);
        var techParam = v(r, 'technical_params', 'thong_so_ky_thuat');
        return '<tr>'
          + rCell(r.stt_goc, true)
          + rCell(r.ma_mua_sam, true)
          + rCell(r.ma_vat_tu, true)
          + '<td><span class="link-edit" onclick="RfqItemsModule.openEdit(\'' + escId + '\')">'
            + API.esc(r.ten_vat_tu || '') + '</span>'
            + (techParam ? '<div class="muted" style="font-size:11px">' + API.esc(String(techParam).slice(0, 60)) + '</div>' : '')
            + '</td>'
          + rCell(v(r, 'required_model', 'quy_cach_model_yeu_cau'), true)
          + rCell(v(r, 'brand', 'nhan_hieu'), true)
          + rCell(v(r, 'manufacture_year', 'nam_san_xuat'), true)
          + rCell(v(r, 'origin_country', 'xuat_xu'), true)
          + rCell(v(r, 'manufacturer', 'hang_goc_nsx_goc'), true)
          + rCell(techParam, true)
          + rCell(r.vat_lieu, true)
          + rCell(r.phu_tung_chuyen_dung, true)
          + rCell(r.yeu_cau_ky_thuat_bo_sung, true)
          + rCell(v(r, 'unit', 'don_vi'), true)
          + rCell(v(r, 'quantity', 'so_luong') || 0, false)
          + rCell(r.thue_suat != null && r.thue_suat !== 0 ? r.thue_suat + '%' : '', true)
          + rCell(API.money(r.don_gia_truoc_thue || r.don_gia_sau_thue), true)
          + rCell(API.money(r.thanh_tien_sau_thue), true)
          + rCell(API.money(r.gia_hop_dong), true)
          + rCell(r.gia_hop_dong ? API.money(r.gia_hop_dong * (parseFloat(v(r, 'quantity', 'so_luong')) || 0)) : '', true)
          + rCell(r.delivery_time, true)
          + rCell(r.note, true)
          + urlCell(r.external_url)
          + RfqItemsModule.quotesSummaryCell(r)
          + '<td>' + RfqItemsModule.technicalSummary(r) + '</td>'
          + '<td><span class="badge">' + API.esc(statusMap[r.trang_thai_dong] || r.trang_thai_dong || '') + '</span></td>'
          + '</tr>';
      }).join('');
      bodyEl.innerHTML = '<div style="grid-column:1/-1">'
        + miniTable(headers, rowsHtml)
        + '</div>';
      if (window.innerWidth <= 640) {
        var _dw = document.querySelector('#modal .dashboard-table-wrap');
        var _dt = _dw && _dw.querySelector('table');
        console.log({
          mobile: true, innerWidth: window.innerWidth,
          wrapClientWidth: _dw && _dw.clientWidth, wrapScrollWidth: _dw && _dw.scrollWidth, wrapOffsetWidth: _dw && _dw.offsetWidth,
          tableClientWidth: _dt && _dt.clientWidth, tableScrollWidth: _dt && _dt.scrollWidth, tableOffsetWidth: _dt && _dt.offsetWidth,
          modalBodyOverflowX: getComputedStyle(document.getElementById('modalBody')).overflowX,
          modalBodyOverflowY: getComputedStyle(document.getElementById('modalBody')).overflowY,
          modalFormOverflowX: getComputedStyle(document.getElementById('modalForm')).overflowX,
          modalFormOverflowY: getComputedStyle(document.getElementById('modalForm')).overflowY,
          modalOverflowX: getComputedStyle(document.querySelector('#modal .modal')).overflowX,
          modalOverflowY: getComputedStyle(document.querySelector('#modal .modal')).overflowY,
          scrollLeftBefore: _dw && _dw.scrollLeft
        });
        setTimeout(function () {
          if (_dw) {
            _dw.scrollLeft = 200;
            console.log({ scrollLeftAfter: _dw.scrollLeft, touchAction: getComputedStyle(_dw).touchAction });
          }
        }, 500);
      }
      Auth.applyRoleUI();
      setTimeout(function () {
        var outerDiv = bodyEl.firstElementChild;
        if (!outerDiv) return;
        var wrap = outerDiv.querySelector('.table-wrap');
        if (!wrap) return;
        var top = document.createElement('div');
        top.id = 'popupItemsTopScroll';
        top.className = 'table-top-scroll';
        var inner = document.createElement('div');
        inner.style.height = '1px';
        inner.style.width = wrap.scrollWidth + 'px';
        top.appendChild(inner);
        outerDiv.insertBefore(top, wrap);
        var lock = false;
        top.onscroll = function () { if (lock) return; lock = true; wrap.scrollLeft = top.scrollLeft; lock = false; };
        wrap.onscroll = function () { if (lock) return; lock = true; top.scrollLeft = wrap.scrollLeft; lock = false; };
      }, 0);
    } catch (err) {
      var bodyEl2 = document.getElementById('modalBody');
      if (bodyEl2) bodyEl2.innerHTML = '<div style="grid-column:1/-1"><p style="color:var(--red)">Lỗi tải dữ liệu.</p></div>';
      API.error(err);
    }
  }

  function priorityBadge(v) {
    var cfg = {
      khan:      { label: 'Khẩn',  bg: 'var(--red)'  },
      cao:       { label: 'Cao',   bg: '#d97706'      },
      trung_binh:{ label: 'TB',    bg: 'var(--blue)'  },
      thap:      { label: 'Thấp',  bg: 'var(--text-muted)' },
    }[v] || { label: v || '—', bg: 'var(--text-muted)' };
    return '<span class="badge" style="background:' + cfg.bg + ';color:#fff">' + API.esc(cfg.label) + '</span>';
  }

  function taskStatusBadge(v) {
    var labels = { dang_lam: 'Đang làm', cho_phan_hoi: 'Chờ phản hồi', tam_dung: 'Tạm dừng' };
    return '<span class="badge">' + API.esc(labels[v] || v || '') + '</span>';
  }

  function rfqStatusLabel(value) {
    return {
      dang_khao_gia: 'Đang khảo giá',
      da_bao:        'Đã báo',
      trung:         'Trúng',
      khong_trung:   'Không trúng',
      treo:          'Treo',
      tham_khao:     'Tham khảo',
      archived:      'Lưu trữ',
    }[value] || value || '';
  }

  function clarTypeLabel(v) {
    return {
      ask_supplier:         'Hỏi NCC',
      supplier_reply:       'NCC phản hồi',
      ask_client:           'Hỏi CĐT',
      client_reply:         'CĐT phản hồi',
      replacement_proposal: 'Đề xuất thay thế',
      final_confirm:        'Final confirm',
      rejected:             'Từ chối',
      other:                'Khác',
    }[v] || v || '—';
  }

  function clarStatusLabel(v) {
    return {
      waiting_supplier: 'Chờ NCC',
      waiting_client:   'Chờ CĐT',
      need_more_info:   'Cần bổ sung',
      processing:       'Đang xử lý',
      final_confirmed:  'Đã xác nhận',
      rejected:         'Từ chối',
    }[v] || v || '—';
  }

  function channelLabel(value) {
    return {
      zalo: 'Zalo', wechat: 'WeChat', email: 'Email',
      phone: 'Phone', direct: 'Direct', other: 'Other', unknown: 'Không rõ',
    }[value] || value || 'Không rõ';
  }

  // ── Inline select builders ─────────────────────────────────────────────────

  function taskStatusSel(taskId, status) {
    var opts = [
      ['dang_lam',     'Đang làm'],
      ['cho_phan_hoi', 'Chờ PH'],
      ['tam_dung',     'Tạm dừng'],
      ['hoan_thanh',   'Hoàn thành'],
      ['huy_bo',       'Huỷ bỏ'],
    ];
    return '<select class="dash-sel" data-prev="' + API.esc(status || '') + '" data-val="' + API.esc(status || '') + '"'
      + ' onclick="event.stopPropagation()"'
      + ' onchange="DashboardModule._quickTaskStatus(\'' + API.esc(taskId) + '\',this.value,this)">'
      + opts.map(function (o) {
          return '<option value="' + o[0] + '"' + (status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('')
      + '</select>';
  }

  function taskPrioritySel(taskId, priority) {
    var opts = [
      ['khan',       'Khẩn'],
      ['cao',        'Cao'],
      ['trung_binh', 'TB'],
      ['thap',       'Thấp'],
    ];
    return '<select class="dash-sel" data-prev="' + API.esc(priority || '') + '" data-val="' + API.esc(priority || '') + '"'
      + ' onclick="event.stopPropagation()"'
      + ' onchange="DashboardModule._quickTaskPriority(\'' + API.esc(taskId) + '\',this.value,this)">'
      + opts.map(function (o) {
          return '<option value="' + o[0] + '"' + (priority === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('')
      + '</select>';
  }

  function rfqStatusSel(rfqId, status) {
    var opts = [
      ['dang_khao_gia', 'Đang KG'],
      ['da_bao',        'Đã báo'],
      ['tham_khao',     'Tham khảo'],
      ['trung',         'Trúng'],
      ['khong_trung',   'Không trúng'],
      ['treo',          'Treo'],
    ];
    return '<select class="dash-sel" data-prev="' + API.esc(status || '') + '" data-val="' + API.esc(status || '') + '"'
      + ' onclick="event.stopPropagation()"'
      + ' onchange="DashboardModule._quickRfqStatus(\'' + API.esc(rfqId) + '\',this.value,this)">'
      + opts.map(function (o) {
          return '<option value="' + o[0] + '"' + (status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('')
      + '</select>';
  }

  function clarTypeSel(clarId, type) {
    var opts = [
      ['ask_supplier',         'Hỏi NCC'],
      ['supplier_opinion',     'NCC ý kiến'],
      ['supplier_reply',       'NCC PH'],
      ['ask_client',           'Hỏi CĐT'],
      ['client_reply',         'CĐT PH'],
      ['replacement_proposal', 'Đề xuất TT'],
      ['final_confirm',        'Final'],
      ['rejected',             'Từ chối'],
      ['other',                'Khác'],
    ];
    return '<select class="dash-sel" data-prev="' + API.esc(type || '') + '" data-val="' + API.esc(type || '') + '"'
      + ' onclick="event.stopPropagation()"'
      + ' onchange="DashboardModule._quickClarType(\'' + API.esc(clarId) + '\',this.value,this)">'
      + opts.map(function (o) {
          return '<option value="' + o[0] + '"' + (type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('')
      + '</select>';
  }

  function clarStatusSel(clarId, status) {
    var opts = [
      ['processing',       'Đang XL'],
      ['waiting_supplier', 'Chờ NCC'],
      ['waiting_client',   'Chờ CĐT'],
      ['need_more_info',   'Cần bổ sung'],
      ['final_confirmed',  'Đã XN'],
      ['rejected',         'Từ chối'],
      ['other',            'Khác'],
    ];
    return '<select class="dash-sel" data-prev="' + API.esc(status || '') + '" data-val="' + API.esc(status || '') + '"'
      + ' onclick="event.stopPropagation()"'
      + ' onchange="DashboardModule._quickClarStatus(\'' + API.esc(clarId) + '\',this.value,this)">'
      + opts.map(function (o) {
          return '<option value="' + o[0] + '"' + (status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('')
      + '</select>';
  }

  // ── Sort handler for tracked RFQ panel ───────────────────────────────────

  function sortTracked(key) {
    if (_trackedSort.by === key) {
      _trackedSort.dir = _trackedSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      _trackedSort.by = key;
      _trackedSort.dir = 'asc';
    }
    var el = document.getElementById('dash-tracked-rfq-inner');
    if (el && _lastData) {
      el.innerHTML = trackedRfqTableHtml((_lastData.rfq || {}).tracked_list || []);
    }
  }

  // ── Quick-update handlers ─────────────────────────────────────────────────

  async function quickTaskStatus(taskId, newStatus, sel) {
    var prev = sel.getAttribute('data-prev') || sel.value;
    sel.setAttribute('data-prev', newStatus);
    sel.setAttribute('data-val', newStatus);
    try {
      await API.call('quickUpdateTaskStatus', { taskId: taskId, status: newStatus });
      var tasks = (_lastData || {}).tasks || {};
      var row = (tasks.top20 || []).find(function (r) { return r.task_id === taskId; });
      if (row) row.status = newStatus;
      var fRow = (tasks.followup || []).find(function (r) { return r.task_id === taskId; });
      if (fRow) fRow.status = newStatus;
      if (newStatus === 'hoan_thanh' || newStatus === 'huy_bo') {
        if (tasks.top20)   tasks.top20   = tasks.top20.filter(function (r) { return r.task_id !== taskId; });
        if (tasks.followup) tasks.followup = tasks.followup.filter(function (r) { return r.task_id !== taskId; });
      }
      rePanelById('dash-panel-tasks',   panelTasks(tasks));
      rePanelById('dash-panel-followup', panelFollowup(tasks));
      API.toast('Đã cập nhật trạng thái', 'success');
    } catch (err) {
      sel.value = prev;
      sel.setAttribute('data-prev', prev);
      sel.setAttribute('data-val', prev);
      API.error(err);
    }
  }

  async function quickTaskPriority(taskId, newPriority, sel) {
    var prev = sel.getAttribute('data-prev') || sel.value;
    sel.setAttribute('data-prev', newPriority);
    sel.setAttribute('data-val', newPriority);
    try {
      await API.call('quickUpdateTaskPriority', { taskId: taskId, priority: newPriority });
      var tasks = (_lastData || {}).tasks || {};
      var row = (tasks.top20 || []).find(function (r) { return r.task_id === taskId; });
      if (row) row.priority = newPriority;
      var fRow = (tasks.followup || []).find(function (r) { return r.task_id === taskId; });
      if (fRow) fRow.priority = newPriority;
      rePanelById('dash-panel-tasks',   panelTasks(tasks));
      rePanelById('dash-panel-followup', panelFollowup(tasks));
      API.toast('Đã cập nhật ưu tiên', 'success');
    } catch (err) {
      sel.value = prev;
      sel.setAttribute('data-prev', prev);
      sel.setAttribute('data-val', prev);
      API.error(err);
    }
  }

  async function quickRfqStatus(rfqId, newStatus, sel) {
    var prev = sel.getAttribute('data-prev') || sel.value;
    sel.setAttribute('data-prev', newStatus);
    sel.setAttribute('data-val', newStatus);
    try {
      await API.call('quickUpdateRfqStatus', { rfqId: rfqId, status: newStatus });
      var rfqData = (_lastData || {}).rfq || {};
      var tracked = rfqData.tracked_list || [];
      var row = tracked.find(function (r) { return r.rfq_id === rfqId; });
      if (row) row.trang_thai_goi = newStatus;
      var trackedSet = ['dang_khao_gia', 'tham_khao', 'da_bao'];
      if (trackedSet.indexOf(newStatus) === -1) {
        rfqData.tracked_list = tracked.filter(function (r) { return r.rfq_id !== rfqId; });
      }
      var el = document.getElementById('dash-tracked-rfq-inner');
      if (el) el.innerHTML = trackedRfqTableHtml(rfqData.tracked_list || []);
      API.toast('Đã cập nhật trạng thái RFQ', 'success');
    } catch (err) {
      sel.value = prev;
      sel.setAttribute('data-prev', prev);
      sel.setAttribute('data-val', prev);
      API.error(err);
    }
  }

  async function quickClarType(clarId, newType, sel) {
    var prev = sel.getAttribute('data-prev') || sel.value;
    sel.setAttribute('data-prev', newType);
    sel.setAttribute('data-val', newType);
    try {
      var latest30 = ((_lastData || {}).clarifications || {}).latest30 || [];
      var row = latest30.find(function (r) { return r.clarification_id === clarId; });
      var curStatus = row ? (row.status_after || '') : '';
      await API.call('quickUpdateClarification', { clarificationId: clarId, clarificationType: newType, statusAfter: curStatus });
      if (row) row.clarification_type = newType;
      rePanelById('dash-panel-clars', panelClarifications((_lastData || {}).clarifications || {}));
      API.toast('Đã cập nhật loại làm rõ', 'success');
    } catch (err) {
      sel.value = prev;
      sel.setAttribute('data-prev', prev);
      sel.setAttribute('data-val', prev);
      API.error(err);
    }
  }

  async function quickClarStatus(clarId, newStatus, sel) {
    var prev = sel.getAttribute('data-prev') || sel.value;
    sel.setAttribute('data-prev', newStatus);
    sel.setAttribute('data-val', newStatus);
    try {
      var latest30 = ((_lastData || {}).clarifications || {}).latest30 || [];
      var row = latest30.find(function (r) { return r.clarification_id === clarId; });
      var curType = row ? (row.clarification_type || '') : '';
      await API.call('quickUpdateClarification', { clarificationId: clarId, clarificationType: curType, statusAfter: newStatus });
      if (row) row.status_after = newStatus;
      rePanelById('dash-panel-clars', panelClarifications((_lastData || {}).clarifications || {}));
      API.toast('Đã cập nhật trạng thái làm rõ', 'success');
    } catch (err) {
      sel.value = prev;
      sel.setAttribute('data-prev', prev);
      sel.setAttribute('data-val', prev);
      API.error(err);
    }
  }

  window.DashboardModule = {
    load:                load,
    openNsxStats:        openNsxStats,
    _navToRfq:           navToRfq,
    _navToTask:          navToTask,
    _navToItem:          navToItem,
    _navToClar:          navToClar,
    _navToClient:        navToClient,
    _openItemsModal:     openItemsModal,
    _sortTracked:        sortTracked,
    _quickTaskStatus:    quickTaskStatus,
    _quickTaskPriority:  quickTaskPriority,
    _quickRfqStatus:     quickRfqStatus,
    _quickClarType:      quickClarType,
    _quickClarStatus:    quickClarStatus,
  };
})();
