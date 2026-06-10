# APP PERFORMANCE V1

Toàn bộ lấy từ code thực tế — không có pattern nào bịa.

## Rule 1: KV cache-aside cho read-heavy data

Data ít thay đổi (rooms, staff, services, reference lists) → cache KV, TTL 6h.

```js
// lib/cache.js — pattern chuẩn
const DEFAULT_TTL = 60 * 60 * 6; // 6h

export async function getKv(env, key) {
  try {
    const raw = await (env.KV || env.SPA_KV).get(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; } // KV lỗi → không crash, trả null
}

export async function setKv(env, key, value, ttl = DEFAULT_TTL) {
  try {
    await (env.KV || env.SPA_KV).put(key, JSON.stringify(value), { expirationTtl: ttl });
    return true;
  } catch { return false; }
}

export async function invalidateKv(env, keys = []) {
  await Promise.all([keys].flat().filter(Boolean).map(k =>
    (env.KV || env.SPA_KV).delete(k).catch(() => {})
  ));
}
```

**Key naming:**
```js
'rooms:v1'                    // danh sách phòng
'staff:v1'                    // danh sách nhân viên
'services:v1'                 // danh sách dịch vụ
`calendar:v1:${date}:all`     // calendar theo ngày
`calendar:v1:${date}:${room}` // calendar theo ngày + phòng
```

**Invalidate sau mutation — luôn làm:**
```js
async function invalidateBookingCache(env, date, roomId = '') {
  await invalidateKv(env, [
    'rooms:v1',
    `calendar:v1:${date}:all`,
    date && roomId ? `calendar:v1:${date}:${roomId}` : null,
  ].filter(Boolean));
}
```

## Rule 2: ctx.waitUntil — GAS + notification không block response

```js
// Response trả về ngay sau D1 xong
return json({ ok: true, bookingId });

// GAS sync chạy sau — nếu GAS chậm/lỗi không ảnh hưởng user
ctx.waitUntil(
  callGAS(env, 'createBooking', { booking: { ...p, lastActionMessage: log.message }, actor, log })
    .then(r => { if (!r?.ok) console.warn('GAS sync non-ok', r); })
    .catch(err => console.error('GAS sync error:', err))
);

// Notification fan-out cũng non-blocking
ctx.waitUntil(
  writeNotificationsForRoles(env, roles, notifParams)
    .catch(err => console.error('notification error:', err))
);
```

## Rule 3: GAS retry — 3 lần, backoff 500ms

```js
// lib/gas-client.js
const DEFAULT_RETRIES   = 3;
const DEFAULT_TIMEOUT   = 25000; // 25s — GAS có thể cold start chậm

for (let attempt = 1; attempt <= retries; attempt++) {
  try {
    const res = await fetch(env.GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action, secret: env.GAS_SECRET, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`GAS HTTP ${res.status}`);
    return await res.json().catch(() => null);
  } catch (err) {
    if (attempt < retries) await sleep(500 * attempt); // 500ms, 1000ms, 1500ms
  }
}
// Fail silently — GAS lỗi không crash app
return null;
```

## Rule 4: Cursor-based pagination — không dùng OFFSET

```js
// OFFSET trên D1 không tối ưu ở row lớn
// Dùng cursor (booking_id của row cuối) thay thế

export async function queryRecentBookingsSQL(db, { limit, cursor, fromDate, toDate }) {
  const conditions = [`(delete_status = '' OR delete_status IS NULL)`];
  const binds = [];
  if (fromDate) { conditions.push('date >= ?'); binds.push(fromDate); }
  if (toDate)   { conditions.push('date <= ?'); binds.push(toDate); }
  if (cursor)   { conditions.push('booking_id < ?'); binds.push(cursor); } // DESC cursor

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const res = await db.prepare(
    `SELECT * FROM bookings_app WHERE ${conditions.join(' AND ')}
     ORDER BY date DESC, booking_id DESC LIMIT ?`
  ).bind(...binds, safeLimit + 1).all(); // +1 để biết có trang tiếp

  const rows = res.results || [];
  const hasMore = rows.length > safeLimit;
  return {
    bookings:   hasMore ? rows.slice(0, safeLimit) : rows,
    hasMore,
    nextCursor: hasMore ? rows[safeLimit - 1]?.booking_id : null,
  };
}
```

## Rule 5: Denormalize — không JOIN trong query hot path

```sql
-- Lưu cả ID lẫn display name trong bookings
-- Tránh JOIN với staff/rooms/services mỗi query
booking_id, room_id, room_name, staff_id, staff_name, service_id, service_name
```

Khi room/staff thay đổi tên → `syncAllToD1` rebuild, hoặc chấp nhận tên cũ trong lịch sử (thường OK cho audit).

## Rule 6: Piggybacked cleanup — không tốn request riêng

```js
// Sau khi trả response notificationLogs → cleanup expired silently
ctx.waitUntil(
  env.DB.prepare(
    `DELETE FROM notifications_app WHERE expires_at IS NOT NULL AND expires_at < ?`
  ).bind(new Date().toISOString()).run().catch(() => {})
);

// Tương tự cho slot_locks expired
ctx.waitUntil(
  env.DB.prepare(
    `DELETE FROM slot_locks_v1 WHERE expire_at < ?`
  ).bind(new Date().toISOString()).run().catch(() => {})
);
```

## Rule 7: Monthly summary — rebuild, không incremental

```js
// Khi có void/rebate hoặc revenue correction
// Không tính incremental (dễ lệch) — rebuild toàn bộ tháng từ raw bookings

async function rebuildMonthlySummary(db, year, month) {
  const ym = `${year}-${String(month).padStart(2,'0')}`;
  const bookings = await db.prepare(
    `SELECT revenue, tip_amount, staff_id, service_id, service_name
     FROM bookings_app
     WHERE strftime('%Y-%m', date) = ?
       AND status = 'completed'
       AND (delete_status = '' OR delete_status IS NULL)
    `).bind(ym).all();

  // Aggregate từ raw data → INSERT OR REPLACE vào monthly_summary
  const revenue   = bookings.results.reduce((s, r) => s + (r.revenue || 0), 0);
  const commission = /* tính từ staff commission_pct */;
  await db.prepare(
    `INSERT OR REPLACE INTO monthly_summary_app (year_month, year, month, revenue, commission, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(ym, year, month, revenue, commission, new Date().toISOString()).run();
}
```

## Rule 8: Frontend không tính toán aggregation

```js
// SAI — frontend tự tính
const total = bookings.reduce((s, b) => s + b.revenue, 0);

// ĐÚNG — hỏi Worker
const res = await callAPI('getMonthlySummary', { year, month });
const { revenue, expense, profit } = res.summary;
```

## Rule 9: Search normalize Vietnamese trước khi index

```sql
-- Migration: thêm cột normalized
ALTER TABLE bookings_app ADD COLUMN guest_name_normalized TEXT DEFAULT '';
CREATE INDEX idx_bk_name_norm ON bookings_app(guest_name_normalized);
```

```js
// Normalize khi INSERT/UPDATE
function normalizeVN(str) {
  return (str || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g,'d').replace(/Đ/g,'D')
    .toLowerCase();
}
// Query: guest_name_normalized LIKE '%nguyen%' match cả "Nguyễn"
```

## Rule 10: D1 indexes — tạo từ đầu, không thêm sau

```sql
-- Tạo đủ trong 001_initial.sql, không chờ bị chậm rồi mới thêm
CREATE INDEX idx_bk_date   ON bookings_app(date);
CREATE INDEX idx_bk_room   ON bookings_app(room_id, date);    -- compound
CREATE INDEX idx_bk_staff  ON bookings_app(staff_id, date);   -- compound
CREATE INDEX idx_bk_status ON bookings_app(status);
CREATE INDEX idx_bk_phone  ON bookings_app(guest_phone);
CREATE INDEX idx_bk_bill   ON bookings_app(bill_number) WHERE bill_number != ''; -- partial
```
