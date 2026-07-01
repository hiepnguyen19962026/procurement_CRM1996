import { nextEntitySequenceSQL } from './system-queries.js';

export async function nextCalendarEventId(db, eventDate) {
  const dateKey = String(eventDate || '').replace(/-/g, '') || vnDateToday().replace(/-/g, '');
  const prefix = `CAL-${dateKey}`;
  const seedRow = await db.prepare(
    `SELECT event_id FROM calendar_events WHERE event_id LIKE ? ORDER BY event_id DESC LIMIT 1`
  ).bind(`${prefix}-%`).first();
  const last = seedRow?.event_id ? Number(String(seedRow.event_id).split('-').pop()) : 0;
  const row = await nextEntitySequenceSQL(db, prefix, Number.isFinite(last) ? last : 0);
  const seq = Number(row?.last_value || 1);
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

export async function listCalendarEventsSQL(db, { fromDate, toDate }) {
  const res = await db.prepare(
    `SELECT
       e.event_id,
       e.title,
       e.event_date,
       e.start_time,
       e.end_time,
       e.duration_minutes,
       (SELECT COUNT(*) FROM media_files mf
        WHERE mf.owner_type = 'calendar_event' AND mf.owner_id = e.event_id) AS media_count,
       (CAST(substr(e.start_time, 1, 2) AS INTEGER) * 60 + CAST(substr(e.start_time, 4, 2) AS INTEGER)) AS start_minutes,
       (CAST(substr(e.end_time, 1, 2) AS INTEGER) * 60 + CAST(substr(e.end_time, 4, 2) AS INTEGER)) AS end_minutes,
       e.owner_id,
       COALESCE(u.display_name, u.username, e.owner_id, '') AS owner_name,
       e.company_name,
       e.note,
       e.external_url,
       e.task_id,
       e.status,
       e.created_by,
       e.created_at,
       e.updated_at
     FROM calendar_events e
     LEFT JOIN users u ON u.user_id = e.owner_id
     WHERE e.deleted_at IS NULL
       AND e.event_date >= ?
       AND e.event_date <= ?
     ORDER BY e.event_date ASC, e.start_time ASC, e.event_id ASC`
  ).bind(fromDate, toDate).all();
  return normalizeEventRows(res.results || []);
}

export async function getCalendarEventSQL(db, eventId) {
  const row = await db.prepare(
    `SELECT
       e.*,
       (CAST(substr(e.start_time, 1, 2) AS INTEGER) * 60 + CAST(substr(e.start_time, 4, 2) AS INTEGER)) AS start_minutes,
       (CAST(substr(e.end_time, 1, 2) AS INTEGER) * 60 + CAST(substr(e.end_time, 4, 2) AS INTEGER)) AS end_minutes,
       COALESCE(u.display_name, u.username, e.owner_id, '') AS owner_name
     FROM calendar_events e
     LEFT JOIN users u ON u.user_id = e.owner_id
     WHERE e.event_id = ? AND e.deleted_at IS NULL`
  ).bind(eventId).first();
  return row ? normalizeEventRow(row) : null;
}

export async function insertCalendarEventSQL(db, row) {
  return prepareInsertCalendarEventSQL(db, row).run();
}

export function prepareInsertCalendarEventSQL(db, row) {
  return db.prepare(
    `INSERT INTO calendar_events (
      event_id, title, event_date, start_time, end_time, duration_minutes,
      owner_id, company_name, note, external_url, task_id, status, created_by,
      created_at, updated_at, deleted_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`
  ).bind(
    row.event_id, row.title, row.event_date, row.start_time, row.end_time, row.duration_minutes,
    row.owner_id, row.company_name, row.note, row.external_url, row.task_id, row.status, row.created_by,
    row.created_at, row.updated_at
  );
}

export async function updateCalendarEventSQL(db, row) {
  return db.prepare(
    `UPDATE calendar_events SET
       title = ?, company_name = ?, note = ?, external_url = ?, status = ?, updated_at = ?
     WHERE event_id = ? AND deleted_at IS NULL`
  ).bind(
    row.title, row.company_name, row.note, row.external_url, row.status, row.updated_at, row.event_id
  ).run();
}

export async function updateCalendarEventScheduleSQL(db, row) {
  return db.prepare(
    `UPDATE calendar_events SET
       event_date = ?, start_time = ?, end_time = ?, duration_minutes = ?, updated_at = ?
     WHERE event_id = ? AND deleted_at IS NULL`
  ).bind(
    row.event_date, row.start_time, row.end_time, row.duration_minutes, row.updated_at, row.event_id
  ).run();
}

export async function softDeleteCalendarEventSQL(db, eventId, now) {
  return db.prepare(
    `UPDATE calendar_events SET deleted_at = ?, updated_at = ? WHERE event_id = ? AND deleted_at IS NULL`
  ).bind(now, now, eventId).run();
}

function normalizeEventRows(rows) {
  return rows.map(normalizeEventRow);
}

function normalizeEventRow(row) {
  const startMinutes = minutesFromTime(row.start_time);
  const endMinutes = minutesFromTime(row.end_time);
  const duration = Math.max(0, endMinutes - startMinutes);
  return {
    ...row,
    event_date: String(row.event_date || '').slice(0, 10),
    start_time: normalizeTime(row.start_time),
    end_time: normalizeTime(row.end_time),
    start_minutes: startMinutes,
    end_minutes: endMinutes,
    duration_minutes: Number(row.duration_minutes || duration || 30),
    media_count: Number(row.media_count || 0),
    owner_id: row.owner_id || '',
    owner_name: row.owner_name || row.owner_id || '',
  };
}

function normalizeTime(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '00:00';
  return `${String(Math.min(23, Number(m[1]) || 0)).padStart(2, '0')}:${String(Math.min(59, Number(m[2]) || 0)).padStart(2, '0')}`;
}

function minutesFromTime(value) {
  const t = normalizeTime(value);
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function vnDateToday() {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return [
    vn.getUTCFullYear(),
    String(vn.getUTCMonth() + 1).padStart(2, '0'),
    String(vn.getUTCDate()).padStart(2, '0'),
  ].join('-');
}
