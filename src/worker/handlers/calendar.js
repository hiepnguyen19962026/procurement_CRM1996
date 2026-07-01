import {
  getCalendarEventSQL,
  listCalendarEventsSQL,
  nextCalendarEventId,
  prepareInsertCalendarEventSQL,
  softDeleteCalendarEventSQL,
  updateCalendarEventSQL,
  updateCalendarEventScheduleSQL,
} from '../db/calendar-queries.js';
import { nextTaskId, prepareInsertTaskSQL } from '../db/task-queries.js';
import { deleteMediaFilesByOwnerSQL, getMediaKeysByOwnerSQL } from '../db/media-queries.js';
import { ALL_ROLES, MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { invalidateKv } from '../lib/cache.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanString, normalizeText } from '../lib/normalize.js';
import { json, nowIso, readJson } from '../lib/utils.js';

const DASHBOARD_CACHE_KEY = 'dashboard:v2';
const VALID_EVENT_STATUS = new Set(['scheduled', 'done', 'cancelled']);

export async function handleCalendar(action, request, env, ctx, actor) {
  if (action === 'getCalendarEvents') return listEvents(request, env, actor);
  if (action === 'createCalendarEvent') return createEvent(request, env, ctx, actor);
  if (action === 'updateCalendarEvent') return updateEvent(request, env, ctx, actor);
  if (action === 'updateCalendarEventSchedule') return updateSchedule(request, env, ctx, actor);
  if (action === 'deleteCalendarEvent') return deleteEvent(request, env, ctx, actor);
  return json({ ok: false, error: 'Unknown calendar action' }, 400);
}

async function listEvents(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const fromDate = normalizeDate(body.fromDate || body.from_date || '');
  const toDate = normalizeDate(body.toDate || body.to_date || fromDate);
  if (!fromDate || !toDate) return json({ ok: false, error: 'Thieu khoang ngay lich' }, 400);
  if (toDate < fromDate) return json({ ok: false, error: 'Khoang ngay khong hop le' }, 400);
  if (daysBetween(fromDate, toDate) > 62) return json({ ok: false, error: 'Chi tai lich toi da 62 ngay moi lan' }, 400);
  const rows = await listCalendarEventsSQL(env.DB, { fromDate, toDate });
  return json({ ok: true, rows, fromDate, toDate });
}

async function createEvent(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const base = normalizeEventPayload(body);
  if (!base.ok) return json({ ok: false, error: base.error }, 400);

  const now = nowIso();
  const eventId = await nextCalendarEventId(env.DB, base.event_date);
  const taskId = await nextTaskId(env.DB);
  const taskRow = buildAutoTaskRow({
    taskId,
    title: base.title,
    eventDate: base.event_date,
    companyName: base.company_name,
    note: base.note,
    actor,
    now,
  });
  const eventRow = {
    event_id: eventId,
    ...base,
    owner_id: actor?.id || '',
    task_id: taskId,
    status: base.status || 'scheduled',
    created_by: actor?.id || '',
    created_at: now,
    updated_at: now,
  };

  await env.DB.batch([
    prepareInsertTaskSQL(env.DB, taskRow),
    prepareInsertCalendarEventSQL(env.DB, eventRow),
  ]);
  await invalidateCalendarCaches(env, eventRow.event_date);
  ctx.waitUntil(writeActionLog(env, {
    action: 'createCalendarEvent',
    entityType: 'calendar_event',
    entityId: eventId,
    message: `Tao lich "${eventRow.title}" va tu dong tao task ${taskId}`,
    oldJson: null,
    newJson: { event: eventRow, task: taskRow },
    actor,
  }));
  return json({ ok: true, event: eventRow, task: taskRow });
}

async function updateEvent(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const eventId = cleanString(body.eventId || body.event_id, 80);
  if (!eventId) return json({ ok: false, error: 'Thieu event_id' }, 400);
  const oldRow = await getCalendarEventSQL(env.DB, eventId);
  if (!oldRow) return json({ ok: false, error: 'Khong tim thay lich' }, 404);
  const ownerDenied = requireEventOwnerOrManager(actor, oldRow);
  if (ownerDenied) return ownerDenied;

  const title = cleanString(body.title || oldRow.title || '', 300);
  if (!title) return json({ ok: false, error: 'Ten lich la bat buoc' }, 400);
  const row = {
    event_id: eventId,
    title,
    company_name: cleanString(body.companyName || body.company_name || oldRow.company_name || '', 200),
    note: cleanString(body.note ?? oldRow.note ?? '', 1500),
    external_url: oldRow.external_url || '',
    status: VALID_EVENT_STATUS.has(body.status) ? body.status : oldRow.status,
    updated_at: nowIso(),
  };
  const externalUrl = normalizeExternalUrl(body.externalUrl ?? body.external_url ?? row.external_url);
  if (!externalUrl.ok) return json({ ok: false, error: externalUrl.error }, 400);
  row.external_url = externalUrl.value;
  await updateCalendarEventSQL(env.DB, row);
  await invalidateCalendarCaches(env, oldRow.event_date);
  const newRow = await getCalendarEventSQL(env.DB, eventId);
  ctx.waitUntil(writeActionLog(env, {
    action: 'updateCalendarEvent',
    entityType: 'calendar_event',
    entityId: eventId,
    message: `Cap nhat lich "${newRow?.title || title}"`,
    oldJson: oldRow,
    newJson: newRow,
    actor,
  }));
  return json({ ok: true, event: newRow });
}

async function updateSchedule(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const eventId = cleanString(body.eventId || body.event_id, 80);
  if (!eventId) return json({ ok: false, error: 'Thieu event_id' }, 400);
  const oldRow = await getCalendarEventSQL(env.DB, eventId);
  if (!oldRow) return json({ ok: false, error: 'Khong tim thay lich' }, 404);
  const ownerDenied = requireEventOwnerOrManager(actor, oldRow);
  if (ownerDenied) return ownerDenied;

  const eventDate = normalizeDate(body.eventDate || body.event_date || '');
  const startTime = normalizeTime(body.startTime || body.start_time || '');
  const endTime = normalizeTime(body.endTime || body.end_time || '');
  const checked = validateSchedule(eventDate, startTime, endTime);
  if (!checked.ok) return json({ ok: false, error: checked.error }, 400);
  const row = {
    event_id: eventId,
    event_date: eventDate,
    start_time: startTime,
    end_time: endTime,
    duration_minutes: checked.duration,
    updated_at: nowIso(),
  };
  await updateCalendarEventScheduleSQL(env.DB, row);
  await invalidateCalendarCaches(env, [oldRow.event_date, eventDate]);
  const newRow = await getCalendarEventSQL(env.DB, eventId);
  ctx.waitUntil(writeActionLog(env, {
    action: 'updateCalendarEventSchedule',
    entityType: 'calendar_event',
    entityId: eventId,
    message: `Doi lich "${oldRow.title}": ${oldRow.event_date} ${oldRow.start_time}-${oldRow.end_time} -> ${eventDate} ${startTime}-${endTime}`,
    oldJson: oldRow,
    newJson: newRow,
    actor,
  }));
  return json({ ok: true, event: newRow });
}

async function deleteEvent(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);
  const eventId = cleanString(body.eventId || body.event_id, 80);
  if (!eventId) return json({ ok: false, error: 'Thieu event_id' }, 400);
  const oldRow = await getCalendarEventSQL(env.DB, eventId);
  if (!oldRow) return json({ ok: false, error: 'Khong tim thay lich' }, 404);
  const ownerDenied = requireEventOwnerOrManager(actor, oldRow);
  if (ownerDenied) return ownerDenied;

  const now = nowIso();
  const mediaRows = await getMediaKeysByOwnerSQL(env.DB, 'calendar_event', eventId);
  if (mediaRows.length && !env.MEDIA) {
    return json({ ok: false, error: 'R2 MEDIA binding chua cau hinh nen khong the xoa sach file lich' }, 500);
  }
  if (mediaRows.length) {
    await Promise.all(mediaRows.map((row) => env.MEDIA.delete(row.r2_key)));
    await deleteMediaFilesByOwnerSQL(env.DB, 'calendar_event', eventId);
  }
  await softDeleteCalendarEventSQL(env.DB, eventId, now);
  await invalidateCalendarCaches(env, oldRow.event_date);
  ctx.waitUntil(writeActionLog(env, {
    action: 'deleteCalendarEvent',
    entityType: 'calendar_event',
    entityId: eventId,
    message: `Xoa lich "${oldRow.title}"`,
    oldJson: oldRow,
    newJson: { deleted_media_ids: mediaRows.map((row) => row.file_id) },
    actor,
  }));
  return json({ ok: true });
}

function normalizeEventPayload(body) {
  const title = cleanString(body.title || '', 300);
  const eventDate = normalizeDate(body.eventDate || body.event_date || '');
  const startTime = normalizeTime(body.startTime || body.start_time || '');
  const endTime = normalizeTime(body.endTime || body.end_time || '');
  const checked = validateSchedule(eventDate, startTime, endTime);
  const externalUrl = normalizeExternalUrl(body.externalUrl ?? body.external_url ?? '');
  if (!title) return { ok: false, error: 'Ten lich la bat buoc' };
  if (!checked.ok) return checked;
  if (!externalUrl.ok) return externalUrl;
  const status = body.status && VALID_EVENT_STATUS.has(body.status) ? body.status : 'scheduled';
  return {
    ok: true,
    title,
    event_date: eventDate,
    start_time: startTime,
    end_time: endTime,
    duration_minutes: checked.duration,
    company_name: cleanString(body.companyName || body.company_name || '', 200),
    note: cleanString(body.note || '', 1500),
    external_url: externalUrl.value,
    status,
  };
}

function normalizeExternalUrl(value) {
  const raw = cleanString(value || '', 1500);
  if (!raw) return { ok: true, value: '' };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Link tai lieu phai dung http hoac https' };
    }
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, error: 'Link tai lieu khong hop le' };
  }
}

function buildAutoTaskRow({ taskId, title, eventDate, companyName, note, actor, now }) {
  return {
    task_id: taskId,
    company_name: companyName,
    company_normalized: normalizeText(companyName),
    title,
    description: note,
    start_date: eventDate,
    deadline_date: eventDate,
    next_followup_date: null,
    status: 'dang_lam',
    priority: 'trung_binh',
    progress_percent: 0,
    task_type: 'calendar',
    latest_note: note,
    completed_at: null,
    last_activity_at: now,
    created_by: actor?.id || '',
    created_at: now,
    updated_at: now,
  };
}

function requireEventOwnerOrManager(actor, eventRow) {
  if (actor?.role && MANAGE_ROLES.has(actor.role)) return null;
  if (eventRow?.owner_id && actor?.id && eventRow.owner_id === actor.id) return null;
  return json({ ok: false, error: 'Khong co quyen sua lich nay' }, 403);
}

async function invalidateCalendarCaches(env, dates) {
  const list = [dates].flat().filter(Boolean);
  const keys = [DASHBOARD_CACHE_KEY];
  list.forEach((date) => keys.push(`calendar:v1:${date}:all`));
  await invalidateKv(env, keys);
}

function validateSchedule(eventDate, startTime, endTime) {
  if (!eventDate) return { ok: false, error: 'Ngay lich khong hop le' };
  if (!startTime || !endTime) return { ok: false, error: 'Gio lich khong hop le' };
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start < 0 || end < 0 || end <= start) return { ok: false, error: 'Khung gio khong hop le' };
  if ((start % 30) !== 0 || (end % 30) !== 0) return { ok: false, error: 'Lich phai theo buoc 30 phut' };
  return { ok: true, duration: end - start };
}

function normalizeDate(value) {
  const raw = cleanString(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function normalizeTime(value) {
  const raw = cleanString(value, 5);
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function minutesFromTime(value) {
  const t = normalizeTime(value);
  if (!t) return -1;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function daysBetween(fromDate, toDate) {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}
