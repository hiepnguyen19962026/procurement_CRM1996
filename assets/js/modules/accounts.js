(function () {
  var state = AppState.list('accounts');
  async function load(reset) {
    if (reset) state.cursor = '';
    try {
      var data = await API.get('getAccounts', { cursor: state.cursor, limit: 50 });
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  function render() {
    document.getElementById('accountRows').innerHTML = (state.rows || []).map(function (r) {
      return '<tr><td>' + API.esc(r.user_id) + '</td><td>' + API.esc(r.username) + '</td><td>' + API.esc(r.display_name) + '</td><td>' + API.esc(r.role) + '</td><td>' + API.esc(r.status) + '</td><td><button onclick="AccountsModule.openEdit(\'' + API.esc(r.user_id) + '\')">Sua</button></td></tr>';
    }).join('');
    document.getElementById('accountMore').classList.toggle('hidden', !state.hasMore);
  }
  function openCreate() { openForm({}); }
  function openEdit(id) { openForm((state.rows || []).find(function (r) { return r.user_id === id; }) || {}); }
  function openForm(r) {
    Utils.openModal(r.user_id ? 'Sua tai khoan' : 'Them tai khoan', fields(r), async function (data) {
      try {
        if (r.user_id) data.userId = r.user_id;
        await API.call(r.user_id ? 'updateAccount' : 'createAccount', data);
        Utils.closeModal();
        API.toast('Da luu tai khoan', 'success');
        await load(true);
      } catch (err) { API.error(err); }
    });
  }
  function fields(r) {
    return '<label>Username<input name="username" ' + (r.user_id ? 'disabled' : 'required') + ' value="' + API.esc(r.username) + '"></label><label>Ten hien thi<input name="displayName" required value="' + API.esc(r.display_name) + '"></label><label>Mat khau moi<input name="password" type="password" ' + (r.user_id ? '' : 'required') + '></label><label>Role<select name="role"><option value="viewer">viewer</option><option value="purchasing">purchasing</option><option value="manager">manager</option><option value="admin">admin</option></select></label><label>Status<select name="status"><option value="active">active</option><option value="inactive">inactive</option><option value="frozen">frozen</option><option value="archived">archived</option></select></label><label class="check"><input type="checkbox" name="forceLogout" value="1"> Force logout</label>';
  }
  window.AccountsModule = { load: load, openCreate: openCreate, openEdit: openEdit };
})();
