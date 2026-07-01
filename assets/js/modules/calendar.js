(function () {
  var state = AppState.list('calendar');
  state.weekStart = state.weekStart || startOfWeek(vnToday());
  state.rows = state.rows || [];
  var _setupDone = false;
  var _drag = null;
  var _suppressClickUntil = 0;

  var DAY_START = 7 * 60;
  var DAY_END = 18 * 60;
  var SLOT = 30;
  var SLOT_HEIGHT = 34;
  var OWNER_COLORS = ['#1d4ed8', '#15803d', '#d97706', '#0d7a5f', '#7c3aed', '#dc2626', '#0369a1', '#b45309'];

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
  }

  function init() { load(true); }

  async function load(reset) {
    setupOnce();
    if (reset) state.rows = [];
    var fromDate = state.weekStart;
    var toDate = addDays(fromDate, 6);
    try {
      var data = await API.get('getCalendarEvents', { fromDate: fromDate, toDate: toDate });
      state.rows = data.rows || [];
      renderGrid();
    } catch (err) {
      API.error(err);
    }
  }

  function renderGrid() {
    var root = document.getElementById('calendarRoot');
    if (!root) return;
    var days = weekDays(state.weekStart);
    root.innerHTML =
      '<div class="calendar-toolbar">' +
        '<button type="button" onclick="CalendarModule.prevWeek()">‹ Tuần trước</button>' +
        '<button type="button" onclick="CalendarModule.today()">Hôm nay</button>' +
        '<button type="button" onclick="CalendarModule.nextWeek()">Tuần sau ›</button>' +
        '<strong>' + fmtDay(days[0]) + ' - ' + fmtDay(days[6]) + '</strong>' +
      '</div>' +
      '<div class="calendar-scroll">' +
        '<div class="calendar-grid">' +
          '<div class="calendar-time-head"></div>' +
          days.map(function (d) {
            return '<div class="calendar-day-head">' + dayName(d) + '<span>' + fmtDay(d) + '</span></div>';
          }).join('') +
          '<div class="calendar-time-col">' + timeSlots().map(function (m) {
            return '<div class="calendar-time-slot">' + timeLabel(m) + '</div>';
          }).join('') + '</div>' +
          days.map(renderDayColumn).join('') +
        '</div>' +
      '</div>';
    Auth.applyRoleUI();
  }

  function renderDayColumn(date) {
    var events = layoutEvents((state.rows || []).filter(function (r) { return r.event_date === date; }));
    var slotHtml = timeSlots().map(function (m) {
      return '<button type="button" class="calendar-slot" data-date="' + API.esc(date) + '" data-minute="' + m + '" onclick="CalendarModule.openCreate(\'' + API.esc(date) + '\',' + m + ')"></button>';
    }).join('');
    var eventHtml = events.map(renderEventBlock).join('');
    return '<div class="calendar-day-col" data-date="' + API.esc(date) + '">' +
      '<div class="calendar-slots">' + slotHtml + '</div>' +
      '<div class="calendar-events-layer">' + eventHtml + '</div>' +
    '</div>';
  }

  function renderEventBlock(ev) {
    var start = Number(ev.start_minutes || 0);
    var end = Number(ev.end_minutes || start + Number(ev.duration_minutes || 30));
    var top = Math.max(0, (start - DAY_START) / SLOT * SLOT_HEIGHT);
    var height = Math.max(24, (end - start) / SLOT * SLOT_HEIGHT - 3);
    var laneCount = Math.max(1, Number(ev._laneCount || 1));
    var lane = Math.max(0, Number(ev._lane || 0));
    var gap = 3;
    var width = 'calc(' + (100 / laneCount) + '% - ' + gap + 'px)';
    var left = 'calc(' + (lane * 100 / laneCount) + '% + ' + Math.max(0, lane * gap / laneCount) + 'px)';
    var color = ownerColor(ev.owner_id || '');
    var editable = canEdit(ev);
    var cls = editable ? 'calendar-event can-drag' : 'calendar-event readonly';
    return '<div class="' + cls + '" data-event-id="' + API.esc(ev.event_id) + '" style="top:' + top + 'px;height:' + height + 'px;left:' + left + ';width:' + width + ';border-color:' + color + ';background:' + tint(color) + '"' +
      (editable ? ' onpointerdown="CalendarModule.startDrag(event,\'' + API.esc(ev.event_id) + '\')"' : '') +
      ' onclick="CalendarModule.openEdit(\'' + API.esc(ev.event_id) + '\',event)">' +
        '<div class="cal-ev-time">' + API.esc(ev.start_time) + ' - ' + API.esc(ev.end_time) + '</div>' +
        '<div class="cal-ev-title">' + API.esc(ev.title) + '</div>' +
        '<div class="cal-ev-meta">' + API.esc(ev.owner_name || '') + (ev.company_name ? ' · ' + API.esc(ev.company_name) : '') + '</div>' +
      '</div>';
  }

  function layoutEvents(rows) {
    var sorted = rows.slice().sort(function (a, b) {
      return Number(a.start_minutes || 0) - Number(b.start_minutes || 0) || String(a.event_id).localeCompare(String(b.event_id));
    });
    var groups = [];
    var group = [];
    var groupEnd = -1;
    sorted.forEach(function (ev) {
      var start = Number(ev.start_minutes || 0);
      var end = Number(ev.end_minutes || start + Number(ev.duration_minutes || 30));
      if (!group.length || start < groupEnd) {
        group.push(ev);
        groupEnd = Math.max(groupEnd, end);
      } else {
        groups.push(group);
        group = [ev];
        groupEnd = end;
      }
    });
    if (group.length) groups.push(group);
    groups.forEach(assignLanes);
    return sorted;
  }

  function assignLanes(group) {
    var laneEnds = [];
    group.forEach(function (ev) {
      var start = Number(ev.start_minutes || 0);
      var end = Number(ev.end_minutes || start + Number(ev.duration_minutes || 30));
      var lane = 0;
      while (laneEnds[lane] > start) lane++;
      laneEnds[lane] = end;
      ev._lane = lane;
    });
    var laneCount = Math.max(1, laneEnds.length);
    group.forEach(function (ev) { ev._laneCount = laneCount; });
  }

  function startDrag(e, eventId) {
    var ev = findEvent(eventId);
    if (!ev || !canEdit(ev)) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.currentTarget;
    _drag = {
      event: ev,
      el: el,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      originDate: ev.event_date,
      originStart: ev.start_time,
      originEnd: ev.end_time,
    };
    el.classList.add('dragging');
    if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!_drag) return;
    var dx = e.clientX - _drag.startX;
    var dy = e.clientY - _drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) _drag.moved = true;
    _drag.el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  }

  async function onPointerUp(e) {
    if (!_drag) return;
    var d = _drag;
    _drag = null;
    d.el.classList.remove('dragging');
    d.el.style.transform = '';
    if (!d.moved) return;
    _suppressClickUntil = Date.now() + 350;
    var hit = document.elementFromPoint(e.clientX, e.clientY);
    var dayCol = hit && hit.closest ? hit.closest('.calendar-day-col') : null;
    if (!dayCol) return renderGrid();
    var rect = dayCol.getBoundingClientRect();
    var minute = DAY_START + Math.round(((e.clientY - rect.top) / SLOT_HEIGHT) * SLOT / SLOT) * SLOT;
    minute = clampMinute(Math.round(minute / SLOT) * SLOT);
    var duration = Math.max(SLOT, Number(d.event.duration_minutes || 30));
    var end = Math.min(DAY_END, minute + duration);
    if (end <= minute) {
      minute = Math.max(DAY_START, DAY_END - duration);
      end = minute + duration;
    }
    var newDate = dayCol.getAttribute('data-date');
    try {
      await API.call('updateCalendarEventSchedule', {
        eventId: d.event.event_id,
        eventDate: newDate,
        startTime: timeLabel(minute),
        endTime: timeLabel(end),
      });
      API.toast('Đã cập nhật lịch', 'success');
      await load(true);
    } catch (err) {
      API.error(err);
      await load(true);
    }
  }

  function openCreate(date, minute) {
    var start = Number.isFinite(Number(minute)) ? Number(minute) : 9 * 60;
    var end = Math.min(DAY_END, start + 60);
    openForm({
      event_date: date || vnToday(),
      start_time: timeLabel(start),
      end_time: timeLabel(end),
      status: 'scheduled',
    });
  }

  function openEdit(eventId, clickEvent) {
    if (Date.now() < _suppressClickUntil) return;
    if (clickEvent && _drag && _drag.moved) return;
    var ev = findEvent(eventId);
    if (!ev) return;
    openForm(ev);
  }

  function openForm(row) {
    var isEdit = !!row.event_id;
    var editable = !isEdit || canEdit(row);
    var status = row.status || 'scheduled';
    var html = ''
      + '<label class="span-5">Tiêu đề<input name="title" required maxlength="300" value="' + API.esc(row.title || '') + '"' + (editable ? '' : ' readonly') + '></label>'
      + '<label class="span-3">Công ty<input name="companyName" maxlength="200" value="' + API.esc(row.company_name || '') + '"' + (editable ? '' : ' readonly') + '></label>'
      + '<label class="span-2">Ngày<input name="eventDate" type="date" required value="' + API.esc(row.event_date || vnToday()) + '"' + (editable ? '' : ' readonly') + '></label>'
      + '<label class="span-1">Bắt đầu<input name="startTime" type="time" step="1800" required value="' + API.esc(row.start_time || '09:00') + '"' + (editable ? '' : ' readonly') + '></label>'
      + '<label class="span-1">Kết thúc<input name="endTime" type="time" step="1800" required value="' + API.esc(row.end_time || '10:00') + '"' + (editable ? '' : ' readonly') + '></label>'
      + '<label class="span-3">Trạng thái<select name="status"' + (editable ? '' : ' disabled') + '>'
        + '<option value="scheduled"' + (status === 'scheduled' ? ' selected' : '') + '>Đã lên lịch</option>'
        + '<option value="done"' + (status === 'done' ? ' selected' : '') + '>Hoàn thành</option>'
        + '<option value="cancelled"' + (status === 'cancelled' ? ' selected' : '') + '>Đã hủy</option>'
      + '</select></label>'
      + '<label class="span-9">Ghi chú<textarea name="note" style="min-height:120px;resize:vertical"' + (editable ? '' : ' readonly') + '>' + API.esc(row.note || '') + '</textarea></label>'
      + (isEdit && row.task_id ? '<div class="span-12 calendar-linked-task">Task tự tạo: <strong>' + API.esc(row.task_id) + '</strong></div>' : '')
      + (isEdit && editable ? '<div class="span-12 calendar-form-actions"><button type="button" class="btn-danger" onclick="CalendarModule.deleteEvent(\'' + API.esc(row.event_id) + '\')">Xóa lịch</button></div>' : '');
    Utils.openModal(isEdit ? 'Lịch: ' + (row.title || row.event_id) : 'Thêm lịch', html, editable ? async function (data) {
      try {
        if (isEdit) {
          await API.call('updateCalendarEvent', {
            eventId: row.event_id,
            title: data.title,
            companyName: data.companyName,
            note: data.note,
            status: data.status,
          });
          if (data.eventDate !== row.event_date || data.startTime !== row.start_time || data.endTime !== row.end_time) {
            await API.call('updateCalendarEventSchedule', {
              eventId: row.event_id,
              eventDate: data.eventDate,
              startTime: data.startTime,
              endTime: data.endTime,
            });
          }
        } else {
          await API.call('createCalendarEvent', data);
        }
        Utils.closeModal();
        API.toast(isEdit ? 'Đã cập nhật lịch' : 'Đã tạo lịch và task', 'success');
        await load(true);
      } catch (err) {
        API.error(err);
      }
    } : null);
    Auth.applyRoleUI();
  }

  async function deleteEvent(eventId) {
    var ev = findEvent(eventId);
    if (!ev || !canEdit(ev)) return;
    var ok = await Utils.confirmDanger('Xóa lịch', 'Bạn có chắc muốn xóa lịch "' + ev.title + '"? Task liên kết sẽ được giữ lại.', 'Xóa');
    if (!ok) return;
    try {
      await API.call('deleteCalendarEvent', { eventId: eventId });
      Utils.closeModal();
      API.toast('Đã xóa lịch', 'success');
      await load(true);
    } catch (err) {
      API.error(err);
    }
  }

  function canEdit(ev) {
    var user = AppState.get('user') || Auth.session && Auth.session();
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'manager') return true;
    return user.role === 'purchasing' && ev && ev.owner_id === user.id;
  }

  function findEvent(eventId) {
    return (state.rows || []).find(function (r) { return r.event_id === eventId; });
  }

  function prevWeek() { state.weekStart = addDays(state.weekStart, -7); load(true); }
  function nextWeek() { state.weekStart = addDays(state.weekStart, 7); load(true); }
  function today() { state.weekStart = startOfWeek(vnToday()); load(true); }

  function timeSlots() {
    var out = [];
    for (var m = DAY_START; m < DAY_END; m += SLOT) out.push(m);
    return out;
  }

  function weekDays(start) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(start, i));
    return out;
  }

  function startOfWeek(dateStr) {
    var d = partsToUtc(dateStr);
    var day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - day + 1);
    return utcDateString(d);
  }

  function addDays(dateStr, days) {
    var d = partsToUtc(dateStr);
    d.setUTCDate(d.getUTCDate() + days);
    return utcDateString(d);
  }

  function partsToUtc(dateStr) {
    var p = String(dateStr || '').split('-').map(Number);
    return new Date(Date.UTC(p[0] || 2026, (p[1] || 1) - 1, p[2] || 1));
  }

  function utcDateString(d) {
    return [d.getUTCFullYear(), pad2(d.getUTCMonth() + 1), pad2(d.getUTCDate())].join('-');
  }

  function vnToday() {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    return map.year + '-' + map.month + '-' + map.day;
  }

  function fmtDay(dateStr) {
    var p = String(dateStr || '').split('-');
    return (p[2] || '') + '/' + (p[1] || '');
  }

  function dayName(dateStr) {
    var names = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    return names[partsToUtc(dateStr).getUTCDay()];
  }

  function timeLabel(minutes) {
    return pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60);
  }

  function clampMinute(minutes) {
    return Math.max(DAY_START, Math.min(DAY_END - SLOT, minutes));
  }

  function ownerColor(ownerId) {
    var hash = 0;
    String(ownerId || 'owner').split('').forEach(function (ch) { hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0; });
    return OWNER_COLORS[Math.abs(hash) % OWNER_COLORS.length];
  }

  function tint(color) {
    return 'color-mix(in srgb, ' + color + ' 12%, white)';
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  window.CalendarModule = {
    init: init,
    load: load,
    openCreate: openCreate,
    openEdit: openEdit,
    deleteEvent: deleteEvent,
    renderGrid: renderGrid,
    startDrag: startDrag,
    prevWeek: prevWeek,
    nextWeek: nextWeek,
    today: today,
  };
})();
