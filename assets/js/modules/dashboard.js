(function () {
  var _lastData = null;

  // VN timezone date helpers (UTC+7)
  function todayVN() {
    var d = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function vnDateAdd(days) {
    var d = new Date(Date.now() + 7 * 60 * 60 * 1000 + days * 86400000);
    return d.toISOString().slice(0, 10);
  }

  async function load() {
    try {
      var data = await API.get('getDashboardV2', {});
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
    var btn = document.querySelector('.nav button[data-screen="rfqs"]');
    if (btn) btn.click();
    if (rfqId) setTimeout(function () { if (window.RfqsModule) RfqsModule.openEdit(rfqId); }, 150);
  }

  function navToTask(taskId) {
    var btn = document.querySelector('.nav button[data-screen="tasks"]');
    if (btn) btn.click();
    if (taskId) setTimeout(function () { if (window.TasksModule) TasksModule.openEdit(taskId); }, 150);
  }

  function navToItem(rfqItemId) {
    // RfqItemsModule.openEdit works as a floating modal regardless of active screen
    if (window.RfqItemsModule) RfqItemsModule.openEdit(rfqItemId);
  }

  // ── KPI cards ─────────────────────────────────────────────────────────────

  function renderStats(d) {
    var rfq = d.rfq            || {};
    var clar = d.clarifications || {};
    var cs   = clar.by_status   || {};

    // Card A: Đang khảo giá
    var dkqTotal = rfq.dkq_total   || 0;
    var dkqDue3  = rfq.dkq_due3    || 0;
    var dkqOver  = rfq.dkq_overdue || 0;
    var cardABadges = '';
    if (dkqOver > 0) cardABadges += ' <span class="badge" style="background:var(--red);color:#fff">' + dkqOver + ' quá hạn</span>';
    if (dkqDue3 > 0) cardABadges += ' <span class="badge" style="background:#d97706;color:#fff">' + dkqDue3 + ' ≤3 ngày</span>';

    // Card B: Đã trúng
    var trungCount = rfq.trung_count      || 0;
    var trungValue = rfq.trung_value      || 0;
    var trungItems = rfq.trung_item_count || 0;

    // Card C: Tham khảo
    var tkCount = rfq.tham_khao_count || 0;
    var tkValue = rfq.tham_khao_value || 0;

    // Card D: Clarification cần xử lý
    var clarTotal = (cs.waiting_supplier || 0) + (cs.waiting_client || 0)
                  + (cs.need_more_info   || 0) + (cs.processing     || 0);
    var clarBadges = '';
    if (cs.waiting_supplier) clarBadges += ' <span class="badge">Chờ NCC: ' + cs.waiting_supplier + '</span>';
    if (cs.waiting_client)   clarBadges += ' <span class="badge">Chờ CĐT: ' + cs.waiting_client   + '</span>';
    if (cs.need_more_info)   clarBadges += ' <span class="badge">Cần bổ sung: ' + cs.need_more_info + '</span>';
    if (cs.processing)       clarBadges += ' <span class="badge">Đang xử lý: ' + cs.processing     + '</span>';

    document.getElementById('dashboardStats').innerHTML = [
      kpiCard('Đang khảo giá', dkqTotal,
        cardABadges ? '<br>' + cardABadges : '',
        rfq.total + ' gói tổng cộng',
        dkqOver > 0 ? 'red' : dkqDue3 > 0 ? 'orange' : 'blue'),

      kpiCard('Đã trúng', trungCount,
        '<br><small>' + fmtMoney(trungValue) + ' VND dự toán · ' + trungItems + ' dòng VT</small>',
        'Giá trị dựa trên du_toan', 'green'),

      kpiCard('Tham khảo', tkCount,
        tkValue > 0 ? '<br><small>' + fmtMoney(tkValue) + ' VND ước tính</small>' : '',
        'RFQ dạng tham khảo', ''),

      kpiCard('Clarification cần xử lý', clarTotal,
        clarBadges ? '<br>' + clarBadges : '',
        'Đang chờ phản hồi',
        clarTotal > 0 ? 'orange' : ''),
    ].join('');
  }

  function kpiCard(label, value, extraHtml, subText, colorHint) {
    var borderColor = {
      red:    'var(--red)',
      orange: '#d97706',
      green:  'var(--green)',
      blue:   'var(--blue)',
    }[colorHint] || 'var(--border)';
    return '<div class="metric" style="border-left:3px solid ' + borderColor + '">'
      + '<div>'
      + '<span>' + API.esc(label) + '</span>'
      + '<strong style="font-size:28px">' + value + '</strong>'
      + (extraHtml || '')
      + '<small>' + API.esc(subText || '') + '</small>'
      + '</div></div>';
  }

  // ── Panels ────────────────────────────────────────────────────────────────

  function renderPanels(d) {
    document.getElementById('dashboardPanels').innerHTML =
      panelTasks(d.tasks || {})
      + panelFollowup(d.tasks || {})
      + panelDeadlines(d.rfq || {})
      + panelWonRfqs(d.rfq || {})
      + panelClarifications(d.clarifications || {})
      + panelContracts(d.contracts || {}, d.rfq || {});
    // Removed: panelTopSuppliers, panelCoverage, panelImports, panelMasterItems
    // Code kept below but not rendered — use for reference or future toggle
  }

  // ── "Việc cần làm" – top 20 active tasks ─────────────────────────────────

  function panelTasks(tasks) {
    var rows = tasks.top20 || [];
    var today = todayVN();
    var d3 = vnDateAdd(3);
    return panel('Việc cần làm (top 20)',
      rows.length
        ? miniTable(
            ['Task', 'Công ty', 'Deadline', 'Ưu tiên', 'Trạng thái'],
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
                + '<td>' + API.esc(r.title || '') + (r.latest_note ? '<br><small style="color:var(--text-muted)">' + API.esc(r.latest_note) + '</small>' : '') + '</td>'
                + '<td>' + API.esc(r.company_name || '—') + '</td>'
                + '<td style="white-space:nowrap">' + dlHtml + '</td>'
                + '<td>' + priorityBadge(r.priority) + '</td>'
                + '<td>' + taskStatusBadge(r.status) + '</td>'
                + '</tr>';
            }).join('')
          )
        : empty('Không có task đang thực hiện.')
    );
  }

  // ── "Follow-up hôm nay & quá hạn" ────────────────────────────────────────

  function panelFollowup(tasks) {
    var rows = tasks.followup || [];
    var today = todayVN();
    return panel('Follow-up hôm nay & quá hạn',
      rows.length
        ? miniTable(
            ['Công ty', 'Nội dung', 'Follow-up', 'Người phụ trách'],
            rows.map(function (r) {
              var fu = r.next_followup_date || '';
              var fuHtml = fu < today
                ? '<span class="badge" style="background:var(--red);color:#fff">QH: ' + API.esc(fu) + '</span>'
                : '<span class="badge" style="background:#d97706;color:#fff">' + API.esc(fu) + '</span>';
              return '<tr style="cursor:pointer" onclick="DashboardModule._navToTask(\'' + API.esc(r.task_id) + '\')">'
                + '<td>' + API.esc(r.company_name || '—') + '</td>'
                + '<td>' + API.esc(r.title || '') + (r.latest_note ? '<br><small style="color:var(--text-muted)">' + API.esc(r.latest_note) + '</small>' : '') + '</td>'
                + '<td style="white-space:nowrap">' + fuHtml + '</td>'
                + '<td style="color:var(--text-muted)">' + API.esc(r.created_by || '—') + '</td>'
                + '</tr>';
            }).join('')
          )
        : empty('Không có follow-up quá hạn hoặc hôm nay.')
    );
  }

  // ── "RFQ sắp hết hạn" – dang_khao_gia only, sorted by deadline ───────────

  function panelDeadlines(rfq) {
    var rows = rfq.deadline_list || [];
    var today = todayVN();
    return panel('RFQ sắp hết hạn (đang khảo giá)',
      rows.length
        ? miniTable(
            ['Mã gói', 'Tên gói', 'CĐT', 'Hạn nộp', 'Còn lại'],
            rows.map(function (r) {
              var dl = r.ngay_het_han || '';
              var daysLeft = dl ? Math.round((new Date(dl).getTime() - new Date(today).getTime()) / 86400000) : null;
              var rowBg = '', badge = '';
              if (dl < today) {
                rowBg = 'background:var(--red-lt);';
                badge = '<span class="badge" style="background:var(--red);color:#fff">Đã hết hạn</span>';
              } else if (dl === today) {
                rowBg = 'background:#fff7ed;';
                badge = '<span class="badge" style="background:#d97706;color:#fff">Hôm nay</span>';
              } else if (daysLeft !== null && daysLeft <= 3) {
                rowBg = 'background:#fffbeb;';
                badge = '<span class="badge" style="background:#f59e0b;color:#fff">Còn ' + daysLeft + ' ngày</span>';
              } else {
                badge = '<span style="color:var(--text-muted)">Còn ' + (daysLeft !== null ? daysLeft : '?') + ' ngày</span>';
              }
              return '<tr style="' + rowBg + 'cursor:pointer" onclick="DashboardModule._navToRfq(\'' + API.esc(r.rfq_id) + '\')">'
                + '<td><strong class="link-edit">' + API.esc(r.ma_goi_tbmt || r.rfq_id) + '</strong></td>'
                + '<td>' + API.esc(r.ten_goi) + '</td>'
                + '<td style="color:var(--text-muted)">' + API.esc(r.cdt_label || '') + '</td>'
                + '<td style="white-space:nowrap">' + API.esc(dl) + '</td>'
                + '<td style="white-space:nowrap">' + badge + '</td>'
                + '</tr>';
            }).join('')
          )
        : empty('Không có RFQ đang khảo giá nào có deadline.')
    );
  }

  // ── "RFQ vừa trúng" ───────────────────────────────────────────────────────

  function panelWonRfqs(rfq) {
    var rows = rfq.won_list || [];
    return panel('RFQ vừa trúng',
      rows.length
        ? miniTable(
            ['Mã gói', 'Tên gói', 'Giá trị (dự toán)', 'Số dòng VT', 'Cập nhật'],
            rows.map(function (r) {
              var upd = (r.updated_at || '').slice(0, 10);
              return '<tr style="cursor:pointer" onclick="DashboardModule._navToRfq(\'' + API.esc(r.rfq_id) + '\')">'
                + '<td><strong class="link-edit">' + API.esc(r.ma_goi_tbmt || r.rfq_id) + '</strong></td>'
                + '<td>' + API.esc(r.ten_goi) + '</td>'
                + '<td class="num">' + (r.du_toan ? fmtMoney(r.du_toan) : '<span style="color:var(--text-faint)">—</span>') + '</td>'
                + '<td class="num">' + (r.item_count || 0) + '</td>'
                + '<td style="color:var(--text-muted);white-space:nowrap">' + API.esc(upd) + '</td>'
                + '</tr>';
            }).join('')
          )
        : empty('Chưa có RFQ trúng nào.')
    );
  }

  // ── "Vật tư vừa làm rõ" ──────────────────────────────────────────────────

  function panelClarifications(clar) {
    var rows = clar.latest30 || [];
    return panel('Vật tư vừa làm rõ (30 dòng gần nhất)',
      rows.length
        ? miniTable(
            ['Thời gian', 'Vật tư', 'Tên gói', 'Loại', 'Trạng thái', 'Tóm tắt'],
            rows.map(function (r) {
              var summary = r.proposed_model || r.proposed_manufacturer || r.proposed_origin || r.title || '—';
              var time = (r.created_at || '').slice(0, 16).replace('T', ' ');
              return '<tr style="cursor:pointer" onclick="DashboardModule._navToItem(\'' + API.esc(r.rfq_item_id) + '\')">'
                + '<td style="white-space:nowrap;color:var(--text-muted)">' + API.esc(time) + '</td>'
                + '<td>' + API.esc(r.ten_vat_tu || r.rfq_item_id)
                  + (r.ma_vat_tu ? '<br><small style="color:var(--text-faint)">' + API.esc(r.ma_vat_tu) + '</small>' : '') + '</td>'
                + '<td>' + API.esc(r.ten_goi || r.rfq_id || '') + '</td>'
                + '<td><span class="badge">' + API.esc(clarTypeLabel(r.clarification_type)) + '</span></td>'
                + '<td><span class="badge">' + API.esc(clarStatusLabel(r.status_after)) + '</span></td>'
                + '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
                  + API.esc(summary) + '</td>'
                + '</tr>';
            }).join('')
          )
        : empty('Chưa có clarification nào.')
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

  function panel(title, bodyHtml) {
    return '<section class="panel"><h3>' + API.esc(title) + '</h3>' + bodyHtml + '</section>';
  }

  function miniTable(headers, bodyRows) {
    var thead = '<thead><tr>'
      + headers.map(function (h) { return '<th>' + API.esc(h) + '</th>'; }).join('')
      + '</tr></thead>';
    return '<div class="table-wrap dashboard-table-wrap" style="margin-top:6px">'
      + '<table class="quotes-mini-table">' + thead + '<tbody>' + bodyRows + '</tbody></table>'
      + '</div>';
  }

  function empty(text) {
    return '<div class="empty-state small">' + API.esc(text) + '</div>';
  }

  function fmtMoney(value) {
    return Number(value || 0).toLocaleString('vi-VN');
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

  window.DashboardModule = {
    load:          load,
    openNsxStats:  openNsxStats,
    _navToRfq:     navToRfq,
    _navToTask:    navToTask,
    _navToItem:    navToItem,
  };
})();
