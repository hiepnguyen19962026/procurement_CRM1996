(function () {
  async function load() {
    try {
      var data = await API.get('getDashboard', {});
      var s = data.summary || {};
      document.getElementById('dashboardStats').innerHTML = [
        stat('▣', 'Gói thầu (RFQ)', s.rfqs),
        stat('◇', 'Dòng vật tư', s.items),
        stat('◌', 'Nhà cung cấp', s.suppliers),
        stat('□', 'RFQ đang mở', s.openRfqs),
      ].join('');
    } catch (err) { API.error(err); }
  }

  function stat(icon, label, value) {
    return '<div class="metric"><span class="metric-icon">' + API.esc(icon) + '</span><div><span>' + API.esc(label) + '</span><strong>' + API.esc(value || 0) + '</strong><small>Dữ liệu hiện tại</small></div></div>';
  }

  window.DashboardModule = { load: load };
})();
