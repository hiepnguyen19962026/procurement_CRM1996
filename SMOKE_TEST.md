# Smoke Test

Run after migrations, Worker deploy, Vercel env vars, and first admin setup.

Open the site, press F12, and use the browser console.

## Session

```js
Auth.session()
```

Expected: current user object with `role`.

## Dashboard

```js
await API.get('getDashboard', {})
```

Expected: `{ ok: true, summary: ... }`.

## Create Client

```js
await API.call('createClient', {
  clientName: 'Test CDT',
  plantName: 'Test Plant',
  province: 'Ha Noi',
  note: 'Smoke test'
})
```

Then:

```js
await API.get('getClients', { q: 'test', limit: 5 })
```

## Create Supplier

```js
await API.call('createSupplier', {
  supplierName: 'Test Supplier',
  supplierType: 'trader',
  country: 'VN',
  contactName: 'Buyer Contact',
  phone: '0900000000'
})
```

Then:

```js
await API.get('getSuppliers', { q: 'test', limit: 5 })
```

## Create RFQ

```js
const rfq = await API.call('createRfq', {
  tenGoi: 'Smoke RFQ',
  maGoiTbmt: 'TBMT-SMOKE',
  nhaMayCdt: 'Test Plant',
  trangThaiGoi: 'dang_khao_gia'
})
rfq
```

## Create RFQ Item

Use the `rfq.rfq.rfq_id` from the previous result:

```js
await API.call('createRfqItem', {
  rfqId: rfq.rfq.rfq_id,
  maVatTu: 'VT-SMOKE',
  tenVatTu: 'Vong bi smoke test',
  quyCachModelYeuCau: 'SKF 6310',
  soLuong: 2,
  donVi: 'cai',
  trangThaiDong: 'dang_hoi_gia'
})
```

Then:

```js
await API.get('getRfqItems', { q: '6310', limit: 5 })
```

## Audit Log

Admin or manager:

```js
await API.get('getAuditLogs', { limit: 10 })
```

Expected: rows for create client, supplier, RFQ, and RFQ item.

## Role Check

Login as a `viewer`, then run:

```js
await API.call('createSupplier', { supplierName: 'Should fail' })
```

Expected: 403 or `Khong co quyen`.

## Pagination

```js
const p1 = await API.get('getRfqItems', { limit: 2 })
await API.get('getRfqItems', { limit: 2, cursor: p1.nextCursor })
```

Expected: second request works when `p1.hasMore` is true.
