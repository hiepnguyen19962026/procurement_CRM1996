# HAN TRAN PREFERENCES

Tất cả quan sát từ code thực trong repo — không suy luận.

## Ngôn ngữ

- **Code:** tiếng Anh (biến, hàm, comment kỹ thuật)
- **UI label / error message / toast:** tiếng Việt
- **Comment giải thích logic:** tiếng Việt OK, tiếng Anh OK, trộn cũng OK
- **Tên file:** kebab-case tiếng Anh (`booking-queries.js`, `void-queue.js`)

## Naming conventions

```js
// Worker handlers: camelCase action strings
'createBooking', 'updateBooking', 'updateStatus', 'voidRebateBooking'

// D1 columns: snake_case
booking_id, guest_name, start_time, bill_number, last_action_message

// JS payload: camelCase (tự normalize trong handler)
{ bookingId, guestName, startTime, billNumber }

// normalizeBookingPayload() xử lý cả 2 format
body.bookingId || body.booking_id

// GAS functions: camelCase + trailing underscore cho private
createBooking_(), validateSecret_(), readSheetAsObjects_()

// Constants: UPPER_SNAKE
MAX_ATTEMPTS, DEFAULT_TTL, BOOKING_WRITER_ROLES
```

## Comment style — từ repo

```js
// S11: booking worker handler. Ghi D1 trước, ghi audit log, return response, rồi ctx.waitUntil sync GAS.
// 1 nơi duy nhất gọi GAS — handlers không gọi GAS trực tiếp.
// Mutation flow: ghi D1 trước → trả response → ctx.waitUntil(callGAS(...)).
// Backward-compatible alias. New code must import from './action-log.js'.
// DÙNG 1 LẦN DUY NHẤT để khởi tạo Google Sheet
```

Pattern: ngắn gọn, 1 dòng, nói "tại sao" không chỉ "cái gì". Có dùng `→` để mô tả flow.

## CSS design tokens — từ spa-app.html

```css
:root {
  --primary:     #d97706;   /* amber-600 */
  --primary-dk:  #b45309;   /* amber-700 */
  --primary-lt:  #fef3c7;   /* amber-100 */
  --primary-bg:  #fffbeb;   /* amber-50 */
  --green:       #15803d;
  --green-lt:    #dcfce7;
  --red:         #dc2626;
  --red-lt:      #fef2f2;
  --blue:        #1d4ed8;
  --blue-lt:     #eff6ff;
  --teal:        #0d7a5f;
  --teal-lt:     #f0fdf4;
  --border:      #e5e7eb;
  --border-mid:  #d1d5db;
  --text:        #111827;
  --text-muted:  #6b7280;
  --text-faint:  #9ca3af;
  --bg:          #f9fafb;
  --white:       #ffffff;
  --sidebar-w:   210px;
  --header-h:    52px;
  --radius:      10px;
  --shadow-sm:   0 1px 3px rgba(0,0,0,.08);
  --shadow-md:   0 4px 16px rgba(0,0,0,.10);
}
```

Màu primary là amber/vàng cam. Luôn dùng CSS variables, không hardcode hex.

## HTML meta tags — PWA chuẩn

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="theme-color" content="#d97706">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="/manifest.json">
```

## Money input — không dùng type="number"

```js
// Từ booking.js — pattern xử lý money input
function parseMoneyValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  return Number(raw.replace(/[^\d-]/g, '')) || 0;
}

function formatMoneyInput(value) {
  const num = Number(value || 0);
  if (!num) return '';
  return String(Math.round(num)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // dấu chấm ngăn cách
}

// Input: type="text", inputmode="numeric"
// Hiển thị: "500.000" (dấu chấm, không có ₫ trong input)
// Lưu/gửi: số nguyên 500000
```

## Bill number validation

```js
// Từ booking.js và booking handler
function isValidBillNumber(value) {
  const bill = String(value ?? '');
  return bill === '' || /^(\d{4}|\d{6})$/.test(bill); // 4 hoặc 6 chữ số
}

function sanitizeBillNumber(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}
```

## Timezone — luôn Asia/Ho_Chi_Minh

```js
// lib/action-log.js — timestampVN()
function timestampVN(date = new Date()) {
  const vn = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return `${pad2(vn.getHours())}:${pad2(vn.getMinutes())}:${pad2(vn.getSeconds())} `
       + `${pad2(vn.getDate())}/${pad2(vn.getMonth()+1)}/${vn.getFullYear()}`;
}

// actionTimestamp cho log message: "HH:MM YYYY-MM-DD"
function actionTimestamp(date = new Date()) {
  const vn = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return `${pad2(vn.getHours())}:${pad2(vn.getMinutes())} `
       + `${vn.getFullYear()}-${pad2(vn.getMonth()+1)}-${pad2(vn.getDate())}`;
}
```

## Log message format — 1 câu, đủ context

```
// booking_created:
"New booking SPA-2025-00123 created for Nguyen Van A (Vietnam) - Swedish 60' at 10:00 on 2025-06-05 by Lan"

// booking_updated (với diff):
"Lan edited SPA-2025-00123, Nguyen Van A: Revenue: 500000 -> 600000; Start Time: 10:00 -> 11:00. Edit time: 14:30 2025-06-05"

// booking_checkin:
"Lan confirmed SPA-2025-00123, Nguyen Van A: Swedish 60' at 10:00 started at 10:03. Action time: 10:03 2025-06-05"
```

Pattern: `{actor} {verb} {id}, {guestName}: {changes}. {type} time: {HH:MM YYYY-MM-DD}`

## GAS conventions

```js
// Private functions có trailing underscore
function handleBookingAction_(params) {}
function validateSecret_(p) {}
function readSheetAsObjects_(sheetName) {}

// ensureSheetHeaders_ — KHÔNG rewrite cột cũ, chỉ append thiếu
function ensureSheetHeaders_(sh, expectedHeaders) {
  const current = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const missing = expectedHeaders.filter(h => !current.includes(h));
  if (!missing.length) return;
  sh.getRange(1,1,1,current.length+missing.length).setValues([[...current.filter(Boolean),...missing]]);
}

// Update booking — self-heal nếu không tìm thấy row
// Tìm không thấy → append, không throw error
if (rowIdx === -1) { sh.appendRow(buildRowFromObject_(b, headers)); return jsonOut_({ok:true,mode:'appended'}); }
```

## Error responses — format chuẩn

```js
// Worker: luôn { ok: false, error: 'message string' }
return json({ ok: false, error: 'Không tìm thấy booking' }, 404);
return json({ ok: false, error: 'Slot đã bị trùng', conflict }, 409);
return json({ ok: false, error: 'Không có quyền' }, 403);

// Frontend toast prefix:
// ✅ success   ❌ error   ⚠️ warn/conflict   ⛔ forbidden   🔄 sync needed   ⏳ rate limit
```

## Status badges — naming

```
scheduled  → "Đã đặt"    (blue)
in_progress → "Đang làm" (yellow/amber)
completed  → "Hoàn thành" (green)
cancelled  → "Đã hủy"    (red)
no_show    → "Vắng mặt"  (gray)
pending    → "Chờ duyệt" (amber)
approved   → "Đã duyệt"  (green)
rejected   → "Từ chối"   (red)
```

## IIFE pattern cho frontend modules

```js
// Từ booking.js, void-queue.js — dùng IIFE để tránh pollute global scope
(function () {
  var STATE = { ... };
  function init() { ... }
  function render() { ... }
  // expose ra global chỉ những gì cần
  window.BookingModule = { init, openForm };
})();
```

## Không dùng

- `localStorage` — dùng `sessionStorage` cho session cache
- `alert()` / `confirm()` — dùng modal custom
- `innerHTML` với untrusted data — dùng `esc()` + `textContent`
- `type="number"` cho tiền — dùng `type="text"` + `inputmode="numeric"`
- Polling liên tục — dùng load on demand
- Fallback GAS khi D1 đủ khả năng trả data
- Tính aggregation ở frontend
- String interpolation trong SQL — luôn prepared statement
