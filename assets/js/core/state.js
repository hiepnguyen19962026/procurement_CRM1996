(function () {
  var state = { user: null, activeScreen: 'dashboard', lists: {} };
  function set(key, value) { state[key] = value; }
  function get(key) { return state[key]; }
  function list(name) {
    state.lists[name] = state.lists[name] || { rows: [], cursor: '', hasMore: false, q: '' };
    return state.lists[name];
  }
  window.AppState = { set: set, get: get, list: list };
})();
