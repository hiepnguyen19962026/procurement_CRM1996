# WEB APP BLUEPRINT — Procurement CRM (chuẩn dùng lại cho các dự án sau)

> Nguồn: inspect code thật ngày 2026-06-17 (commit gần nhất `8a74d2f`). Tài liệu này mô tả **đúng những gì code hiện có làm**, không suy diễn. Mọi mục đề xuất tương lai được tách riêng và ghi rõ "not implemented yet".
>
> Thứ tự ưu tiên nguồn sự thật khi có mâu thuẫn: **code thật > tài liệu này > PROCUREMENT_CRM_BLUEPRINT.md / OWNER_CODE_GUIDE.md / PROJECT_BLUEPRINT.md > .skills/*.md** (các file .skills/01-05 là template tham khảo từ một app khác — SPA booking có Google Apps Script — KHÔNG áp dụng cho repo này, vì repo này không có GAS).

---

## 1. Architecture chuẩn

```
Browser (PWA, vanilla JS, no framework)
   │  fetch('/api/fetch-data' | '/api/upload' | '/api/media')
   ▼
Vercel Gateway (api/*.js — Node serverless functions)
   - Verify JWT cookie (httpOnly) "procurement_sess"
   - Whitelist action theo role (lớp permission #1)
   - Forward sang Worker kèm X-Worker-Secret + X-App-Actor
   ▼
Cloudflare Worker (src/worker/index.js → handlers/*.js)
   - Verify X-Worker-Secret (lớp permission #2: server-to-server)
   - Verify role lại lần nữa trong handler (lớp permission #3)
   - Gọi query layer (src/worker/db/*-queries.js) → D1
   - Đọc/ghi cache KV, đọc/ghi file R2
   ▼
D1 (SQLite) / KV (cache) / R2 (file nhị phân — ảnh, PDF)
   ▲
   └── Cron Trigger (wrangler.toml) → handlers/scheduled.js → warm KV, scan report
```

- **Browser**: vanilla JS, không React/Vue/framework nào. PWA qua `manifest.json` + `sw.js`. Module nạp theo thẻ `<script>` tuần tự trong `index.html`, không bundler.
- **Vercel Gateway**: 3 file `api/fetch-data.js`, `api/upload.js`, `api/media.js`. Đây là **lớp duy nhất nhận traffic từ browser** chịu trách nhiệm xác thực JWT + whitelist action theo role.
- **Cloudflare Worker**: không bao giờ được gọi trực tiếp từ browser — chỉ Vercel gọi server-to-server bằng `X-Worker-Secret`. `src/worker/index.js` chỉ làm router, business logic nằm ở `handlers/*.js`, SQL nằm ở `db/*-queries.js`.
- **D1**: 27 bảng hiện có (xem chương 4-5). **KV**: cache đọc-nhiều (dashboard, report quét nightly). **R2**: file nhị phân (ảnh minh chứng, PDF báo giá) — D1 chỉ lưu metadata, không lưu base64.
- **Cron**: 2 trigger trong `wrangler.toml` — `*/4 * * * *` (warm dashboard) và `0 2 * * *` (quét báo giá hết hạn / deadline RFQ / orphan media — chỉ đọc + ghi KV report, không mutate D1).
- **Auth**: JWT HS256 ký ở Vercel, lưu cookie httpOnly `procurement_sess`, hết hạn 7 ngày. `session_version` trong bảng `users` tăng khi đổi mật khẩu/bị admin force-logout → JWT cũ bị vô hiệu ngay dù chưa hết hạn.
- **Role whitelist 2 lớp**: lớp 1 ở Vercel (`api/fetch-data.js` có 4 tập action: `VIEW_ACTIONS`, `PURCHASING_ACTIONS`, `MANAGER_ACTIONS`, `ADMIN_ACTIONS`, cộng dồn theo role); lớp 2 ở Worker handler (`requireRole(actor, allowed)` trong `src/worker/lib/auth.js`, dùng tập `ALL_ROLES` / `WRITE_ROLES` / `MANAGE_ROLES` / `ADMIN_ROLES`).
- **Không đề xuất framework mới** (React, ORM, GraphQL, microservice riêng...) nếu chưa có lý do nghiệp vụ mạnh — kiến trúc 3 lớp Vercel/Worker/D1 hiện tại đã đủ cho quy mô team nhỏ.

---

## 2. Nguyên tắc làm việc với Codex

1. **Không code mù.** Trước khi sửa bug phải đọc code thật liên quan (handler, query, frontend module), không đoán theo tên hàm.
2. **Reproduce trước khi fix.** Tái hiện đúng bước gây lỗi (đúng role, đúng action, đúng input) trước khi đề xuất patch.
3. **Xem evidence trước khi sửa**: Console error, Network request/response payload, Worker log (`wrangler tail`), D1 schema thật (`wrangler d1 execute ... --command "PRAGMA table_info(...)"`) — chỉ sửa sau khi đã có evidence cụ thể.
4. **Targeted edit.** Chỉ sửa đúng hàm/file gây lỗi. Không refactor diện rộng kèm theo một bug fix nhỏ.
5. **Reuse trước khi tạo mới.** Trước khi tạo bảng/action/component mới, kiểm tra xem bảng/action/component cũ có mở rộng được không (thêm cột, thêm field optional, thêm nhánh điều kiện) thay vì tạo bản sao.
6. **Không tự deploy.** Không tự ý `vercel --prod`, `wrangler deploy`, `git push` lên remote nếu owner chưa yêu cầu rõ.
7. **Không tự chạy migration production.** Không tự `wrangler d1 execute --remote` chạy file migration mới nếu owner chưa xác nhận.
8. **Không sửa migration cũ đã chạy production.** Migration là lịch sử bất biến — luôn tạo file migration mới (số thứ tự tiếp theo, hiện tại mới nhất là `042_contract_addendum_items.sql`), không `ALTER`/xoá nội dung file cũ.

---

## 3. Business core

App lấy **RFQ Item làm trung tâm dữ liệu**, không lấy Contract làm trung tâm. Một RFQ Item có thể chưa từng thành Contract Item (vẫn đang khảo giá), nhưng mọi RFQ Item đều có lịch sử riêng cần track.

Flow chuẩn (đúng theo code, không phải lý tưởng hoá):

```
RFQ (rfqs)
  └─ RFQ Items (rfq_items)               — đơn vị trung tâm
       ├─ liên kết Master Item (items)    — không tự động, chỉ gợi ý + user confirm
       ├─ Technical Clarification         — timeline hỏi/đáp kỹ thuật, có thể "final_confirm"
       │     └─ final_confirm có thể tạo rfq_item_revisions (snapshot spec trước/sau)
       ├─ Supplier Quotes                 — nhiều báo giá / 1 RFQ Item
       │     └─ Media Evidence (R2)       — ảnh nameplate, PDF báo giá
       ├─ Pricing Decision                — chọn 1 quote làm base, áp markup → giá đề xuất
       │     └─ ghi vào Price History (chính là supplier_quotes, không phải bảng riêng)
       └─ (nếu trúng thầu) → Contract Item — copy snapshot tại thời điểm ký, KHÔNG link động
             └─ Contract (header)
                   └─ Contract Addendum (header) — phụ lục, optional
                         └─ Contract Addendum Item — dòng phụ lục
             └─ Delivery Note / Delivery Note Item — giao hàng theo Contract Item
Dashboard summary — tổng hợp tất cả trên, tính ở D1 (KV cache), không tính ở frontend
```

Lưu ý quan trọng: **Price History không phải bảng riêng** — nó được build từ `supplier_quotes` (search/export theo `item_id` hoặc fallback `rfq_item_id`/`ma_vat_tu`). Xem chương 11.

---

## 4. Toàn bộ module hiện có

Quy ước viết tắt: FE = frontend file, BE = worker handler, Q = query file, DB = bảng D1.

### 4.1 Login / session / roles
- Mục đích: xác thực, phân quyền 4 cấp `admin > manager > purchasing > viewer`.
- FE: [assets/js/core/auth.js](../assets/js/core/auth.js), [index.html](../index.html) (`.login-screen`).
- API action: `authLogin`, `getSession`, `changePassword`, `logout`, `initSetup`.
- Vercel whitelist: `authLogin`/`initSetup`/`logout` = PUBLIC; còn lại theo role.
- BE: [src/worker/handlers/accounts.js](../src/worker/handlers/accounts.js).
- Q: [src/worker/db/account-queries.js](../src/worker/db/account-queries.js).
- DB: `users` (session_version, role, status).
- Role: tất cả role tự đăng nhập; `initSetup` cần `SETUP_SECRET` khớp.
- Audit: không log login thường, có log đổi role/status qua `createAccount`/`updateAccount`.
- Test cơ bản: login đúng/sai mật khẩu; đổi mật khẩu → JWT cũ phải bị từ chối (session_version tăng).

### 4.2 Dashboard
- Mục đích: KPI tổng hợp (RFQ đang khảo giá, tham khảo, clarification cần xử lý, task...).
- FE: [assets/js/modules/dashboard.js](../assets/js/modules/dashboard.js).
- API action: `getDashboardV2` (mới), `getDashboard` (cũ, vẫn còn).
- BE: [src/worker/handlers/dashboard.js](../src/worker/handlers/dashboard.js), [src/worker/handlers/rfqs.js](../src/worker/handlers/rfqs.js) (cho `getDashboard` cũ).
- Q: [src/worker/db/dashboard-queries.js](../src/worker/db/dashboard-queries.js) (`getDashboardV2SQL` — ~38 statement Promise.all).
- DB: đọc nhiều bảng (rfqs, rfq_items, supplier_quotes, contracts, tasks, technical_clarifications...).
- Role: `ALL_ROLES` (mọi role xem được).
- Cache: KV key `dashboard:v2` TTL 300s, warm mỗi 4 phút bằng cron (`handlers/scheduled.js`); `force=1` bỏ qua cache.
- Audit: không (read-only).
- Test: load dashboard 2 lần liên tiếp trong 5 phút → số liệu giống nhau (cache); đổi 1 RFQ status rồi đợi cache hết TTL hoặc gọi `force=1` → số liệu cập nhật.

### 4.3 Clients (CĐT/khách hàng)
- Mục đích: quản lý chủ đầu tư — tên, pháp nhân, MST, tỉnh, liên hệ.
- FE: [assets/js/modules/clients.js](../assets/js/modules/clients.js).
- Modal: form `.form-grid-12` 4 dòng (tên/MST/loại hình, nhà máy/tỉnh/địa chỉ, email/sđt/web, ghi chú).
- API action: `getClients`, `createClient`, `updateClient`, `archiveClient`.
- BE: [src/worker/handlers/clients.js](../src/worker/handlers/clients.js).
- Q: [src/worker/db/client-queries.js](../src/worker/db/client-queries.js).
- DB: `clients` (soft-delete qua `deleted_at`).
- Role: write = purchasing+; archive = manager+.
- Audit: có (`createClient`/`updateClient`/`archiveClient`).
- Test: tạo client → list hiện summary RFQ status breakdown (đếm theo trạng thái).

### 4.4 Client contacts
- FE: trong `clients.js` (drilldown panel).
- API: `getClientContacts`, `createClientContact`, `updateClientContact`, `archiveClientContact`, `importClientContacts`.
- BE: [src/worker/handlers/client-contacts.js](../src/worker/handlers/client-contacts.js); Q: [client-contact-queries.js](../src/worker/db/client-contact-queries.js); DB: `client_contacts`.
- Role type hợp lệ: technical/procurement/commercial/finance/safety/production/management/other. `is_primary` tự clear contact primary khác khi set 1 contact mới làm primary.

### 4.5 Client equipment
- API: `getClientEquipment`, `createClientEquipment`, `updateClientEquipment`, `archiveClientEquipment`, `importClientEquipment` (≤500 dòng/lần).
- BE: [client-equipment.js](../src/worker/handlers/client-equipment.js); Q: [client-equipment-queries.js](../src/worker/db/client-equipment-queries.js); DB: `client_equipment`.
- equipment_group hợp lệ: turbine, generator, boiler, heater, primary_fan, secondary_fan, coal_mill, gearbox, condenser, feed_pump, transformer, pump, motor, valve, other.

### 4.6 Client bank accounts
- API: `getClientBankAccounts`, `createClientBankAccount`, `updateClientBankAccount`, `archiveClientBankAccount`.
- BE: [client-bank-accounts.js](../src/worker/handlers/client-bank-accounts.js); DB: `client_bank_accounts`. `is_primary` tự clear account primary khác.

### 4.7 Client legal history
- API: `getClientLegalHistory`, `addClientLegalHistory` (append-only, **không có update/delete** — đúng vì là lịch sử pháp lý).
- BE: [client-legal-history.js](../src/worker/handlers/client-legal-history.js); DB: `client_legal_history`.

### 4.8 Suppliers (NCC)
- FE: [assets/js/modules/suppliers.js](../assets/js/modules/suppliers.js).
- API: `getSuppliers`, `createSupplier`, `updateSupplier`, `archiveSupplier`.
- BE: [suppliers.js](../src/worker/handlers/suppliers.js); Q: [supplier-queries.js](../src/worker/db/supplier-queries.js); DB: `suppliers` (soft-delete).

### 4.9 RFQs (gói thầu)
- FE: [assets/js/modules/rfqs.js](../assets/js/modules/rfqs.js).
- API: `getRfqs`, `getRfq`, `createRfq`, `updateRfq`, `archiveRfq`, `quickUpdateRfqStatus`.
- BE: [rfqs.js](../src/worker/handlers/rfqs.js); Q: [rfq-queries.js](../src/worker/db/rfq-queries.js); DB: `rfqs`.
- Status: `dang_khao_gia | da_bao | trung | khong_trung | treo | tham_khao | archived`.
- Mutation nào invalidate KV: tạo/sửa RFQ → invalidate `['dashboard:v1','dashboard:v2']`.
- Role: write = purchasing+; archive = manager+.

### 4.10 RFQ contacts
- API: `getRfqContacts`, `addRfqContact`, `archiveRfqContact`.
- BE: [rfq-contacts.js](../src/worker/handlers/rfq-contacts.js); DB: `rfq_contacts` — liên kết `client_contacts` vào 1 RFQ cụ thể, chặn duplicate trong cùng RFQ.

### 4.11 RFQ Items (trung tâm hệ thống)
- FE: [assets/js/modules/rfq-items.js](../assets/js/modules/rfq-items.js) (file lớn nhất, ~294KB — quản lý cả clarification, quote, pricing, contract trigger, delivery workflow ngay trong modal item).
- API chính: `getRfqItems`, `getRfqItem`, `createRfqItem`, `updateRfqItem`, `archiveRfqItem`, `hardDeleteRfqItems`, `hardDeleteAllRfqItems`, `exportRfqItemsCsv`, `exportRfqItemsJson`.
- BE: [rfq-items.js](../src/worker/handlers/rfq-items.js); Q: [rfq-item-queries.js](../src/worker/db/rfq-item-queries.js) (1 CTE rất lớn, join 6 subquery: clarification mới nhất, tổng contract, tổng delivery, deadline summary, acceptance).
- DB: `rfq_items` (đầy field, xem chương 5).
- Pagination: cursor-based, page size lựa chọn 500/1000/2000/all ở UI (lớn hơn 50 mặc định của các module khác vì đặc thù import hàng loạt).
- `hardDeleteRfqItems`/`hardDeleteAllRfqItems`: **chỉ MANAGE_ROLES**, cascade xoá `technical_clarifications`, `supplier_quotes`, `pricing_decisions`, `contract_items`, `rfq_item_revisions` liên quan + set `import_job_rows.rfq_item_id = NULL`. Đây là hard delete thật, dùng cho dữ liệu test/nhập sai.
- Role: write = purchasing+; archive/hard-delete = manager+.

### 4.12 RFQ item revisions
- Mục đích: snapshot spec (quy cách/hãng/xuất xứ final) tại thời điểm clarification được "final_confirm".
- BE logic nằm trong [technical-clarifications.js](../src/worker/handlers/technical-clarifications.js) (không có handler riêng); Q: [rfq-item-revision-queries.js](../src/worker/db/rfq-item-revision-queries.js); DB: `rfq_item_revisions` (UNIQUE rfq_item_id+revision_no).
- API: `getItemRevisions`.
- Quy tắc: revision_no=0 = snapshot TRƯỚC, revision tiếp theo = snapshot SAU khi confirm. Một khi đã có revision link tới 1 clarification, business field của clarification đó **bị khoá** (chỉ sửa được URL/file đính kèm qua `updateTechnicalClarification`).

### 4.13 Technical clarifications (làm rõ kỹ thuật)
- FE: [assets/js/modules/clarifications.js](../assets/js/modules/clarifications.js) (list toàn cục) + timeline trong `rfq-items.js`.
- API: `listAllClarifications`, `getTechnicalClarifications`, `createTechnicalClarification`, `updateTechnicalClarification`, `deleteTechnicalClarification`, `quickUpdateClarification`.
- BE: [technical-clarifications.js](../src/worker/handlers/technical-clarifications.js); Q: [technical-clarification-queries.js](../src/worker/db/technical-clarification-queries.js); DB: `technical_clarifications` (UNIQUE rfq_item_id+sequence_no, soft-delete `deleted_at`).
- Type: `ask_supplier, supplier_opinion, supplier_reply, ask_client, client_reply, replacement_proposal, final_confirm, rejected, other`.
- Status sau: `processing, waiting_supplier, waiting_client, need_more_info, final_confirmed, rejected, other` → map sang `rfq_items.trang_thai_ky_thuat` qua `TECH_STATUS_MAP`.
- Role: tạo = purchasing+; update/delete = **manager+ only** (chặt hơn các module khác vì có thể tạo revision ảnh hưởng dữ liệu hợp đồng).
- Audit: có. Cache invalidate: `quickUpdateClarification` invalidate `dashboard:v1`.

### 4.14 Supplier quotations (báo giá)
- FE: [assets/js/modules/supplier-quotes.js](../assets/js/modules/supplier-quotes.js) (search toàn cục) + bảng quote trong `rfq-items.js` (theo từng item).
- API: `getSupplierQuotes`, `searchSupplierQuotes`, `createSupplierQuote`, `updateSupplierQuote`, `archiveSupplierQuote`, `deleteSupplierQuote`.
- BE: [supplier-quotes.js](../src/worker/handlers/supplier-quotes.js); Q: [supplier-quote-queries.js](../src/worker/db/supplier-quote-queries.js); DB: `supplier_quotes`.
- **2 đường xoá khác nhau** (đúng theo code, phải giữ nguyên): `archiveSupplierQuote` (soft, `status='archived'`, giữ lịch sử — dùng cho báo giá thật đã hết hiệu lực) vs `deleteSupplierQuote` (hard delete thật, **manager+ only**, dùng cho dữ liệu test/nhập trùng — kèm cleanup R2: `getMediaKeysByOwnerSQL` rồi `env.MEDIA.delete(r2_key)` rồi xoá record `media_files`).
- sourceChannel: `zalo, wechat, email, phone, direct, other`.
- Audit: có. Đây là nơi tính `price_vnd`/`price_vnd_incl_tax` (xem chương 6).

### 4.15 Pricing decisions (cân giá)
- FE: section "Cân giá / Quyết định giá" trong `rfq-items.js`.
- API: `getPricingDecisions`, `createPricingDecision`.
- BE: [pricing-decisions.js](../src/worker/handlers/pricing-decisions.js); Q: [pricing-decision-queries.js](../src/worker/db/pricing-decision-queries.js); DB: `pricing_decisions`.
- Role: xem = purchasing+ (`WRITE_ROLES`); **tạo session cân giá = manager+ only** (`MANAGE_ROLES`).
- Validation: quote phải `active` và thuộc đúng `rfqItemId`; nếu `selectionReason='other'` thì `pricingNote` bắt buộc.
- Versioning: mỗi lần tạo mới tăng `version` (không update đè quote cũ — giữ lịch sử quyết định giá).
- Không có update/delete — chỉ tạo version mới (giống legal history, đây là quyết định lịch sử).

### 4.16 Media evidence (ảnh/PDF minh chứng)
- Xem chi tiết đầy đủ ở chương 7.
- API: `getMediaFiles`, `uploadMedia` (qua `/api/upload`, không qua `/api/fetch-data`), `getMediaFileContent` (qua `/api/media`).
- BE: [media.js](../src/worker/handlers/media.js); Q: [media-queries.js](../src/worker/db/media-queries.js); DB: `media_files`.

### 4.17 Import CSV
- Xem chi tiết ở chương 10.
- API: `previewImportRows`, `checkRfqImportSafety`, `commitImportRows`, `saveImportTemplate`, `getImportTemplates`, `getImportJob`, `getImportJobRows`, `logRfqItemImportSummary`.
- BE: [imports.js](../src/worker/handlers/imports.js); Q: [import-queries.js](../src/worker/db/import-queries.js); DB: `import_templates`, `import_jobs`, `import_job_rows`.

### 4.18 Import XLSX
- Browser parse bằng SheetJS (`xlsx.min.js` self-host, vendor file) — không upload file gốc lên R2 (xem chương 10, "not implemented yet").
- Cùng action backend với Import CSV (`previewImportRows`/`commitImportRows` dùng chung pipeline, chỉ khác bước parse ở frontend).

### 4.19 Import templates/jobs/rows
- DB: `import_templates` (mapping_json lưu cấu hình cột nguồn → field đích, theo `ownerKey`), `import_jobs` (1 lần commit), `import_job_rows` (raw_row_json từng dòng, kết quả created/updated/skipped/error).
- Role: write = purchasing+.

### 4.20 Master items / items
- FE: panel "Master Item" trong `rfq-items.js` (link/unlink/tạo mới/search).
- API: `searchMasterItems`, `getMasterItemDetail`, `suggestMasterItemsForRfqItem`, `createMasterItem`, `updateMasterItem`, `linkRfqItemToMaster`, `unlinkRfqItemFromMaster`.
- BE: [items.js](../src/worker/handlers/items.js); Q: [item-queries.js](../src/worker/db/item-queries.js); DB: `items`.
- **Không tự động link** — `suggestMasterItemsForRfqItem` chỉ gợi ý, user phải bấm "Link" thủ công.
- Role: tạo/link/unlink = purchasing+; `updateMasterItem` = manager+.

### 4.21 Price history search/export
- Xem chi tiết ở chương 11. Không phải bảng riêng — build từ `supplier_quotes` join `rfq_items`/`rfqs`/`items`.
- API: `searchPriceHistory`, `getPriceHistorySummary`, `exportPriceHistoryCsv`.
- BE: [price-history.js](../src/worker/handlers/price-history.js); Q: [price-history-queries.js](../src/worker/db/price-history-queries.js).

### 4.22 Contracts
- Xem chi tiết đầy đủ ở chương 5.
- API: `getContracts`, `getContractDetail`, `createContract`, `updateContract`, `archiveContract`, `createContractFromRfqItem`.
- BE/Q: [contracts.js](../src/worker/handlers/contracts.js) / [contract-queries.js](../src/worker/db/contract-queries.js); DB: `contracts`.

### 4.23 Contract items
- API: `getContractItemsForRfqItem`, `addContractItem`, `updateContractItem`, `archiveContractItem`.
- DB: `contract_items` (snapshot, có field delivery deadline tự tính).

### 4.24 Contract addendum (phụ lục hợp đồng) — **đã implement, xem chương 5.5**

### 4.25 Tasks (công việc)
- FE: [assets/js/modules/tasks.js](../assets/js/modules/tasks.js).
- API: `getTasks`, `getTask`, `createTask`, `updateTask`, `deleteTask`, `quickUpdateTaskStatus`, `quickUpdateTaskPriority`, `suggestTaskCompanies`.
- BE: [tasks.js](../src/worker/handlers/tasks.js); Q: [task-queries.js](../src/worker/db/task-queries.js); DB: `tasks` (soft-delete).
- Status: `dang_lam, cho_phan_hoi, tam_dung, hoan_thanh, huy_bo`. Priority: `khan, cao, trung_binh, thap`.
- `deleteTask` = manager+ (soft-delete, set `deleted_at`).

### 4.26 Audit logs
- FE: [assets/js/modules/audit.js](../assets/js/modules/audit.js).
- API: `getAuditLogs` — **admin only**.
- BE: [audit.js](../src/worker/handlers/audit.js); Q: [audit-queries.js](../src/worker/db/audit-queries.js); DB: `audit_logs`.
- Ghi bởi `writeActionLog()` trong [src/worker/lib/action-log.js](../src/worker/lib/action-log.js) — mọi action write đều gọi hàm này (action, entity_type, entity_id, message, old_json, new_json, actor).
- Cron purge: log > 365 ngày bị xoá vĩnh viễn lúc 02:00 UTC hàng ngày.

### 4.27 Delivery notes / delivery note items (module thực tế có trong code, không nằm trong checklist gốc của owner nhưng phải ghi vì là code thật)
- FE: [assets/js/modules/delivery-notes.js](../assets/js/modules/delivery-notes.js) + workflow tạo đơn ngay trong `rfq-items.js`.
- API: `getDeliveryNotes`, `getDeliveryNoteDetail`, `getDeliveryItemsForRfqItem`, `createDeliveryNote`, `updateDeliveryNote`, `archiveDeliveryNote`, `deleteDeliveryNote` (admin only), `addDeliveryNoteItem`, `updateDeliveryNoteItem`, `archiveDeliveryNoteItem`, `recordDeliveryAcceptance`, `previewDeliveryNoteNo`.
- BE: [delivery.js](../src/worker/handlers/delivery.js); Q: [delivery-queries.js](../src/worker/db/delivery-queries.js); DB: `delivery_notes`, `delivery_note_items`.
- `note_type`: `delivery | return` (đơn giao hàng / đơn trả hàng). `delivery_note_no` tự sinh, unique, retry 3 lần khi conflict.
- Nghiệm thu (`recordDeliveryAcceptance`): trạng thái header derive từ tất cả item con (`allAccepted→accepted`, `allRejected→rejected`, `anyPending→pending`, mixed→`partial`); `payment_request_status` tự set `ready` khi có dòng accepted/partial.
- Bảo hành: `warranty_end_date = warranty_start_date + warranty_days`, với `warranty_days`/`warranty_percent` lấy theo thứ tự ưu tiên: override ở `delivery_note_items` → override ở `rfq_items` → default ở `rfqs`.

### 4.28 Cron/background reports
- BE: [scheduled.js](../src/worker/handlers/scheduled.js), export `scheduled()` trong [src/worker/index.js](../src/worker/index.js).
- `*/4 * * * *`: `warmDashboard()` — build trước KV `dashboard:v2` (TTL 300s).
- `0 2 * * *` (4 job song song, chỉ đọc D1 + ghi KV, **không mutate D1 trừ audit purge**):
  - `scanExpiredQuotes()` → KV `quotes:expired:report` (TTL 6h)
  - `scanRfqDeadlines()` → KV `rfq:deadline:scan` (TTL 6h)
  - `purgeOldAuditLogs()` → **DELETE thật** audit_logs > 365 ngày (đây là mutation duy nhất trong cron)
  - `scanOrphanMedia()` → KV `media:orphan:report` (TTL 6h)

### 4.29 R2 cleanup / orphan media report
- `scanOrphanMedia()` (chương 4.28) chỉ **report**, không tự xoá. Việc xoá thật R2 + record `media_files` chỉ xảy ra khi `deleteSupplierQuote` cascade cleanup (chương 4.14). Chưa có job tự động xoá orphan — xem chương 7 "not implemented yet".

---

## 5. Contract và phụ lục hợp đồng

### 5.1 Nguyên tắc
- **Contract là kết quả cuối, không phải trung tâm hệ thống.** Trung tâm là RFQ Item (chương 3).
- **Không auto-create contract từ RFQ.** `createContractFromRfqItem` chỉ chạy khi user bấm nút "Tạo Hệ từ dòng này" trong modal 1 RFQ Item cụ thể — không có batch convert toàn bộ RFQ.
- **Không auto-convert toàn bộ RFQ items.** Mỗi `addContractItem` là 1 hành động thủ công, dù có thể auto-snapshot field từ RFQ item/quote nguồn.
- **Contract item phải copy snapshot tại thời điểm tạo**: `rfq_item_id`, `item_id`, `source_quote_id`, `ma_vat_tu`, `ten_vat_tu`, `quy_cach` (qua `required_model`/`technical_params`), `manufacturer`/`brand`, `origin_country`, `unit`, `supplier_id`/`supplier_name`, `contract_quantity`, `contract_unit_price`, `contract_line_total`. Đúng theo code: `buildContractItem()` trong `contracts.js` tự lấy field từ `rfq_items`/`supplier_quotes` nếu `rfqItemId`/`sourceQuoteId` được truyền, **copy 1 lần, không link động**.
- **Không mutate RFQ Item hoặc Supplier Quote khi tạo Contract Item.** Tạo contract item không ghi ngược lại `rfq_items`/`supplier_quotes` (không UPDATE bảng nguồn).
- **contract_total tính từ active contract_items.** `recalcContractTotalSQL` = `SUM(contract_line_total) WHERE status='active'`, chạy lại sau mỗi `addContractItem`/`updateContractItem`/`archiveContractItem`.
- **Archive là soft archive.** `archiveContract`/`archiveContractItem` chỉ set `status='archived'`/`archived_at`, **không hard delete** hợp đồng thật. (`hardDeleteRfqItems` có cascade xoá `contract_items` — nhưng đó là xoá RFQ Item test, không phải nghiệp vụ xoá Contract).

### 5.2 Action chi tiết (đúng theo `src/worker/handlers/contracts.js`)

| Action | Role | Mô tả |
|---|---|---|
| `getContracts` | ALL_ROLES | List, cursor `sortDate\|contractId`, filter q/rfqId/clientId/status/date range |
| `getContractDetail` | ALL_ROLES | `{ contract, items[] }` |
| `getContractItemsForRfqItem` | ALL_ROLES | Contract item nào đang link tới 1 RFQ item |
| `createContract` | WRITE_ROLES | Field: contractNo*, contractName (default = `rfqs.ten_goi`), rfqId, clientId (auto-inherit từ RFQ nếu rỗng), signedDate/effectiveDate/expiryDate, currency (default VND), contractTotal, partyA/partyB, note, items[] (optional batch insert ngay) |
| `updateContract` | WRITE_ROLES | Không cho update nếu contract đã `archived` |
| `archiveContract` | MANAGE_ROLES | Soft archive |
| `addContractItem` | WRITE_ROLES | Auto-snapshot từ rfqItemId/sourceQuoteId; tự tính `delivery_deadline_date` theo `deliveryTriggerType` (`contract_sign`/`award_notice`/`delivery_notice`/`po_date`/`manual`) + `deliveryLeadDays` |
| `updateContractItem` | WRITE_ROLES | Không cho update nếu contract cha đã archived |
| `archiveContractItem` | MANAGE_ROLES | Soft archive, recalc total |
| `createContractFromRfqItem` | WRITE_ROLES | 1-click: tạo cả contract header + 1 contract item từ 1 RFQ item, inherit RFQ + client |

Currency hợp lệ: `VND, USD, EUR, JPY, CNY, SGD, KRW`. Status hợp lệ: `active, archived`.

### 5.3 Phụ lục hợp đồng / Contract Addendum — **ĐÃ IMPLEMENT** (không phải đề xuất tương lai)

Khác với các bản blueprint cũ (`PROCUREMENT_CRM_BLUEPRINT.md`, viết trước migration 039/042) — addendum **đã có trong code thật** kể từ migration `039_contract_addendums.sql` (2026-06-16) và `042_contract_addendum_items.sql` (2026-06-16). Bản blueprint cũ chưa kịp cập nhật mục này — đây là một flow code có thật mà tài liệu cũ thiếu (xem chương 17.4).

**Bảng `contract_addendums`** (header phụ lục): `addendum_id`, `contract_id` (FK contracts, bắt buộc), `addendum_no`*, `addendum_name`, `signed_date`, `value_before_tax`, `tax_rate`, `value_after_tax`, `amount_delta` (mức tăng/giảm so với contract gốc), `note`, `external_url`, `status` (`draft|active|archived|cancelled`), `created_by`, `created_at`, `updated_at`, `archived_at`.

**Bảng `contract_addendum_items`** (dòng phụ lục): `addendum_item_id`, `addendum_id` (FK), `contract_id` (FK, denormalized để query nhanh), `rfq_item_id` (FK optional), `item_type` (`material|service|other`), `item_code`, `item_name`*, `spec`, `unit`, `quantity`, `unit_price`, `line_total`, `tax_rate`, `note`, `status` (`active|archived`).

**Action** (trong `contracts.js`, cùng file với contract — không tách handler riêng):

| Action | Role | Mô tả |
|---|---|---|
| `getContractAddendums` | ALL_ROLES | `{ contract, rows[], summary }` |
| `createContractAddendum` | WRITE_ROLES | `valueAfterTax = valueBeforeTax * (1 + taxRate/100)`; `amountDelta` = explicit hoặc default = `valueAfterTax` |
| `updateContractAddendum` | WRITE_ROLES | Chặn nếu addendum đã archived hoặc contract cha đã archived |
| `archiveContractAddendum` | MANAGE_ROLES | Soft archive |
| `getContractAddendumItems` | ALL_ROLES | `{ addendum, rows[], summary }` |
| `searchContractAddendumItems` | ALL_ROLES | Full-text q/q2/q3 + filter rfqId — dùng khi search trong list RFQ Items có kèm addendum |
| `createContractAddendumItem` | WRITE_ROLES | `lineTotal = Math.round(qty * unitPrice * (1 + taxRate/100))` |
| `updateContractAddendumItem` | WRITE_ROLES | Chặn nếu addendum `archived/cancelled` hoặc contract cha archived |
| `archiveContractAddendumItem` | MANAGE_ROLES | Soft archive |

Quy tắc đã được code tuân thủ đúng tinh thần owner đề ra:
- Addendum **không sửa đè hợp đồng gốc** — `contracts.contract_total` không bị addendum ghi đè trực tiếp; addendum có field riêng `value_after_tax`/`amount_delta`. (Lưu ý: hiện tại **chưa thấy code cộng `amount_delta` vào "giá trị hợp đồng hiệu lực" hiển thị ở đâu một cách tự động** — `getContractAddendumSummarySQL` có tính `original_contract_total + SUM(amount_delta active)` làm summary riêng, nhưng `contracts.contract_total` field gốc vẫn chỉ là SUM(contract_items) như chương 5.2. Đây là điểm cần làm rõ thêm nếu owner muốn 1 con số "tổng hợp đồng sau phụ lục" hiển thị chính thức ở UI list — **chưa chắc đã có UI hiển thị số này**, cần Codex kiểm tra lại `rfq-items.js` phần `contractItemsTable`/addendum render trước khi khẳng định.)
- Mọi thay đổi (create/update/archive addendum và addendum item) đều gọi `writeActionLog` → có audit log.

**FE**: render trong `rfq-items.js` (`contractSection`, load addendum theo từng contract bằng `setTimeout`, action `getContractAddendums`/`getContractAddendumItems`/`archiveContractAddendum`/`archiveContractAddendumItem`).

> Chuẩn tương lai (nếu cần mở rộng thêm — KHÔNG code trong task này): addendum item nên có thêm liên kết trực tiếp tới `contract_item_id`/`source_quote_id` (hiện tại addendum item chỉ link `rfq_item_id`, chưa link `contract_item_id`) để truy vết "phụ lục này sửa đổi đúng dòng hợp đồng gốc nào" rõ ràng hơn. Việc này là "not implemented yet" — chỉ đề xuất, không code.

---

## 6. Thành tiền và auto calculation

Nguyên tắc chung: **frontend chỉ preview/tạm tính để user nhìn, backend là nguồn tính cuối cùng**. Không tin số tiền frontend gửi nếu backend có đủ input để tự tính lại.

| Công thức | Nơi tính (backend, nguồn thật) | File:hàm | Frontend preview (chỉ để hiển thị tạm) |
|---|---|---|---|
| `price_vnd = Math.round(quoted_price * exchange_rate)` | Worker | [supplier-quotes.js](../src/worker/handlers/supplier-quotes.js) trong `createSupplierQuote`/`updateSupplierQuote` | Không thấy FE tự tính lại — chỉ hiển thị giá trị backend trả về |
| `price_vnd_incl_tax = Math.round(price_vnd * (1 + tax_rate/100))` | Worker | cùng file trên | — |
| `lineTotalAfterTax (rfq_items.thanh_tien_sau_thue) = Math.round(quantity * unitPrice * (1 + taxRate/100))` | Worker | [rfq-items.js handler](../src/worker/handlers/rfq-items.js) (`createRfqItem`/`updateRfqItem`) và [imports.js](../src/worker/handlers/imports.js) (`commitImportRows`) | FE [rfq-items.js module](../assets/js/modules/rfq-items.js) hàm `calculateRfqItemTotal` (~line 1761-1768) — **chỉ preview ngay trong form trước khi submit**, công thức giống backend |
| `proposed_unit_price = Math.round(basePriceVndInclTax * markupRate)` | Worker | [pricing-decisions.js](../src/worker/handlers/pricing-decisions.js) `createPricingDecision`. `markupRate` clamp `[1.0, 9.99]` | Không có FE tự tính — chỉ chọn markupRate, backend trả số |
| `proposed_line_total = Math.round(proposed_unit_price * quantity)` | Worker | cùng file trên | — |
| `contract_line_total = Math.round(contract_quantity * contract_unit_price)` (hoặc explicit nếu truyền sẵn) | Worker | [contracts.js](../src/worker/handlers/contracts.js) `addContractItem`/`updateContractItem` | — |
| `contract_total = SUM(contract_items.contract_line_total WHERE status='active')` | Worker (D1 SQL) | [contract-queries.js](../src/worker/db/contract-queries.js) `recalcContractTotalSQL` — chạy lại sau mọi mutation contract_items | Không bao giờ tính ở frontend |
| `value_after_tax (addendum) = value_before_tax * (1 + tax_rate/100)` | Worker | [contracts.js](../src/worker/handlers/contracts.js) `createContractAddendum` | — |
| `line_total (addendum item) = Math.round(qty * unit_price * (1 + tax_rate/100))` | Worker | cùng file trên `createContractAddendumItem` | — |

Quy tắc bắt buộc:
- Khi `updateContractItem`/`archiveContractItem` → **luôn gọi lại `recalcContractTotalSQL`**, không cache giá trị cũ.
- **Không aggregate tổng tiền ở frontend** với dataset có thể phân trang/lớn — toàn bộ SUM/COUNT đều nằm trong D1 query (`dashboard-queries.js`, `contract-queries.js`).
- Frontend chỉ làm preview tức thời trong 1 form đang mở (ví dụ `calculateRfqItemTotal` khi user đang gõ số lượng/đơn giá) — số này KHÔNG được gửi lên backend như giá trị cuối, backend tự tính lại từ `quantity`+`unitPrice`+`taxRate` thô.

---

## 7. Upload ảnh/file/R2/media

### 7.1 Đường đi upload
- Upload đi qua **`api/upload.js`** (multipart/form-data), **không đi qua `api/fetch-data.js` JSON thường** — đúng yêu cầu owner.
- `api/upload.js`: xác thực JWT giống fetch-data, nhưng role whitelist riêng `UPLOAD_ROLES = ['purchasing','manager','admin']` (viewer không upload được). Giới hạn `Content-Length` ≤ 10MB ở gateway (413 nếu vượt), validate `content-type` phải chứa `multipart/form-data`, timeout 30s.
- Forward sang Worker action `uploadMedia` (tự suy ra từ multipart request không cần field `action` riêng).
- Worker (`handlers/media.js`): `UPLOAD_ROLES` check lại lần 2, `MAX_UPLOAD_BYTES = 10MB`, **magic-byte validation thật** (đọc byte đầu file, không tin `Content-Type` header từ client):
  - PDF: `0x25 0x50 0x44 0x46`
  - JPEG: `0xFF 0xD8 0xFF`
  - PNG: `0x89 0x50 0x4E 0x47`
  - WebP: `RIFF....WEBP`
  - GIF: `0x47 0x49 0x46 0x38`
- `ALLOWED_UPLOADS` (cặp owner_type:file_kind hợp lệ — chặn upload sai chỗ): `quote:quote_pdf`, `quote:quote_evidence_image`, `rfq_item:document_pdf`, `rfq_item:item_image`.
- PDF kind chỉ nhận MIME `application/pdf`; image kind chỉ nhận JPEG/PNG/WebP.

### 7.2 Lưu trữ — đúng yêu cầu owner, không lưu base64
- File thật lưu **R2** (bucket `MEDIA`), path: `media/{ownerType}/{ownerId}/{fileKind}/{fileId}-{safeBaseName}.{ext}`.
- D1 (bảng `media_files`) **chỉ lưu metadata**: `file_id`, `owner_type`, `owner_id`, `file_kind`, `r2_key`, `public_url` (luôn rỗng — xem 7.4), `file_name`, `mime_type`, `size_bytes`, `width`, `height`, `variant`, `is_primary`, `created_by`, `created_at`. **Không có cột lưu base64/binary trong D1** — đúng yêu cầu.

### 7.3 Hiển thị — đúng yêu cầu owner
- FE không bao giờ render media bằng text/base64/JSON trong table — `API.mediaUrl(fileId)` trả về `/api/media?fileId=...`, dùng trực tiếp làm `<img src>` hoặc `href` download.
- Ảnh JPG/PNG/WebP → hiển thị `<img>` thật trong gallery (grid `repeat(auto-fill, minmax(92px,1fr))`), có lightbox prev/next khi click.
- PDF → hiển thị link mở/tải (`quoteFileCell`/item attachment section trong `rfq-items.js`), không render preview ảnh.
- List lớn (bảng RFQ Items, bảng Quote) **chỉ hiển thị badge/count** media, không load ảnh ngay trong row — chỉ load thật khi mở modal detail của item/quote đó (đúng yêu cầu owner "chỉ detail/modal mới load media").

### 7.4 Bảo mật file
- **`public_url` luôn rỗng** trong D1 — file là **private**, không có URL công khai vĩnh viễn. Truy cập duy nhất qua `/api/media?fileId=...` (yêu cầu đã login, role `viewer+`).
- `getMediaFileContent`: Worker fetch thật từ `env.MEDIA.get(r2_key)`, response header `cache-control: private, no-store`, `x-content-type-options: nosniff`. Đây thay cho khái niệm "signed URL" — repo dùng pattern proxy-qua-Worker thay vì pre-signed URL hết hạn. → mục "không lưu signed URL lâu dài, lưu r2_key rồi generate URL khi cần" **đã đúng theo thiết kế hiện tại** (vì không hề có signed URL nào được generate cả — luôn proxy).
- `r2_key` không bao giờ trả ra trong response API cho frontend thông thường (chỉ Worker nội bộ dùng để gọi R2), và không log vào audit (`writeActionLog` strip field nhạy cảm — cần Codex double-check `compactObject` áp dụng đúng chỗ nếu sửa code media trong tương lai).

### 7.5 Cleanup / orphan
- `deleteSupplierQuote` (hard delete) → cascade xoá R2 + `media_files` qua `cleanupQuoteMedia()`.
- `hardDeleteRfqItems`/`hardDeleteAllRfqItems` (chương 4.11) → **cascade các bảng liên quan trong D1** nhưng **theo agent inspect hiện tại KHÔNG thấy gọi cleanup R2 media của rfq_item khi hard-delete** — cần Codex verify lại kỹ trước khi khẳng định nếu liên quan tới bug "media rác sau khi xoá item test". Đây là điểm chưa chắc 100%, ghi rõ để tránh tài liệu bịa.
- `scanOrphanMedia()` (cron 02:00 UTC) chỉ **report** (KV `media:orphan:report`), **không tự xoá** orphan — xem `file_kind` phân loại: `quote_pdf`, `quote_evidence_image`, `document_pdf` (item PDF, không phải "technical_attachment"), `item_image`. **Không có `rfq_item_image` riêng** (chuẩn hoá tên là `item_image`), **không có `contract_attachment`**, **không có `source_xlsx`** trong code thật — những kind này owner liệt kê nhưng **chưa implement** (not implemented yet).

### 7.6 file_kind hiện có thật trong code (đối chiếu yêu cầu owner)
| Owner đề xuất | Có trong code? | Tên thật trong code |
|---|---|---|
| quote_evidence_image | ✅ có | `quote_evidence_image` |
| quote_pdf | ✅ có | `quote_pdf` |
| rfq_item_image | ✅ có (tên khác) | `item_image` |
| technical_attachment | ⚠️ không tách riêng | clarification dùng `attachment_file_id` trỏ tới file `document_pdf`/`item_image` đã upload qua rfq_item, không có file_kind riêng cho clarification |
| contract_attachment | ❌ chưa có | **not implemented yet** |
| source_xlsx | ❌ chưa có | **not implemented yet** — chưa upload file Excel gốc lên R2 (xem chương 10) |

---

## 8. Resize ảnh và hiển thị ảnh

**Đã implement ở client-side** — không phải "not implemented yet" như checklist owner giả định. Code thật ở [assets/js/core/api.js](../assets/js/core/api.js) (`prepareUploadForm`/`compressImage`, chạy trước khi gọi `API.upload`):

- Chỉ áp dụng cho file `image/jpeg|image/png|image/webp` (không áp dụng PDF).
- 2 profile:
  - `nameplate` (dùng khi `fileKind === 'quote_evidence_image'`): `maxLongEdge: 2000px`, `initQuality: 0.85`, `targetBytes: 1MB`.
  - `normal` (mọi ảnh khác, ví dụ `item_image`): `maxLongEdge: 1600px`, `initQuality: 0.82`, `targetBytes: 700KB`.
- Giữ tỉ lệ khung hình (`scale = maxLongEdge / longEdge` nếu ảnh vượt ngưỡng, không scale nếu ảnh đã nhỏ hơn).
- Output: **WebP nếu browser support** (detect bằng vẽ canvas 1x1 + check magic byte RIFF...WEBP), **fallback JPEG** nếu không.
- Quality fallback step: thử `initQuality` → nếu vẫn > targetBytes thì giảm dần theo `QUALITY_STEPS = [0.8, 0.75, 0.72]` (chỉ áp dụng các mức < initQuality), dừng khi đạt targetBytes hoặc hết step (đánh dấu `overTarget=true` nếu vẫn vượt).
- Không xử lý EXIF rotation đặc biệt (dùng `createImageBitmap`/`<canvas>` mặc định của browser — cần Codex kiểm tra thực tế ảnh chụp dọc từ điện thoại có bị xoay sai không nếu có bug report, không khẳng định trước).
- Không block UI lâu — resize chạy async trong `prepareUploadForm` trước khi `fetch('/api/upload')`, không thấy progress bar riêng cho bước resize (chỉ có toast loading chung khi upload).
- Backend **vẫn validate** size (≤10MB) + MIME bằng magic byte dù file đã được resize ở client — đúng nguyên tắc "không tin client, backend validate lại".
- Giữ ảnh gốc hay không: **không giữ** — file gốc bị thay thế hoàn toàn bởi file đã compress trước khi gửi lên (`formData.set('file', result.file)`), server chỉ nhận và lưu bản đã resize, không có "variant" gốc song song (cột `variant` trong `media_files` luôn `'original'` nhưng đó là bản đã resize, không phải file gốc thật từ máy user).

---

## 9. Link/update URL

Field URL hiện có trong code thật:
- `rfqs.external_url` (RFQ).
- `rfq_items.external_url` (URL thư mục/tài liệu của item).
- `technical_clarifications.external_url`.
- `contract_addendums.external_url`.
- `supplier_quotes.source_ref` — **đây là text reference, không phải URL bắt buộc** (Zalo/WeChat ref string, có thể là link hoặc không — không nên coi là field URL chuẩn).
- Không có field "website/public URL" riêng cho khách hàng ngoài `clients.website`.
- **Không có `contract.attachment_url`** trong code — "not implemented yet" (khớp với 7.6).

Quy tắc đã quan sát trong code và nên giữ làm chuẩn:
- FE validate URL bằng regex `/^https?:\/\//i` trước khi render thành `<a>` (thấy trong `rfq-items.js` clarification timeline và RFQ note cell).
- Render an toàn: `<a href="..." target="_blank" rel="noopener">Mở</a>` — đã có `rel="noopener"`. **Cần Codex kiểm tra có `noreferrer` đi kèm chưa** — theo agent inspect chỉ thấy `rel="noopener"`, owner yêu cầu chuẩn `noopener noreferrer` — đây là điểm khác biệt nhỏ giữa yêu cầu và code thật, nên bổ sung `noreferrer` khi có dịp sửa (không code trong task này).
- Link dài dùng `encodeURI()` trước khi gắn vào `href` (tránh lỗi với khoảng trắng/ký tự đặc biệt trong URL paste từ Zalo/Drive).
- **Không thấy chặn `javascript:` URL bằng code rõ ràng** (không có sanitize scheme ngoài regex check `^https?://` ở 1 số chỗ — nhưng **không phải tất cả input URL đều đi qua check này**, ví dụ `source_ref` của quote không validate). Đây là điểm cần lưu ý security (xem chương 14) — **chưa có validate URL tập trung ở 1 hàm chung, mỗi module tự regex riêng lẻ nếu có**.
- Update URL là mutation thường (`updateRfq`, `updateRfqItem`, `updateTechnicalClarification`, `createContractAddendum`...) — đều qua role-check + `writeActionLog` như mutation khác, không có xử lý đặc biệt riêng cho field URL.
- Text link dài: không thấy CSS riêng cho wrap link trong code (`.nowrap` dùng cho cột khác) — cần Codex kiểm tra trực quan nếu có bug overflow do link dài thật (theo chương 13 modal debug rule, không đoán trước).

---

## 10. Import CSV/XLSX

- Browser parse: CSV parse thuần JS trong `rfq-items.js`; XLSX parse bằng **SheetJS `xlsx.min.js` self-host** (vendor file nạp qua `<script>` trong `index.html`, không CDN ngoài).
- Sheet selector: có (chọn sheet nào trong file Excel nhiều sheet trước khi map).
- Preview: hiện trước khi commit, hiển thị mapping kết quả.
- Mapping nguồn→đích: lưu trong `import_templates.mapping_json`, theo `ownerKey` (tái sử dụng lần sau qua `getImportTemplates`/`saveImportTemplate`).
- Import mode (đúng theo `imports.js`): `update_changed` (default — chỉ update nếu nội dung khác), `skip_all_existing`, `force_insert`, `selective_update`, `clear_and_reimport` (hard-delete toàn bộ rfq_items của RFQ trước khi nhập lại — cascade xoá luôn clarification/quote/pricing/contract_items/revision liên quan).
- Composite identity key để match dòng cũ/mới: `buildImportKey(rfqId, sttGoc, maMuaSam, maVatTu)`, ngăn cách bằng null-byte, loại trừ các field hay sửa tay (`ten_vat_tu`, `required_model`, `quantity`, `unit`) khỏi key.
- Commit theo chunk: tối đa **500 dòng/lần commit** (`commitImportRows`).
- `raw_row_json`, `source_sheet_name`, `source_row_number`: lưu đầy đủ trên cả `rfq_items` và `import_job_rows` — cho phép remap lại nếu map sai field.
- **Không tự động link Master Item** khi import — đúng nguyên tắc chương 4.20.
- **Source Excel/CSV gốc KHÔNG được upload lên R2** — chỉ parse browser-side rồi gửi JSON đã map lên backend. → **not implemented yet** (V1C trong blueprint cũ, vẫn chưa có ở code hiện tại — đối chiếu xác nhận đúng).

---

## 11. Price history

- **Không phải bảng riêng** — build từ `supplier_quotes` (đối chiếu code thật: `searchPriceHistorySQL` SELECT 25 cột join `rfq_items`, `rfqs`, `items` LEFT JOIN, KHÔNG có bảng `price_history`).
- Gom theo `item_id` nếu RFQ Item đã link Master Item; **fallback** theo `rfq_item_id`/`ma_vat_tu` nếu chưa link (filter param `itemId` hoặc `maVatTu` đều support trong `searchPriceHistory`).
- Không load toàn bộ lịch sử lên FE — `searchPriceHistory` cursor pagination, `exportPriceHistoryCsv` cap **5000 dòng**.
- Backend search/export: API `searchPriceHistory`, `getPriceHistorySummary` (aggregate cho filter set hiện tại), `exportPriceHistoryCsv`.
- CSV UTF-8 BOM: đúng theo PROCUREMENT_CRM_BLUEPRINT cũ — cần Codex verify trực tiếp đoạn code build CSV string trong `price-history.js` có prepend BOM (`﻿`) chưa nếu có report lỗi font Excel; agent inspect không trích cụ thể đoạn này nên không khẳng định 100%, ghi vào mục cần verify thêm.
- Evidence count: có — `searchPriceHistorySQL` có subquery `COUNT(media_files)` theo từng quote.
- Sort: mới nhất trước, theo `COALESCE(received_at, quote_date, created_at) DESC`.

---

## 12. Dashboard/cache

- Dashboard là summary backend hoàn toàn — `getDashboardV2SQL` chạy ~38 statement `Promise.all` ở D1, không có bước aggregate ở frontend.
- KV key/TTL: `dashboard:v1` (TTL 300s, dùng cho action `getDashboard` cũ), `dashboard:v2` (TTL 300s, dùng cho `getDashboardV2` mới, **được cron warm trước mỗi 4 phút** nên thực tế luôn có cache sẵn). Ngoài ra: `quotes:expired:report`, `rfq:deadline:scan`, `media:orphan:report` (đều TTL 6h, cron 02:00 UTC).
- Cron warm cache: `*/4 * * * *` → `warmDashboard()`.
- Mutation cần invalidate KV: tạo/sửa **RFQ** (`createRfq`/`updateRfq`) và **quickUpdateClarification** đều gọi `invalidateKv(env, ['dashboard:v1','dashboard:v2'])`. **Cần Codex verify thêm**: tạo RFQ Item / tạo Contract / tạo Quote có invalidate dashboard cache không — agent inspect chỉ xác nhận chắc 2 action trên, các action khác cần kiểm tra lại code thật nếu có bug "dashboard không cập nhật sau khi tạo X" trước khi kết luận đó là do thiếu invalidate.
- Nếu dashboard chậm cập nhật do TTL (≤300s, hoặc do cron warm 4 phút) → **không coi ngay là bug**, đây là hành vi cache-aside theo thiết kế.

---

## 13. UI/Modal/Layout chuẩn bắt buộc cho mọi dự án sau

### 13.1 Modal nghiệp vụ — chuẩn đã verify trong CSS thật
- Modal hiện tại: `max-width: min(90vw, 1200px)`, `max-height: 90vh` (desktop `>900px` có thêm `min-height: 560px`). **Owner yêu cầu chuẩn mới 90–96% và 90–96vh** — code thật hiện tại đang ở mép dưới khoảng đó (90vw/90vh, chưa lên tới 96). Khi cần sửa modal theo task khác, có thể nới lên tới 96 nếu owner yêu cầu cụ thể, nhưng **không tự ý đổi khi đang làm task không liên quan tới modal**.
- Modal body **scroll dọc bên trong** (`.modal-body { overflow-y: auto }`), page nền không bị kéo theo — đã đúng chuẩn.
- Mobile (`≤640px`): modal full `100dvh - 24px`, 1 cột.
- Form nhiều thông tin dùng **grid 12 cột** (`.form-grid-12`, class `.span-1`…`.span-12`) — đã đúng chuẩn, dùng xuyên suốt mọi modal create/edit (clients, rfqs, rfq-items, contracts...).
- Section full-width dùng `.modal-section` (grid-column: 1/-1).
- Bảng nhiều cột (ví dụ bảng RFQ Items chính, bảng Quotes) dùng `table-layout: fixed` + `min-width` lớn (RFQ Items table `min-width: 2200px`) **trong `.table-wrap` riêng có `overflow: auto`** — đúng chuẩn "horizontal scroll chỉ nằm trong table wrapper, không kéo rộng toàn modal/page".
- Bảng ít cột (ví dụ bảng contact, bank account) không ép min-width lớn — fit tự nhiên.
- Không dùng `window.alert/confirm/prompt` — đã đúng 100%, toàn bộ confirm dùng `Utils.confirmDanger()`/`Utils.confirmTyping()` (modal tự build), notify dùng `API.toast()`.

### 13.2 Modal debug rule (bắt buộc tuân theo khi có bug overflow/layout)
Trước khi sửa lỗi modal/table/overflow phải:
1. Reproduce đúng màn hình/modal đang lỗi.
2. Mở DevTools Console — xem lỗi JS nếu có.
3. Inspect DOM thực tế: modal width/height, modal body width/overflow, parent chain, grid/flex wrapper, table width/min-width/table-layout, th/td width, overflow-x/overflow-y.
4. Báo root cause dạng cụ thể: "element A width X trong parent B width Y nên gây overflow Z".
5. Chỉ sau đó mới sửa CSS/HTML targeted.

**Không được đoán** kiểu tự thêm `table-layout: fixed`, xoá `overflow`, thêm/bỏ `modal--wide`, thêm `span-12` nếu chưa có DOM evidence cụ thể từ bước 3.

---

## 14. Permission/security

- Role hiện có: `admin > manager > purchasing > viewer` (4 cấp, không có cấp "staff" như app SPA khác — không nhầm với `.skills/*` template).
- Quyền tổng quát theo cấp (đối chiếu cả Vercel whitelist và Worker role-check):
  - `viewer`: chỉ đọc (`VIEW_ACTIONS`/`ALL_ROLES`).
  - `purchasing`: đọc + tạo/sửa hầu hết nghiệp vụ (`PURCHASING_ACTIONS`/`WRITE_ROLES`) — KHÔNG tạo pricing decision, KHÔNG archive/delete, KHÔNG sửa technical clarification đã tạo.
  - `manager`: thêm quyền archive/soft-delete, tạo pricing decision, sửa/xoá technical clarification, hard-delete RFQ items, hard-delete supplier quote (`MANAGER_ACTIONS`/`MANAGE_ROLES`).
  - `admin`: thêm quyền account management, audit log, xoá vĩnh viễn delivery note (`ADMIN_ACTIONS`/`ADMIN_ROLES`).
- **Frontend hide chỉ là UX, không phải security** — `data-role-only`/`data-write` chỉ ẩn nút trên UI (`Auth.applyRoleUI()`), không chặn API call thật nếu user cố tình gọi tay.
- **Vercel whitelist là lớp 1** — chặn action không nằm trong tập role tương ứng, trả 403 trước khi chạm Worker.
- **Worker handler role check là lớp 2** — `requireRole(actor, allowed)` trong mỗi handler, độc lập với lớp 1 (không tin tưởng tuyệt đối vào việc lớp 1 đã chặn đúng).
- D1 mutation phải validate input — mỗi handler có validate field required/enum trước khi insert (ví dụ `VALID_CURRENCY`, `VALID_STATUS`, `VALID_ADDENDUM_STATUS`...).
- Upload phải validate MIME/size/kind — đã đúng (chương 7.1, magic byte thật, không tin Content-Type header).
- Không expose Worker secret — `WORKER_SECRET` chỉ tồn tại trong env Vercel + Cloudflare, không log ra console/response.
- Không bypass Vercel gateway — Worker chỉ nhận request có `X-Worker-Secret` đúng (`validateSecret()`), nên browser gọi trực tiếp Worker URL sẽ bị từ chối.
- Cookie: `procurement_sess` — cần Codex verify trực tiếp đủ 3 cờ `HttpOnly`/`Secure`/`SameSite` trong response header của `authLogin` nếu có nghi ngờ bảo mật cookie cụ thể (agent inspect xác nhận httpOnly + JWT HS256 nhưng không trích đầy đủ flag Secure/SameSite cụ thể — không khẳng định bừa).
- Không log secret/token/file binary — `writeActionLog` chỉ log `old_json`/`new_json` của business data, không thấy log token/password (`changePassword` không log plaintext, chỉ log hành động).

---

## 15. Performance rules

- List mặc định pagination: hầu hết module **50** (mặc định `clampLimit(value, fallback=50, max=200)` trong `lib/utils.js`); riêng **RFQ Items** UI cho chọn 500/1000/2000/all vì đặc thù cần xem/export hàng loạt (vẫn cap 5000 dòng khi export CSV/JSON).
- Search/filter ở D1 — không filter ở frontend với dataset lớn (mọi `search*`/`get*List` action đều nhận `q`/filter params, build WHERE ở SQL).
- Không load timeline/quote/media/history/contract items trong RFQ Item **list** — `getRfqItems` chỉ trả field cơ bản + vài cột tổng hợp tính sẵn (latest clarification summary, contract total, delivery total) qua CTE join, không trả toàn bộ rows con.
- Detail/modal mới load related data — `getTechnicalClarifications`, `getSupplierQuotes`, `getMediaFiles`, `getContractItemsForRfqItem`... đều gọi riêng khi mở modal item.
- Không aggregate frontend với dataset lớn — đúng 100%, toàn bộ SUM/COUNT nằm ở D1 (dashboard, contract total, price history summary).
- D1 query có index phù hợp — migrations `002`, `010`, `012`, `026`, `028`, `029`, `033`, `034` đều bổ sung index cho search/filter/sort cột nóng.
- KV dùng cho dashboard + report cron — không dùng KV cho dữ liệu transaction thường (quote, contract...).
- R2 file không load hàng loạt — media chỉ load theo `owner_type`+`owner_id` cụ thể khi mở detail, không có action "load tất cả media".

---

## 16. Error handling/troubleshooting prompts

Khi gặp các lỗi sau, **luôn bắt đầu bằng "do not edit code yet"**, reproduce, paste console/network/`wrangler tail` nếu có, trace đúng file/function, report root cause **trước khi** đề xuất fix:

- **400 bad payload** → kiểm tra field required nào thiếu trong handler tương ứng (`src/worker/handlers/*.js`), so với payload thật gửi từ Network tab.
- **403 permission** → kiểm tra cả 2 lớp: tập role ở `api/fetch-data.js` (PUBLIC/VIEW/PURCHASING/MANAGER/ADMIN_ACTIONS) **và** `requireRole()` trong handler Worker — đôi khi lớp 1 cho qua nhưng lớp 2 chặn (hoặc ngược lại), phải xem cả 2.
- **500 server error** → `wrangler tail` xem stack trace Worker thật, không đoán; kiểm tra D1 schema (`PRAGMA table_info`) có khớp với SQL trong query file không (migration thiếu chạy?).
- **Worker 1101** → thường do exception JS chưa catch trong handler hoặc query SQL sai cột; xem `wrangler tail` log chi tiết.
- **Upload ảnh lỗi** → kiểm tra: Content-Length > 10MB? Content-Type có đúng `multipart/form-data`? magic byte file có khớp MIME khai báo? `fileKind`/`ownerType` có nằm trong `ALLOWED_UPLOADS` không?
- **Ảnh hiện text/base64/json thay vì jpg** → kiểm tra FE có đang gọi đúng `API.mediaUrl(fileId)` làm `src` hay đang render trực tiếp response JSON của `getMediaFiles` vào `<img>`; kiểm tra response header `content-type` của `/api/media` có đúng MIME thật không.
- **Resize ảnh lỗi** → kiểm tra `compressImage()` trong `api.js`: browser có support `canvas.toBlob('image/webp')` không (fallback JPEG), file gốc có đúng `image/jpeg|png|webp` không (file khác type bị skip resize, gửi nguyên file gốc lên — có thể vượt 10MB).
- **Contract total sai** → kiểm tra `recalcContractTotalSQL` có được gọi sau action mutate contract_items gần nhất không; kiểm tra có contract_item nào `status` không phải `active` nhưng vẫn bị cộng nhầm.
- **Line total sai** → kiểm tra công thức thật đang dùng (chương 6) so với giá trị FE đang preview — phân biệt rõ field nào tính ở quote (`price_vnd_incl_tax`) vs field nào tính ở rfq_item (`thanh_tien_sau_thue`) vs pricing decision (`proposed_line_total`) — đây là 3 con số khác nhau, đừng nhầm.
- **Modal/table overflow** → áp dụng đúng quy trình debug chương 13.2, không đoán fix.
- **Link update sai** → kiểm tra field URL nào (rfqs/rfq_items/technical_clarifications/contract_addendums — chương 9) đang được update, có đi qua validate `^https?://` không, có bị strip bởi `cleanString(max=500)` cắt ngắn không.
- **Dashboard cache chậm** → kiểm tra TTL (300s cho dashboard, 6h cho report) trước khi coi là bug; thử gọi `getDashboardV2` với `force=1` để bypass cache xác nhận số liệu D1 thật đã đúng hay chưa.
- **Import XLSX sai ngày/cột** → kiểm tra mapping trong `import_templates.mapping_json` có đúng tên cột nguồn không (Excel có thể đổi tên cột giữa các lần xuất); kiểm tra SheetJS parse date có bị lệch timezone không (Excel serial date vs ISO string).

---

## 17. Output report sau khi inspect

### 17.1 File blueprint đã tạo
- Tạo mới: [docs/WEB_APP_BLUEPRINT.md](WEB_APP_BLUEPRINT.md) (file này). `docs/` đã tồn tại từ trước (chứa `OWNER_CODE_GUIDE.md`, `PROJECT_BLUEPRINT.md`), không cần tạo thư mục mới.
- Không xoá nội dung của `PROCUREMENT_CRM_BLUEPRINT.md` (root), `docs/OWNER_CODE_GUIDE.md`, `docs/PROJECT_BLUEPRINT.md`, `.skills/*.md` — các file này vẫn giữ nguyên, blueprint mới này tham chiếu và bổ sung, không thay thế.

### 17.2 Các file đã inspect (đối chiếu code thật)
`index.html`, `assets/css/app.css`, `assets/js/core/{api,auth,datepicker,state,utils}.js`, `assets/js/modules/*.js` (12 file), `api/{fetch-data,upload,media}.js`, `src/worker/index.js`, `src/worker/handlers/*.js` (24 file), `src/worker/db/*-queries.js` (23 file), `src/worker/db/migrations/001..042` (42 file), `src/worker/lib/*.js` (5 file), `wrangler.toml`, `vercel.json`, `sw.js`. Đọc trước: `PROCUREMENT_CRM_BLUEPRINT.md`, `docs/OWNER_CODE_GUIDE.md`, `docs/PROJECT_BLUEPRINT.md`, `.skills/01-05_*.md`, `.skills/MSC_WEBAPP_REFACTOR_RULES.md`, `README.md`, `SMOKE_TEST.md`.

### 17.3 Danh sách flow đã ghi vào blueprint
RFQ → RFQ Item → Master Item link → Technical Clarification (+ revision) → Supplier Quote (+ media) → Pricing Decision → Contract → Contract Addendum → Delivery Note (+ acceptance) → Dashboard. Cộng thêm: Login/session/role 2-lớp, Import CSV/XLSX, Price History (từ supplier_quotes), Upload/resize ảnh, Cron background report, Audit log.

### 17.4 Flow code hiện có nhưng blueprint cũ (`PROCUREMENT_CRM_BLUEPRINT.md`) thiếu
- **Contract Addendum / Contract Addendum Item** — đã code đầy đủ (migration 039, 042 + handler + query), nhưng blueprint cũ viết trước thời điểm đó nên chưa hề nhắc tới (search "addendum" ra 0 kết quả trong các doc cũ).
- **Delivery Notes / Delivery Note Items** (giao hàng, trả hàng, nghiệm thu, bảo hành, payment status) — module lớn (24KB handler, 13KB query, 43KB frontend) nhưng không có trong checklist gốc của owner và blueprint cũ chỉ nhắc sơ.
- **Tasks module** — quản lý công việc/follow-up, có trong code (`tasks.js` handler + FE) nhưng blueprint cũ không mô tả chi tiết action/role.
- **Contract parties** (`party_a`/`party_b`, migration 041) — field mới, blueprint cũ không có.
- **`contract_items.delivery_lead_days`/`delivery_trigger_type`/`delivery_deadline_date`** (migration 029) — logic tự tính deadline giao hàng theo nhiều loại trigger, chưa được mô tả ở blueprint cũ.
- **RFQ warranty default + override** (`rfqs.warranty_percent/days`, `rfq_items.warranty_percent/days`, migration 035/036) — cơ chế override theo cấp (item > rfq) dùng cho tính warranty_end_date ở delivery note item.

### 17.5 Yêu cầu owner nêu nhưng repo chưa implement ("not implemented yet")
- Upload file Excel/CSV nguồn lên R2 (`source_xlsx` file_kind) — chỉ parse browser-side, không lưu file gốc.
- `contract_attachment` file_kind riêng cho hợp đồng — chưa có.
- `technical_attachment` file_kind riêng cho clarification — clarification hiện dùng chung file đã upload qua rfq_item/quote, không có kind riêng.
- Resize ảnh server-side (Worker-side) — hiện chỉ resize client-side, backend không resize lại (chỉ validate).
- Job tự động xoá orphan media — hiện chỉ có report (KV), không tự xoá.
- Một số điểm "chưa chắc 100%, cần Codex verify lại bằng code thật trước khi sửa" (đã đánh dấu ⚠️ rõ trong các chương 5.3, 7.5, 9, 11, 12, 14): cleanup R2 khi hard-delete RFQ item; UI hiển thị "tổng hợp đồng sau phụ lục"; `rel="noopener noreferrer"` đầy đủ; cờ Secure/SameSite của cookie; CSV BOM cho price history export; invalidate KV dashboard sau khi tạo RFQ Item/Contract/Quote.

### 17.6–17.8
- Không code feature mới trong task này.
- Không deploy.
- Không chạy migration.

---

# 18. Architectural Guardrails (Mandatory)

This section is not documentation.

This section is a permanent rulebook for future Codex sessions.

Every future Codex task must read and follow these rules.

## 18.1 Never create parallel architecture

Do NOT create:

* duplicate tables
* duplicate modules
* duplicate APIs
* duplicate upload systems
* duplicate audit systems
* duplicate media systems
* duplicate contract systems

Always extend existing implementation first.

Before creating anything new, search repo for:

* existing table
* existing handler
* existing action
* existing modal
* existing query
* existing component

and explain why reuse is impossible.

## 18.2 Never store binary data in D1

Forbidden:

* base64 image
* base64 PDF
* blob in D1
* JSON encoded image

Use:

R2 for binary
D1 for metadata only

## 18.3 Never trust frontend calculations

Frontend may preview.

Backend is source of truth.

Any financial field must be recalculated server-side.

Examples:

* quote total
* contract total
* addendum total
* line total
* warranty amount
* tax amount

## 18.4 Never load entire dataset

Forbidden:

SELECT * without pagination for large modules.

Forbidden:

frontend aggregation on thousands of rows.

Use:

* pagination
* backend aggregation
* D1 indexes
* KV cache

## 18.5 Never break RFQ Item centric architecture

RFQ Item remains the center.

Do not redesign system around:

* Contract
* Delivery Note
* Supplier
* Master Item

without business approval.

## 18.6 Never refactor while fixing bugs

Bug fix workflow:

1. reproduce
2. inspect
3. identify root cause
4. targeted fix

Forbidden:

large refactor mixed into bug fix.

## 18.7 Never redesign modal layouts blindly

Before modal fix:

* inspect DOM
* inspect width
* inspect overflow
* inspect parent chain

Report root cause first.

## 18.8 Media Rules

Images must display as images.

Never show:

* base64 string
* JSON payload
* raw R2 key

Use browser-viewable URLs.

## 18.9 Upload Rules

Every upload flow must document:

* allowed mime
* max size
* owner type
* file kind
* R2 path
* cleanup strategy

before implementation.

## 18.10 New module checklist

Before creating any module:

Document:

* business purpose
* D1 tables
* APIs
* permissions
* audit log impact
* cache impact
* dashboard impact
* media impact
* migration impact

If checklist is incomplete:
DO NOT IMPLEMENT.

## 18.11 Blueprint Update Rule

Whenever a new module reaches production:

Update WEB_APP_BLUEPRINT.md first.

Code and blueprint must stay synchronized.

If code and blueprint differ:

code is truth,
blueprint must be updated immediately.

## 18.12 Future Project Bootstrap Rule

When creating a new web application:

Read:

* WEB_APP_BLUEPRINT.md
* OWNER_CODE_GUIDE.md
* PROJECT_BLUEPRINT.md
* .skills/*.md

before generating architecture.

Do not start coding before architecture review.
