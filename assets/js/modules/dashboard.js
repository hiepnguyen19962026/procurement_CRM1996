(function () {
  async function load() {
    try {
      var data = await API.get('getDashboard', {});
      var s = data.summary || {};
      document.getElementById('dashboardStats').innerHTML = [
        stat('RFQ', s.rfqs),
        stat('Dòng vật tư', s.items),
        stat('Nhà cung cấp', s.suppliers),
        stat('RFQ đang mở', s.openRfqs),
      ].join('');
    } catch (err) { API.error(err); }
  }

  function stat(label, value) {
    return '<div class="metric"><span>' + API.esc(label) + '</span><strong>' + API.esc(value || 0) + '</strong></div>';
  }

  window.DashboardModule = { load: load };
})();
