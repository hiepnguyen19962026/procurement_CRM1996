# APP ARCHITECTURE V1

## Stack

```
Browser (Vanilla JS, PWA, mobile-first)
    ↓ fetch credentials:include + cookie
[L1] Vercel Edge  api/fetch-data.js     JWT verify + role whitelist + proxy
    ↓ X-App-Actor (base64url JSON) + X-Worker-Secret
[L2] Cloudflare Worker  src/worker/     Business logic + D1 queries
    ↓ env.DB (D1) + env.KV
[L3] D1 (SQLite source of truth) + KV (cache, TTL 6h)
    ↓ ctx.waitUntil — NON-BLOCKING
[L4] Google Apps Script  src/gas/       Sheet backup only
```

## Mutation order — bất biến, không exception

```js
// 1. Ghi D1
await writeSQL(env.DB, payload);
// 2. Pre-build audit message TRƯỚC (để D1 + GAS + notification cùng string)
const preLog = buildActionLog({ action, actor, oldSnap, newSnap });
await writeSQL(env.DB, { ...payload, last_action_message: preLog.message });
// 3. Ghi audit log
const log = await writeActionLog(env, { ...opts, message: preLog.message });
// 4. Invalidate KV
await invalidateKv(env, ['rooms:v1', `calendar:v1:${date}:all`]);
// 5. Return response ngay
return json({ ok: true });
// 6. GAS + notification — non-blocking
ctx.waitUntil(callGAS(env, action, { ...payload, lastActionMessage: log.message, actor, log }));
ctx.waitUntil(writeNotificationsForRoles(env, roles, { message: log.message, ref_id: log.log_id }));
```

## File structure chuẩn

```
project/
├── api/fetch-data.js              Vercel Edge Gateway (JWT, whitelist, proxy)
├── src/
│   ├── worker/
│   │   ├── index.js               Router only — không chứa logic
│   │   ├── handlers/              1 file = 1 nhóm (booking.js, staff.js, revenue.js...)
│   │   ├── db/
│   │   │   ├── *-queries.js       SQL thuần, không business logic
│   │   │   └── migrations/        001_initial.sql, 002_xxx.sql — KHÔNG sửa 001
│   │   └── lib/
│   │       ├── auth.js            actorFromRequest, validateSecret, roleLevel, canPerform
│   │       ├── action-log.js      buildActionLog, writeActionLog, writeNotification
│   │       ├── cache.js           getKv, setKv, invalidateKv (DEFAULT_TTL = 6h)
│   │       ├── gas-client.js      callGAS (retry 3x, timeout 25s, non-blocking)
│   │       ├── password.js        hashPasswordPBKDF2, verifyPasswordPBKDF2
│   │       └── utils.js           jsonResponse, genId, nowVN, nextEntityId
│   └── gas/
│       ├── main.gs                doGet/doPost + routing
│       ├── booking.gs             ghi Bookings sheet
│       ├── sync.gs                buildOptimizedDataset_ + syncAllToD1_
│       ├── setup.gs               chạy 1 lần — tạo sheets + sample data
│       └── utils.gs               readSheetAsObjects_, callWorker_, jsonOut_, ensureSheetHeaders_
├── assets/js/
│   ├── core/api.js                callAPI (GET), callAPIPost (POST), showToast, _handleApiError
│   ├── core/auth.js               doLogin, doLogout, initSession, saveSessionCache, applyRoleUI
│   └── modules/                   1 file = 1 module UI
├── wrangler.toml                  D1 binding + KV binding + compatibility_date
├── vercel.json
├── manifest.json                  PWA
└── sw.js                          cache static, bypass /api/
```

## index.js — router pattern

```js
// Khai báo action groups — không có logic
const BOOKING_ACTIONS = ['createBooking', 'updateBooking', 'updateStatus', ...];
const STAFF_ACTIONS   = ['getStaffList', 'getStaffKpi', ...];

export default {
  async fetch(request, env, ctx) {
    if (!validateSecret(request, env)) return json({ ok: false, error: 'Forbidden' }, 403);
    const action = await getAction(request);
    const actor  = actorRoleFromRequest(request); // decode X-App-Actor header
    if (BOOKING_ACTIONS.includes(action)) return handleBooking(action, request, env, ctx, actor);
    if (STAFF_ACTIONS.includes(action))   return handleStaff(action, request, env, ctx, actor);
    // ...
  }
};
```

## Entity ID format

```js
// utils.js — nextEntityId(db, table, idCol, prefix, dateStr)
// SPA-2025-00001, HMS-2025-00001, PDO-2025-00001, ORD-2025-00001
async function nextEntityId(db, table, idCol, prefix, dateStr) {
  const year = (dateStr || new Date().toISOString()).slice(0, 4);
  const row = await db.prepare(
    `SELECT ${idCol} FROM ${table} WHERE ${idCol} LIKE ? ORDER BY ${idCol} DESC LIMIT 1`
  ).bind(`${prefix}-${year}-%`).first();
  const last = row ? parseInt(row[idCol].split('-')[2], 10) : 0;
  return `${prefix}-${year}-${String((isFinite(last)?last:0)+1).padStart(5,'0')}`;
}
```

## Role levels

```js
// lib/auth.js
const ROLE_LEVEL = {
  staff: 1,
  // level 2-3: đặt tên theo loại hình (therapist / housekeeper / appraiser / worker...)
  receptionist: 3,
  supervisor: 4,
  assistant_manager: 5,
  manager: 6,
  director: 7,
  admin: 8,
};
```

## wrangler.toml

```toml
name = "app-worker"
main = "src/worker/index.js"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "app-db"
database_id = "..."

[[kv_namespaces]]
binding = "KV"
id = "..."
```

## Secrets

```
Cloudflare (wrangler secret put):  GAS_URL, GAS_SECRET, WORKER_SECRET, JWT_SECRET
Vercel env:                        WORKER_URL, WORKER_SECRET, JWT_SECRET
GAS Script Properties:             WORKER_URL, WORKER_SECRET, GAS_SECRET
```

## Thêm module mới — checklist

1. Migration: `migrations/00N_module.sql`
2. Queries: `db/module-queries.js` — SQL thuần
3. Handler: `handlers/module.js`
4. Route: thêm `MODULE_ACTIONS` array trong `index.js`
5. Gateway: thêm vào `STAFF_ALLOWED` hoặc `MANAGER_ALLOWED`
6. GAS: thêm route trong `main.gs`, tạo `module.gs` nếu cần ghi Sheet
7. Frontend: `assets/js/modules/module.js`
