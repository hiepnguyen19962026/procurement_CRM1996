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
      return '<tr><td>' + API.esc(maskId(r.user_id)) + '</td><td>' + API.esc(r.username) + '</td><td>' + API.esc(r.display_name) + '</td><td>' + API.esc(roleLabel(r.role)) + '</td><td>' + API.esc(statusLabel(r.status)) + '</td><td><button onclick="AccountsModule.openEdit(\'' + API.esc(r.user_id) + '\')">Sửa</button></td></tr>';
    }).join('');
    document.getElementById('accountMore').classList.toggle('hidden', !state.hasMore);
  }
  function openCreate() { openForm({}); }
  function openEdit(id) { openForm((state.rows || []).find(function (r) { return r.user_id === id; }) || {}); }
  function openForm(r) {
    Utils.openModal(r.user_id ? 'Sửa tài khoản' : 'Thêm tài khoản', fields(r), async function (data) {
      try {
        if (r.user_id) data.userId = r.user_id;
        await API.call(r.user_id ? 'updateAccount' : 'createAccount', data);
        Utils.closeModal();
        API.toast('Đã lưu tài khoản', 'success');
        await load(true);
      } catch (err) { API.error(err); }
    });
  }
  function fields(r) {
    return '<label>Tài khoản<input name="username" ' + (r.user_id ? 'disabled' : 'required') + ' value="' + API.esc(r.username) + '"></label><label>Tên hiển thị<input name="displayName" required value="' + API.esc(r.display_name) + '"></label><label>Mật khẩu mới<input name="password" type="password" ' + (r.user_id ? '' : 'required') + '></label><label>Vai trò<select name="role"><option value="viewer">Viewer</option><option value="purchasing">Purchasing</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label><label>Trạng thái<select name="status"><option value="active">Hoạt động</option><option value="inactive">Không hoạt động</option><option value="frozen">Tạm khóa</option><option value="archived">Lưu trữ</option></select></label><label class="check"><input type="checkbox" name="forceLogout" value="1"> Buộc đăng xuất</label>';
  }
  function maskId(id) {
    var value = String(id || '');
    return value ? '***' + value.slice(-4) : '';
  }
  function roleLabel(value) {
    return { admin: 'Admin', manager: 'Manager', purchasing: 'Purchasing', viewer: 'Viewer' }[value] || value || '';
  }
  function statusLabel(value) {
    return { active: 'Hoạt động', inactive: 'Không hoạt động', frozen: 'Tạm khóa', archived: 'Lưu trữ' }[value] || value || '';
  }
  window.AccountsModule = { load: load, openCreate: openCreate, openEdit: openEdit };
})();
