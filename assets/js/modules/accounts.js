(function () {
  var state = AppState.list('accounts');
  var sort = { by: '', dir: 'asc' };

  function syncSort() {
    var def = 'username';
    document.querySelectorAll('#screen-accounts th[data-sort-key]').forEach(function (th) {
      var key = th.getAttribute('data-sort-key');
      if (!th.getAttribute('data-label')) th.setAttribute('data-label', th.textContent.trim());
      var label = th.getAttribute('data-label');
      var active = (sort.by || def) === key;
      th.textContent = label + (active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕');
      th.onclick = function () {
        var cur = sort.by || def;
        if (cur === key) { sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'; }
        else { sort.by = key; sort.dir = 'asc'; }
        load(true);
      };
    });
  }

  async function load(reset) {
    if (reset) state.cursor = '';
    try {
      var params = { cursor: state.cursor, limit: 50 };
      if (sort.by) { params.sortBy = sort.by; params.sortDir = sort.dir; }
      var data = await API.get('getAccounts', params);
      state.rows = reset ? data.rows : state.rows.concat(data.rows || []);
      state.cursor = data.nextCursor || '';
      state.hasMore = !!data.hasMore;
      render();
    } catch (err) { API.error(err); }
  }
  function render() {
    syncSort();
    document.getElementById('accountRows').innerHTML = (state.rows || []).map(function (r) {
      return '<tr>'
        + '<td>' + API.esc(maskId(r.user_id)) + '</td>'
        + '<td>' + API.esc(r.username) + '</td>'
        + '<td><span class="link-edit" onclick="AccountsModule.openEdit(\'' + API.esc(r.user_id) + '\')">' + API.esc(r.display_name) + '</span></td>'
        + '<td>' + API.esc(roleLabel(r.role)) + '</td>'
        + '<td>' + API.esc(statusLabel(r.status)) + '</td>'
        + '</tr>';
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
    var role = r.role || 'viewer';
    var status = r.status || 'active';
    // Row 1: username(4) + displayName(4) + password(4) = 12
    // Row 2: vai trò(3) + trạng thái(3) = 6
    return '<label class="span-4">Tài khoản<input name="username" ' + (r.user_id ? 'disabled' : 'required') + ' value="' + API.esc(r.username) + '"></label>'
      + '<label class="span-4">Tên hiển thị<input name="displayName" required value="' + API.esc(r.display_name) + '"></label>'
      + '<label class="span-4">Mật khẩu mới<input name="password" type="password" ' + (r.user_id ? '' : 'required') + '></label>'
      + '<label class="span-3">Vai trò<select name="role">'
      + '<option value="viewer"' + (role === 'viewer' ? ' selected' : '') + '>Viewer</option>'
      + '<option value="purchasing"' + (role === 'purchasing' ? ' selected' : '') + '>Purchasing</option>'
      + '<option value="manager"' + (role === 'manager' ? ' selected' : '') + '>Manager</option>'
      + '<option value="admin"' + (role === 'admin' ? ' selected' : '') + '>Admin</option>'
      + '</select></label>'
      + '<label class="span-3">Trạng thái<select name="status">'
      + '<option value="active"' + (status === 'active' ? ' selected' : '') + '>Hoạt động</option>'
      + '<option value="inactive"' + (status === 'inactive' ? ' selected' : '') + '>Không hoạt động</option>'
      + '<option value="frozen"' + (status === 'frozen' ? ' selected' : '') + '>Tạm khóa</option>'
      + '<option value="archived"' + (status === 'archived' ? ' selected' : '') + '>Lưu trữ</option>'
      + '</select></label>'
      + '<label class="check"><input type="checkbox" name="forceLogout" value="1"> Buộc đăng xuất</label>';
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
