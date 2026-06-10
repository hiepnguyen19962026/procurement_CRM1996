# Project Blueprint - Product Sales Web App

Tài liệu này là blueprint thực tế rút ra từ repo hiện tại. Dùng để xây app bán hàng tương tự: website công khai + hệ thống nội bộ + Worker + D1.

## 1. Project Overview

Repo hiện tại là web app bán rượu nhập khẩu Trung Quốc.

App có 2 mặt:

- Public website: khách xem sản phẩm, thương hiệu, liên hệ, banner, nội dung trang chủ.
- Internal admin app: đăng nhập để quản lý sản phẩm, đơn hàng, hủy đơn, kho, chi phí, báo cáo, tài khoản, audit, cấu hình website.

Luồng tổng quát:

```text
Browser
  -> Vercel static site + /api/fetch-data.js + /api/upload.js
  -> Cloudflare Worker src/worker/index.js
  -> Cloudflare D1 + KV + R2
```

## 2. Stack

- Frontend: HTML/CSS/vanilla JavaScript, SPA trong `index.html`, module JS trong `assets/js`.
- PWA: `manifest.json`, `sw.js`, icons.
- Gateway: Vercel Edge Function `api/fetch-data.js` cho JSON API, `api/upload.js` cho upload multipart.
- Backend: Cloudflare Worker trong `src/worker`.
- Database: Cloudflare D1 SQLite.
- Cache: Cloudflare KV binding `KV`.
- Media storage: Cloudflare R2 binding `MEDIA`.
- Deploy Worker: Wrangler.
- Deploy frontend/gateway: Vercel auto deploy từ GitHub.

## 3. Frontend Structure

```text
index.html
assets/css/app.css
assets/js/core/api.js
assets/js/core/auth.js
assets/js/core/state.js
assets/js/core/datepicker.js
assets/js/core/product-display.js
assets/js/modules/catalog.js
assets/js/modules/products.js
assets/js/modules/orders.js
assets/js/modules/inventory.js
assets/js/modules/costs.js
assets/js/modules/reports.js
assets/js/modules/accounts.js
assets/js/modules/website-settings.js
```

Rules:

- `index.html` chứa public website, app shell, modal, table shell, script load order.
- `assets/js/core/api.js` là cổng gọi API duy nhất: `API.call()` và `API.get()`.
- `assets/js/core/auth.js` quản lý login/logout/session cache/role UI/navigation.
- Mỗi module trong `assets/js/modules` dùng IIFE và expose global như `OrdersModule`, `InventoryModule`.
- Render dữ liệu bằng `API.esc()` khi chèn HTML.
- Tiền nhập bằng text + parse/format, không dùng `type="number"` cho tiền.
- Frontend không tự aggregate báo cáo chính; gọi Worker/D1.

## 4. Backend Worker Structure

```text
src/worker/index.js
src/worker/handlers/*.js
src/worker/db/*-queries.js
src/worker/db/migrations/*.sql
src/worker/lib/*.js
```

`src/worker/index.js` chỉ làm router:

- verify `X-Worker-Secret`
- lấy `action`
- cho phép public action không cần actor: `getPublicProducts`, `getPublicSiteConfig`
- chuyển auth/setup về account handler
- decode `X-App-Actor`
- validate session trong D1
- route sang handler theo action group

Handlers chứa business logic. Query files chỉ chứa SQL.

## 5. Vercel Gateway Role

`api/fetch-data.js` là lớp bảo vệ đầu tiên:

- chạy Edge Runtime.
- đọc action từ JSON body hoặc query string.
- action public: `getPublicProducts`, `getPublicSiteConfig`, `authLogin`, `initSetup`.
- login thành công thì ký JWT HS256 và set cookie `wine_sess`.
- các action còn lại phải có cookie hợp lệ.
- whitelist action theo role:
  - `staff`
  - `manager01`
  - `admin`
- forward sang Worker bằng:
  - `X-Worker-Secret`
  - `X-App-Actor` là base64url JSON.
- timeout Worker JSON API 10 giây.

`api/upload.js` là gateway riêng cho upload ảnh:

- không JSON encode body.
- giữ nguyên multipart/form-data.
- admin-only.
- giới hạn nhanh bằng `Content-Length` 5 MB.
- timeout 30 giây.

## 6. D1 Schema Overview

Các bảng chính:

- `users`: tài khoản, role, status, session version, login lockout.
- `products`: sản phẩm, giá nhập, giá bán, thông tin CMS/public catalog.
- `sales_orders`: đầu đơn bán hàng.
- `sales_order_lines`: dòng bán hàng, `line_type` là `sale` hoặc `reversal`.
- `void_requests`: yêu cầu hủy đơn.
- `purchase_costs`: chi phí nhập hàng, hiện được tạo từ phiếu nhập kho.
- `operating_costs`: chi phí vận hành.
- `audit_logs`: nhật ký thao tác.
- `website_settings`: cấu hình public website.
- `inventory_opening_balances`: tồn đầu kỳ theo sản phẩm.
- `inventory_movements`: ledger nhập/xuất/điều chỉnh kho.
- `warehouse_vouchers`: phiếu kho.
- `warehouse_voucher_lines`: dòng phiếu kho.

Index đã có cho sản phẩm, đơn hàng, dòng đơn, void request, chi phí, audit, inventory, warehouse voucher.

## 7. KV/R2 Usage

KV:

- Binding trong `wrangler.toml`: `KV`.
- `src/worker/lib/cache.js` cung cấp `getKv`, `setKv`, `invalidateKv`.
- Product handler cache public catalog bằng key `public_products:v1`.
- Khi tạo/sửa/ẩn hiện sản phẩm thì invalidate KV public products/product list.

R2:

- Binding trong `wrangler.toml`: `MEDIA`.
- `src/worker/handlers/media.js` upload ảnh vào R2.
- Cần secret/env `MEDIA_PUBLIC_URL` để trả URL public.
- Category upload hợp lệ: `hero-desktop`, `hero-mobile`, `gift`, `brand-story`, `authenticity`, `invoice`, `products`.
- Chỉ chấp nhận JPEG, PNG, WebP bằng magic bytes.

## 8. Auth/Session Flow

1. Browser gọi `API.call('authLogin', { username, password })`.
2. Vercel proxy public action sang Worker.
3. Worker `authLogin` kiểm tra `users`, status, lockout, PBKDF2 password hash.
4. Worker trả `user` gồm id, username, displayName, role, sessionVersion.
5. Vercel ký JWT, set cookie httpOnly `wine_sess`, trả user tối giản cho frontend.
6. Frontend lưu user vào `sessionStorage` key `wine_session`.
7. Các API sau đó gửi cookie bằng `credentials: 'include'`.
8. Vercel verify JWT, check role whitelist, forward actor.
9. Worker validate actor session bằng `users.session_version` và `status`.
10. Đổi/reset password hoặc freeze/archive account sẽ tăng `session_version` để kick session cũ.

## 9. Role/Permission Rules

Role thật trong repo:

- `admin`: toàn quyền.
- `manager01`: quản lý nghiệp vụ, không quản lý tài khoản/audit/website settings/upload.
- `staff`: tạo/xem đơn của mình, xem kho giới hạn, tạo yêu cầu hủy.

Gateway whitelist:

- Staff: `createOrder`, `getOrders`, `getOrderDetail`, `getOrderLines`, `requestVoidOrder`, inventory reads, notifications.
- Manager: thêm quản lý sản phẩm, kho, phiếu kho, void approval, chi phí, báo cáo, export.
- Admin: thêm audit, hard delete test data, accounts, website config, media upload.

Worker vẫn check lại role trong handler. Không chỉ tin Vercel.

## 10. Public Website Rules

Public site lấy:

- `getPublicProducts`: danh sách product `active = 1`.
- `getPublicSiteConfig`: cấu hình website từ `website_settings`, fallback default trong `handlers/website.js`.

Admin chỉnh website bằng `updatePublicSiteConfig`.

Website config có validate:

- URL phải là http/https hoặc rỗng.
- email phải hợp lệ.
- text length bị giới hạn.
- font, weight, align, color bị whitelist.
- target button chỉ là anchor `#...` hoặc URL http/https.

## 11. Internal Admin Modules

- Orders: bán hàng, xem chi tiết, in hóa đơn, hủy đơn, export.
- Void requests: danh sách yêu cầu hủy cho manager/admin.
- Inventory: tồn kho tháng, phát sinh ngày, phiếu kho, tồn đầu kỳ, nhập hàng, điều chỉnh.
- Products: quản lý sản phẩm, upload/preview ảnh, export CSV.
- Costs: chi phí nhập hàng và chi phí vận hành.
- Reports: tổng hợp doanh thu/chi phí/lợi nhuận theo tháng/năm.
- Audit: admin xem nhật ký hệ thống.
- Accounts: admin quản lý tài khoản.
- Website settings: admin chỉnh nội dung/ảnh/font public site và hóa đơn.
- Notifications: đọc một phần audit log nghiệp vụ.

## 12. Product Module

Actions:

- `getPublicProducts`
- `searchProducts`
- `getProducts`
- `createProduct`
- `updateProduct`
- `toggleProductActive`

Rules:

- Public chỉ thấy active products.
- Manager/admin mới quản lý sản phẩm.
- Product bắt buộc có `name` và `sale_price > 0` khi tạo.
- ID dạng `PRD-YYYY-00001`.
- Search dùng `normalizeVN` và tính score trong handler.
- Sau mutation phải invalidate KV catalog.
- Giá bán thay đổi nên cân nhắc tạo SKU mới nếu cần giữ lịch sử giá vận hành.

## 13. Sales Order Module

Actions:

- `createOrder`
- `getOrders`
- `getOrderDetail`
- `getOrderLines`
- `getOrdersExport`

Rules:

- Đơn phải có ít nhất 1 dòng.
- ID đơn theo tháng: `DH-YYYY-MM-0001`.
- Dòng đơn có `line_type = 'sale'`.
- Tổng tiền là tổng `amount` các dòng.
- Staff chỉ xem đơn của chính mình trong 1 năm gần nhất.
- Manager/admin xem rộng hơn và được export.
- Báo cáo doanh thu chỉ tính `sales_orders.status = 'active'`.

## 14. Void/Cancel Logic

Actions:

- `requestVoidOrder`
- `getVoidRequests`
- `approveVoidRequest`
- `rejectVoidRequest`
- `deleteOrderAdmin`
- `deleteVoidRequestAdmin`

Rules:

- Staff request void với lý do.
- Staff chỉ request đơn của mình, trong 1 năm.
- Nếu cùng business day theo Asia/Ho_Chi_Minh hoặc actor là manager/admin, request được duyệt trực tiếp.
- Nếu không, void request ở trạng thái `pending`.
- Manager/admin approve/reject pending request.
- Approve tạo các dòng `sales_order_lines.line_type = 'reversal'` với `amount` âm, rồi set order `status = 'voided'`, total = 0.
- Không xóa request đã approved bằng admin hard delete.
- `deleteOrderAdmin` là hard delete cho dữ liệu test: xóa void requests, order lines, order.

## 15. Inventory Module

Actions:

- `getInventoryProducts`
- `getInventoryMonthlySummary`
- `getInventoryDailyMovements`
- `exportInventoryDailyMovements`
- `upsertInventoryOpeningBalance`
- `createPurchaseImport`
- `createInventoryAdjustment`

Rules:

- Staff được xem tồn kho nhưng bị mask `purchase_price`.
- Manager/admin mới ghi tồn đầu kỳ, nhập hàng, điều chỉnh, export.
- Tồn tháng tính từ:
  - `inventory_opening_balances`
  - `inventory_movements`
  - `sales_order_lines` sale/reversal
- Daily movements là union từ opening, manual movements, sales order lines.
- `manual_in`, `manual_out`, `adjustment` là loại movement thật trong schema.
- Bán hàng tự xuất kho trong query bằng `sales_order_lines`, không thấy code insert `inventory_movements` khi tạo order.

## 16. Warehouse Voucher NH/XH/HN/HX Logic

Actions:

- `createWarehouseVoucher`
- `getWarehouseVouchers`
- `getWarehouseVoucherDetails`
- `cancelWarehouseVoucher`
- `deleteWarehouseVoucher`

Voucher types:

- `import`: phiếu nhập.
- `export`: phiếu xuất.
- `reversal`: phiếu đảo khi hủy phiếu.

Code families:

- `NH-YYYY-MM-0001`: nhập hàng/import.
- `XH-YYYY-MM-0001`: xuất hàng/export.
- `HN-YYYY-MM-0001`: đảo phiếu nhập.
- `HX-YYYY-MM-0001`: đảo phiếu xuất.

Create voucher:

- Manager/admin only.
- Phiếu phải có ít nhất 1 dòng.
- Import yêu cầu thành tiền.
- Ghi `warehouse_vouchers`.
- Ghi `warehouse_voucher_lines`.
- Ghi `inventory_movements`.
- Nếu import, đồng thời ghi `purchase_costs` với `voucher_id`, `voucher_code`.

Cancel voucher:

- Chỉ hủy phiếu active.
- Không hủy phiếu reversal.
- Không hủy lần 2 nếu đã có reversal.
- Đổi phiếu gốc sang `status = 'canceled'`.
- Tạo phiếu reversal:
  - gốc import -> `HN`
  - gốc export -> `HX`
- Reversal lines dùng số âm.
- Reversal cũng ghi inventory movement để đảo tồn.

Delete voucher:

- Manager/admin only.
- Chỉ xóa hard phiếu active chưa có reversal và không phải phiếu đảo.
- Xóa purchase costs liên quan, inventory movements liên quan, voucher lines, voucher.
- Dùng cho dữ liệu test là chính.

## 17. Cost Module

Purchase cost:

- `addPurchaseCost` hiện trả 409: phải nhập hàng từ màn hình Kho để đồng bộ chi phí và tồn kho.
- `getPurchaseCosts` đọc danh sách.
- `updatePurchaseCost`/`deletePurchaseCost` chặn nếu đã liên kết với inventory movement qua source.
- Purchase cost từ voucher import có `voucher_id`, `voucher_code`.

Operating cost:

- Actions: `addOperatingCost`, `getOperatingCosts`, `updateOperatingCost`, `deleteOperatingCost`.
- Manager/admin only.
- Category hợp lệ: `electricity`, `water`, `salary`, `rent`, `delivery`, `marketing`, `office`, `maintenance`, `tax_fee`, `other`.
- Payment method hợp lệ: `cash`, `bank_transfer`, `other`.
- `period_month` lấy từ ngày chi phí.

## 18. Report Module

Actions:

- `getReportSummary`
- `getMonthDetail`
- `getOrdersExport`

Rules:

- Manager/admin only.
- Monthly summary:
  - revenue từ active sales order lines.
  - purchase cost từ `purchase_costs`.
  - operating cost từ `operating_costs`.
  - profit = revenue - purchase - operating.
- Yearly summary gom tất cả năm có dữ liệu.
- Month detail trả revenue, purchase_cost, operating_cost, total_cost, profit, order_count.
- Frontend render chart/table; D1 tính aggregation.

## 19. Audit/Notification Logic

`writeActionLog()` ghi vào `audit_logs`:

- action
- actor id/name/role
- target type/id
- before_json
- after_json
- message
- created_at

Mọi mutation chính đều gọi audit qua `ctx.waitUntil()` để không block response.

Notifications không có bảng riêng. `getNotifications` đọc một nhóm action trong `audit_logs`:

- `createOrder`
- `approveVoidRequest`
- `directVoidOrder`
- `rejectVoidRequest`
- `upsertInventoryOpeningBalance`
- `createPurchaseImport`
- `createInventoryAdjustment`
- `addPurchaseCost`
- `addOperatingCost`

Worker scheduled cleanup xóa audit log cũ hơn 365 ngày.

## 20. Deployment Workflow

Frontend/Vercel:

```powershell
git status
git add .
git commit -m "docs: update project docs"
git push
```

Vercel tự deploy khi push GitHub.

Worker:

```powershell
wrangler deploy
```

Database migration:

```powershell
wrangler d1 execute wine-sales-db --file=src/worker/db/migrations/00N_name.sql
wrangler deploy
git add .
git commit -m "db: add migration 00N_name"
git push
```

Theo preference hiện tại: Codex không tự deploy production; đưa lệnh cho owner chạy.

## 21. Migration Workflow

Rules:

- Không sửa migration đã chạy production, đặc biệt `001_initial.sql`.
- Thêm file mới tăng số: `013_xxx.sql`.
- Với D1, `ALTER TABLE ADD COLUMN` không có `IF NOT EXISTS`; nếu chạy lại có thể lỗi duplicate column.
- Nếu migration có `ALTER TABLE`, phải kiểm tra schema trước khi chạy lại.
- Tạo index bằng `CREATE INDEX IF NOT EXISTS`.
- Chạy migration trước khi deploy Worker nếu Worker cần cột/bảng mới.
- Sau migration, test action liên quan qua browser console hoặc API.

## 22. Common Bug Checklist

- 403:
  - role không có action trong `api/fetch-data.js`.
  - handler Worker cũng chặn role.
  - thiếu/sai `X-Worker-Secret`.
  - upload không phải admin.
- 400:
  - thiếu `action`.
  - thiếu required field.
  - field sai format date/month/url/email.
  - voucher không có dòng.
- 409:
  - duplicate username.
  - order đã voided.
  - void request đã pending.
  - purchase cost linked với kho không cho sửa/xóa.
  - voucher đã canceled/reversal.
- 500:
  - thiếu env/secret/binding.
  - SQL schema chưa migrate.
  - Worker exception.
- Worker 1101:
  - exception trong Worker, xem `wrangler tail`.
  - hay gặp do schema thiếu cột, env thiếu, code path không bắt lỗi.
- 504:
  - Vercel gateway timeout 10 giây với Worker JSON API.
  - query quá nặng hoặc Worker treo.
- Mojibake:
  - source/output đang có nhiều chuỗi tiếng Việt bị lỗi encoding.
  - repo có migration repair và helper repair actor name, nhưng cần kiểm tra thêm toàn bộ UI text.
- Vercel deployed old commit:
  - kiểm tra `git log`, Vercel deployment commit, cache headers, query version trong script/css.
- D1 duplicate column:
  - migration `ALTER TABLE ADD COLUMN` đã chạy rồi.
  - kiểm tra schema trước, không chạy lại mù.

## 23. Coding Principles For Future Similar Apps

- Router chỉ route, không chứa business logic.
- Handler giữ business rule và role check.
- Query file chỉ SQL/prepared statements.
- Mọi SQL dùng `.prepare().bind()`.
- Mutations ghi D1 trước, audit/log/cache invalidate sau.
- Dùng `ctx.waitUntil()` cho việc không cần block response.
- Role check ở cả gateway và Worker.
- Public action phải liệt kê rõ.
- Không tin body actor/role từ frontend.
- Dùng session version để vô hiệu hóa JWT cũ.
- Dùng D1 aggregation, không aggregate dữ liệu lớn ở frontend.
- Dùng cursor/pagination, không load vô hạn.
- Cache KV cho dữ liệu public/read-heavy.
- Khi có media upload, tách endpoint multipart riêng.
- Hard delete chỉ cho admin và dữ liệu test; nghiệp vụ thật dùng status/reversal.
- Hủy tài chính/kho phải tạo dòng đảo, không xóa lịch sử.
- Nếu không chắc business rule, ghi "Cần kiểm tra thêm" thay vì đoán.

## 24. Unknown / Need More Check

- Không thấy Google Apps Script trong repo hiện tại dù skill architecture cũ có nhắc GAS. Repo hiện tại dường như không dùng GAS.
- Không thấy bảng notification riêng; notification hiện đọc từ `audit_logs`.
- Không thấy logic tự trừ kho bằng insert movement khi tạo order; tồn kho sale-out được tính từ `sales_order_lines`.
- Một số source text đang mojibake khi đọc file; cần kiểm tra bằng editor/browser thực tế để biết ảnh hưởng UI production.

## 25. Required Reading Before Future Work

Trước khi GPT/Codex làm bất kỳ việc mới nào trong repo này, phải đọc:

- `docs/PROJECT_BLUEPRINT.md`
- `docs/OWNER_CODE_GUIDE.md`
- tất cả file `.skills/**/skill.md`

Ghi chú cho repo hiện tại: kiểm tra thực tế ngày 2026-06-09 cho thấy `.skills/` đang có các file `.md` trực tiếp, không phải thư mục `*/skill.md`:

- `.skills/01_architecture.md`
- `.skills/02_performance.md`
- `.skills/03_security.md`
- `.skills/04_han_preferences.md`
- `.skills/05_working_style.md`
- `.skills/MSC_WEBAPP_REFACTOR_RULES.md`

Nếu sau này owner chuyển sang cấu trúc `.skills/01_architecture/skill.md`, Codex phải đọc các file `skill.md` đó. Nếu repo vẫn giữ cấu trúc `.skills/*.md`, Codex phải đọc các file `.md` thực tế trong `.skills/`.

## 26. Source Of Truth Priority

Khi tài liệu, skill note và code có vẻ mâu thuẫn, ưu tiên theo thứ tự:

1. `.skills/**/skill.md` = working style của owner, preference kiến trúc, security/performance rules.
2. `PROJECT_BLUEPRINT.md` = kiến trúc app hiện tại và business rules.
3. `OWNER_CODE_GUIDE.md` = giải thích cho người mới, troubleshooting, commands.
4. Actual repo code/schema = sự thật triển khai cuối cùng.

Nói cách khác: skill files nói cách làm việc và tiêu chuẩn; blueprint nói thiết kế hiện tại; owner guide giải thích dễ hiểu; code/schema quyết định app thật đang chạy thế nào.

## 27. Future Similar Apps

Blueprint này có thể tái sử dụng cho các app bán hàng tương tự, nhưng không bê nguyên domain fields.

Ví dụ chuyển từ app rượu sang app giày/dép:

- Bỏ alcohol/age-warning/legal alcohol rules nếu sản phẩm không phải rượu.
- Đổi field sản phẩm từ `alcohol_degree`, `specification_ml`, nguồn gốc rượu sang size, color, material, brand, gender, style.
- Giữ nguyên nguyên tắc SKU: khác size/color/cost/specification quan trọng thì nên là SKU riêng.
- Giữ kiến trúc inventory/order/cost/report/audit vì vẫn là app bán hàng.
- Review lại public site cần cart/order/payment hay chỉ cần contact như app hiện tại.
- Review lại invoice/export fields để khớp ngành mới.
- Review lại filter/search: app giày có thể cần size/color/brand/gender; app rượu cần dung tích/nồng độ/xuất xứ.

Phần có thể giữ gần như nguyên:

- Vercel gateway + Worker + D1/KV/R2.
- Role gateway whitelist + Worker role check.
- Product/order/void/cost/report/audit module structure.
- D1 migrations theo thứ tự.
- Upload ảnh qua endpoint riêng.
- Audit log cho mutation.
- Hủy nghiệp vụ bằng status/reversal, không xóa lịch sử.

Phần phải đổi theo domain:

- Tên sản phẩm và field đặc thù.
- Public copy, cảnh báo pháp lý, banner, SEO text.
- Quy tắc SKU.
- Quy tắc tồn kho nếu có biến thể.
- Quy tắc thanh toán/giao hàng nếu app mới bán trực tiếp trên web.
