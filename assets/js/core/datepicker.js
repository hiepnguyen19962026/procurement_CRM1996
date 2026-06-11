(function () {
  var MONTHS = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
  var DOW = ['CN','T2','T3','T4','T5','T6','T7'];
  var _uid = 0;

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function parseIso(str) {
    if (!str) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str));
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }

  function toIso(d) {
    return d ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) : '';
  }

  function toDisplay(d) {
    return d ? pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() : '';
  }

  function todayIso() {
    var now = new Date();
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  }

  function buildGrid(year, month, selectedIso) {
    var todIso = todayIso();
    var firstDow = new Date(year, month, 1).getDay();
    var lastDay = new Date(year, month + 1, 0).getDate();

    var html = '<div class="dp-head">'
      + '<button type="button" class="dp-nav" data-dir="-1">&#8249;</button>'
      + '<span class="dp-label">' + MONTHS[month] + ' ' + year + '</span>'
      + '<button type="button" class="dp-nav" data-dir="1">&#8250;</button>'
      + '</div><div class="dp-grid">';

    DOW.forEach(function (d) { html += '<div class="dp-dow">' + d + '</div>'; });
    for (var i = 0; i < firstDow; i++) html += '<div></div>';
    for (var day = 1; day <= lastDay; day++) {
      var iso = year + '-' + pad2(month + 1) + '-' + pad2(day);
      var cls = 'dp-day'
        + (iso === selectedIso ? ' dp-sel' : '')
        + (iso === todIso ? ' dp-today' : '');
      html += '<button type="button" class="' + cls + '" data-v="' + iso + '">' + day + '</button>';
    }
    html += '</div>';
    return html;
  }

  function attachOne(inp) {
    if (inp._dpReady) return;
    inp._dpReady = true;

    var initIso = inp.value || '';
    var sel = parseIso(initIso);
    var now = new Date();
    var view = { y: sel ? sel.getFullYear() : now.getFullYear(), m: sel ? sel.getMonth() : now.getMonth() };

    var wrap = document.createElement('div');
    wrap.className = 'dp-wrap';

    // Hidden field carries the canonical YYYY-MM-DD value for form submission
    var hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = inp.name;
    hidden.value = initIso;

    // Editable text input — user can type or click to open the calendar
    var textInp = document.createElement('input');
    textInp.type = 'text';
    textInp.className = 'dp-trigger';
    textInp.placeholder = inp.placeholder || 'DD/MM/YYYY';
    textInp.autocomplete = 'off';
    textInp.value = sel ? toDisplay(sel) : '';
    if (inp.required) textInp.required = true;

    var cal = document.createElement('div');
    cal.className = 'dp-cal dp-hidden';
    cal.id = 'dp-' + (++_uid);

    function setDate(iso) {
      hidden.value = iso;
      var d = parseIso(iso);
      textInp.value = d ? toDisplay(d) : '';
    }

    function renderCal() {
      cal.innerHTML = buildGrid(view.y, view.m, hidden.value);
      cal.querySelectorAll('.dp-nav').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          view.m += +btn.getAttribute('data-dir');
          if (view.m < 0) { view.m = 11; view.y--; }
          if (view.m > 11) { view.m = 0; view.y++; }
          renderCal();
        });
      });
      cal.querySelectorAll('.dp-day').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          setDate(btn.getAttribute('data-v'));
          closeCal();
        });
      });
    }

    function openCal() {
      document.querySelectorAll('.dp-cal:not(.dp-hidden)').forEach(function (c) { c.classList.add('dp-hidden'); });
      // Sync calendar view to currently selected date when opening
      var cur = parseIso(hidden.value);
      if (cur) { view.y = cur.getFullYear(); view.m = cur.getMonth(); }
      renderCal();
      cal.classList.remove('dp-hidden');
    }

    function closeCal() { cal.classList.add('dp-hidden'); }

    function parseTyped(raw) {
      // Accept YYYY-MM-DD
      var d = parseIso(raw.trim());
      if (d) return d;
      // Accept DD/MM/YYYY
      var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
      if (m) {
        d = new Date(+m[3], +m[2] - 1, +m[1]);
        return (!isNaN(d.getTime())) ? d : null;
      }
      return null;
    }

    // Prevent blur when the user clicks inside the calendar (mousedown fires before blur)
    cal.addEventListener('mousedown', function (e) { e.preventDefault(); });

    // Open calendar when input receives focus
    textInp.addEventListener('focus', function () { openCal(); });

    // Parse whatever the user typed when focus leaves
    textInp.addEventListener('blur', function () {
      var raw = textInp.value.trim();
      if (!raw) { hidden.value = ''; closeCal(); return; }
      var d = parseTyped(raw);
      if (d) {
        var iso = toIso(d);
        hidden.value = iso;
        textInp.value = toDisplay(d);
        view.y = d.getFullYear();
        view.m = d.getMonth();
      } else {
        // Invalid input — restore the last valid value
        textInp.value = hidden.value ? toDisplay(parseIso(hidden.value)) : '';
      }
      closeCal();
    });

    // capture-phase outside-click to close
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) closeCal();
    }, true);

    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(hidden);
    wrap.appendChild(textInp);
    wrap.appendChild(cal);
    inp.remove();
  }

  function init(scope) {
    (scope || document).querySelectorAll('input[type="date"]').forEach(attachOne);
  }

  window.Datepicker = { init: init };
  window.DatePicker = window.Datepicker; // capital-P alias for diagnostic checks
})();
