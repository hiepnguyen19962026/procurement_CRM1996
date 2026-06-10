(function () {
  function formToObject(form) {
    var data = {};
    Array.prototype.forEach.call(new FormData(form).entries(), function (pair) {
      data[pair[0]] = pair[1];
    });
    return data;
  }

  function openModal(title, bodyHtml, onSubmit) {
    var modal = document.getElementById('modal');
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
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
    document.getElementById('modal').addEventListener('click', function (e) {
      if (e.target.id === 'modal') closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
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

  window.Utils = { formToObject: formToObject, openModal: openModal, closeModal: closeModal, bindModal: bindModal, roleCanWrite: roleCanWrite };
})();
