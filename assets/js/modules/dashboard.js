(function () {
  async function load() {
    try {
      var data = await API.get('getDashboard', {});
      var s = data.summary || {};
      document.getElementById('dashboardStats').innerHTML = [
        stat('RFQ', s.rfqs),
        stat('Dong vat tu', s.items),
        stat('Nha cung cap', s.suppliers),
        stat('RFQ dang mo', s.openRfqs),
      ].join('');
    } catch (err) { API.error(err); }
  }

  function stat(label, value) {
    return '<div class="metric"><span>' + API.esc(label) + '</span><strong>' + API.esc(value || 0) + '</strong></div>';
  }

  window.DashboardModule = { load: load };
})();
