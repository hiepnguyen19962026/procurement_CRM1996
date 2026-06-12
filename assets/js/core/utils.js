(function () {
  function formToObject(form) {
    var data = {};
    new FormData(form).forEach(function (value, key) {
      data[key] = value;
    });
    return data;
  }

  function openModal(title, bodyHtml, onSubmit) {
    var modal = document.getElementById('modal');
    // remove import-wide modifier so it does not leak to other modals
    var _innerModal = document.querySelector('#modal .modal');
    if (_innerModal) _innerModal.classList.remove('modal--import-wide');
    document.getElementById('modalTitle').textContent = title;
    var _mb = document.getElementById('modalBody');
    _mb.className = 'modal-body form-grid-12';
    _mb.innerHTML = bodyHtml;
    modal.classList.remove('hidden');
    modal._onSubmit = onSubmit;
    var submitBtn = document.getElementById('modalSubmit');
    if (submitBtn) submitBtn.classList.toggle('hidden', !onSubmit);
    setTimeout(function () {
      var body = document.getElementById('modalBody');
      if (typeof Datepicker !== 'undefined') Datepicker.init(body);
      var first = modal.querySelector('input:not([type="hidden"]),select,textarea');
      if (first) first.focus();
    }, 0);
  }

  function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modalBody').innerHTML = '';
  }

  function bindModal() {
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalCancel').addEventListener('click', closeModal);
    // Intentionally no backdrop-click or ESC close — users lose form data on accidental click.
    document.getElementById('modalForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var fn = document.getElementById('modal')._onSubmit;
      if (fn) await fn(formToObject(e.currentTarget));
    });
  }

  function roleCanWrite() {
    var role = AppState.get('user') && AppState.get('user').role;
    return ['admin', 'manager', 'purchasing'].indexOf(role) >= 0;
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Styled in-app confirm for destructive/archive actions. Returns Promise<boolean>.
  // Clicking outside and ESC intentionally do nothing — match main modal policy.
  function confirmDanger(title, message, confirmLabel, cancelLabel) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = '<div class="confirm-box">'
        + '<div class="confirm-title">' + _esc(title) + '</div>'
        + '<p class="confirm-desc">' + _esc(message) + '</p>'
        + '<div class="confirm-actions">'
        + '<button type="button" class="btn-cancel">' + _esc(cancelLabel || 'Hủy') + '</button>'
        + '<button type="button" class="btn-danger">' + _esc(confirmLabel || 'Xác nhận') + '</button>'
        + '</div></div>';
      document.body.appendChild(overlay);
      function done(result) { document.body.removeChild(overlay); resolve(result); }
      overlay.querySelector('.btn-danger').onclick = function () { done(true); };
      overlay.querySelector('.btn-cancel').onclick  = function () { done(false); };
    });
  }

  // Destructive confirm that requires the user to type a specific phrase before the action button activates.
  function confirmTyping(title, message, requiredText) {
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = '<div class="confirm-box">'
        + '<div class="confirm-title">' + _esc(title) + '</div>'
        + '<p class="confirm-desc">' + _esc(message) + '</p>'
        + '<input type="text" class="confirm-input" placeholder="' + _esc(requiredText) + '" autocomplete="off">'
        + '<div class="confirm-actions">'
        + '<button type="button" class="btn-cancel">Hủy</button>'
        + '<button type="button" class="btn-danger" disabled>Xóa vĩnh viễn</button>'
        + '</div></div>';
      document.body.appendChild(overlay);
      function done(result) { document.body.removeChild(overlay); resolve(result); }
      var inp = overlay.querySelector('.confirm-input');
      var btn = overlay.querySelector('.btn-danger');
      inp.oninput = function () { btn.disabled = inp.value !== requiredText; };
      btn.onclick = function () { done(true); };
      overlay.querySelector('.btn-cancel').onclick = function () { done(false); };
      setTimeout(function () { inp.focus(); }, 0);
    });
  }

  window.Utils = { formToObject: formToObject, openModal: openModal, closeModal: closeModal, bindModal: bindModal, roleCanWrite: roleCanWrite, confirmDanger: confirmDanger, confirmTyping: confirmTyping };
})();
