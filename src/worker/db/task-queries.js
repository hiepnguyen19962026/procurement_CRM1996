import { nextEntitySequenceSQL } from './system-queries.js';

// VN date-based task ID: Task-YYYY-MMDD-NN, resets per date, collision-safe.
export async function nextTaskId(db) {
  const d    = new Date(Date.now() + 7 * 60 * 60 * 1000); // UTC+7
  const yyyy = d.toISOString().slice(0, 4);
  const mmdd = d.toISOString().slice(5, 10).replace('-', '');
  const prefix = `Task-${yyyy}-${mmdd}`;
  const seedRow = await db.prepare(
    `SELECT task_id FROM tasks WHERE task_id LIKE ? ORDER BY task_id DESC LIMIT 1`
  ).bind(`${prefix}-%`).first();
  const last = seedRow?.task_id ? Number(seedRow.task_id.split('-').pop()) : 0;
  const row = await nextEntitySequenceSQL(db, prefix, Number.isFinite(last) ? last : 0);
  const seq = Number(row?.last_value || 1);
  return `${prefix}-${String(seq).padStart(2, '0')}`;
}

// Cursor format: sortVal|||task_id  (or just task_id for default sort)
function parseCursor(cursor) {
  if (!cursor) return null;
  const idx = cursor.indexOf('|||');
  return idx === -1 ? { pk: cursor, sortVal: undefined } : { pk: cursor.slice(idx + 3), sortVal: cursor.slice(0, idx) };
}

const TASK_SORT = {
  title:            { col: 'title',            rowKey: 'title' },
  deadline_date:    { col: 'deadline_date',    rowKey: 'deadline_date' },
  priority:         { col: 'priority',         rowKey: 'priority' },
  status:           { col: 'status',           rowKey: 'status' },
  company_name:     { col: 'company_name',     rowKey: 'company_name' },
  created_at:       { col: 'created_at',       rowKey: 'created_at' },
  last_activity_at: { col: 'last_activity_at', rowKey: 'last_activity_at' },
};

export async function listTasksSQL(db, { q, company, status, priority, cursor, sortBy, sortDir, limit }) {
  const sort = TASK_SORT[sortBy] || null;
  const dir  = sortDir === 'asc' ? 'ASC' : 'DESC';
  const op   = dir === 'ASC' ? '>' : '<';

  const binds = [];
  const where = ['deleted_at IS NULL'];

  if (q) {
    where.push('(company_normalized LIKE ? OR title LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`);
  }
  if (company) {
    where.push('company_normalized LIKE ?');
    binds.push(`%${company}%`);
  }
  if (status) {
    where.push('status = ?');
    binds.push(status);
  }
  if (priority) {
    where.push('priority = ?');
    binds.push(priority);
  }

  if (cursor) {
    const c = parseCursor(cursor);
    if (!sort) {
      // default sort: COALESCE(last_activity_at, created_at) DESC, task_id DESC
      if (c.sortVal !== undefined) {
        where.push(
          '(COALESCE(last_activity_at,created_at) < ? OR (COALESCE(last_activity_at,created_at) = ? AND task_id < ?))'
        );
        binds.push(c.sortVal, c.sortVal, c.pk);
      }
    } else {
      const wrap = `COALESCE(${sort.col},'')`;
      where.push(`(${wrap} ${op} ? OR (${wrap} = ? AND task_id ${op} ?))`);
      binds.push(c.sortVal, c.sortVal, c.pk);
    }
  }

  const orderBy = sort
    ? `${sort.col} ${dir}, task_id ${dir}`
    : 'COALESCE(last_activity_at,created_at) DESC, task_id DESC';

  const res = await db.prepare(
    `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${orderBy} LIMIT ?`
  ).bind(...binds, limit + 1).all();

  const rows = res.results || [];
  const page = rows.slice(0, limit);
  let nextCursor = null;
  if (rows.length > limit && page.length > 0) {
    const last = page[page.length - 1];
    if (sort) {
      nextCursor = String(last[sort.rowKey] ?? '') + '|||' + last.task_id;
    } else {
      nextCursor = String(last.last_activity_at ?? last.created_at ?? '') + '|||' + last.task_id;
    }
  }
  return { rows: page, hasMore: rows.length > limit, nextCursor };
}

export async function getTasksSummarySQL(db) {
  const today = new Date().toISOString().slice(0, 10);
  const in7days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const res = await db.prepare(`
    SELECT
      SUM(CASE WHEN status='dang_lam'     THEN 1 ELSE 0 END) AS dang_lam,
      SUM(CASE WHEN status='cho_phan_hoi' THEN 1 ELSE 0 END) AS cho_phan_hoi,
      SUM(CASE WHEN deadline_date IS NOT NULL AND deadline_date < ?
               AND status NOT IN ('hoan_thanh','huy_bo') THEN 1 ELSE 0 END) AS qua_han,
      SUM(CASE WHEN deadline_date IS NOT NULL AND deadline_date >= ? AND deadline_date <= ?
               AND status NOT IN ('hoan_thanh','huy_bo') THEN 1 ELSE 0 END) AS sap_den_han
    FROM tasks WHERE deleted_at IS NULL
  `).bind(today, today, in7days).first();
  return {
    dang_lam:    Number(res?.dang_lam    || 0),
    cho_phan_hoi:Number(res?.cho_phan_hoi|| 0),
    qua_han:     Number(res?.qua_han     || 0),
    sap_den_han: Number(res?.sap_den_han || 0),
  };
}

export async function getTaskSQL(db, taskId) {
  return db.prepare('SELECT * FROM tasks WHERE task_id = ? AND deleted_at IS NULL').bind(taskId).first();
}

export async function insertTaskSQL(db, row) {
  return prepareInsertTaskSQL(db, row).run();
}

export function prepareInsertTaskSQL(db, row) {
  return db.prepare(
    `INSERT INTO tasks (
      task_id, company_name, company_normalized, title, description,
      start_date, deadline_date, next_followup_date,
      status, priority, progress_percent, task_type,
      latest_note, completed_at, last_activity_at,
      created_by, created_at, updated_at, deleted_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`
  ).bind(
    row.task_id, row.company_name, row.company_normalized, row.title, row.description,
    row.start_date, row.deadline_date, row.next_followup_date,
    row.status, row.priority, row.progress_percent, row.task_type,
    row.latest_note, row.completed_at, row.last_activity_at,
    row.created_by, row.created_at, row.updated_at
  );
}

export async function updateTaskSQL(db, row) {
  return db.prepare(
    `UPDATE tasks SET
      company_name=?, company_normalized=?, title=?, description=?,
      deadline_date=?, next_followup_date=?,
      status=?, priority=?, progress_percent=?, task_type=?,
      latest_note=?, completed_at=?, last_activity_at=?, updated_at=?
     WHERE task_id=? AND deleted_at IS NULL`
  ).bind(
    row.company_name, row.company_normalized, row.title, row.description,
    row.deadline_date, row.next_followup_date,
    row.status, row.priority, row.progress_percent, row.task_type,
    row.latest_note, row.completed_at, row.last_activity_at, row.updated_at,
    row.task_id
  ).run();
}

export async function softDeleteTaskSQL(db, taskId, now) {
  return db.prepare('UPDATE tasks SET deleted_at=?, updated_at=? WHERE task_id=?')
    .bind(now, now, taskId).run();
}

export async function quickUpdateTaskStatusSQL(db, taskId, status, completedAt, now) {
  return db.prepare(
    `UPDATE tasks SET status=?, completed_at=?, last_activity_at=?, updated_at=?
     WHERE task_id=? AND deleted_at IS NULL`
  ).bind(status, completedAt, now, now, taskId).run();
}

export async function quickUpdateTaskPrioritySQL(db, taskId, priority, now) {
  return db.prepare(
    `UPDATE tasks SET priority=?, last_activity_at=?, updated_at=?
     WHERE task_id=? AND deleted_at IS NULL`
  ).bind(priority, now, now, taskId).run();
}

export async function suggestTaskCompaniesSQL(db, q, limit) {
  const res = await db.prepare(
    `SELECT DISTINCT company_name FROM tasks
     WHERE deleted_at IS NULL AND company_normalized LIKE ?
     ORDER BY company_name ASC LIMIT ?`
  ).bind(`${q}%`, limit).all();
  return (res.results || []).map((r) => r.company_name).filter(Boolean);
}
