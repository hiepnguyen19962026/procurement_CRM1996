# Procurement CRM Blueprint

Tài liệu này dùng làm blueprint cho web app **Procurement CRM / RFQ Price History**. Mục tiêu là quản lý dữ liệu khảo giá vật tư kỹ thuật cho purchasing: nhận danh sách vật tư từ CĐT, hỏi giá nhiều hãng/nhà cung cấp, cân giá báo CĐT, theo dõi thay đổi kỹ thuật, và tra cứu lại lịch sử giá sau vài tháng/vài năm.

**Cập nhật vận hành:** bản này đã được bổ sung theo trạng thái smoke test production ngày **2026-06-10**. Mục tiêu của tài liệu sau cập nhật là giữ “sườn” nghiệp vụ để các lần sửa sau không đi lệch kiến trúc, không tạo trùng bảng/action/component, và không mở thêm module lớn khi chưa có dữ liệu thật chứng minh cần thiết.

---

## 1. Mục tiêu app

App không phải phần mềm kho, không phải ERP, không phải app bán hàng.

App tập trung vào 5 việc:

1. Quản lý gói khảo giá / RFQ từ nhiều nhà máy, nhiều CĐT.
2. Chuẩn hóa danh sách vật tư từ Excel không đồng nhất về một bộ cột tiếng Việt.
3. Quản lý nhiều báo giá hãng/nhà cung cấp cho từng dòng vật tư.
4. Ghi lại quá trình thay đổi quy cách, thay thế model, xác nhận kỹ thuật.
5. Lưu lịch sử giá hợp đồng nếu trúng, để tra cứu nhanh về sau.

Nguyên tắc trung tâm:

```text
RFQ -> RFQ items -> supplier quotes -> pricing decision -> technical changes -> contract items nếu trúng
```

Không lấy hợp đồng làm trung tâm, vì phần lớn dữ liệu thực tế là khảo giá trước hợp đồng.

---

## 1A. Trạng thái triển khai hiện tại đã chốt

Tính đến smoke test production ngày **2026-06-10**, app đã đi đúng kiến trúc mục tiêu:

```text
Browser
  -> Vercel Gateway
  -> Cloudflare Worker
  -> D1
  -> KV
  -> R2
```

Frontend là Vanilla JS + PWA, không dùng framework frontend. Authentication dùng JWT cookie httpOnly 7 ngày, giữ các thuộc tính bảo mật `HttpOnly`, `Secure`, `SameSite=Strict`.

Các nhóm nghiệp vụ đã hoạt động và đã smoke test:

- Login/session/role: `admin`, `manager`, `purchasing`, `viewer`.
- Clients.
- Suppliers.
- RFQ/gói thầu.
- RFQ Items/dòng vật tư.
- Technical Clarification theo timeline.
- Supplier Quotations.
- Quote reference/source note: `source_channel`, `source_ref`, `received_at`.
- Safe upload/media evidence cho ảnh/PDF/bằng chứng báo giá.
- Pricing Decisions/cân giá.
- Import CSV Mapping V1A.
- Import XLSX Mapping V1B Core:
  - SheetJS `0.18.5` self-host tại `assets/js/vendor/xlsx.min.js`;
  - parse XLSX ở browser;
  - chọn sheet;
  - preview;
  - map cột;
  - chunk 500 rows;
  - giữ CSV cũ;
  - chưa lưu file Excel gốc vào R2.
- Import templates/jobs/rows:
  - `import_templates`;
  - `import_jobs`;
  - `import_job_rows`.
- Master Item Linking V1:
  - dùng bảng `items`;
  - reuse `rfq_items.item_id`;
  - không tạo `master_items`;
  - không auto-link.
- Price History Search/Export V1:
  - search lịch sử giá từ supplier quotes;
  - gom theo `item_id` nếu đã link master item;
  - CSV UTF-8 BOM cho Excel tiếng Việt.
- Contract / Contract Items V1:
  - `contracts`;
  - `contract_items`;
  - link về `rfq_id`, `rfq_item_id`, `item_id`, `source_quote_id`.
- Dashboard Snapshot/Cache V2:
  - action `getDashboardV2`;
  - KV key `dashboard:v2`;
  - TTL 300 giây;
  - không aggregate frontend.
- Audit log cho các mutation quan trọng.
- Pagination/search cơ bản.
- Tasks / Nhắc việc theo công ty:
  - bảng `tasks`; liên kết theo `company_name` text match, không foreign key cứng;
  - soft delete dùng `deleted_at`;
  - actions: `getTasks`, `getTask`, `createTask`, `updateTask`, `deleteTask`, `quickUpdateTaskStatus`, `quickUpdateTaskPriority`, `suggestTaskCompanies`.
- Client profile mở rộng:
  - thêm fields: `tax_code`, `legal_name`, `client_type`, `address`, `email`, `phone`, `website`, `deleted_at`;
  - sub-modules đã triển khai: `client_equipment`, `client_contacts`, `client_bank_accounts`, `client_legal_history`.
- RFQ Contacts: gắn liên lạc khách hàng (`client_contacts`) vào từng gói RFQ (`rfq_contacts`).
- RFQ Item Revisions: snapshot quy cách tự động sau mỗi final confirm clarification (`rfq_item_revisions`, cột `current_revision_no`).
- Hard delete báo giá nhập nhầm/test: xem mục 1E.
- Cloudflare Cron Triggers (CF-1): warm `dashboard:v2` mỗi 4 phút; báo cáo hàng ngày quote hết hạn, deadline RFQ, orphan media. Xem mục 1O.

Nguyên tắc triển khai đang dùng:

- **RFQ Item là trung tâm hệ thống.**
- **Master Item/items là danh tính vật tư dùng lại để gom lịch sử.**
- **Contract là kết quả cuối**, không lấy Contract làm trung tâm.
- Danh sách RFQ Item không load toàn bộ timeline, báo giá, ảnh, file, hợp đồng, lịch sử giá.
- Chỉ mở detail/modal của một RFQ Item mới load:
  - technical clarifications;
  - supplier quotations;
  - pricing decisions;
  - media evidence;
  - master item suggestions/detail;
  - price history;
  - contract items.
- Upload media đi qua `api/upload.js` + Worker media handler + R2.
- Ảnh/file không lưu base64 trong D1.
- XLSX V1B hiện chỉ parse browser-side và commit JSON, **chưa upload source Excel vào R2**.
- Sau khi sườn đã hoàn thành, không mở module lớn mới nếu chưa có lỗi/dữ liệu thật chứng minh cần.

## 1B. Gói thầu / RFQ đã triển khai

Màn hình RFQ list hiện cần giữ các thông tin nghiệp vụ chính:

- Mã gói.
- Tên gói.
- CĐT/nhà máy.
- Ngày đăng tải hoặc ngày nhận.
- Hạn nộp.
- Số dòng vật tư (`item_count`).
- Dự toán.
- Trạng thái.
- Ghi chú.
- Nút sửa theo quyền.

`item_count` lấy từ D1/query backend, không aggregate toàn bộ ở frontend. Ví dụ hiển thị:

```text
15 dòng
50 dòng
```

Không cần migration riêng chỉ để hiển thị `item_count` nếu đã có thể tính bằng query.

Trạng thái gói nên giữ tiếng Việt/code nội bộ thống nhất, ví dụ:

```text
dang_khao_gia
da_bao
trung
khong_trung
treo
tham_khao
```

Không trộn enum Anh + Việt trong cùng một field nghiệp vụ.

---

## 1C. Dòng vật tư / RFQ Item đã triển khai

Các field canonical đã có và cần tiếp tục dùng làm dữ liệu search/filter chính:

```text
required_model
brand
manufacture_year
origin_country
manufacturer
technical_params
unit
quantity
```

Các field tiếng Việt trong blueprint vẫn là chuẩn nghiệp vụ, nhưng khi repo đang có field canonical tiếng Anh thì không tự ý đổi schema nếu chưa có lý do rõ ràng.

`origin_full_text` chỉ dùng cho:

- import;
- export;
- đối chiếu dữ liệu gốc;
- debug mapping.

Không dùng `origin_full_text` làm field search/filter chính nếu đã có field structured.

Luôn giữ:

```text
raw_row_json
```

để bảo toàn nguyên dòng Excel gốc. Nếu sau này thiếu field hoặc map sai, dùng `raw_row_json` để remap lại thay vì mất dữ liệu gốc.

Danh sách RFQ Item bắt buộc theo performance rule:

- pagination mặc định 50 dòng;
- search/filter tại D1;
- không filter toàn bộ ở frontend;
- không load timeline/báo giá/ảnh/file trong list;
- detail/modal mới load dữ liệu phụ.

---

## 1D. Technical Clarification đã triển khai

Technical Clarification hiện dùng bảng riêng:

```text
technical_clarifications
```

Lưu theo chiều dọc dạng timeline. Một vật tư có thể có vô hạn lần trao đổi.

Không dùng thiết kế dạng cột cố định:

```text
clarification_1
clarification_2
clarification_3
```

Actions đã triển khai:

```text
getTechnicalClarifications
createTechnicalClarification
updateTechnicalClarification
deleteTechnicalClarification
```

Quyền:

- `viewer`: xem.
- `purchasing`: tạo mới.
- `manager`/`admin`: tạo, sửa, soft delete.

Timeline hỗ trợ các tình huống nghiệp vụ:

- hỏi hãng;
- hãng phản hồi;
- đề xuất thay thế;
- CĐT phản hồi;
- final confirm.

Mapping trạng thái kỹ thuật:

```text
technical_clarifications.status_after -> rfq_items.trang_thai_ky_thuat

waiting_supplier -> dang_hoi
waiting_client   -> dang_hoi
need_more_info   -> can_bo_sung
final_confirmed  -> da_xac_nhan
rejected         -> bi_tu_choi
```

Khi `clarification_type = final_confirm` hoặc `status_after = final_confirmed`, và user tick “Cập nhật quy cách final”, hệ thống được cập nhật các field snapshot cuối:

```text
quy_cach_final
hang_final
xuat_xu_final
trang_thai_ky_thuat
```

Không sửa đè lịch sử clarification cũ. Timeline là lịch sử, field final trên `rfq_items` chỉ là snapshot hiện tại.

Clarification create/update phải ghi audit log.

---

## 1E. Supplier Quotations v1 đã triển khai

Supplier Quotations v1 đã hoàn thành theo hướng nhập thủ công, chưa upload file báo giá.

Actions:

```text
getSupplierQuotes
searchSupplierQuotes
createSupplierQuote
updateSupplierQuote
archiveSupplierQuote
deleteSupplierQuote
```

Quyền:

- `viewer`: xem.
- `purchasing`: tạo mới.
- `manager`/`admin`: tạo, sửa, archive, hard delete.

**Hai luồng xóa báo giá — phân biệt rõ:**

- **Archive** (`archiveSupplierQuote`): dùng cho báo giá thật đã không còn hiệu lực. Soft archive, `status = 'archived'`. Dữ liệu vẫn là lịch sử nghiệp vụ, vẫn tra được trong price history. **Đây là luồng mặc định cho báo giá thật.**
- **Hard delete** (`deleteSupplierQuote`): chỉ dùng khi báo giá nhập nhầm, nhập test, hoặc trùng lặp không có giá trị lịch sử. D1 hard delete. Sau khi xóa quote, cleanup `media_files` D1 rows và R2 objects theo `owner_type='quote'` chạy trong background (`ctx.waitUntil`). Ghi audit log `deleteSupplierQuote` với `oldJson`. Chỉ `manager`/`admin` dùng được.

Không dùng hard delete cho báo giá thật. Mặc định là archive.

Bảng production:

```text
supplier_quotes
```

Một RFQ Item có nhiều báo giá NCC. Danh sách RFQ Item không load báo giá. Báo giá chỉ load khi mở detail/modal của RFQ Item.

Các field v1:

```text
quote_id
rfq_item_id
supplier_id
supplier_name
manufacturer
quote_date
quoted_price
currency
exchange_rate
price_vnd
tax_rate
price_vnd_incl_tax
lead_time
valid_until
warranty
note
status
created_by
created_at
updated_at
```

Trong v1 không có:

```text
quote_file_id
email_ref
```

Hai field này chỉ thêm ở phase upload/file sau, bằng migration mới.

Rule tính giá:

```text
price_vnd = Math.round(quoted_price * exchange_rate)
price_vnd_incl_tax = Math.round(price_vnd * (1 + tax_rate / 100))
```

Backend phải tự tính `price_vnd` và `price_vnd_incl_tax`, không tin giá đã tính từ frontend.

`status` dùng:

```text
active
archived
```

Hai luồng xóa — xem phần "Hai luồng xóa báo giá" bên trên.

Mutation create/update/archive/delete phải ghi audit log.

---

---

## 1F. Quote reference/source note và media evidence đã triển khai

Supplier quote hiện không chỉ lưu giá, mà còn lưu nguồn nhận báo giá để sau này truy vết:

```text
source_channel
source_ref
received_at
```

Kênh hợp lệ:

```text
zalo
wechat
email
phone
direct
other
```

Ý nghĩa:

- `source_channel`: báo giá đến từ kênh nào.
- `source_ref`: ghi chú tham chiếu như email subject, tên file, đoạn chat, số Zalo/Wechat, link nội bộ.
- `received_at`: ngày/giờ nhận báo giá.

Bằng chứng báo giá không nhét vào quote row. Ảnh/PDF/screenshot lưu qua `media_files` + R2 với owner quote, ví dụ:

```text
owner_type = quote
owner_id = quote_id
file_kind = quote_pdf / quote_evidence_image
```

Danh sách báo giá không load file nặng. Chỉ hiện badge/count bằng chứng nếu cần. Khi mở detail mới load danh sách media.

Quy tắc:

- Không lưu ảnh/PDF base64 trong D1.
- Không load bằng chứng trong RFQ Item list.
- Quote archived vẫn là lịch sử nghiệp vụ — đây là luồng mặc định cho báo giá thật.
- Hard delete (`deleteSupplierQuote`) chỉ dành cho dữ liệu nhầm/test; không dùng cho báo giá thật. Xem chi tiết mục 1E.
- Báo giá và bằng chứng phải sort mới nhất trước khi hiển thị trong các màn hình lịch sử.

---

## 1G. Import CSV/XLSX Mapping đã triển khai

Import hiện dùng flow:

```text
CSV/XLSX file
  -> Browser parse
  -> Preview headers + rows
  -> User map source headers to target fields
  -> Reuse/save template theo owner_key
  -> commitImportRows
  -> Worker validate/upsert rfq_items
  -> import_jobs + import_job_rows
```

CSV Mapping V1A:

- Giữ import CSV cũ.
- Thêm import mapping nâng cao.
- Có owner key.
- Có template save/reuse.
- Có preview.
- Có one Worker commit action.
- Lưu `raw_row_json`.
- Lưu `source_sheet_name = 'csv'`.
- Lưu `source_row_number`.

XLSX Mapping V1B Core:

- Dùng SheetJS Community `0.18.5`, self-host trong `assets/js/vendor/xlsx.min.js`.
- Parse XLSX ở browser, không bundle parser vào Worker.
- Hỗ trợ `.xlsx`.
- Không hỗ trợ `.xls`, `.xlsm`, `.ods`.
- Có sheet selector nếu workbook có nhiều sheet.
- Preview 20 dòng.
- `cellDates: true`, date object convert về `YYYY-MM-DD`.
- Commit theo chunk 500 rows để tránh quá tải Worker/D1.
- Template mapping dùng chung cho CSV và XLSX.
- `source_sheet_name` dùng tên sheet thật với XLSX.

Chưa làm ở V1B:

- Chưa upload source XLSX vào R2.
- Chưa thêm `source_file_id` vào `import_jobs`.
- Chưa bật Excel MIME ở `/api/upload`.
- Chưa parse formula/macro.
- Chưa AI automapping.
- Chưa auto-link Master Item.

Nếu sau này cần lưu file Excel gốc để audit/replay, làm V1C riêng:

```text
import_job:source_xlsx
R2 source archive
magic bytes ZIP + .xlsx extension
source_file_id propagation
migration thêm import_jobs.source_file_id
```

Không gộp V1C vào sửa lỗi nhỏ.

---

## 1H. Master Item Linking đã triển khai

Mục tiêu của Master Item là gom các RFQ Item giống nhau ở nhiều gói thầu/nhiều năm về một danh tính vật tư dùng lại.

Thiết kế đã chốt:

```text
items
  ↑
rfq_items.item_id
```

Không tạo bảng `master_items`.

Vì sao:

- Blueprint đã có `items`.
- `rfq_items` đã có `item_id`.
- Reuse schema hiện có, tránh tạo trùng.

Nguyên tắc:

- RFQ Item vẫn là dòng vật tư theo từng gói cụ thể.
- Item/Master Item chỉ là danh tính chuẩn hóa dùng lại.
- Không bắt buộc mọi RFQ Item phải có `item_id`.
- Không auto-link khi import.
- Suggestions chỉ gợi ý theo:
  - `ma_vat_tu`;
  - `ten_vat_tu`;
  - `required_model`;
  - `manufacturer`;
  - `brand`;
  - `origin_country`;
  - `unit`.
- User phải xác nhận link.
- Có thể unlink nếu link sai.
- Không merge/xóa RFQ Item trong V1.

Actions đã có:

```text
searchMasterItems
getMasterItemDetail
suggestMasterItemsForRfqItem
createMasterItem
updateMasterItem
linkRfqItemToMaster
unlinkRfqItemFromMaster
```

Quyền:

- `viewer`: search/detail/suggest.
- `purchasing`: create/link/unlink.
- `manager`/`admin`: create/update/link/unlink.
- Không hard delete.

Ứng dụng:

- Price History dùng `item_id` để gom lịch sử giá.
- Contract Items lưu `item_id` để nối hợp đồng với vật tư chuẩn.
- Dashboard V2 tính master link coverage và top master item theo quote count.

---

## 1I. Price History Search/Export đã triển khai

Price History là một trong các giá trị chính của CRM.

Luồng dữ liệu:

```text
items
  -> rfq_items
  -> supplier_quotes
  -> price history
```

Nếu RFQ Item đã link master item, lịch sử giá gom theo `item_id`. Nếu chưa link, có thể fallback theo `ma_vat_tu` hoặc `rfq_item_id`.

Actions đã có:

```text
searchPriceHistory
getPriceHistorySummary
exportPriceHistoryCsv
```

Bộ lọc:

- `itemId`;
- `rfqItemId`;
- `q`;
- `maVatTu`;
- `supplierId`;
- `supplierName`;
- `rfqId`;
- `clientId`;
- `sourceChannel`;
- `dateFrom`;
- `dateTo`;
- `limit`;
- `cursor`.

Sort:

```text
COALESCE(received_at, quote_date, created_at) DESC
quote_id DESC
```

CSV export:

- Backend build CSV, không aggregate frontend.
- UTF-8 BOM để mở đúng tiếng Việt trong Excel.
- Giới hạn safe max rows.
- Có các field RFQ, RFQ Item, Master Item, Supplier Quote, nguồn báo giá, evidence count.

Quy tắc:

- Không load toàn bộ lịch sử lên browser.
- Không frontend join nhiều trang dữ liệu.
- Không sửa quote cũ khi export.
- Lịch sử giá trước khi link master item có thể chưa đầy đủ; phải link dần bằng dữ liệu thật.

---

## 1J. Contract / Contract Items đã triển khai

Contract là kết quả cuối của quá trình RFQ/báo giá/cân giá, không phải trung tâm app.

Luồng đúng:

```text
RFQ
  -> RFQ Item
  -> Master Item
  -> Supplier Quotes
  -> Pricing Decision
  -> Contract
  -> Contract Item
```

Actions đã có:

```text
getContracts
getContractDetail
getContractItemsForRfqItem
createContract
updateContract
archiveContract
addContractItem
updateContractItem
archiveContractItem
createContractFromRfqItem
```

Nguyên tắc:

- Không auto-create contract từ RFQ.
- Không auto-convert toàn bộ RFQ items.
- Contract item copy snapshot tại thời điểm ký:
  - `rfq_item_id`;
  - `item_id`;
  - `source_quote_id`;
  - mã/tên/quy cách/hãng/xuất xứ/đơn vị;
  - supplier;
  - quantity;
  - unit price;
  - line total.
- Không mutate RFQ Item hoặc Supplier Quote khi tạo Contract Item.
- `contract_total` tính từ active contract items.
- Archive là soft archive.
- Không hard delete trong vận hành thật.

Quyền:

- `viewer`: xem contract/detail/contract items.
- `purchasing`: tạo/sửa contract, thêm/sửa item.
- `manager`/`admin`: thêm quyền archive.

Contract Items giúp sau này so sánh:

```text
giá báo NCC
vs
giá cân
vs
giá trúng/giá hợp đồng
```

---

## 1K. Dashboard Snapshot/Cache V2 đã triển khai

Dashboard không phải nơi load list lớn. Dashboard là summary nghiệp vụ, tính ở backend.

Action:

```text
getDashboardV2
```

Cache:

```text
KV key: dashboard:v2
TTL: 300 seconds
```

V1 vẫn giữ:

```text
getDashboard
dashboard:v1
```

Dashboard V2 có:

- RFQ overview:
  - tổng RFQ;
  - RFQ đang mở;
  - RFQ sắp hết hạn;
  - RFQ quá hạn;
  - 5 RFQ mới nhất.
- RFQ item / quote coverage:
  - tổng dòng vật tư;
  - dòng có báo giá;
  - dòng chưa có báo giá;
  - quote coverage %;
  - dòng đã link master item;
  - master link %.
- Supplier quote stats:
  - tổng quote;
  - quote 7 ngày;
  - quote 30 ngày;
  - theo source channel;
  - top suppliers.
- Technical clarification:
  - pending count;
  - latest clarifications.
- Import health:
  - latest import jobs;
  - import errors 30 ngày.
- Contract stats:
  - active contracts;
  - contracts 30 ngày;
  - total active contract value;
  - latest contracts.
- Master item stats:
  - total active items;
  - top master items by quote count.

Quy tắc:

- Không frontend aggregation.
- Không load ảnh/file vào dashboard.
- Không dashboard màu mè.
- Không snapshot table ở V2; KV TTL đủ.
- Cron trigger warm lại `dashboard:v2` mỗi 4 phút. Nếu vừa sửa dữ liệu mà dashboard chưa cập nhật ngay, chờ tối đa ~4 phút — đây không phải bug.

---

## 1L. Trạng thái khung hiện tại sau smoke test

Full smoke test đã pass cho các nhóm:

```text
XLSX library
Dashboard V2
Dashboard V1 compatibility
Contracts
Price History
Master Items
Import Templates
RFQ Items
```

Từ đây trở đi chuyển sang giai đoạn:

```text
vận hành dữ liệu thật
  -> phát hiện lỗi thật
  -> reproduce
  -> xem Console/Network/API/D1
  -> xác định root cause
  -> targeted fix
```

Không nên mở thêm module lớn trước khi test dữ liệu thật.

Các vấn đề có thể gặp khi vận hành thật:

- Excel nhiều header, merged cells, sheet rác.
- Ngày Excel sai format.
- Cột tiếng Trung/VN map không thống nhất.
- Duplicate RFQ Item.
- Master Item link sai hoặc thiếu link.
- Quote nhập sai thuế/tỷ giá/đơn vị tiền.
- Contract quantity/unit price nhập sai.
- Dashboard chậm phản ánh do KV cache 5 phút.
- Ảnh quá nặng hoặc preview chậm.
- Evidence upload thiếu magic-byte support cho một loại file mới.

Cách xử lý vẫn là: không đoán, không refactor rộng, sửa đúng module.

---

## 1O. Cloudflare Background Tasks đã triển khai

### CF-1 — Cron Triggers

Hai cron đã đăng ký trong `wrangler.toml [triggers]`:

```toml
[triggers]
crons = ["*/4 * * * *", "0 2 * * *"]
```

Handler: `src/worker/handlers/scheduled.js` → `runScheduledTasks(env, cron)`.

Worker export:

```js
async scheduled(event, env, ctx) {
  ctx.waitUntil(runScheduledTasks(env, event.cron));
}
```

Nhiệm vụ theo cron:

| Cron | Nhiệm vụ |
|------|-----------|
| `*/4 * * * *` | `warmDashboard` — warm KV `dashboard:v2` mỗi 4 phút; không để cache nguội |
| `0 2 * * *` | `scanExpiredQuotes` — báo cáo KV `report:expired-quotes` |
| `0 2 * * *` | `scanRfqDeadlines` — báo cáo KV `report:rfq-deadlines` |
| `0 2 * * *` | `scanOrphanMedia` — báo cáo KV `report:orphan-media` |

Tất cả CF-1 tasks là **read-only + KV write**. Không mutation D1. Không R2 delete. Không gửi email.

### CF-2-lite — Background Media Cleanup sau Hard Delete

Khi `deleteSupplierQuote` hard delete một báo giá, cleanup media chạy trong background:

```js
ctx.waitUntil(cleanupQuoteMedia(env, quoteId));
```

Luồng cleanup (`cleanupQuoteMedia` trong `supplier-quotes.js`):

1. Query `media_files` lấy `file_id` và `r2_key` cho `owner_type='quote'`, `owner_id=quoteId`.
2. `Promise.allSettled` xóa từng R2 object — một cái fail không chặn cái khác.
3. `DELETE FROM media_files WHERE owner_type='quote' AND owner_id=quoteId`.
4. Log kết quả vào console.

Nguyên tắc:

- Cleanup failure không làm fail response hard delete — HTTP đã return `{ ok: true }` trước khi cleanup chạy.
- Idempotent: R2 delete silent nếu object đã xóa; D1 DELETE là no-op nếu row đã xóa.
- Lỗi cleanup log vào `console.error`, CF-1 orphan report sẽ phát hiện row còn sót.
- Không dùng Cloudflare Queues. Không retry tự động.

---

## 2. Stack đề xuất

Giữ stack quen thuộc của các web app trước:

```text
Browser / PWA / Vanilla JS
  -> Vercel static + api/fetch-data.js + api/upload.js
  -> Cloudflare Worker
  -> D1 database
  -> KV cache
  -> R2 media/file storage
```

Vai trò:

- Vercel: cửa trước, static UI, API gateway, JWT cookie, role whitelist.
- Worker: xử lý nghiệp vụ, validate, query D1, ghi audit.
- D1: database chính.
- KV: cache data ít thay đổi, filter options, dashboard nhẹ.
- R2: ảnh vật tư, file báo giá, datasheet, file Excel gốc, file xác nhận kỹ thuật.
- Cloudflare Cron Triggers: warm KV cache và chạy báo cáo định kỳ (`scheduled()` handler, `wrangler.toml [triggers]`). Report-only — không mutation D1, không Cloudflare Queues.

Không dùng framework phức tạp nếu chưa cần. Ưu tiên đơn giản, dễ inspect, dễ sửa bằng Codex.

---

## 3. File structure chuẩn

```text
project/
├── index.html
├── api/
│   ├── fetch-data.js
│   └── upload.js
├── assets/
│   ├── css/app.css
│   └── js/
│       ├── core/
│       │   ├── api.js
│       │   ├── auth.js
│       │   ├── state.js
│       │   └── utils.js
│       └── modules/
│           ├── dashboard.js
│           ├── clients.js
│           ├── suppliers.js
│           ├── rfqs.js
│           ├── rfq-items.js
│           ├── quotes.js
│           ├── pricing.js
│           ├── technical-changes.js
│           ├── contracts.js
│           ├── items.js
│           ├── media.js
│           ├── audit.js
│           └── accounts.js
├── src/
│   └── worker/
│       ├── index.js
│       ├── handlers/
│       │   ├── accounts.js
│       │   ├── audit.js
│       │   ├── client-bank-accounts.js
│       │   ├── client-contacts.js
│       │   ├── client-equipment.js
│       │   ├── client-legal-history.js
│       │   ├── clients.js
│       │   ├── contracts.js
│       │   ├── dashboard.js
│       │   ├── imports.js
│       │   ├── items.js
│       │   ├── media.js
│       │   ├── ocr.js              (binding AI có; blocked tại gateway whitelist)
│       │   ├── price-history.js
│       │   ├── pricing-decisions.js
│       │   ├── rfq-contacts.js
│       │   ├── rfq-items.js
│       │   ├── rfqs.js
│       │   ├── scheduled.js        (CF-1 Cron Triggers)
│       │   ├── supplier-quotes.js
│       │   ├── suppliers.js
│       │   ├── tasks.js
│       │   └── technical-clarifications.js
│       ├── db/
│       │   ├── migrations/
│       │   │   ├── 001_initial.sql
│       │   │   ├── 002_indexes.sql
│       │   │   ├── ...
│       │   │   └── 025_rfq_external_url.sql
│       │   └── *-queries.js
│       └── lib/
│           ├── auth.js
│           ├── cache.js
│           ├── action-log.js
│           ├── media.js
│           ├── normalize.js
│           ├── csv-excel-import.js
│           └── utils.js
├── .skills/
│   ├── 01_architecture.md
│   ├── 02_performance.md
│   ├── 03_security.md
│   ├── 04_han_preferences.md
│   └── 05_working_style.md
├── wrangler.toml
├── vercel.json
├── manifest.json
└── sw.js
```

`src/worker/index.js` chỉ làm router, không chứa nghiệp vụ phức tạp. Business logic nằm trong `handlers/`. SQL nằm trong `db/*-queries.js`.

---

## 4. Nguyên tắc bắt buộc từ `.skills/*.md`

Repo phải có thư mục `.skills/` và các file `.md` như:

- `.skills/01_architecture.md`
- `.skills/02_performance.md`
- `.skills/03_security.md`
- `.skills/04_han_preferences.md`
- `.skills/05_working_style.md`

Codex không bắt buộc đọc toàn bộ skill cho mọi chỉnh sửa nhỏ. Nhưng các bước sau bắt buộc phải đọc skill trước:

1. Tạo khung repo / kiến trúc ban đầu.
2. Thêm hoặc sửa D1 schema / migration.
3. Thêm module nghiệp vụ lớn.
4. Sửa auth, role, permission, JWT, Worker secret.
5. Sửa upload R2 hoặc public media URL.
6. Sửa performance, pagination, search, dashboard.
7. Sửa lỗi chưa rõ root cause.
8. Refactor hoặc đổi luồng nghiệp vụ.

Các sửa nhỏ đã rõ phạm vi thì không cần đọc lại toàn bộ skill, ví dụ:

- chỉnh label UI;
- chỉnh spacing CSS nhỏ;
- sửa typo;
- đổi text toast;
- sửa một lỗi đã xác định rõ file/function.

Nhưng vẫn phải tuân thủ tinh thần: không code mù, không refactor rộng, reuse trước, targeted edit.

---

## 5. Bộ cột chuẩn tiếng Việt cho RFQ item

Không tạo schema riêng cho từng CĐT. Excel của CĐT nào cũng map về một bộ cột chuẩn. Cột nào không có thì để trống.

### 5.1. Nhóm gói

- `rfq_id` — mã RFQ nội bộ.
- `ma_goi_tbmt` — mã gói / TBMT.
- `ten_goi` — tên gói.
- `nha_may_cdt` — nhà máy / chủ đầu tư.
- `ngay_nhan_hoac_dang_tai` — ngày nhận / ngày đăng tải.
- `ngay_het_han` — deadline nếu có.
- `du_toan` — dự toán nếu có.
- `don_vi_trung_thau` — nếu là dữ liệu kết quả thầu.
- `gia_trung_thau` — nếu có.
- `trang_thai_goi` — đang khảo giá / đã báo / trúng / không trúng / treo / tham khảo.

### 5.2. Nhóm vật tư gốc

- `stt_goc` — STT trong file CĐT.
- `id_import_goc` — ID import nếu file có.
- `ma_mua_sam` — mã mua sắm / mã quy cách mua sắm nếu có.
- `ma_vat_tu` — mã vật tư.
- `ten_vat_tu` — tên / mô tả vật tư.
- `quy_cach_model_yeu_cau` — quy cách, model yêu cầu.
- `hang_goc_nsx_goc` — nguyên thiết bị chế tạo / hãng sản xuất gốc.
- `hang_bao_gia_nsx_bao_gia` — hãng báo giá / NSX báo giá.
- `nhan_hieu` — nhãn hiệu nếu có.
- `xuat_xu` — quốc gia/vùng lãnh thổ sản xuất.
- `nam_san_xuat` — nếu có.
- `vat_lieu` — vật liệu.
- `phu_tung_chuyen_dung` — có/không.
- `thong_so_ky_thuat` — cấu hình, tính năng kỹ thuật, thông số.
- `yeu_cau_ky_thuat_bo_sung` — yêu cầu an toàn, môi trường, yêu cầu khác.
- `so_luong` — số lượng / khối lượng.
- `don_vi` — đơn vị tính.

### 5.3. Nhóm giá CĐT / giá tham khảo

- `thue_suat` — thuế suất %.
- `don_gia_truoc_thue` — nếu có.
- `don_gia_sau_thue` — nếu có.
- `thanh_tien_sau_thue` — nếu có.
- `nguon_gia` — giá CĐT / giá kết quả thầu / giá nội bộ / giá hãng / chưa xác định.

### 5.4. Nhóm xử lý nội bộ

- `trang_thai_dong` — chưa xử lý / đang hỏi giá / đủ giá / đã báo CĐT / cần xác nhận kỹ thuật / đã final.
- `trang_thai_ky_thuat` — không cần xác nhận / đang hỏi / đã xác nhận / bị từ chối / thay thế.
- `quy_cach_final` — quy cách sau cùng được xác nhận.
- `hang_final` — hãng sau cùng.
- `xuat_xu_final` — xuất xứ sau cùng.
- `ghi_chu_final` — ghi chú cuối.

### 5.5. Dữ liệu gốc

Luôn lưu:

- `raw_row_json` — nguyên dòng Excel sau khi import.
- `source_file_id` — file Excel gốc trong R2.
- `source_sheet_name` — tên sheet nếu có.
- `source_row_number` — số dòng gốc.

Lý do: nếu sau này thiếu field hoặc map sai, còn dữ liệu gốc để remap lại.

---

## 6. Import Excel và column mapping

Không cố AI tự hiểu tất cả ngay từ đầu. Làm màn hình mapping rõ ràng:

```text
Cột Excel/CSV -> Cột chuẩn trong app
```

Ví dụ:

```text
物资编码 -> Mã vật tư
物资描述 -> Tên vật tư
采购规格型号 -> Quy cách/model yêu cầu
原设备制造商/生产厂 -> Hãng gốc/NSX gốc
材质 -> Vật liệu
专用备件 -> Phụ tùng chuyên dụng
技术参数、安健环或其他要求 -> Thông số/yêu cầu kỹ thuật
数量 -> Số lượng
单位 -> Đơn vị
```

Bảng đã triển khai:

```text
import_templates
import_jobs
import_job_rows
```

Lưu ý: blueprint ban đầu có nhắc `import_template_columns`, nhưng production V1A/V1B đang dùng `mapping_json` trong `import_templates`, không tách bảng columns riêng. Không tạo thêm bảng `import_template_columns` nếu chưa có lý do rõ ràng.

Import flow hiện tại:

1. User chọn CSV hoặc XLSX ở browser.
2. CSV parse bằng parser frontend hiện có.
3. XLSX parse bằng SheetJS `0.18.5` ở browser.
4. Nếu XLSX có nhiều sheet, user chọn sheet.
5. Preview headers + 20 dòng đầu.
6. User map source headers -> normalized target fields.
7. User có thể save/reuse template theo `owner_key`.
8. Frontend validate tối thiểu có `ten_vat_tu`.
9. Frontend chunk rows tối đa 500 dòng/batch.
10. Gọi `commitImportRows`.
11. Worker validate/upsert vào `rfq_items`.
12. Lưu `raw_row_json`, `mapped_json`, `source_sheet_name`, `source_row_number`.
13. Trả summary created/updated/skipped/errors.

V1B chưa lưu file Excel gốc vào R2. Khi cần audit/replay source file, làm V1C riêng, không trộn vào bugfix import.

Target fields import đang ưu tiên:

Bắt buộc:

```text
ten_vat_tu
```

Khuyến nghị:

```text
stt_goc
ma_vat_tu
required_model
manufacturer
brand
origin_country
unit
quantity
yeu_cau_ky_thuat_bo_sung
don_gia_sau_thue
thanh_tien_sau_thue
delivery_time
origin_full_text
```

Không auto-link Master Item trong import. Sau import, user link master item thủ công hoặc theo suggestion.

## 7. D1 schema đề xuất

### 7.1. `clients`

```sql
client_id   TEXT PRIMARY KEY,
client_name TEXT NOT NULL,
plant_name  TEXT,
province    TEXT,
note        TEXT,
tax_code    TEXT,
legal_name  TEXT,
client_type TEXT DEFAULT 'company',
address     TEXT,
email       TEXT,
phone       TEXT,
website     TEXT,
deleted_at  TEXT,
created_at  TEXT,
updated_at  TEXT
```

### 7.2. `suppliers`

```sql
supplier_id   TEXT PRIMARY KEY,
supplier_name TEXT NOT NULL,
supplier_type TEXT, -- manufacturer / distributor / trader / unknown
country       TEXT,
contact_name  TEXT,
email         TEXT,
phone         TEXT,
zalo          TEXT,
wechat        TEXT,
note          TEXT,
tax_code      TEXT,
deleted_at    TEXT,
created_at    TEXT,
updated_at    TEXT
```

### 7.3. `rfqs`

```sql
rfq_id                  TEXT PRIMARY KEY,
client_id               TEXT,
ma_goi_tbmt             TEXT,
ten_goi                 TEXT NOT NULL,
nha_may_cdt             TEXT,
ngay_nhan_hoac_dang_tai TEXT,
ngay_het_han            TEXT,
du_toan                 INTEGER DEFAULT 0,
trang_thai_goi          TEXT NOT NULL DEFAULT 'dang_khao_gia',
source_file_id          TEXT,
note                    TEXT,
external_url            TEXT,
created_by              TEXT,
created_at              TEXT,
updated_at              TEXT
```

### 7.4. `rfq_items`

```sql
rfq_item_id TEXT PRIMARY KEY,
rfq_id TEXT NOT NULL,
stt_goc TEXT,
id_import_goc TEXT,
ma_mua_sam TEXT,
ma_vat_tu TEXT,
ten_vat_tu TEXT NOT NULL,
quy_cach_model_yeu_cau TEXT,
hang_goc_nsx_goc TEXT,
hang_bao_gia_nsx_bao_gia TEXT,
nhan_hieu TEXT,
xuat_xu TEXT,
nam_san_xuat TEXT,
vat_lieu TEXT,
phu_tung_chuyen_dung TEXT,
thong_so_ky_thuat TEXT,
yeu_cau_ky_thuat_bo_sung TEXT,
so_luong REAL DEFAULT 0,
don_vi TEXT,
thue_suat REAL DEFAULT 0,
don_gia_truoc_thue INTEGER DEFAULT 0,
don_gia_sau_thue INTEGER DEFAULT 0,
thanh_tien_sau_thue INTEGER DEFAULT 0,
nguon_gia TEXT,
trang_thai_dong TEXT NOT NULL DEFAULT 'chua_xu_ly',
trang_thai_ky_thuat TEXT NOT NULL DEFAULT 'khong_can_xac_nhan',
quy_cach_final TEXT,
hang_final TEXT,
xuat_xu_final TEXT,
ghi_chu_final TEXT,
item_id TEXT,
normalized_search TEXT,
raw_row_json TEXT,
source_file_id         TEXT,
source_sheet_name      TEXT,
source_row_number      INTEGER,
current_revision_no    INTEGER NOT NULL DEFAULT 0,
gia_hop_dong           INTEGER DEFAULT 0,
created_at             TEXT,
updated_at             TEXT
```

### 7.5. `items` — Master Item

Production V1 dùng `items` làm Master Item. Không tạo bảng `master_items`.

```sql
item_id TEXT PRIMARY KEY,
ma_vat_tu TEXT,
ten_vat_tu TEXT NOT NULL,
required_model TEXT,
manufacturer TEXT,
brand TEXT,
origin_country TEXT,
unit TEXT,
technical_params TEXT,
note TEXT,
normalized_search TEXT,
status TEXT NOT NULL DEFAULT 'active',
created_by TEXT,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL
```

Quan hệ với RFQ Item:

```text
rfq_items.item_id -> items.item_id
```

Không bắt buộc mọi RFQ Item phải link vào `items`. Có thể link dần trong quá trình vận hành. Không auto-link nguy hiểm.

### 7.6. `supplier_quotes`

Schema production đã mở rộng từ v1 nhập tay sang có source/reference:

```sql
quote_id TEXT PRIMARY KEY,
rfq_item_id TEXT NOT NULL,
supplier_id TEXT,
supplier_name TEXT,
manufacturer TEXT,
quote_date TEXT,
quoted_price REAL DEFAULT 0,
currency TEXT DEFAULT 'VND',
exchange_rate REAL DEFAULT 1,
price_vnd INTEGER DEFAULT 0,
tax_rate REAL DEFAULT 0,
price_vnd_incl_tax INTEGER DEFAULT 0,
lead_time TEXT,
valid_until TEXT,
warranty TEXT,
note TEXT,
source_channel TEXT,
source_ref TEXT,
received_at TEXT,
status TEXT NOT NULL DEFAULT 'active',
created_by TEXT,
created_at TEXT NOT NULL,
updated_at TEXT,
FOREIGN KEY (rfq_item_id) REFERENCES rfq_items(rfq_item_id)
```

Index production nên có:

```sql
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_item
  ON supplier_quotes(rfq_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_status
  ON supplier_quotes(status);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_source_channel
  ON supplier_quotes(source_channel);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_supplier
  ON supplier_quotes(supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_created
  ON supplier_quotes(created_at DESC);
```

Rule tính giá:

```text
price_vnd = Math.round(quoted_price * exchange_rate)
price_vnd_incl_tax = Math.round(price_vnd * (1 + tax_rate / 100))
```

Backend tự tính `price_vnd` và `price_vnd_incl_tax`, không tin giá đã tính từ frontend.

`status` dùng:

```text
active
archived
```

Hai luồng xóa:

- **Archive**: `status = 'archived'`. Soft. Dữ liệu vẫn là lịch sử nghiệp vụ, vẫn tra được trong price history. Dùng cho báo giá thật hết hiệu lực. **Đây là mặc định.**
- **Hard delete**: `DELETE FROM supplier_quotes`. Chỉ dùng cho dữ liệu nhầm/test, không có giá trị lịch sử. Kéo theo cleanup `media_files` rows và R2 objects cho `owner_type='quote'` trong background. Chỉ `manager`/`admin`. Ghi audit log.

Bằng chứng báo giá lưu qua `media_files` + R2, không nhét file vào `supplier_quotes`.

### 7.7. `pricing_decisions`

```sql
pricing_id TEXT PRIMARY KEY,
rfq_item_id TEXT NOT NULL,
base_quote_id TEXT,
base_price_vnd INTEGER DEFAULT 0,
markup_rate REAL DEFAULT 1.4,
risk_level TEXT,
risk_note TEXT,
proposed_unit_price INTEGER DEFAULT 0,
proposed_line_total INTEGER DEFAULT 0,
pricing_note TEXT,
version INTEGER DEFAULT 1,
created_by TEXT,
created_at TEXT
```

Không sửa đè pricing cũ. Mỗi lần cân giá quan trọng tạo version mới.

### 7.8. `technical_changes`

```sql
change_id TEXT PRIMARY KEY,
rfq_item_id TEXT NOT NULL,
change_date TEXT,
change_type TEXT, -- spec_change / replacement / clarification / owner_confirm / rejected
old_value TEXT,
proposed_value TEXT,
owner_response TEXT,
status TEXT DEFAULT 'pending',
file_id TEXT,
note TEXT,
created_by TEXT,
created_at TEXT
```

Không sửa đè quá trình thay đổi quy cách. `rfq_items.quy_cach_final` chỉ là kết quả cuối.

### 7.8A. `technical_clarifications` — production timeline hiện tại

Production hiện dùng bảng `technical_clarifications` để lưu timeline clarification theo chiều dọc:

```sql
clarification_id TEXT PRIMARY KEY,
rfq_item_id TEXT NOT NULL,
clarification_type TEXT NOT NULL,
question_text TEXT,
response_text TEXT,
proposed_spec TEXT,
proposed_brand TEXT,
proposed_origin TEXT,
status_after TEXT,
is_final_update INTEGER DEFAULT 0,
created_by TEXT,
created_at TEXT NOT NULL,
updated_at TEXT,
deleted_at TEXT
```

Tên cột cụ thể phải kiểm tra theo migration production thật trước khi sửa code. Nguyên tắc không đổi:

- Một `rfq_item_id` có nhiều clarification.
- Không thêm cột `clarification_1`, `clarification_2`.
- Không sửa đè lịch sử khi final confirm.
- Nếu final confirm và user tick cập nhật final, chỉ cập nhật snapshot trên `rfq_items`.
- Danh sách RFQ Item không join/load toàn bộ timeline.
- Detail/modal mới gọi `getTechnicalClarifications`.

### 7.9. `contracts`

Production V1:

```sql
contract_id TEXT PRIMARY KEY,
rfq_id TEXT,
contract_no TEXT NOT NULL,
contract_name TEXT,
client_id TEXT,
signed_date TEXT,
effective_date TEXT,
expiry_date TEXT,
currency TEXT DEFAULT 'VND',
contract_total INTEGER DEFAULT 0,
status TEXT NOT NULL DEFAULT 'active',
note TEXT,
created_by TEXT,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
archived_at TEXT
```

Contract là header. `contract_total` tính từ active `contract_items`.

### 7.10. `contract_items`

Production V1:

```sql
contract_item_id TEXT PRIMARY KEY,
contract_id TEXT NOT NULL,
rfq_item_id TEXT,
item_id TEXT,
line_no TEXT,
ma_vat_tu TEXT,
ten_vat_tu TEXT NOT NULL,
required_model TEXT,
manufacturer TEXT,
brand TEXT,
origin_country TEXT,
unit TEXT,
contract_quantity REAL DEFAULT 0,
contract_unit_price INTEGER DEFAULT 0,
contract_line_total INTEGER DEFAULT 0,
supplier_id TEXT,
supplier_name TEXT,
source_quote_id TEXT,
note TEXT,
status TEXT NOT NULL DEFAULT 'active',
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
archived_at TEXT
```

Contract item là snapshot tại thời điểm ký hợp đồng. Không mutate RFQ Item hoặc Supplier Quote khi tạo/sửa Contract Item.

### 7.11. `media_files`

```sql
file_id TEXT PRIMARY KEY,
owner_type TEXT NOT NULL, -- rfq / rfq_item / item / quote / technical_change / contract
owner_id TEXT,
file_kind TEXT NOT NULL, -- image / quote_pdf / excel_source / datasheet / confirmation / other
r2_key TEXT NOT NULL,
public_url TEXT,
file_name TEXT,
mime_type TEXT,
size_bytes INTEGER DEFAULT 0,
width INTEGER,
height INTEGER,
variant TEXT, -- thumb / medium / original / document
is_primary INTEGER DEFAULT 0,
created_by TEXT,
created_at TEXT
```

### 7.12. `audit_logs`

```sql
audit_id TEXT PRIMARY KEY,
action TEXT NOT NULL,
entity_type TEXT,
entity_id TEXT,
message TEXT,
old_json TEXT,
new_json TEXT,
actor_id TEXT,
actor_name TEXT,
created_at TEXT
```

### 7.13. `tasks` — Nhắc việc theo công ty

```sql
task_id TEXT PRIMARY KEY,
company_name TEXT,
title TEXT NOT NULL,
description TEXT,
due_date TEXT,
priority TEXT DEFAULT 'medium',
status TEXT DEFAULT 'open',
created_by TEXT,
created_at TEXT NOT NULL,
updated_at TEXT,
deleted_at TEXT
```

Liên kết theo `company_name` text match, không foreign key cứng vào `clients`. Soft delete dùng `deleted_at`.

### 7.14. `rfq_item_revisions` — Snapshot quy cách

```sql
revision_id TEXT PRIMARY KEY,
rfq_item_id TEXT NOT NULL,
revision_no INTEGER NOT NULL,
required_model TEXT,
brand TEXT,
manufacturer TEXT,
origin_country TEXT,
technical_params TEXT,
snapshot_json TEXT,
created_by TEXT,
created_at TEXT NOT NULL
```

Tự động tạo snapshot sau mỗi final confirm clarification. `rfq_items.current_revision_no` tăng theo.

### 7.15. `rfq_contacts` — Gắn liên lạc khách hàng vào gói RFQ

```sql
rfq_contact_id TEXT PRIMARY KEY,
rfq_id TEXT NOT NULL,
contact_id TEXT NOT NULL,
role_note TEXT,
created_by TEXT,
created_at TEXT NOT NULL
```

Liên kết `client_contacts` vào `rfqs`. Không duplicate thông tin liên lạc.

### 7.16. `client_contacts`

```sql
contact_id TEXT PRIMARY KEY,
client_id TEXT NOT NULL,
contact_name TEXT NOT NULL,
position TEXT,
phone TEXT,
email TEXT,
note TEXT,
created_by TEXT,
created_at TEXT NOT NULL,
updated_at TEXT,
deleted_at TEXT
```

### 7.17. `client_equipment`

```sql
equipment_id TEXT PRIMARY KEY,
client_id TEXT NOT NULL,
equipment_name TEXT NOT NULL,
equipment_type TEXT,
model TEXT,
manufacturer TEXT,
serial_no TEXT,
install_date TEXT,
note TEXT,
created_by TEXT,
created_at TEXT NOT NULL,
updated_at TEXT
```

### 7.18. `client_bank_accounts`

```sql
bank_account_id TEXT PRIMARY KEY,
client_id TEXT NOT NULL,
bank_name TEXT NOT NULL,
account_no TEXT NOT NULL,
account_holder TEXT,
branch TEXT,
note TEXT,
created_by TEXT,
created_at TEXT NOT NULL,
updated_at TEXT
```

### 7.19. `client_legal_history`

```sql
legal_id TEXT PRIMARY KEY,
client_id TEXT NOT NULL,
event_date TEXT,
event_type TEXT,
description TEXT NOT NULL,
document_ref TEXT,
created_by TEXT,
created_at TEXT NOT NULL
```

---

## 8. R2 upload và ảnh vật tư

Dự kiến hiện tại 4.000-5.000 dòng, tương lai 30.000 dòng vật tư. Mỗi vật tư ít nhất 1 ảnh, khoảng 1.000 vật tư có thể có 4-6 ảnh.

Nguyên tắc:

- Ảnh/file không lưu trong D1.
- D1 chỉ lưu metadata và R2 key.
- Upload qua `api/upload.js`, không qua JSON API.
- Kiểm tra MIME + magic bytes.
- Resize ảnh trước khi lưu hoặc trong Worker pipeline nếu làm được.
- Không cần giữ ảnh gốc 4-8MB nếu không có nhu cầu bằng chứng gốc.

Biến thể ảnh:

```text
thumb: 300px, dùng cho list/table
medium: 1200px, dùng cho detail
original: optional, chỉ giữ nếu cần
```

R2 key thực tế production:

```text
media/{owner_type}/{owner_id}/{file_kind}/{file_id}-{safe_name}.{ext}
```

Ví dụ:

```text
media/quote/QUO-0001/quote_pdf/FILE-abc-bao_gia.pdf
media/rfq_item/ITEM-0001/item_image/FILE-xyz-anh.jpg
```

Bảo mật R2 key:

- `r2_key` là internal key, không bao giờ trả về trong API response (dùng `compactMediaRow` để strip).
- `r2_key` không lưu vào `audit_logs.new_json` khi upload media — audit log dùng `compactMediaRow(row)`, không dùng `row` thô.
- File truy xuất qua `getMediaFileContent` với JWT auth, không dùng URL R2 public.
- `public_url` trong `media_files` luôn để trống.

Biến thể ảnh:

```text
original: ảnh gốc đã validate magic bytes, JPEG hoặc WebP
```

Hiện tại chưa có thumbnail/resize pipeline. Không lưu nhiều variant cho cùng một file.

---

## 9. Search và performance

Không load toàn bộ 30.000 dòng lên frontend.

Rules:

- Mặc định list 50 dòng.
- Có nút load more 100/200.
- Không render 5000 dòng một lần.
- Dùng cursor pagination, không dùng OFFSET cho bảng lớn.
- Search ở D1, không filter toàn bộ trên frontend.
- Dashboard dùng summary query hoặc snapshot.
- Data ít đổi dùng KV cache.

Search nên hỗ trợ:

- mã vật tư;
- mã mua sắm;
- tên vật tư;
- model/quy cách;
- hãng;
- xuất xứ;
- mã TBMT/gói;
- mã hợp đồng;
- supplier;
- text trong thông số kỹ thuật.

Tạo `normalized_search` để search tiếng Việt/Trung/Anh dễ hơn.

Index bắt buộc:

```sql
CREATE INDEX IF NOT EXISTS idx_rfqs_client ON rfqs(client_id);
CREATE INDEX IF NOT EXISTS idx_rfqs_status ON rfqs(trang_thai_goi);
CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq ON rfq_items(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_items_ma_vat_tu ON rfq_items(ma_vat_tu);
CREATE INDEX IF NOT EXISTS idx_rfq_items_ma_mua_sam ON rfq_items(ma_mua_sam);
CREATE INDEX IF NOT EXISTS idx_rfq_items_search ON rfq_items(normalized_search);
CREATE INDEX IF NOT EXISTS idx_items_ma_vat_tu ON items(ma_vat_tu);
CREATE INDEX IF NOT EXISTS idx_items_search ON items(normalized_search);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_item ON supplier_quotes(rfq_item_id);
CREATE INDEX IF NOT EXISTS idx_pricing_item ON pricing_decisions(rfq_item_id);
CREATE INDEX IF NOT EXISTS idx_changes_item ON technical_changes(rfq_item_id);
CREATE INDEX IF NOT EXISTS idx_contract_items_contract ON contract_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media_files(owner_type, owner_id);
```

---

## 10. Role đề xuất

Đơn giản trước:

- `admin`: toàn quyền, tài khoản, migration/debug, audit, hard delete dữ liệu nhầm/test.
- `manager`: quản lý RFQ, quotes, pricing, contracts, import/export. Có thể hard delete báo giá nhầm/test (`deleteSupplierQuote`). Có thể archive RFQ/quote thật.
- `purchasing`: nhập/sửa RFQ, dòng vật tư, quotes, upload file bằng chứng, xem giá.
- `viewer`: chỉ xem/search, không sửa.

Không chặn máy móc. Quyền phải theo vận hành thực tế.

Gateway kiểm tra action whitelist (`api/fetch-data.js`). Worker handler vẫn check lại role bằng `requireRole`.

---

## 11. UI/UX nguyên tắc

App dành cho purchasing, không phải demo marketing.

Bắt buộc:

- Bảng rõ cột, có search/filter/sort.
- Text dài wrap được, không cắt mất thông tin kỹ thuật.
- Modal chuyên nghiệp, không dùng `alert/confirm/prompt` mặc định.
- Mobile dùng được, không tràn ngang vô lý.
- Mỗi dòng vật tư có detail drawer/modal:
  - thông tin gốc;
  - ảnh;
  - báo giá hãng;
  - pricing version;
  - technical change log;
  - contract history.

Tab đề xuất:

```text
Dashboard
Gói RFQ
Dòng vật tư
Báo giá hãng
Cân giá
Xác nhận kỹ thuật
Hợp đồng
Master Item
Nhà cung cấp
File & Ảnh
Audit log
Tài khoản
```

---

## 12. Audit log

Mọi mutation quan trọng phải ghi audit. Các action đã ghi production:

- `createRfq`, `updateRfq`, `archiveRfq` — gói thầu.
- `createRfqItem`, `updateRfqItem` — dòng vật tư.
- `createSupplierQuote`, `updateSupplierQuote`, `archiveSupplierQuote` — báo giá hãng.
- `deleteSupplierQuote` — hard delete báo giá nhầm/test; `oldJson` ghi lại row trước khi xóa, `newJson = null`.
- `createPricingDecision` — cân giá.
- `createTechnicalClarification`, `updateTechnicalClarification` — xác nhận kỹ thuật.
- `uploadMedia` — upload file/ảnh bằng chứng; `newJson` dùng `compactMediaRow(row)` (không chứa `r2_key`).
- `downloadMedia` — truy xuất file/ảnh; chỉ ghi `message`, không ghi `oldJson`/`newJson`.
- `createContract`, `updateContract` — hợp đồng.
- `createTask`, `updateTask`, `deleteTask` — nhắc việc.

Log message phải dễ hiểu cho người nghiệp vụ:

```text
Han cập nhật RFQITEM-2026-00045: Quy cách final từ "SKF 6310" -> "NSK 6310". Thời gian: 14:30 2026-06-10
```

`r2_key` không bao giờ xuất hiện trong `audit_logs.new_json`. Nếu row lịch sử cũ (trước ngày fix) có chứa `r2_key` trong `new_json`, đó là dữ liệu lịch sử không thể thay đổi — không ảnh hưởng production hiện tại.

---

## 13. Những thứ không làm ở Phase 1

Không làm ngay:

- tồn kho;
- công nợ;
- thanh toán;
- giao hàng;
- ERP nhiều phòng ban;
- AI tự đọc Excel hoàn toàn;
- workflow duyệt nhiều cấp;
- gửi email tự động;
- OCR hóa đơn/chứng từ.

Chỉ làm core purchasing CRM trước.

---

## 14. Phase build đề xuất

Các phase ban đầu đã triển khai gần đủ thành sườn production. Từ sau smoke test ngày 2026-06-10, không nên tiếp tục mở module lớn theo phase cũ mà chuyển sang vận hành dữ liệu thật.

### Phase 1 — Khung app + core RFQ

Đã hoàn thành:

- Login/auth/role.
- Clients.
- Suppliers.
- RFQ CRUD.
- RFQ items CRUD.
- Search/pagination.
- Audit log.

### Phase 2 — Import mapping

Đã hoàn thành V1A/V1B Core:

- CSV mapping.
- XLSX mapping browser-side.
- Preview sheet.
- Map cột -> cột chuẩn.
- Template save/reuse theo owner.
- Import jobs/rows.
- Lưu raw row JSON.
- Chưa lưu source Excel vào R2; để V1C nếu cần audit/replay.

### Phase 3 — Supplier quotes + pricing

Đã hoàn thành:

- Nhập nhiều báo giá cho 1 RFQ item.
- Source/reference fields.
- Upload media evidence cho quote.
- Backend tính giá VND/sau thuế.
- Pricing Decisions/cân giá.
- Price History Search/Export.

### Phase 4 — R2 ảnh vật tư/media evidence

Đã có safe upload/media evidence. Nguyên tắc tiếp tục:

- Ảnh/PDF qua R2.
- D1 chỉ metadata.
- Không load sẵn media ở list.
- Chỉ load khi mở detail.
- Resize/compress ảnh để tránh file 2MB/4MB/8MB không cần thiết.

Nếu phát hiện ảnh vẫn quá nặng khi vận hành, sửa targeted phần upload/resize, không đổi kiến trúc.

### Phase 5 — Technical clarification

Đã hoàn thành timeline clarification:

- Hỏi hãng.
- Hãng phản hồi.
- CĐT phản hồi.
- Final confirm.
- Cập nhật snapshot final nếu user chọn.

### Phase 6 — Master Item + Price History + Contract

Đã hoàn thành sườn:

- Master Item Linking V1.
- Price History Search/Export V1.
- Contract / Contract Items V1.
- Dashboard Snapshot/Cache V2.

### Phase vận hành thực tế

Từ đây ưu tiên:

1. Nhập vài RFQ thật.
2. Import Excel thật từ nhiều CĐT.
3. Link master item thủ công/suggestion.
4. Nhập báo giá thật + bằng chứng ảnh/PDF.
5. Cân giá.
6. Tạo contract nếu trúng.
7. Xem dashboard/lịch sử giá.
8. Ghi lại lỗi thực tế.
9. Sửa targeted theo root cause.

Không mở module ERP/tồn kho/công nợ/thanh toán/giao hàng trong giai đoạn này.

## 14A. D1 migration production và deploy

Wrangler mặc định có thể chạy D1 trên local database nếu không thêm `--remote`.

Khi migrate production D1, bắt buộc dùng `--remote`:

```powershell
wrangler d1 execute procurement-crm-db --remote --file=src/worker/db/migrations/005_supplier_quotes.sql
```

Kiểm tra bảng trên production D1:

```powershell
wrangler d1 execute procurement-crm-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_quotes';"
```

Kiểm tra schema production D1:

```powershell
wrangler d1 execute procurement-crm-db --remote --command "PRAGMA table_info(supplier_quotes);"
```

Nếu quên `--remote`, Wrangler sẽ báo dạng:

```text
Resource location: local
Use --remote if you want to access the remote instance.
```

Khi đó migration chỉ chạy vào `.wrangler/state/...` local, Worker production vẫn lỗi:

```text
D1_ERROR: no such table: supplier_quotes
```

Quy trình deploy có migration:

```powershell
# 1. Chạy migration production D1 trước nếu Worker cần bảng/cột mới
wrangler d1 execute procurement-crm-db --remote --file=src/worker/db/migrations/00N_name.sql

# 2. Deploy Worker
wrangler deploy

# 3. Commit/push để Vercel auto deploy frontend/gateway
git status
git add .
git commit -m "feat: describe change"
git push
```

Không sửa migration cũ đã chạy production. Nếu cần đổi schema, tạo migration mới tăng số.

---

## 14B. Console smoke test Supplier Quotations v1

Sau khi login trên browser, copy một lần toàn bộ block này vào DevTools Console để test `Supplier Quotations v1`:

```js
(async () => {
  const log = (name, res) => console.log(`✅ ${name}:`, res);
  const fail = (name, err) => console.error(`❌ ${name}:`, err);

  try {
    console.log("=== Supplier Quotations v1 Smoke Test ===");

    const session = Auth.session?.();
    log("Current session", session);

    const itemsRes = await API.get("getRfqItems", { limit: 1 });
    log("Get 1 RFQ item", itemsRes);

    const item = itemsRes.rows?.[0] || itemsRes.items?.[0] || itemsRes.data?.[0];
    if (!item) throw new Error("Không tìm thấy RFQ item nào để test.");

    const rfqItemId = item.rfq_item_id || item.rfqItemId || item.id;
    if (!rfqItemId) throw new Error("RFQ item không có rfq_item_id.");

    log("Selected rfqItemId", rfqItemId);

    const before = await API.get("getSupplierQuotes", { rfqItemId });
    log("Quotes before create", before);

    if (session?.role === "viewer") {
      console.log("ℹ️ Viewer chỉ test xem danh sách. Không test create/update/archive.");
      console.log("=== DONE ===");
      return;
    }

    const created = await API.call("createSupplierQuote", {
      rfqItemId,
      supplierName: "TEST NCC Console",
      manufacturer: "SKF",
      quoteDate: "2026-06-10",
      quotedPrice: 1000,
      currency: "USD",
      exchangeRate: 25000,
      taxRate: 10,
      leadTime: "6 tuần",
      validUntil: "2026-09-30",
      warranty: "12 tháng",
      note: "Smoke test từ browser console"
    });
    log("Create quote", created);

    const quote = created.quote || created.row || created.data;
    const quoteId = quote?.quote_id || quote?.quoteId;
    if (!quoteId) throw new Error("Create thành công nhưng không thấy quote_id.");

    console.log("Expected price_vnd = 25,000,000");
    console.log("Expected price_vnd_incl_tax = 27,500,000");

    const afterCreate = await API.get("getSupplierQuotes", { rfqItemId });
    log("Quotes after create", afterCreate);

    if (["manager", "admin"].includes(session?.role)) {
      const updated = await API.call("updateSupplierQuote", {
        quoteId,
        rfqItemId,
        supplierName: "TEST NCC Console Updated",
        manufacturer: "FAG",
        quoteDate: "2026-06-10",
        quotedPrice: 2000,
        currency: "USD",
        exchangeRate: 25000,
        taxRate: 8,
        leadTime: "8 tuần",
        validUntil: "2026-10-31",
        warranty: "18 tháng",
        note: "Smoke test update"
      });
      log("Update quote", updated);

      const afterUpdate = await API.get("getSupplierQuotes", { rfqItemId });
      log("Quotes after update", afterUpdate);

      const archived = await API.call("archiveSupplierQuote", { quoteId });
      log("Archive quote", archived);

      const afterArchive = await API.get("getSupplierQuotes", { rfqItemId });
      log("Quotes after archive", afterArchive);
    } else {
      console.log("ℹ️ Purchasing chỉ test create. Không test update/archive.");
    }

    console.log("=== DONE ===");
  } catch (err) {
    fail("Smoke test failed", err);
  }
})();
```

Kết quả kỳ vọng:

- `viewer`: get/list PASS, không create.
- `purchasing`: get/list + create PASS, không update/archive.
- `manager`/`admin`: get/list + create + update + archive PASS.
- Với test USD 1000, tỷ giá 25000, thuế 10:
  - `price_vnd = 25,000,000`;
  - `price_vnd_incl_tax = 27,500,000`.

Nếu console báo `Worker HTTP 500` và `wrangler tail` có `D1_ERROR: no such table`, kiểm tra lại migration production D1 đã chạy với `--remote` chưa.

---

## 15. Workflow làm việc với GPT/Codex

### GPT project vai trò

GPT không trực tiếp deploy. GPT có nhiệm vụ:

1. Đọc blueprint và `.skills/*.md` khi cần.
2. Hỏi rõ yêu cầu nghiệp vụ nếu thiếu.
3. Viết prompt cho Codex inspect trước.
4. Đọc kết quả Codex inspect.
5. Xác định root cause nếu có lỗi.
6. Viết prompt sửa targeted edit cho Codex.
7. Đưa console test / SQL test / smoke test cho owner kiểm tra.
8. Sau khi OK mới đưa lệnh PowerShell để owner tự deploy.

### Codex vai trò

Codex:

- đọc repo;
- inspect;
- sửa code;
- không tự deploy production;
- không chạy migration production nếu owner chưa xác nhận;
- không tự refactor rộng;
- không tạo function/table trùng khi có thể reuse.

### Owner vai trò

Owner:

- chạy lệnh PowerShell;
- deploy Vercel/Worker;
- chạy D1 migration nếu được hướng dẫn;
- test trên browser;
- gửi console/API/Worker log lại cho GPT.

---

## 16. Prompt mẫu cho Codex inspect

```text
Bạn là Codex làm trong repo Procurement CRM. Trước khi code, hãy inspect kỹ repo.

Bắt buộc đọc:
- PROCUREMENT_CRM_BLUEPRINT.md
- .skills/01_architecture.md
- .skills/02_performance.md
- .skills/03_security.md
- .skills/04_han_preferences.md
- .skills/05_working_style.md

Yêu cầu:
1. Không code mù.
2. Không refactor diện rộng.
3. Reuse trước, chỉ tạo mới khi repo chưa có phần tương ứng.
4. Không tự deploy.
5. Không tự chạy migration production.

Hãy báo cáo:
- cấu trúc repo hiện tại;
- các file liên quan đến yêu cầu;
- action/API hiện có;
- D1 tables/migrations hiện có;
- phần nào có thể reuse;
- phần nào cần tạo mới;
- rủi ro bảo mật/performance;
- kế hoạch sửa theo từng file, chưa code vội.
```

---

## 17. Prompt mẫu cho Codex code

```text
Dựa trên inspect vừa rồi, hãy code đúng phạm vi sau: [mô tả task cụ thể].

Bắt buộc:
- Targeted edit, không refactor ngoài phạm vi.
- Giữ kiến trúc Vercel gateway -> Worker handler -> D1 query file.
- Handler chứa business logic, query file chứa SQL.
- Frontend gọi API qua assets/js/core/api.js.
- UI label/toast tiếng Việt, code biến/hàm tiếng Anh.
- Không dùng window.alert/confirm/prompt.
- List mặc định pagination 50 dòng.
- Không load toàn bộ lịch sử lên frontend.
- Mutation phải ghi audit log.
- Sau mutation phải invalidate KV liên quan nếu có cache.
- Upload file/ảnh đi qua api/upload.js và R2, không nhét base64 vào D1.
- Không tự deploy.

Sau khi code xong, báo cáo:
1. Files changed.
2. Exact edits.
3. D1 migration cần chạy nếu có.
4. Manual test steps.
5. Console/API test commands.
6. Rủi ro hoặc phần chưa làm.
```

---

## 18. Prompt mẫu cho GPT Project riêng

```text
Bạn là GPT hỗ trợ tôi xây và bảo trì web app Procurement CRM / RFQ Price History cho công việc purchasing vật tư kỹ thuật.

Bối cảnh:
- Tôi là purchasing, không phải developer.
- App dùng Vercel + Cloudflare Worker + D1 + KV + R2.
- D1 lưu dữ liệu chính; KV cache; R2 lưu ảnh vật tư, file báo giá, datasheet, Excel gốc, file xác nhận kỹ thuật.
- App quản lý RFQ, dòng vật tư, báo giá hãng, cân giá, thay đổi kỹ thuật, hợp đồng nếu trúng.
- Excel từ nhiều CĐT không đồng nhất, nhưng phải map về một bộ cột chuẩn tiếng Việt.
- Không tạo schema riêng cho từng CĐT. Cột nào không có thì để trống. Luôn lưu raw_row_json.

Cách làm việc:
- Bạn không trực tiếp deploy.
- Bạn hướng dẫn tôi kiểm tra, đọc kết quả Codex, viết prompt cho Codex inspect/code.
- Tôi tự deploy bằng PowerShell sau khi bạn và tôi kiểm tra.
- Với lỗi chưa rõ, phải tìm root cause trước, không code mù.
- Ưu tiên targeted edit, không refactor rộng.
- Reuse trước, không tạo function/table/component trùng.
- Performance là bắt buộc: list mặc định 50 dòng, search ở D1, không load toàn bộ lịch sử lên frontend.
- UI phải như phần mềm nghiệp vụ: bảng, filter, modal rõ ràng, không dùng alert/confirm/prompt.

Tài liệu bắt buộc dùng:
- PROCUREMENT_CRM_BLUEPRINT.md
- .skills/*.md

Không bắt buộc đọc skill cho mọi sửa nhỏ. Nhưng các step quan trọng như tạo kiến trúc, sửa schema/migration, auth/role/security, upload R2, performance, import Excel, hoặc lỗi chưa rõ root cause thì phải nhắc Codex đọc kỹ .skills/*.md.

Khi tôi yêu cầu sửa app:
1. Hỏi lại nếu yêu cầu nghiệp vụ chưa rõ.
2. Viết prompt cho Codex inspect trước nếu chưa rõ repo/lỗi.
3. Sau inspect, phân tích root cause hoặc phạm vi sửa.
4. Viết prompt cho Codex code targeted edit.
5. Sau Codex code, yêu cầu báo cáo files changed/exact edits/migration/test steps.
6. Đưa tôi console test, SQL test hoặc PowerShell deploy command khi cần.
```

---


## 19. Trạng thái hoàn thành và nguyên tắc sau sườn

Tính đến smoke test production ngày 2026-06-10, các module sườn chính đã pass:

```text
RFQ
RFQ Items
Technical Clarification
Supplier Quotes
Quote Reference
Media Evidence
Pricing Decisions
CSV Import Mapping
XLSX Import Mapping
Master Item Linking
Price History Search/Export
Contract / Contract Items
Dashboard Snapshot/Cache V2
```

Chuỗi nghiệp vụ hoàn chỉnh hiện tại:

```text
RFQ
  -> RFQ Items
  -> Master Item/items
  -> Supplier Quotes + Evidence
  -> Pricing Decisions
  -> Price History
  -> Contract / Contract Items nếu trúng
  -> Dashboard summary
```

Từ giai đoạn này, mọi yêu cầu sửa nên phân loại trước:

### A. Bug vận hành

Ví dụ:

- import Excel sai ngày;
- mapping thiếu cột;
- quote tính sai thuế;
- link master sai;
- contract total sai;
- dashboard chưa cập nhật;
- ảnh quá nặng;
- action 400/403/500.

Cách làm:

1. Reproduce.
2. Xem Console.
3. Xem Network/API payload.
4. Xem Worker log nếu cần.
5. Xem D1 nếu nghi schema/data.
6. Xác định root cause.
7. Sửa đúng file/function liên quan.
8. Không refactor rộng.

### B. Cải tiến nhỏ

Ví dụ:

- thêm filter;
- đổi label;
- thêm cột vào bảng;
- chỉnh sort newest-first;
- thêm badge/count.

Cách làm:

- Targeted edit.
- Không tạo bảng/action mới nếu API cũ mở rộng được.
- Giữ UI nghiệp vụ đơn giản.

### C. Module mới

Chỉ làm khi dữ liệu thật chứng minh cần thiết. Trước khi code phải inspect.

Các module không mở vội:

- ERP;
- tồn kho;
- công nợ;
- thanh toán;
- giao hàng;
- OCR;
- AI automapping;
- workflow duyệt nhiều cấp;
- email automation.

### D. XLSX Source Archive V1C nếu cần

Chỉ làm nếu thực tế cần lưu file Excel gốc để audit/replay. Khi đó mới thêm:

```text
import_jobs.source_file_id
R2 owner_type import_job
file_kind source_xlsx
.xlsx magic byte + extension validation
source_file_id propagation
```

Không trộn V1C vào bugfix XLSX parser.

### E. Master Item data quality

Lịch sử giá chỉ mạnh khi RFQ Items được link đúng Master Item. Trong vận hành thật cần quy trình:

1. Import RFQ Items.
2. Mở detail dòng vật tư.
3. Xem suggestions.
4. Link vào item có sẵn hoặc tạo item mới.
5. Không auto-link hàng loạt nếu chưa kiểm tra.
6. Nếu link sai, unlink và link lại.

Dashboard `master_link_pct` là chỉ số theo dõi chất lượng dữ liệu.

### F. Dashboard cache

Dashboard V2 dùng KV TTL 300 giây. Nếu vừa sửa dữ liệu mà dashboard chưa đổi ngay, đây chưa chắc là bug. Chờ cache hết hạn hoặc sau này thêm invalidate targeted nếu thật cần.

---

## 20. Kết luận

Procurement CRM nên đi từ nhỏ đến chắc:

```text
RFQ + RFQ items + technical clarification + supplier quotes + pricing + contract history
```

Sau đó mới mở rộng contract history, ảnh vật tư lớn, import Excel nâng cao.

Thiết kế quan trọng nhất là:

- một bộ cột chuẩn tiếng Việt;
- lưu raw row JSON;
- không sửa đè lịch sử giá và lịch sử thay đổi kỹ thuật;
- search nhanh sau vài năm;
- R2 lưu ảnh/file, D1 chỉ lưu metadata;
- Codex luôn theo `.skills/*.md` ở các bước quan trọng.

## Modal/Layout Debug Rule — Bắt buộc trước khi sửa UI modal

Khi lỗi liên quan đến modal, table, scroll, width, overflow, cột bị mất, cột quá rộng/quá hẹp, chữ bị đè/tràn, tuyệt đối không prompt sửa code ngay.

Bắt buộc làm theo thứ tự:

1. Reproduce đúng màn hình/modal đang lỗi.
2. Mở DevTools Console.
3. Inspect DOM thực tế:
   - modal width/height
   - modal body width/overflow
   - parent chain
   - grid/flex wrapper
   - table width/min-width/table-layout
   - th/td width
   - overflow-x/overflow-y
4. Xác định element nào đang bó/kéo layout.
5. Chỉ sau khi có root cause DOM/CSS cụ thể mới prompt sửa code.

Không được đoán kiểu:
- “thêm table-layout fixed”
- “xóa overflow-x”
- “thêm modal--wide”
- “bỏ modal--wide”
- “thêm span-12”

nếu chưa có console/DOM evidence.

Nguyên tắc modal Procurement CRM:

- Form/modal nghiệp vụ mặc định phải tận dụng 90–96% chiều rộng laptop.
- Section nằm trong `form-grid-12` nếu muốn full width phải có `span-12`.
- Modal có ít cột phải fit vừa modal, không horizontal scroll.
- Modal có nhiều cột được phép horizontal scroll, nhưng scroll nằm ở table wrapper, không làm vỡ toàn modal.
- Không được xóa cột nghiệp vụ để sửa layout.
- Không được để 2 table hoặc child element có `min-width` lớn kéo rộng toàn bộ modal.
- Nếu summary chỉ có vài field, dùng grid/div rows thay vì table `min-width` lớn.
- Trước mọi fix modal/table phải báo root cause dạng:
  “element A width X trong parent B width Y nên gây overflow Z”.
