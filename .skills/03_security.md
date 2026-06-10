# APP SECURITY V1

Toàn bộ lấy từ code thực — không có pattern nào suy luận.

## Defense in depth — 2 lớp kiểm tra

```
L1 Vercel Gateway:   JWT verify + role action whitelist
L2 Cloudflare Worker: WORKER_SECRET verify + role level check trong handler
```

Cả 2 lớp phải pass. Lớp 1 lọc request ngoài vào. Lớp 2 bảo vệ khi Worker URL bị leak trực tiếp.

## L1: JWT httpOnly cookie

```js
// api/fetch-data.js
const COOKIE_NAME  = 'spa_sess';   // đổi tên theo app
const JWT_EXPIRES  = 8 * 60 * 60; // 8h

// Sign — thuần Web Crypto API, không cần package
async function signJWT(payload, secret, expiresSec) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now()/1000),
    exp: Math.floor(Date.now()/1000) + expiresSec,
  }));
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

// Set cookie — httpOnly + Secure + SameSite=Strict
const cookie = [
  `${COOKIE_NAME}=${token}`,
  'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict',
  `Max-Age=${JWT_EXPIRES}`,
].join('; ');
```

## L1: Role action whitelist (gateway)

```js
// Hai tier: staff thấy ít hơn manager
const STAFF_ALLOWED = [
  'ping', 'logout', 'changePassword',
  'rooms', 'getServiceList', 'getSlotCalendar', 'lockSlot', 'unlockSlot',
  'createBooking', 'updateBooking', 'updateStatus',
  'recentBookings', 'searchBookings', 'getBookingDetail',
  'requestDeleteBooking', 'requestVoidRebate',
  'notificationLogs', 'markNotificationRead',
  // ...
];

const MANAGER_ALLOWED = [
  ...STAFF_ALLOWED,
  'getMonthlySummary', 'getExpenseDashboard', 'addExpense',
  'cancelBooking', 'confirmCancel',
  'approveDeleteBooking', 'voidRebateBooking', 'approveVoidRebate',
  'actionLogs', 'getAuditLogs', 'getRecentAuditLogs',
  'syncAllToD1', 'clearKvCache',
  // ...
];

const MANAGER_ROLES = ['admin', 'director', 'manager', 'assistant_manager', 'supervisor'];
const allowed = MANAGER_ROLES.includes(role) ? MANAGER_ALLOWED : STAFF_ALLOWED;
if (!allowed.includes(action)) return json({ ok: false, error: 'Not allowed' }, 403);
```

## L1: Actor encoding Vercel → Worker

```js
// Gateway encode actor vào header — Worker không tin body
// base64url để safe trong HTTP header
function encodeActor(actor) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(actor))))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
headers['X-App-Actor']    = encodeActor({ id: staffId, role, name, username, session_version });
headers['X-Worker-Secret'] = process.env.WORKER_SECRET;

// Worker decode
function actorFromRequest(req) {
  const raw = req.headers.get('X-App-Actor');
  const normalized = raw.replace(/-/g,'+').replace(/_/g,'/');
  const padded = normalized.padEnd(Math.ceil(normalized.length/4)*4, '=');
  return JSON.parse(new TextDecoder().decode(
    Uint8Array.from(atob(padded), c => c.charCodeAt(0))
  ));
}
```

## L2: Worker secret validation

```js
// lib/auth.js
export function validateSecret(request, env) {
  const expected = env?.WORKER_SECRET;
  if (!expected) return false;
  const fromHeader = request.headers.get('X-Worker-Secret');
  const fromBearer = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  return fromHeader === expected || fromBearer === expected;
}
// index.js — first line of fetch()
if (!validateSecret(request, env)) return json({ ok: false, error: 'Forbidden' }, 403);
```

## L2: Role check trong handler

```js
// Mỗi handler tự check role — không tin gateway
const MANAGER_ROLES     = new Set(['admin','director','manager','assistant_manager','supervisor']);
const BOOKING_WRITERS   = new Set([...MANAGER_ROLES, 'receptionist']);
const VOID_REBATE_ROLES = new Set(['admin','director','manager','assistant_manager']);

function assertRole(actor, allowed) { return allowed.has(actor?.role); }

async function voidRebateBooking(request, env, ctx, actor) {
  if (!assertRole(actor, VOID_REBATE_ROLES))
    return json({ ok: false, error: 'Only manager/director can perform void/rebate' }, 403);
  // ...
}
```

## Password: PBKDF2-HMAC-SHA-256

```js
// lib/password.js
// Format lưu: "pbkdf2_sha256$100000$saltB64$hashB64"
// Không bao giờ log password, hash, hoặc salt

export async function hashPasswordPBKDF2(password, options = {}) {
  const iterations = Math.max(options.iterations || 100000, 100000);
  const salt = options.salt || crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256
  );
  return `pbkdf2_sha256$${iterations}$${b64(salt)}$${b64(bits)}`;
}

// Constant-time compare — chống timing attack
export function constantTimeEqual(a, b) {
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    diff |= (left[i]||0) ^ (right[i]||0);
  return diff === 0;
}
```

## Session versioning — kick sessions sau đổi mật khẩu

```js
// D1: session_version INTEGER DEFAULT 1
// Sau changePassword → session_version += 1 → tất cả JWT cũ invalid ngay

// Worker authValidateSession:
const account = await getAccountByStaffId(env.DB, staffId);
if (Number(account.session_version) !== Number(payload.session_version))
  return json({ ok: false }, 401); // JWT cũ → reject

// Gateway: sau changePassword → re-sign JWT với session_version mới
if (action === 'changePassword' && data?.ok) {
  return issueSessionResponse({ ...data }); // JWT mới + cookie mới
}
```

## Brute force — 2 lớp

```js
// L1 client-side (sessionStorage):
const MAX_ATTEMPTS = 5, LOCK_MS = 15 * 60 * 1000;
// 5 lần sai → lock client 15 phút

// L2 server-side (D1):
// failed_login_count++, locked_until = now + 15min khi đạt MAX_ATTEMPTS
// authLogin check: if (account.locked_until > now) return 429
await recordLoginFailed(env.DB, account.id, MAX_ATTEMPTS, LOCK_MS);
```

## Account status flow

```
inactive  → activate → active
active    → deactivate → inactive
active    → freeze → frozen   (admin only, immediate)
*         → archive → archived (không login được nữa)
forceLogout: session_version++ → kick ngay không cần logout
```

```sql
-- D1 schema có CHECK constraint — không thể set status lạ
status TEXT NOT NULL DEFAULT 'inactive' CHECK (
  status IN ('active', 'inactive', 'frozen', 'archived')
),
role TEXT NOT NULL CHECK (
  role IN ('admin','director','manager','assistant_manager',
           'supervisor','receptionist','therapist','staff')
)
```

## Strip price fields — therapist/staff không thấy revenue

```js
// api/fetch-data.js
const STRIP_ACTIONS = ['getBookingDetail', 'recentBookings', 'searchBookings'];
const PRICE_FIELDS  = ['totalAmount','price','commissionAmt','revenue','expense',
                       'profit','commission','tipAmount','retailAmount','menuPrice'];

function stripPriceFields(data, action) {
  if (!STRIP_ACTIONS.includes(action)) return data;
  function strip(obj) {
    if (Array.isArray(obj)) return obj.map(strip);
    if (obj && typeof obj === 'object') {
      const out = { ...obj };
      PRICE_FIELDS.forEach(f => delete out[f]);
      return out;
    }
    return obj;
  }
  return strip(data);
}

const isLimited = ['therapist', 'staff'].includes(role);
if (isLimited && data?.ok) data = stripPriceFields(data, action);
```

## Input validation — whitelist fields, không trust body

```js
// Normalize payload — strip unknown keys
function normalizeBookingPayload(body = {}) {
  return {
    bookingId:   body.bookingId   || body.booking_id  || '',
    roomId:      body.roomId      || body.room_id      || '',
    staffId:     body.staffId     || body.staff_id     || '',
    date:        body.date        || '',
    startTime:   body.startTime   || body.start_time   || '',
    // ... chỉ những field biết trước
  };
  // Keys không có trong list → bị bỏ
}

// changedFieldsJson — whitelist keys trước khi lưu audit
const FIELD_WHITELIST = new Set([
  'bookingId','guestName','guestPhone','country',
  'serviceId','roomId','staffId','date','startTime','endTime',
  'status','billNumber','revenue','menuPrice','note',
  // ...
]);
function changedKeysFromBody(body) {
  return Object.keys(body || {}).filter(k => FIELD_WHITELIST.has(k));
}
```

## SQL injection prevention

```js
// LUÔN dùng prepared statements + bind — không bao giờ string interpolation
await db.prepare(
  `SELECT * FROM bookings_app WHERE booking_id = ? AND staff_id = ?`
).bind(bookingId, staffId).first();

// XSS — escape trong frontend khi render untrusted data
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, m =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m])
  );
}
```

## Audit trail — security accountability

```sql
-- Mọi mutation có before_json + after_json
-- Không bao giờ lưu password_hash, salt, session_version vào audit log
-- compactAccountSnapshot() loại bỏ credentials trước khi snapshot
```

## Secrets checklist

```
JWT_SECRET:      ≥ 32 ký tự random, không commit vào git
WORKER_SECRET:   random string, dùng để Vercel → Worker
GAS_SECRET:      random string, dùng để Worker → GAS
GAS_URL:         URL sau khi deploy GAS (không public trong code)
Tất cả:          Vercel env + Cloudflare secret, không trong .env committed
```
