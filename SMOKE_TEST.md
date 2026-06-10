# Phase 1 Smoke Test

Run these after logging in on the Vercel production site as `admin`, `manager`, or `purchasing`.

Open DevTools -> Console. Run each block in order.

## 0. Session

```js
Auth.session()
```

Expected: a user object with role `admin`, `manager`, or `purchasing`.

## 1. Ping

Action: `ping`

```js
await API.call('ping', {})
```

Expected: `{ ok: true, pong: true }`.

## 2. Create Client

Action: `createClient`

```js
window.smoke = window.smoke || {};
smoke.client = await API.call('createClient', {
  clientName: 'Smoke CDT ' + Date.now(),
  plantName: 'Smoke Plant',
  province: 'Ha Noi',
  note: 'Phase 1 smoke test'
});
smoke.client
```

Expected: `{ ok: true, client: ... }`.

## 3. List Clients

Action: `getClients`

```js
smoke.clients = await API.get('getClients', {
  q: smoke.client.client.client_name,
  limit: 5
});
smoke.clients
```

Expected: `rows` includes the created client.

## 4. Create Supplier

Action: `createSupplier`

```js
smoke.supplier = await API.call('createSupplier', {
  supplierName: 'Smoke Supplier ' + Date.now(),
  supplierType: 'trader',
  country: 'VN',
  contactName: 'Smoke Contact',
  email: 'smoke@example.com',
  phone: '0900000000',
  note: 'Phase 1 smoke test'
});
smoke.supplier
```

Expected: `{ ok: true, supplier: ... }`.

## 5. List Suppliers

Action: `getSuppliers`

```js
smoke.suppliers = await API.get('getSuppliers', {
  q: smoke.supplier.supplier.supplier_name,
  limit: 5
});
smoke.suppliers
```

Expected: `rows` includes the created supplier.

## 6. Create RFQ

Action: `createRfq`

```js
smoke.rfq = await API.call('createRfq', {
  clientId: smoke.client.client.client_id,
  tenGoi: 'Smoke RFQ ' + Date.now(),
  maGoiTbmt: 'TBMT-SMOKE-' + Date.now(),
  nhaMayCdt: 'Smoke Plant',
  ngayNhanHoacDangTai: '2026-06-10',
  ngayHetHan: '2026-06-30',
  duToan: 1000000,
  trangThaiGoi: 'dang_khao_gia',
  note: 'Phase 1 smoke test'
});
smoke.rfq
```

Expected: `{ ok: true, rfq: ... }`.

## 7. List RFQs

Action: `getRfqs`

```js
smoke.rfqs = await API.get('getRfqs', {
  q: smoke.rfq.rfq.ten_goi,
  limit: 5
});
smoke.rfqs
```

Expected: `rows` includes the created RFQ.

## 8. Create RFQ Item

Action: `createRfqItem`

```js
smoke.item = await API.call('createRfqItem', {
  rfqId: smoke.rfq.rfq.rfq_id,
  sttGoc: '1',
  maMuaSam: 'MS-SMOKE',
  maVatTu: 'VT-SMOKE-' + Date.now(),
  tenVatTu: 'Smoke bearing 6310',
  quyCachModelYeuCau: 'SKF 6310',
  hangGocNsxGoc: 'SKF',
  xuatXu: 'EU',
  soLuong: 2,
  donVi: 'cai',
  trangThaiDong: 'dang_hoi_gia',
  thongSoKyThuat: 'Phase 1 smoke test item'
});
smoke.item
```

Expected: `{ ok: true, item: ... }`.

## 9. List RFQ Items

Action: `getRfqItems`

```js
smoke.items = await API.get('getRfqItems', {
  q: '6310',
  rfqId: smoke.rfq.rfq.rfq_id,
  limit: 5
});
smoke.items
```

Expected: `rows` includes the created RFQ item.

## 10. Dashboard Summary

Action: `getDashboard`

```js
smoke.dashboard = await API.get('getDashboard', {});
smoke.dashboard
```

Expected: `summary.rfqs`, `summary.items`, and `summary.suppliers` are numbers.

## 11. Audit Log

Action: `getAuditLogs`

```js
smoke.audit = await API.get('getAuditLogs', {
  q: smoke.rfq.rfq.rfq_id,
  limit: 20
});
smoke.audit
```

Expected for `admin` or `manager`: `{ ok: true, rows: ... }`. At least one row should reference the RFQ or related mutation.

For `purchasing`, this action should be blocked by role:

```js
await API.get('getAuditLogs', { limit: 1 })
```

Expected: `Khong co quyen`.

## 12. Upload Disabled In Phase 1

Endpoint: `/api/upload`

```js
const fd = new FormData();
fd.append('file', new Blob(['smoke'], { type: 'text/plain' }), 'smoke.txt');
await fetch('/api/upload', {
  method: 'POST',
  credentials: 'include',
  body: fd
}).then(async (res) => ({ status: res.status, body: await res.json() }))
```

Expected: status `501` and message that upload is disabled until MIME allowlist and magic-byte validation are implemented.

## 13. Cursor Pagination

Action: `getRfqItems`

```js
const page1 = await API.get('getRfqItems', { limit: 2 });
const page2 = page1.nextCursor
  ? await API.get('getRfqItems', { limit: 2, cursor: page1.nextCursor })
  : null;
({ page1, page2 })
```

Expected: first page returns at most 2 rows. Second page only runs when `nextCursor` exists.
