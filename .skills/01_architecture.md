# Kiến trúc — Procurement CRM

## Stack thực tế (không phải Google Apps Script)

```text
Browser / PWA / Vanilla JS
  -> Vercel: static UI + api/fetch-data.js (JSON gateway) + api/upload.js (multipart gateway)
  -> Cloudflare Worker: src/worker/index.js (router) -> handlers/*.js -> db/*-queries.js
  -> D1 (database chính)
  -> KV (cache: dashboard:v2, filter options)
  -> R2 (media: ảnh, PDF báo giá, Excel gốc)
```

Không có tầng Google Apps Script. Không dùng framework frontend (React/Vue) — Vanilla JS module dạng IIFE, expose qua `window.*Module`.

## Nguyên tắc trung tâm nghiệp vụ

```text
RFQ -> RFQ Items -> Supplier Quotes -> Pricing Decision -> Technical Clarification -> Contract Items (nếu trúng)
```

**RFQ Item là trung tâm hệ thống.** Không lấy Contract làm trung tâm — phần lớn dữ liệu thực tế là khảo giá trước hợp đồng.

`items` là Master Item (không có bảng `master_items` riêng). `rfq_items.item_id` link tới `items` để gom lịch sử giá qua nhiều gói thầu/nhiều năm.

## File structure

```text
api/fetch-data.js      # Gateway JSON: role whitelist, JWT cookie, proxy sang Worker qua X-Worker-Secret
api/upload.js          # Gateway multipart: role whitelist theo action, proxy file upload
src/worker/index.js    # Router: chỉ định tuyến action -> handler, KHÔNG chứa business logic
src/worker/handlers/*.js   # Business logic: validate, requireRole, gọi query, ghi audit
src/worker/db/*-queries.js # SQL thuần, dùng .prepare().bind(), không ghép chuỗi user input
src/worker/lib/*.js    # Helper dùng chung: auth, cache, action-log, media, normalize
assets/js/core/        # api.js (API.call/API.get), auth.js, state.js
assets/js/modules/     # Mỗi domain nghiệp vụ 1 file: rfqs.js, rfq-items.js, quotes.js, contracts.js...
```

## Luồng 1 API đi qua

```text
Browser UI -> assets/js/core/api.js -> api/fetch-data.js (role whitelist + JWT)
  -> src/worker/index.js (secret check + session check + route)
  -> src/worker/handlers/*.js (business logic + audit log)
  -> src/worker/db/*-queries.js (SQL)
  -> D1/KV/R2
  -> response về UI
```

Có 2 lớp role check độc lập: gateway (`api/fetch-data.js`) whitelist theo action, Worker handler tự `requireRole` lại — không được bỏ qua lớp nào.

## Bộ cột chuẩn tiếng Việt cho RFQ Item

Excel từ nhiều CĐT không đồng nhất, nhưng luôn map về một bộ cột chuẩn tiếng Việt duy nhất (xem PROCUREMENT_CRM_BLUEPRINT.md mục 5). Không tạo schema riêng cho từng CĐT. Luôn giữ `raw_row_json` để remap lại nếu map sai.

## Nguyên tắc B2B đa bên

App phục vụ mô hình: công ty (nhà thầu) mua từ nhiều NCC, giao cho nhiều CĐT. Không hard-code tên bất kỳ công ty cụ thể nào (CĐT, NCC, hay công ty chủ dự án) vào template, code, hay chứng từ xuất ra — mọi tên đơn vị phải lấy động từ `clients`/`suppliers`/field free-text theo từng bản ghi (`receiver_unit`, `sender_unit`...).

## Trước khi tạo module/schema mới

1. Kiểm tra `PROCUREMENT_CRM_BLUEPRINT.md` mục 7 (D1 schema) — bảng tương tự đã tồn tại chưa.
2. Kiểm tra `src/worker/handlers/` — handler tương tự đã tồn tại chưa.
3. Ưu tiên mở rộng bảng/action cũ hơn là tạo mới.
4. Nếu bắt buộc tạo mới, tạo migration mới tăng số — không sửa migration cũ đã chạy production.
