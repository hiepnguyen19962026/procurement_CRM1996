# Procurement CRM Blueprint

Tài liệu này dùng làm blueprint cho web app **Procurement CRM / RFQ Price History**. Mục tiêu là quản lý dữ liệu khảo giá vật tư kỹ thuật cho purchasing: nhận danh sách vật tư từ CĐT, hỏi giá nhiều hãng/nhà cung cấp, cân giá báo CĐT, theo dõi thay đổi kỹ thuật, và tra cứu lại lịch sử giá sau vài tháng/vài năm.

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

Tính đến phase hiện tại, app đang đi đúng kiến trúc mục tiêu:

```text
Browser
  -> Vercel Gateway
  -> Cloudflare Worker
  -> D1
  -> KV
  -> R2
```

Frontend là Vanilla JS + PWA, không dùng framework frontend. Authentication đã hoạt động bằng JWT cookie httpOnly 7 ngày, giữ các thuộc tính bảo mật `HttpOnly`, `Secure`, `SameSite=Strict`.

Các nhóm nghiệp vụ đã hoạt động:

- Login/session/role: `admin`, `manager`, `purchasing`, `viewer`.
- Clients.
- Suppliers.
- RFQ/gói thầu.
- RFQ Items/dòng vật tư.
- Technical Clarification theo timeline.
- Supplier Quotations v1.
- Audit log.
- Pagination/search cơ bản.
- Dashboard cơ bản.

Nguyên tắc triển khai đang dùng:

- RFQ Item là trung tâm hệ thống.
- Danh sách RFQ Item không load toàn bộ timeline, báo giá, ảnh, file.
- Chỉ mở detail/modal của một RFQ Item mới load:
  - technical clarifications;
  - supplier quotations;
  - ảnh/file/báo giá ở các phase sau.
- Upload `/api/upload` vẫn khóa 501 nếu chưa hoàn thành MIME allowlist và magic-byte validation.
- Không mở upload public trước khi hoàn thành validate file an toàn.

---

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
createSupplierQuote
updateSupplierQuote
archiveSupplierQuote
```

Quyền:

- `viewer`: xem.
- `purchasing`: tạo mới.
- `manager`/`admin`: tạo, sửa, archive.

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

Archive là soft-hide/soft-archive, không hard delete. Báo giá archived vẫn là lịch sử nghiệp vụ.

Mutation create/update/archive phải ghi audit log.

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
│       │   ├── clients.js
│       │   ├── suppliers.js
│       │   ├── rfqs.js
│       │   ├── rfq-items.js
│       │   ├── quotes.js
│       │   ├── pricing.js
│       │   ├── technical-changes.js
│       │   ├── contracts.js
│       │   ├── items.js
│       │   ├── media.js
│       │   └── audit.js
│       ├── db/
│       │   ├── migrations/
│       │   │   ├── 001_initial.sql
│       │   │   ├── 002_indexes.sql
│       │   │   └── 003_media.sql
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
Cột Excel -> Cột chuẩn trong app
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

Lưu template mapping để lần sau chọn lại nhanh. Bảng:

```text
import_templates
import_template_columns
import_jobs
import_job_rows
```

Import flow:

1. Upload Excel vào R2.
2. Parse preview 20 dòng đầu.
3. User map cột.
4. Validate dữ liệu.
5. Import vào `rfq_items`.
6. Lưu `raw_row_json`.
7. Ghi audit log.

---

## 7. D1 schema đề xuất

### 7.1. `clients`

```sql
client_id TEXT PRIMARY KEY,
client_name TEXT NOT NULL,
plant_name TEXT,
province TEXT,
note TEXT,
created_at TEXT,
updated_at TEXT
```

### 7.2. `suppliers`

```sql
supplier_id TEXT PRIMARY KEY,
supplier_name TEXT NOT NULL,
supplier_type TEXT, -- manufacturer / distributor / trader / unknown
country TEXT,
contact_name TEXT,
email TEXT,
phone TEXT,
zalo TEXT,
wechat TEXT,
note TEXT,
created_at TEXT,
updated_at TEXT
```

### 7.3. `rfqs`

```sql
rfq_id TEXT PRIMARY KEY,
client_id TEXT,
ma_goi_tbmt TEXT,
ten_goi TEXT NOT NULL,
nha_may_cdt TEXT,
ngay_nhan_hoac_dang_tai TEXT,
ngay_het_han TEXT,
du_toan INTEGER DEFAULT 0,
trang_thai_goi TEXT NOT NULL DEFAULT 'dang_khao_gia',
source_file_id TEXT,
note TEXT,
created_by TEXT,
created_at TEXT,
updated_at TEXT
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
source_file_id TEXT,
source_sheet_name TEXT,
source_row_number INTEGER,
created_at TEXT,
updated_at TEXT
```

### 7.5. `items` — Master Item

```sql
item_id TEXT PRIMARY KEY,
ma_vat_tu TEXT,
ten_vat_tu TEXT NOT NULL,
quy_cach_model TEXT,
hang_nsx TEXT,
nhan_hieu TEXT,
xuat_xu TEXT,
vat_lieu TEXT,
category TEXT,
main_image_id TEXT,
normalized_search TEXT,
note TEXT,
created_at TEXT,
updated_at TEXT
```

Giai đoạn đầu không bắt buộc mọi RFQ item phải link vào `items`. Có thể link/merge sau.

### 7.6. `supplier_quotes`

Schema v1 đang dùng trong production:

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
status TEXT NOT NULL DEFAULT 'active',
created_by TEXT,
created_at TEXT NOT NULL,
updated_at TEXT,
FOREIGN KEY (rfq_item_id) REFERENCES rfq_items(rfq_item_id)
```

Index production:

```sql
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_item
  ON supplier_quotes(rfq_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_status
  ON supplier_quotes(status);
```

Ghi chú:

- V1 nhập báo giá thủ công, chưa upload file.
- `quote_file_id` và `email_ref` chưa có trong production v1.
- Khi mở upload báo giá/file email ở phase sau, thêm các field này bằng migration mới.
- Backend tự tính `price_vnd` và `price_vnd_incl_tax`, không tin frontend.
- `status` chỉ dùng `active` hoặc `archived`.
- Archive không xóa dữ liệu lịch sử.

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

```sql
contract_id TEXT PRIMARY KEY,
rfq_id TEXT,
contract_no TEXT NOT NULL,
client_id TEXT,
signed_date TEXT,
contract_total INTEGER DEFAULT 0,
contract_file_id TEXT,
status TEXT DEFAULT 'active',
note TEXT,
created_at TEXT,
updated_at TEXT
```

### 7.10. `contract_items`

```sql
contract_item_id TEXT PRIMARY KEY,
contract_id TEXT NOT NULL,
rfq_item_id TEXT,
item_id TEXT,
contract_unit_price INTEGER DEFAULT 0,
contract_quantity REAL DEFAULT 0,
contract_line_total INTEGER DEFAULT 0,
final_spec TEXT,
final_brand TEXT,
final_origin TEXT,
note TEXT,
created_at TEXT
```

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

R2 key đề xuất:

```text
media/items/{item_id}/thumb/{file_id}.webp
media/items/{item_id}/medium/{file_id}.webp
media/rfq-items/{rfq_item_id}/medium/{file_id}.webp
media/quotes/{quote_id}/{file_name}
media/contracts/{contract_id}/{file_name}
media/imports/{rfq_id}/{file_name}
```

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

- `admin`: toàn quyền, tài khoản, migration/debug, audit, hard delete test data.
- `manager`: quản lý RFQ, quotes, pricing, contracts, import/export.
- `purchasing`: nhập/sửa RFQ, quotes, upload file, xem giá.
- `viewer`: chỉ xem/search, không sửa.

Không chặn máy móc. Quyền phải theo vận hành thực tế.

Gateway kiểm tra action whitelist. Worker handler vẫn check lại role.

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

Mọi mutation quan trọng phải ghi audit:

- tạo/sửa RFQ;
- import Excel;
- sửa dòng vật tư;
- thêm/sửa báo giá hãng;
- tạo pricing version;
- cập nhật final spec;
- upload/xóa ảnh/file;
- tạo hợp đồng;
- sửa giá hợp đồng.

Log message phải dễ hiểu cho người nghiệp vụ:

```text
Han cập nhật RFQITEM-2026-00045: Quy cách final từ "SKF 6310" -> "NSK 6310". Thời gian: 14:30 2026-06-10
```

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

### Phase 1 — Khung app + core RFQ

- Login/auth/role.
- Clients.
- Suppliers.
- RFQ CRUD.
- RFQ items CRUD.
- Search/pagination.
- Audit log.

### Phase 2 — Excel import mapping

- Upload Excel vào R2.
- Preview sheet.
- Map cột Excel -> cột chuẩn.
- Import vào RFQ items.
- Lưu raw row JSON.

### Phase 3 — Supplier quotes + pricing

- Nhập nhiều báo giá cho 1 RFQ item.
- Upload file báo giá.
- Chọn base quote.
- Tính markup 1.4 / 1.55 / 1.6.
- Lưu pricing version.

### Phase 4 — R2 ảnh vật tư

- Upload ảnh theo item/RFQ item.
- Auto resize thumb/medium.
- Chọn ảnh đại diện.
- Gallery trong detail.

### Phase 5 — Technical change log

- Log thay đổi quy cách/model/hãng.
- Upload file xác nhận.
- Cập nhật final spec.

### Phase 6 — Contract history

- Tạo contract.
- Link RFQ item vào contract item.
- Lưu giá hợp đồng.
- Search theo mã hợp đồng.

---

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

## 19. Kết luận

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
