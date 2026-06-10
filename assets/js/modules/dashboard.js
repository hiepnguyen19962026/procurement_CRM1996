(function () {
  async function load() {
    try {
      var data = await API.get('getDashboardV2', {});
      var d = data.data || {};
      renderStats(d);
      renderPanels(d);
    } catch (err) { API.error(err); }
  }

  // ── Metric cards ──────────────────────────────────────────────────────────

  function renderStats(d) {
    var rfq       = d.rfq            || {};
    var items     = d.items          || {};
    var contracts = d.contracts      || {};
    var clar      = d.clarifications || {};
    var quotes    = d.quotes         || {};

    var openExtra = rfq.overdue > 0
      ? ' <span style="color:var(--red);font-size:12px;font-weight:normal">(' + rfq.overdue + ' quá hạn)</span>'
      : rfq.due_soon > 0
      ? ' <span style="color:#d97706;font-size:12px;font-weight:normal">(' + rfq.due_soon + ' sắp hết hạn)</span>'
      : '';

    var clarExtra = clar.pending > 0
      ? ' <span style="color:#d97706;font-size:12px;font-weight:normal">cần xử lý</span>'
      : '';

    document.getElementById('dashboardStats').innerHTML = [
      stat('□', 'RFQ đang mở',
        rfq.open + openExtra,
        rfq.total + ' tổng số gói'),
      stat('◇', 'Dòng vật tư chưa có báo giá',
        items.without_quotes,
        items.total + ' tổng dòng · ' + items.quote_coverage_pct + '% đã có báo giá'),
      stat('◈', 'Hợp đồng đang hiệu lực',
        contracts.active,
        fmtMoney(contracts.total_value_active) + ' VND tổng giá trị'),
      stat('≋', 'Clarification đang chờ',
        clar.pending + clarExtra,
        quotes.last_7_days + ' báo giá mới (7 ngày)'),
    ].join('');
  }

  function stat(icon, label, valueHtml, subText) {
    return '<div class="metric">'
      + '<span class="metric-icon">' + API.esc(icon) + '</span>'
      + '<div>'
      + '<span>' + API.esc(label) + '</span>'
      + '<strong>' + valueHtml + '</strong>'
      + '<small>' + API.esc(subText || '') + '</small>'
      + '</div></div>';
  }

  // ── Dashboard panels ──────────────────────────────────────────────────────

  function renderPanels(d) {
    document.getElementById('dashboardPanels').innerHTML =
      panelRecentRfqs(d.rfq || {})
      + panelTopSuppliers(d.quotes || {})
      + panelCoverage(d.items || {}, d.quotes || {})
      + panelImports(d.imports || {})
      + panelContracts(d.contracts || {})
      + panelMasterItems(d.master_items || {});
  }

  function panelRecentRfqs(rfq) {
    var rows = rfq.newest || [];
    return panel('RFQ gần đây',
      rows.length
        ? miniTable(
            ['Mã gói', 'Tên gói', 'Trạng thái', 'Hạn nộp'],
            rows.map(function (r) {
              var deadline = r.ngay_het_han || '';
              var isOverdue = deadline && deadline < new Date().toISOString().slice(0, 10);
              return '<tr>'
                + '<td>' + API.esc(r.ma_goi_tbmt || r.rfq_id) + '</td>'
                + '<td>' + API.esc(r.ten_goi) + '</td>'
                + '<td><span class="badge">' + API.esc(rfqStatusLabel(r.trang_thai_goi)) + '</span></td>'
                + '<td' + (isOverdue ? ' style="color:var(--red)"' : '') + '>'
                  + API.esc(deadline) + '</td>'
                + '</tr>';
            }).join('')
          )
        : empty('Chưa có RFQ nào.')
    );
  }

  function panelTopSuppliers(quotes) {
    var top     = quotes.top_suppliers || [];
    var byChannel = quotes.by_channel  || [];
    var channelHtml = byChannel.length
      ? '<p style="font-size:12px;color:var(--text-muted);margin:10px 0 4px">Theo kênh:</p>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px">'
        + byChannel.map(function (c) {
            return '<span class="badge">' + API.esc(channelLabel(c.channel))
              + ' <strong>' + c.cnt + '</strong></span>';
          }).join('')
        + '</div>'
      : '';
    return panel('Top NCC báo giá nhiều nhất',
      (top.length
        ? miniTable(
            ['Nhà cung cấp', 'Số báo giá'],
            top.map(function (r) {
              return '<tr>'
                + '<td>' + API.esc(r.name) + '</td>'
                + '<td class="num">' + r.cnt + '</td>'
                + '</tr>';
            }).join('')
          )
        : empty('Chưa có báo giá.'))
      + channelHtml
    );
  }

  function panelCoverage(items, quotes) {
    return panel('Độ phủ báo giá & master item',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px">'
      + coverageStat('Có báo giá', items.with_quotes, items.total, items.quote_coverage_pct)
      + coverageStat('Liên kết master', items.with_master_link, items.total, items.master_link_pct)
      + '</div>'
      + '<p style="font-size:12px;color:var(--text-muted);margin:0">'
      + '7 ngày qua: <strong>' + (quotes.last_7_days || 0) + '</strong> báo giá mới'
      + ' · 30 ngày: <strong>' + (quotes.last_30_days || 0) + '</strong>'
      + ' · Tổng active: <strong>' + (quotes.total || 0) + '</strong>'
      + '</p>'
    );
  }

  function coverageStat(label, count, total, pct) {
    return '<div>'
      + '<p style="font-size:12px;color:var(--text-muted);margin:0 0 2px">' + API.esc(label) + '</p>'
      + '<p style="font-size:22px;font-weight:700;margin:0;line-height:1.2">' + (count || 0)
      + '<span style="font-size:13px;font-weight:400;color:var(--text-muted)">'
      + '&nbsp;/ ' + (total || 0) + ' (' + (pct || 0) + '%)</span></p>'
      + '</div>';
  }

  function panelImports(imports) {
    var jobs     = imports.latest_jobs              || [];
    var errCount = imports.error_count_last_30_days || 0;
    var errBanner = errCount > 0
      ? '<p style="color:var(--red);font-size:13px;font-weight:600;margin:0 0 8px">'
        + '⚠ ' + errCount + ' lỗi import trong 30 ngày qua</p>'
      : '<p style="color:var(--green);font-size:13px;margin:0 0 8px">'
        + 'Không có lỗi import trong 30 ngày qua</p>';
    return panel('Import gần đây',
      errBanner
      + (jobs.length
          ? miniTable(
              ['File', 'RFQ', 'Tạo', 'Cập nhật', 'Lỗi'],
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
              }).join('')
            )
          : empty('Chưa có job import.'))
    );
  }

  function panelContracts(contracts) {
    var rows = contracts.latest || [];
    var summary = '<p style="font-size:12px;color:var(--text-muted);margin:0 0 8px">'
      + '<strong>' + (contracts.active || 0) + '</strong> HĐ đang hiệu lực'
      + ' · <strong>' + (contracts.last_30_days || 0) + '</strong> trong 30 ngày'
      + ' · Tổng: <strong>' + fmtMoney(contracts.total_value_active) + '</strong> VND'
      + '</p>';
    return panel('Hợp đồng gần đây',
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
          : empty('Chưa có hợp đồng nào.'))
    );
  }

  function panelMasterItems(masterItems) {
    var rows = masterItems.top_by_quote_count || [];
    return panel('Master item được hỏi giá nhiều nhất',
      rows.length
        ? miniTable(
            ['Mã VT', 'Tên vật tư', 'Số BG'],
            rows.map(function (r) {
              return '<tr>'
                + '<td>' + API.esc(r.ma_vat_tu || '-') + '</td>'
                + '<td>' + API.esc(r.ten_vat_tu) + '</td>'
                + '<td class="num">' + r.quote_count + '</td>'
                + '</tr>';
            }).join('')
          )
        : empty('Chưa có dữ liệu master item.')
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function panel(title, bodyHtml) {
    return '<section class="panel"><h3>' + API.esc(title) + '</h3>' + bodyHtml + '</section>';
  }

  function miniTable(headers, bodyRows) {
    var thead = '<thead><tr>'
      + headers.map(function (h) { return '<th>' + API.esc(h) + '</th>'; }).join('')
      + '</tr></thead>';
    return '<div class="table-wrap" style="margin-top:6px">'
      + '<table class="quotes-mini-table">' + thead + '<tbody>' + bodyRows + '</tbody></table>'
      + '</div>';
  }

  function empty(text) {
    return '<div class="empty-state small">' + API.esc(text) + '</div>';
  }

  function fmtMoney(value) {
    var n = Number(value || 0);
    return n.toLocaleString('vi-VN');
  }

  function rfqStatusLabel(value) {
    return {
      dang_khao_gia: 'Đang khảo giá',
      da_bao:        'Đã báo',
      trung:         'Trúng',
      khong_trung:   'Không trúng',
      treo:          'Treo',
    }[value] || value || '';
  }

  function channelLabel(value) {
    return {
      zalo:    'Zalo',
      wechat:  'WeChat',
      email:   'Email',
      phone:   'Phone',
      direct:  'Direct',
      other:   'Other',
      unknown: 'Không rõ',
    }[value] || value || 'Không rõ';
  }

  window.DashboardModule = { load: load };
})();
