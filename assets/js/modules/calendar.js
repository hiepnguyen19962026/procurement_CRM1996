(function () {
  var state = AppState.list('calendar');
  state.weekStart = state.weekStart || startOfWeek(vnToday());
  state.rows = state.rows || [];
  state.expanded = state.expanded === true;
  var _setupDone = false;
  var _drag = null;
  var _suppressClickUntil = 0;
  var _calendarMediaRows = [];
  var _calendarLightboxImages = [];
  var _calendarLightboxIndex = 0;
  var _calendarLightboxEl = null;

  var COLLAPSED_START = 7 * 60;
  var COLLAPSED_END = 19 * 60;
  var EXPANDED_START = 4 * 60;
  var EXPANDED_END = 24 * 60;
  var SLOT = 30;
  var SLOT_HEIGHT = 34;
  var OWNER_COLORS = ['#6f8fbf', '#6f9d83', '#bd8b62', '#679b99', '#8c7fb2', '#b57d7d', '#6f91a8', '#a48868'];

  function setupOnce() {
    if (_setupDone) return;
    _setupDone = true;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('keydown', onCalendarLightboxKeydown);
  }

  function init() { load(true); }

  async function load(reset) {
    setupOnce();
    if (reset) state.rows = [];
    var fromDate = state.weekStart;
    var toDate = addDays(fromDate, 13);
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
    updateWeekLabel(days);
    Auth.applyRoleUI();
  }

  function renderDayColumn(date) {
    var rangeStart = activeDayStart();
    var rangeEnd = activeDayEnd();
    var events = layoutEvents((state.rows || []).filter(function (r) {
      var start = Number(r.start_minutes || 0);
      return r.event_date === date && start >= rangeStart && start < rangeEnd;
    }));
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
    var visibleEnd = Math.min(end, activeDayEnd());
    var top = (start - activeDayStart()) / SLOT * SLOT_HEIGHT;
    var height = Math.max(24, (visibleEnd - start) / SLOT * SLOT_HEIGHT - 3);
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
        '<div class="cal-ev-time">' + API.esc(ev.start_time) + ' - ' + API.esc(ev.end_time) + (Number(ev.media_count || 0) > 0 ? '<span class="cal-media-indicator" title="Có file đính kèm">📎</span>' : '') + '</div>' +
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
    var minute = activeDayStart() + Math.round(((e.clientY - rect.top) / SLOT_HEIGHT) * SLOT / SLOT) * SLOT;
    minute = clampMinute(Math.round(minute / SLOT) * SLOT);
    var duration = Math.max(SLOT, Number(d.event.duration_minutes || 30));
    var scheduleEnd = activeScheduleEnd();
    var end = Math.min(scheduleEnd, minute + duration);
    if (end <= minute) {
      minute = Math.max(activeDayStart(), scheduleEnd - duration);
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
    var scheduleEnd = activeScheduleEnd();
    if (start >= scheduleEnd) start = Math.max(activeDayStart(), scheduleEnd - SLOT);
    var end = Math.min(scheduleEnd, start + 60);
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
      + '<label class="span-3">Tiêu đề<input name="title" required maxlength="300" value="' + API.esc(row.title || '') + '"' + (editable ? '' : ' readonly') + '></label>'
      + '<label class="span-3">Công ty<input name="companyName" maxlength="200" value="' + API.esc(row.company_name || '') + '"' + (editable ? '' : ' readonly') + '></label>'
      + '<label class="span-3">Ngày<input name="eventDate" type="date" required value="' + API.esc(row.event_date || vnToday()) + '"' + (editable ? '' : ' readonly') + '></label>'
      + '<label class="span-3">Thời gian<div class="calendar-time-group"><input name="startTime" type="time" step="1800" required aria-label="Bắt đầu" value="' + API.esc(row.start_time || '09:00') + '"' + (editable ? '' : ' readonly') + '><input name="endTime" type="time" step="1800" required aria-label="Kết thúc" value="' + API.esc(row.end_time || '10:00') + '"' + (editable ? '' : ' readonly') + '></div></label>'
      + '<label class="span-3 calendar-status-field">Trạng thái<select name="status"' + (editable ? '' : ' disabled') + '>'
        + '<option value="scheduled"' + (status === 'scheduled' ? ' selected' : '') + '>Đã lên lịch</option>'
        + '<option value="done"' + (status === 'done' ? ' selected' : '') + '>Hoàn thành</option>'
        + '<option value="cancelled"' + (status === 'cancelled' ? ' selected' : '') + '>Đã hủy</option>'
      + '</select></label>'
      + '<label class="span-9 calendar-note-field">Ghi chú<textarea name="note" rows="2"' + (editable ? '' : ' readonly') + '>' + API.esc(row.note || '') + '</textarea></label>'
      + '<label class="span-12">Link tài liệu / Google Drive<input name="externalUrl" type="url" maxlength="1500" placeholder="https://..." value="' + API.esc(row.external_url || '') + '"' + (editable ? '' : ' readonly') + '></label>'
      + '<div class="span-12 calendar-media-box">' + (isEdit
        ? '<div class="calendar-media-upload"><input id="calendarMediaInput" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple' + (editable ? '' : ' disabled') + '><button type="button"' + (editable ? ' onclick="CalendarModule.uploadAttachments(\'' + API.esc(row.event_id) + '\')"' : ' disabled') + '>Upload ảnh / tài liệu</button></div><div id="calendarMediaList" class="calendar-media-list"><span class="muted">Đang tải file...</span></div>'
        : '<span class="muted">Lưu lịch trước, sau đó mở lại để đính kèm nhiều ảnh hoặc PDF.</span>') + '</div>'
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
            externalUrl: data.externalUrl,
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
    if (isEdit) loadCalendarMedia(row.event_id);
    Auth.applyRoleUI();
  }

  async function loadCalendarMedia(eventId) {
    var box = document.getElementById('calendarMediaList');
    if (!box) return;
    try {
      var data = await API.get('getMediaFiles', { ownerType: 'calendar_event', ownerId: eventId, limit: 100 });
      if (document.getElementById('calendarMediaList') !== box) return;
      var rows = data.rows || [];
      _calendarMediaRows = rows;
      _calendarLightboxImages = rows.filter(function (file) { return /^image\//i.test(file.mime_type || ''); });
      var editable = canEdit(findEvent(eventId));
      box.innerHTML = rows.length ? '<div class="calendar-media-grid">' + rows.map(function (file) {
        var name = API.esc(file.file_name || file.file_id);
        var url = API.esc(API.mediaUrl(file.file_id, file.owner_type, file.owner_id));
        var deleteButton = editable ? '<button type="button" class="calendar-media-delete" title="Xóa file" aria-label="Xóa ' + name + '" onclick="event.stopPropagation();CalendarModule.deleteMediaFile(\'' + API.esc(eventId) + '\',\'' + API.esc(file.file_id) + '\')">×</button>' : '';
        if (/^image\//i.test(file.mime_type || '')) {
          var imageIndex = _calendarLightboxImages.findIndex(function (image) { return image.file_id === file.file_id; });
          return '<div class="calendar-media-item">' + deleteButton + '<button type="button" class="calendar-media-thumb" onclick="CalendarModule.openMediaPreview(' + imageIndex + ')" title="' + name + '"><img src="' + url + '" alt="' + name + '" loading="lazy"><span>' + name + '</span></button></div>';
        }
        return '<div class="calendar-media-item calendar-media-document">' + deleteButton + '<a href="' + url + '" target="_blank" rel="noopener" title="' + name + '"><span class="calendar-document-icon">PDF</span><span>' + name + '</span></a></div>';
      }).join('') + '</div>' : '<span class="muted">Chưa có file đính kèm.</span>';
    } catch (err) {
      box.textContent = err.message || 'Không tải được file đính kèm';
    }
  }

  async function uploadAttachments(eventId) {
    var input = document.getElementById('calendarMediaInput');
    var files = input && input.files ? Array.from(input.files) : [];
    if (!files.length) return API.toast('Chọn ảnh hoặc PDF trước khi upload', 'warn');
    var succeeded = 0;
    var failed = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      var isImage = /^image\/(jpeg|png|webp)$/i.test(file.type || '');
      if (!isPdf && !isImage) {
        failed.push(file.name);
        continue;
      }
      var form = new FormData();
      form.append('ownerType', 'calendar_event');
      form.append('ownerId', eventId);
      form.append('fileKind', isPdf ? 'calendar_document_pdf' : 'calendar_evidence_image');
      form.append('file', file);
      try {
        API.toast('Đang upload ' + (i + 1) + '/' + files.length + ': ' + file.name, 'info');
        await API.upload(form);
        succeeded++;
      } catch (err) {
        failed.push(file.name + ': ' + (err.message || 'Lỗi upload'));
      }
    }
    input.value = '';
    if (succeeded) {
      await load(true);
      await loadCalendarMedia(eventId);
    }
    API.toast(failed.length ? 'Đã upload ' + succeeded + '/' + files.length + '. Lỗi: ' + failed.join('; ') : 'Đã upload ' + succeeded + ' file', failed.length ? 'warn' : 'success');
  }

  async function deleteMediaFile(eventId, fileId) {
    var row = _calendarMediaRows.find(function (file) { return file.file_id === fileId; });
    if (!row || !canEdit(findEvent(eventId))) return;
    try {
      await API.call('deleteMediaFile', { ownerType: 'calendar_event', ownerId: eventId, fileId: fileId });
      API.toast('Đã xóa file ' + (row.file_name || fileId), 'success');
      await load(true);
      await loadCalendarMedia(eventId);
    } catch (err) {
      API.error(err);
    }
  }

  function ensureCalendarLightbox() {
    if (_calendarLightboxEl) return;
    _calendarLightboxEl = document.createElement('div');
    _calendarLightboxEl.className = 'calendar-lightbox hidden';
    _calendarLightboxEl.innerHTML = '<button type="button" class="calendar-lightbox-close" onclick="CalendarModule.closeMediaPreview()" aria-label="Đóng">×</button>' +
      '<button type="button" class="calendar-lightbox-prev" onclick="CalendarModule.prevMediaPreview()" aria-label="Ảnh trước">‹</button>' +
      '<div class="calendar-lightbox-content"><img alt="Ảnh lịch"><div class="calendar-lightbox-caption"></div></div>' +
      '<button type="button" class="calendar-lightbox-next" onclick="CalendarModule.nextMediaPreview()" aria-label="Ảnh sau">›</button>';
    _calendarLightboxEl.addEventListener('click', function (event) {
      if (event.target === _calendarLightboxEl) closeMediaPreview();
    });
    document.body.appendChild(_calendarLightboxEl);
  }

  function openMediaPreview(index) {
    if (!_calendarLightboxImages.length || index < 0) return;
    ensureCalendarLightbox();
    _calendarLightboxIndex = index;
    renderCalendarLightbox();
    _calendarLightboxEl.classList.remove('hidden');
  }

  function renderCalendarLightbox() {
    var file = _calendarLightboxImages[_calendarLightboxIndex];
    if (!file || !_calendarLightboxEl) return;
    _calendarLightboxEl.querySelector('img').src = API.mediaUrl(file.file_id, file.owner_type, file.owner_id);
    _calendarLightboxEl.querySelector('.calendar-lightbox-caption').textContent = (file.file_name || file.file_id) + ' · ' + (_calendarLightboxIndex + 1) + '/' + _calendarLightboxImages.length;
    _calendarLightboxEl.querySelector('.calendar-lightbox-prev').disabled = _calendarLightboxImages.length < 2;
    _calendarLightboxEl.querySelector('.calendar-lightbox-next').disabled = _calendarLightboxImages.length < 2;
  }

  function closeMediaPreview() {
    if (_calendarLightboxEl) _calendarLightboxEl.classList.add('hidden');
  }

  function prevMediaPreview() {
    if (!_calendarLightboxImages.length) return;
    _calendarLightboxIndex = (_calendarLightboxIndex - 1 + _calendarLightboxImages.length) % _calendarLightboxImages.length;
    renderCalendarLightbox();
  }

  function nextMediaPreview() {
    if (!_calendarLightboxImages.length) return;
    _calendarLightboxIndex = (_calendarLightboxIndex + 1) % _calendarLightboxImages.length;
    renderCalendarLightbox();
  }

  function onCalendarLightboxKeydown(event) {
    if (!_calendarLightboxEl || _calendarLightboxEl.classList.contains('hidden')) return;
    if (event.key === 'Escape') closeMediaPreview();
    if (event.key === 'ArrowLeft') prevMediaPreview();
    if (event.key === 'ArrowRight') nextMediaPreview();
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

  function toggleExpanded() {
    state.expanded = !state.expanded;
    renderGrid();
  }

  function jumpToDate(value) {
    var match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return API.toast('Nhập ngày theo định dạng dd/mm/yyyy', 'warn');
    var dateStr = match[3] + '-' + pad2(Number(match[2])) + '-' + pad2(Number(match[1]));
    var date = partsToUtc(dateStr);
    if (utcDateString(date) !== dateStr) return API.toast('Ngày không hợp lệ', 'warn');
    state.weekStart = startOfWeek(dateStr);
    load(true);
  }

  function updateWeekLabel(days) {
    var label = document.getElementById('calendarWeekLabel');
    if (label) label.textContent = fmtDay(days[0]) + ' - ' + fmtDay(days[13]);
    var button = document.getElementById('calendarExpandButton');
    if (button) button.textContent = state.expanded ? 'Thu gọn' : 'Mở rộng';
  }

  function timeSlots() {
    var out = [];
    for (var m = activeDayStart(); m < activeDayEnd(); m += SLOT) out.push(m);
    return out;
  }

  function weekDays(start) {
    var out = [];
    for (var i = 0; i < 14; i++) out.push(addDays(start, i));
    return out;
  }

  function activeDayStart() { return state.expanded ? EXPANDED_START : COLLAPSED_START; }
  function activeDayEnd() { return state.expanded ? EXPANDED_END : COLLAPSED_END; }

  // The backend stores same-day HH:MM values, so the latest schedulable end is 23:30.
  function activeScheduleEnd() { return Math.min(activeDayEnd(), 23 * 60 + 30); }

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
    return Math.max(activeDayStart(), Math.min(activeScheduleEnd() - SLOT, minutes));
  }

  function ownerColor(ownerId) {
    var hash = 0;
    String(ownerId || 'owner').split('').forEach(function (ch) { hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0; });
    return OWNER_COLORS[Math.abs(hash) % OWNER_COLORS.length];
  }

  function tint(color) {
    return 'color-mix(in srgb, ' + color + ' 16%, white)';
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
    toggleExpanded: toggleExpanded,
    jumpToDate: jumpToDate,
    uploadAttachments: uploadAttachments,
    deleteMediaFile: deleteMediaFile,
    openMediaPreview: openMediaPreview,
    closeMediaPreview: closeMediaPreview,
    prevMediaPreview: prevMediaPreview,
    nextMediaPreview: nextMediaPreview,
  };
})();
