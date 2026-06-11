import {
  listTasksSQL, getTasksSummarySQL, getTaskSQL,
  insertTaskSQL, updateTaskSQL, softDeleteTaskSQL,
  quickUpdateTaskStatusSQL, quickUpdateTaskPrioritySQL,
  suggestTaskCompaniesSQL,
} from '../db/task-queries.js';
import { ALL_ROLES, WRITE_ROLES, MANAGE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { normalizeText, cleanString } from '../lib/normalize.js';
import { clampLimit, json, nextEntityId, nowIso, readJson } from '../lib/utils.js';

const VALID_STATUS   = new Set(['dang_lam', 'cho_phan_hoi', 'tam_dung', 'hoan_thanh', 'huy_bo']);
const VALID_PRIORITY = new Set(['khan', 'cao', 'trung_binh', 'thap']);

export async function handleTasks(action, request, env, ctx, actor) {
  if (action === 'getTasks')               return listTasks(request, env, actor);
  if (action === 'createTask')             return saveTask(request, env, ctx, actor, false);
  if (action === 'updateTask')             return saveTask(request, env, ctx, actor, true);
  if (action === 'deleteTask')             return deleteTask(request, env, ctx, actor);
  if (action === 'quickUpdateTaskStatus')  return quickUpdateStatus(request, env, ctx, actor);
  if (action === 'quickUpdateTaskPriority') return quickUpdatePriority(request, env, ctx, actor);
  if (action === 'suggestTaskCompanies')   return suggestCompanies(request, env, actor);
  return json({ ok: false, error: 'Unknown task action' }, 400);
}

async function listTasks(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const limit = clampLimit(p.limit);
  const [data, summary] = await Promise.all([
    listTasksSQL(env.DB, {
      q:        normalizeText(p.q),
      company:  normalizeText(p.company),
      status:   p.status  || '',
      priority: p.priority || '',
      cursor:   p.cursor   || '',
      sortBy:   p.sortBy   || '',
      sortDir:  p.sortDir  || '',
      limit,
    }),
    getTasksSummarySQL(env.DB),
  ]);
  return json({ ok: true, ...data, summary });
}

async function saveTask(request, env, ctx, actor, isUpdate) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body = await readJson(request);

  const title = cleanString(body.title || '', 300);
  if (!title) return json({ ok: false, error: 'Tên task là bắt buộc' }, 400);

  const now       = nowIso();
  const todayDate = now.slice(0, 10);

  const taskId = isUpdate ? cleanString(body.taskId || body.task_id, 50) : null;
  const oldRow = isUpdate ? await getTaskSQL(env.DB, taskId) : null;
  if (isUpdate && !oldRow) return json({ ok: false, error: 'Không tìm thấy task' }, 404);

  const companyName = cleanString(body.companyName || body.company_name || '', 200);
  const status   = VALID_STATUS.has(body.status)   ? body.status   : (oldRow?.status   || 'dang_lam');
  const priority = VALID_PRIORITY.has(body.priority) ? body.priority : (oldRow?.priority || 'trung_binh');
  const progressRaw = Number(body.progressPercent ?? body.progress_percent ?? oldRow?.progress_percent ?? 0);
  const progressPercent = Math.min(100, Math.max(0, Number.isFinite(progressRaw) ? Math.trunc(progressRaw) : 0));

  let completedAt = oldRow?.completed_at || null;
  if (status === 'hoan_thanh' && !completedAt) completedAt = now;
  if (status !== 'hoan_thanh') completedAt = null;

  const row = {
    task_id:            isUpdate ? oldRow.task_id : await nextEntityId(env.DB, 'tasks', 'task_id', 'TASK'),
    company_name:       companyName,
    company_normalized: normalizeText(companyName),
    title,
    description:         cleanString(body.description       || '', 2000),
    // start_date is always backend-generated on create; on update keep existing value
    start_date:          isUpdate ? (oldRow.start_date || todayDate) : todayDate,
    deadline_date:       cleanString(body.deadlineDate       || body.deadline_date       || '', 10) || null,
    next_followup_date:  cleanString(body.nextFollowupDate   || body.next_followup_date   || '', 10) || null,
    status,
    priority,
    progress_percent:    progressPercent,
    task_type:           cleanString(body.taskType           || body.task_type           || '', 100),
    latest_note:         cleanString(body.latestNote         || body.latest_note         || '', 1000),
    completed_at:        completedAt,
    last_activity_at:    now,
    created_by:          isUpdate ? oldRow.created_by : (actor?.id || ''),
    created_at:          oldRow?.created_at || now,
    updated_at:          now,
  };

  if (isUpdate) await updateTaskSQL(env.DB, row);
  else          await insertTaskSQL(env.DB, row);

  const taskLabel = row.company_name ? `"${row.title}" — ${row.company_name}` : `"${row.title}"`;
  ctx.waitUntil(writeActionLog(env, {
    action:     isUpdate ? 'updateTask' : 'createTask',
    entityType: 'task',
    entityId:   row.task_id,
    message:    isUpdate ? `Cập nhật task: ${taskLabel}` : `Tạo task mới: ${taskLabel}`,
    oldJson:    oldRow,
    newJson:    row,
    actor,
  }));
  return json({ ok: true, task: row });
}

async function deleteTask(request, env, ctx, actor) {
  const denied = requireRole(actor, MANAGE_ROLES);
  if (denied) return denied;
  const body   = await readJson(request);
  const taskId = cleanString(body.taskId || body.task_id, 50);
  if (!taskId) return json({ ok: false, error: 'Thiếu task_id' }, 400);
  const row = await getTaskSQL(env.DB, taskId);
  if (!row) return json({ ok: false, error: 'Không tìm thấy task' }, 404);
  const now = nowIso();
  await softDeleteTaskSQL(env.DB, taskId, now);
  const deletedLabel = row.company_name ? `"${row.title}" — ${row.company_name}` : `"${row.title}"`;
  ctx.waitUntil(writeActionLog(env, {
    action:     'deleteTask',
    entityType: 'task',
    entityId:   taskId,
    message:    `Xóa task: ${deletedLabel}`,
    oldJson:    row,
    newJson:    null,
    actor,
  }));
  return json({ ok: true });
}

async function quickUpdateStatus(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body   = await readJson(request);
  const taskId = cleanString(body.taskId || body.task_id, 50);
  const status = body.status;
  if (!taskId)               return json({ ok: false, error: 'Thiếu task_id' }, 400);
  if (!VALID_STATUS.has(status)) return json({ ok: false, error: 'Trạng thái không hợp lệ' }, 400);
  const row = await getTaskSQL(env.DB, taskId);
  if (!row) return json({ ok: false, error: 'Không tìm thấy task' }, 404);
  const now = nowIso();
  let completedAt = row.completed_at;
  if (status === 'hoan_thanh' && !completedAt) completedAt = now;
  if (status !== 'hoan_thanh') completedAt = null;
  await quickUpdateTaskStatusSQL(env.DB, taskId, status, completedAt, now);
  ctx.waitUntil(writeActionLog(env, {
    action:     'quickUpdateTaskStatus',
    entityType: 'task',
    entityId:   taskId,
    message:    `Đổi trạng thái task "${row.title}": ${row.status} → ${status}`,
    oldJson:    { status: row.status },
    newJson:    { status },
    actor,
  }));
  return json({ ok: true });
}

async function quickUpdatePriority(request, env, ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;
  const body     = await readJson(request);
  const taskId   = cleanString(body.taskId || body.task_id, 50);
  const priority = body.priority;
  if (!taskId)                 return json({ ok: false, error: 'Thiếu task_id' }, 400);
  if (!VALID_PRIORITY.has(priority)) return json({ ok: false, error: 'Ưu tiên không hợp lệ' }, 400);
  const row = await getTaskSQL(env.DB, taskId);
  if (!row) return json({ ok: false, error: 'Không tìm thấy task' }, 404);
  const now = nowIso();
  await quickUpdateTaskPrioritySQL(env.DB, taskId, priority, now);
  ctx.waitUntil(writeActionLog(env, {
    action:     'quickUpdateTaskPriority',
    entityType: 'task',
    entityId:   taskId,
    message:    `Đổi ưu tiên task "${row.title}": ${row.priority} → ${priority}`,
    oldJson:    { priority: row.priority },
    newJson:    { priority },
    actor,
  }));
  return json({ ok: true });
}

async function suggestCompanies(request, env, actor) {
  const denied = requireRole(actor, ALL_ROLES);
  if (denied) return denied;
  const p = await readJson(request);
  const q = normalizeText(p.q || '');
  const limit = q ? 10 : Math.min(Number(p.limit) || 20, 20);
  const suggestions = await suggestTaskCompaniesSQL(env.DB, q, limit);
  return json({ ok: true, suggestions });
}
