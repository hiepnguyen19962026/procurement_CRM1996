(function () {
  var _cursor = null;
  var _hasMore = false;

  function init() {}

  function getFilters() {
    return {
      q:              (document.getElementById('sqSearch')       || {}).value || '',
      supplierName:   (document.getElementById('sqSupplier')     || {}).value || '',
      manufacturer:   (document.getElementById('sqManufacturer') || {}).value || '',
      status:         (document.getElementById('sqStatus')       || {}).value || '',
      sourceChannel:  (document.getElementById('sqSourceChannel') || {}).value || '',
      priceMin:       (document.getElementById('sqPriceMin')     || {}).value || '',
      priceMax:       (document.getElementById('sqPriceMax')     || {}).value || '',
      validUntilFrom: (document.getElementById('sqValidFrom')    || {}).value || '',
      validUntilTo:   (document.getElementById('sqValidTo')      || {}).value || '',
    };
  }

  function search() {
    load(true);
  }

  function reset() {
    ['sqSearch', 'sqSupplier', 'sqManufacturer', 'sqPriceMin', 'sqPriceMax', 'sqValidFrom', 'sqValidTo'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var statusEl = document.getElementById('sqStatus');
    if (statusEl) statusEl.value = '';
    var sourceEl = document.getElementById('sqSourceChannel');
    if (sourceEl) sourceEl.value = '';
    load(true);
  }

  function loadMore() {
    if (_hasMore) load(false);
  }

  async function load(isFirstPage) {
    if (isFirstPage) _cursor = null;

    var filters = getFilters();
    var params = { limit: 50 };
    if (filters.q)              params.q              = filters.q;
    if (filters.supplierName)   params.supplierName   = filters.supplierName;
    if (filters.manufacturer)   params.manufacturer   = filters.manufacturer;
    if (filters.status)         params.status         = filters.status;
    if (filters.sourceChannel)  params.sourceChannel  = filters.sourceChannel;
    if (filters.priceMin)       params.priceMin       = filters.priceMin;
    if (filters.priceMax)       params.priceMax       = filters.priceMax;
    if (filters.validUntilFrom) params.validUntilFrom = filters.validUntilFrom;
    if (filters.validUntilTo)   params.validUntilTo   = filters.validUntilTo;
    if (_cursor)                params.cursor         = _cursor;

    try {
      var data = await API.get('searchSupplierQuotes', params);
      _hasMore = !!data.hasMore;
      _cursor  = data.nextCursor || null;

      var tbody = document.getElementById('sqRows');
      if (!tbody) return;

      if (isFirstPage) tbody.innerHTML = '';

      if (!data.rows || data.rows.length === 0) {
        if (isFirstPage) tbody.innerHTML = '<tr><td colspan="11" class="empty-state">Không có báo giá nào phù hợp.</td></tr>';
        document.getElementById('sqMore').classList.add('hidden');
        return;
      }

      data.rows.forEach(function (r) {
        tbody.insertAdjacentHTML('beforeend', renderRow(r));
      });

      var moreBtn = document.getElementById('sqMore');
      if (_hasMore) moreBtn.classList.remove('hidden');
      else moreBtn.classList.add('hidden');
    } catch (err) {
      API.error(err);
    }
  }

  function renderRow(r) {
    var priceText = r.price_vnd_incl_tax
      ? API.money(r.price_vnd_incl_tax) + ' ₫'
      : '<span style="color:var(--text-faint)">—</span>';
    var statusBadge = r.status === 'active'
      ? '<span class="badge badge-green">Active</span>'
      : '<span class="badge badge-gray">Archived</span>';
    var rfqCell = API.esc(r.ma_goi_tbmt || '')
      + (r.ten_goi ? '<br><small style="color:var(--text-muted)">' + API.esc(r.ten_goi) + '</small>' : '');
    var itemCell = API.esc(r.ma_vat_tu || '')
      + (r.ten_vat_tu ? '<br><small style="color:var(--text-muted)">' + API.esc(r.ten_vat_tu) + '</small>' : '');
    var supplierCell = API.esc(r.supplier_name || '')
      + (quoteSourceText(r) ? '<br><small style="color:var(--text-muted)">' + API.esc(quoteSourceText(r)) + '</small>' : '')
      + (r.received_at ? '<br><small style="color:var(--text-muted)">Nhận: ' + API.esc(r.received_at) + '</small>' : '');

    return '<tr>' +
      '<td>' + rfqCell + '</td>' +
      '<td>' + itemCell + '</td>' +
      '<td>' + API.esc(r.required_model_display || '') + '</td>' +
      '<td>' + supplierCell + '</td>' +
      '<td>' + API.esc(r.manufacturer || '') + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' + priceText + '</td>' +
      '<td>' + API.esc(r.lead_time || '') + '</td>' +
      '<td style="white-space:nowrap">' + API.esc(r.valid_until || '') + '</td>' +
      '<td>' + API.esc(r.warranty || '') + '</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td><button onclick="SupplierQuotesModule.openItem(\'' + r.rfq_item_id + '\')">Xem vật tư</button></td>' +
      '</tr>';
  }

  function quoteSourceText(r) {
    var channel = sourceChannelLabel(r.source_channel);
    var ref = r.source_ref || '';
    return [channel, ref].filter(Boolean).join(' - ');
  }

  function sourceChannelLabel(value) {
    return {
      zalo: 'Zalo',
      wechat: 'WeChat',
      email: 'Email',
      phone: 'Phone',
      direct: 'Direct',
      other: 'Other',
    }[value] || '';
  }

  function openItem(rfqItemId) {
    if (typeof RfqItemsModule !== 'undefined' && typeof RfqItemsModule.openEdit === 'function') {
      RfqItemsModule.openEdit(rfqItemId);
    }
  }

  window.SupplierQuotesModule = { init: init, load: load, search: search, reset: reset, loadMore: loadMore, openItem: openItem };
})();
