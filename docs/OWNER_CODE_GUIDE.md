# Hướng dẫn đọc code cho chủ dự án

Tài liệu này giải thích repo bằng tiếng Việt đơn giản. Mục tiêu là giúp chủ dự án biết file nào làm gì, luồng nghiệp vụ chạy qua đâu, và khi lỗi thì kiểm tra gì.

## 1. Bức tranh tổng quan

App này có 3 phần chính:

```text
Trình duyệt của người dùng
  -> Vercel: chạy website, file JS/CSS, API gateway
  -> Cloudflare Worker: xử lý nghiệp vụ
  -> D1/KV/R2: lưu database, cache, ảnh
```

Nói đơn giản:

- Vercel là cửa trước.
- Worker là bộ não xử lý nghiệp vụ.
- D1 là database.
- KV là cache.
- R2 là nơi lưu ảnh upload.

## 2. Giải thích từng thư mục

### Thư mục gốc

- `index.html`: màn hình website công khai, màn hình quản lý nội bộ, modal, bảng, form.
- `package.json`: khai báo project và lệnh như `wrangler deploy`.
- `wrangler.toml`: cấu hình Cloudflare Worker, D1, KV, R2.
- `vercel.json`: cấu hình Vercel, cache header.
- `README.md`: hướng dẫn setup/deploy ban đầu.
- `SMOKE_TEST.md`: checklist test thủ công.
- `manifest.json`, `sw.js`, `icon-*.png`: PWA/app icon/cache offline cơ bản.

### `api/`

- `api/fetch-data.js`: cổng API chính của Vercel cho request JSON.
- `api/upload.js`: cổng upload ảnh riêng vì upload dùng multipart/form-data, không phải JSON.

### `assets/css/`

- `assets/css/app.css`: toàn bộ giao diện website và app nội bộ.

### `assets/js/core/`

- `api.js`: hàm gọi API, format tiền, escape HTML, toast lỗi.
- `auth.js`: đăng nhập, đăng xuất, session, phân quyền giao diện, điều hướng menu.
- `state.js`: cache nhẹ trong trình duyệt, chủ yếu danh sách sản phẩm.
- `datepicker.js`: nâng cấp input ngày/tháng.
- `product-display.js`: helper hiển thị tên sản phẩm.

### `assets/js/modules/`

- `catalog.js`: website công khai, danh mục sản phẩm, liên hệ, banner, font.
- `products.js`: quản lý sản phẩm nội bộ.
- `orders.js`: tạo đơn, xem đơn, in hóa đơn, hủy đơn, export.
- `inventory.js`: kho, tồn đầu kỳ, nhập/xuất/điều chỉnh, phiếu kho.
- `costs.js`: chi phí nhập hàng và chi phí vận hành.
- `reports.js`: báo cáo tháng/năm.
- `accounts.js`: tài khoản, đổi mật khẩu.
- `website-settings.js`: cấu hình website công khai và mẫu hóa đơn.

### `src/worker/`

- `index.js`: router của Worker. File này quyết định action nào đi tới handler nào.
- `handlers/`: xử lý nghiệp vụ.
- `db/`: câu SQL và migration.
- `lib/`: hàm dùng chung cho Worker.

### `src/worker/handlers/`

- `accounts.js`: login, đổi mật khẩu, quản lý tài khoản, setup tài khoản seed.
- `products.js`: sản phẩm.
- `orders.js`: đơn hàng và hủy đơn.
- `inventory.js`: kho và phiếu kho.
- `costs.js`: chi phí.
- `reports.js`: báo cáo.
- `audit.js`: nhật ký và thông báo.
- `website.js`: cấu hình website công khai.
- `media.js`: upload ảnh vào R2.

### `src/worker/db/`

Các file `*-queries.js` chỉ chứa SQL:

- `account-queries.js`
- `product-queries.js`
- `order-queries.js`
- `inventory-queries.js`
- `warehouse-queries.js`
- `cost-queries.js`
- `report-queries.js`
- `website-settings-queries.js`

### `src/worker/db/migrations/`

Mỗi file `.sql` là một lần thay đổi database.

Ví dụ:

- `001_initial.sql`: bảng ban đầu.
- `010_inventory.sql`: tồn đầu kỳ và phát sinh kho.
- `011_cost_inventory_refactor.sql`: thêm thông tin chi phí vận hành và index liên quan.
- `012_warehouse_vouchers.sql`: phiếu kho NH/XH/HN/HX.

Không sửa migration cũ đã chạy production. Nếu cần đổi database, tạo file mới.

## 3. File `api/fetch-data.js` làm gì?

Đây là cổng API chính ở Vercel.

Nó làm các việc:

1. Nhận request từ browser.
2. Đọc `action`.
3. Nếu là public action thì cho đi tiếp.
4. Nếu là `authLogin`, gửi qua Worker kiểm tra tài khoản.
5. Login thành công thì ký JWT và set cookie `wine_sess`.
6. Nếu là action nội bộ, kiểm tra cookie.
7. Kiểm tra role có được gọi action đó không.
8. Gửi request sang Worker bằng `X-Worker-Secret`.
9. Gửi thông tin user sang Worker bằng `X-App-Actor`.

Role whitelist nằm ngay đầu file:

- `STAFF_ALLOWED`
- `MANAGER_ALLOWED`
- `ADMIN_ALLOWED`

Khi bị 403, đây là file đầu tiên cần kiểm tra.

## 4. File `src/worker/index.js` làm gì?

Đây là router của Worker.

Nó làm các việc:

1. Trả CORS preflight.
2. Kiểm tra `X-Worker-Secret`.
3. Lấy `action`.
4. Cho public action chạy không cần login.
5. Login/setup thì chuyển sang `accounts.js`.
6. Các action còn lại phải có actor từ Vercel.
7. Kiểm tra session còn hợp lệ trong bảng `users`.
8. Route action sang handler:
   - sản phẩm -> `products.js`
   - đơn hàng -> `orders.js`
   - kho -> `inventory.js`
   - chi phí -> `costs.js`
   - báo cáo -> `reports.js`
   - tài khoản -> `accounts.js`
   - audit -> `audit.js`
   - website -> `website.js`
   - media -> `media.js`

File này không nên chứa nghiệp vụ phức tạp.

## 5. Handler là gì?

Handler là file xử lý nghiệp vụ.

Ví dụ:

- `orders.js` biết tạo đơn, xin hủy đơn, duyệt hủy đơn.
- `inventory.js` biết tạo phiếu kho, hủy phiếu kho, tính tồn.
- `products.js` biết tạo/sửa/ẩn sản phẩm.

Mẫu chung:

```js
export async function handleOrders(action, request, env, ctx, actor) {
  switch (action) {
    case 'createOrder':
      return createOrder(request, env, ctx, actor);
  }
}
```

Mỗi handler thường:

- kiểm tra quyền.
- đọc body/query.
- validate dữ liệu.
- gọi query SQL.
- ghi audit log.
- trả JSON `{ ok: true }` hoặc `{ ok: false, error: '...' }`.

## 6. DB query files là gì?

Query files chứa SQL thuần.

Ví dụ:

- Handler nói: "tạo đơn".
- Query file làm: `INSERT INTO sales_orders`.

Quy tắc tốt:

- Business logic để ở handler.
- SQL để ở query file.
- Không ghép chuỗi user input vào SQL.
- Luôn dùng `.prepare(...).bind(...)`.

## 7. Frontend JS modules hoạt động thế nào?

Mỗi module là một IIFE:

```js
(function () {
  function init() {}
  function loadList() {}
  window.OrdersModule = { init, loadList };
})();
```

Nghĩa là:

- code bên trong không làm bẩn global quá nhiều.
- chỉ expose những hàm HTML cần gọi.
- `index.html` gọi qua `onclick="OrdersModule.openCreate()"`.

Các module thường có nhóm hàm:

- `init`: nhận session.
- `load...`: gọi API lấy dữ liệu.
- `render...`: vẽ bảng/card/modal.
- `open...`/`close...`: mở/đóng modal.
- `save...`/`submit...`: gửi form lên API.

## 8. D1 migrations là gì?

Migration là file thay đổi database.

Ví dụ:

```powershell
wrangler d1 execute wine-sales-db --file=src/worker/db/migrations/012_warehouse_vouchers.sql
```

Lưu ý quan trọng:

- `CREATE TABLE IF NOT EXISTS` chạy lại thường không sao.
- `CREATE INDEX IF NOT EXISTS` chạy lại thường không sao.
- `ALTER TABLE ADD COLUMN` chạy lại có thể lỗi duplicate column.
- Không sửa migration cũ nếu database production đã chạy rồi.
- Nếu cần thêm cột mới, tạo migration mới.

## 9. Các pattern hàm thường gặp

### `API.call`

Trong `assets/js/core/api.js`.

Dùng cho POST JSON:

```js
var data = await API.call('createOrder', payload);
```

Nó tự thêm `{ action: 'createOrder' }`, gửi cookie, parse JSON.

### `API.get`

Dùng cho GET có query string:

```js
var data = await API.get('getOrders', { limit: 50 });
```

### Action routing

Frontend gửi action.

Vercel check action.

Worker route action.

Handler xử lý action.

Nếu action bị sai tên, thường nhận 400 `Unknown action`.

### Role checking

Có 3 lớp:

1. Frontend ẩn/hiện menu bằng `data-nav-role`, `data-min-role`.
2. Vercel whitelist action theo role.
3. Worker handler kiểm tra lại role.

Không được chỉ dựa vào frontend.

### SQL query functions

Ví dụ trong `order-queries.js`:

```js
export async function getOrderByIdSQL(db, id) {
  return db.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
}
```

Tên thường kết thúc bằng `SQL`.

### Render functions

Frontend có nhiều hàm `render...`.

Ví dụ:

- `renderOrderRows`
- `renderMonthlyTable`
- `renderVoucherTable`
- `renderProductCard`

Nhiệm vụ là biến dữ liệu thành HTML.

Khi render text người dùng nhập, dùng `API.esc()`.

### Modal functions

Tên thường là:

- `openCreate`
- `openEdit`
- `closeModal`
- `openVoucher`
- `closeVoucher`
- `openChangePassword`

Modal nằm trong `index.html`, JS chỉ bật/tắt class `hidden`.

### Form submit functions

Tên thường là:

- `submitOrder`
- `saveProduct`
- `saveVoucher`
- `saveCost`
- `submitChangePassword`

Luồng thường là:

1. đọc input.
2. validate nhanh.
3. tạo payload.
4. gọi `API.call`.
5. nếu lỗi gọi `API.error`.
6. nếu thành công toast, đóng modal, reload list.

## 10. Workflow: Login

1. User nhập username/password.
2. `submitLogin()` trong `index.html` gọi `Auth.login`.
3. `Auth.login` gọi `API.call('authLogin')`.
4. Vercel chuyển qua Worker.
5. `accounts.js` kiểm tra bảng `users`.
6. Password được kiểm tra bằng PBKDF2.
7. Nếu sai nhiều lần, lock 15 phút.
8. Nếu đúng, Worker trả user.
9. Vercel set cookie `wine_sess`.
10. Frontend lưu user trong `sessionStorage`.
11. App hiện màn hình quản lý theo role.

## 11. Workflow: Tạo sản phẩm

1. Manager/admin mở màn hình Sản phẩm.
2. Frontend `ProductsMgmtModule.openCreate()`.
3. Nhập thông tin sản phẩm.
4. `saveProduct()` gọi `API.call('createProduct')`.
5. Vercel kiểm tra role.
6. Worker `products.js` kiểm tra role manager/admin.
7. Validate tên và giá bán.
8. Tạo ID `PRD-YYYY-00001`.
9. Insert vào `products`.
10. Xóa cache KV public products.
11. Ghi audit log.
12. Frontend reload danh sách.

## 12. Workflow: Tạo đơn hàng

1. Staff/manager/admin mở Đơn hàng.
2. Bấm tạo đơn.
3. Chọn sản phẩm bằng product picker/search.
4. Nhập số lượng, giá, thông tin khách.
5. `submitOrder()` gọi `API.call('createOrder')`.
6. Worker tạo ID `DH-YYYY-MM-0001`.
7. Insert `sales_orders`.
8. Insert từng dòng vào `sales_order_lines` với `line_type = 'sale'`.
9. Tổng tiền lưu vào `sales_orders.total_amount`.
10. Ghi audit log.
11. Kho không insert movement riêng; tồn kho tính sale-out từ order lines trong query.

## 13. Workflow: Hủy/Void đơn hàng

1. User mở chi tiết đơn.
2. Bấm hủy đơn, nhập lý do.
3. Frontend gọi `requestVoidOrder`.
4. Worker kiểm tra:
   - đơn tồn tại.
   - đơn chưa voided.
   - staff chỉ được thao tác đơn của mình trong 1 năm.
   - chưa có pending request trùng.
5. Nếu manager/admin hoặc cùng ngày kinh doanh, Worker duyệt trực tiếp.
6. Nếu không, tạo `void_requests` trạng thái `pending`.
7. Manager/admin vào màn hình Hủy đơn.
8. Duyệt thì Worker:
   - tạo reversal lines trong `sales_order_lines`.
   - set order `status = 'voided'`.
   - set total = 0.
   - update void request `approved`.
   - ghi audit log.
9. Từ chối thì update `rejected` và lưu lý do.

## 14. Workflow: Phiếu nhập kho

Có 2 đường trong code:

- `createPurchaseImport`: form nhập hàng đơn giản.
- `createWarehouseVoucher` với `type = 'import'`: phiếu kho nhiều dòng.

Luồng chính:

1. Manager/admin mở Kho.
2. Tạo phiếu nhập.
3. Chọn sản phẩm, số lượng, đơn giá/thành tiền.
4. Worker tạo voucher code `NH-YYYY-MM-0001`.
5. Ghi `warehouse_vouchers`.
6. Ghi `warehouse_voucher_lines`.
7. Ghi `inventory_movements` loại `manual_in`.
8. Ghi `purchase_costs` để báo cáo chi phí nhập hàng.
9. Ghi audit log.

## 15. Workflow: Phiếu xuất kho

1. Manager/admin mở Kho.
2. Tạo phiếu xuất `type = 'export'`.
3. Worker tạo code `XH-YYYY-MM-0001`.
4. Ghi voucher và voucher lines.
5. Ghi `inventory_movements` loại `manual_out`.
6. Không ghi `purchase_costs`.
7. Ghi audit log.

## 16. Workflow: Hủy phiếu kho

1. Manager/admin bấm hủy phiếu.
2. Worker kiểm tra phiếu active.
3. Không cho hủy phiếu reversal.
4. Không cho hủy nếu đã có reversal.
5. Set phiếu gốc `status = 'canceled'`.
6. Tạo phiếu đảo:
   - phiếu nhập gốc -> `HN-YYYY-MM-0001`.
   - phiếu xuất gốc -> `HX-YYYY-MM-0001`.
7. Ghi dòng đảo số âm.
8. Ghi inventory movement để đảo tồn.
9. Ghi audit log.

## 17. Workflow: Chi phí vận hành

1. Manager/admin mở Chi phí.
2. Chọn tab chi phí vận hành.
3. Nhập ngày, loại chi phí, phương thức thanh toán, người nhận/nhà cung cấp, số tiền.
4. Frontend gọi `addOperatingCost`.
5. Worker validate ngày và số tiền > 0.
6. Chuẩn hóa category và payment method.
7. Insert `operating_costs`.
8. Ghi audit log.
9. Báo cáo dùng bảng này để tính operating cost.

## 18. Workflow: Tính báo cáo

1. Manager/admin mở Báo cáo.
2. Frontend gọi `getReportSummary`.
3. Worker gọi `report-queries.js`.
4. D1 tính:
   - doanh thu từ active order lines.
   - chi phí nhập từ `purchase_costs`.
   - chi phí vận hành từ `operating_costs`.
5. Profit = revenue - purchase_cost - operating_cost.
6. Frontend chỉ render bảng/chart.

## 19. Troubleshooting

### Lỗi 403

Nghĩa là không có quyền hoặc secret sai.

Kiểm tra:

- Role có action trong `api/fetch-data.js` chưa?
- Handler Worker có chặn role không?
- User có đúng role không?
- Vercel `WORKER_SECRET` có giống Cloudflare `WORKER_SECRET` không?
- Upload ảnh có phải admin không?

### Lỗi 400

Thường là thiếu dữ liệu hoặc dữ liệu sai format.

Kiểm tra:

- Có gửi `action` chưa?
- Payload có đúng tên field không?
- Ngày có dạng `YYYY-MM-DD` không?
- Tháng có dạng `YYYY-MM` không?
- URL/email/config có hợp lệ không?
- Phiếu/đơn có ít nhất 1 dòng không?

### Lỗi 500

Thường là lỗi server.

Kiểm tra:

- Worker thiếu env/secret/binding không?
- D1 đã chạy migration mới chưa?
- SQL có gọi cột chưa tồn tại không?
- Xem `wrangler tail`.

### Worker 1101

Đây thường là Worker bị exception.

Làm:

```powershell
wrangler tail
```

Sau đó reproduce lỗi và đọc log.

Nguyên nhân hay gặp:

- thiếu migration.
- thiếu binding R2/KV/D1.
- thiếu secret.
- code path throw lỗi chưa catch.

### Mojibake

Mojibake là chữ Việt bị lỗi như `Ä`, `RÆ°á»£u`.

Repo có migration sửa một số actor name và helper repair, nhưng vẫn cần kiểm tra thêm UI/source.

Khi gặp:

- kiểm tra file đang mở bằng UTF-8.
- kiểm tra dữ liệu trong D1.
- không sửa hàng loạt nếu chưa biết nguồn lỗi.

### Vercel deploy old commit

Kiểm tra:

```powershell
git status
git log --oneline -5
```

Sau đó vào Vercel xem deployment đang chạy commit nào.

Nếu cần trigger lại:

```powershell
git commit --allow-empty -m "trigger: redeploy"
git push
```

### D1 migration duplicate column

Nghĩa là cột đã tồn tại nhưng migration `ALTER TABLE ADD COLUMN` bị chạy lại.

Không chạy lại mù.

Kiểm tra schema trước:

```powershell
wrangler d1 execute wine-sales-db --command "PRAGMA table_info(purchase_costs);"
```

Nếu cột đã có, bỏ qua migration đó hoặc tạo migration mới phù hợp.

## 20. Lệnh copy-paste thường dùng

### Git status

```powershell
git status
```

### Git log

```powershell
git log --oneline -10
```

### Chạy D1 migration

```powershell
wrangler d1 execute wine-sales-db --file=src/worker/db/migrations/012_warehouse_vouchers.sql
```

### Chạy câu SQL kiểm tra D1

```powershell
wrangler d1 execute wine-sales-db --command "SELECT id, username, role, status FROM users LIMIT 10;"
```

### Deploy Worker

```powershell
wrangler deploy
```

### Git add/commit/push

```powershell
git add .
git commit -m "docs: update owner guide"
git push
```

### Xem log Worker

```powershell
wrangler tail
```

## 21. Browser console test examples

Mở website, đăng nhập, bấm F12 -> Console.

### Kiểm tra session

```js
Auth.session()
```

### Ping server

```js
await API.call('ping', {})
```

### Lấy sản phẩm public

```js
await API.call('getPublicProducts', {})
```

### Lấy đơn hàng

```js
await API.get('getOrders', { limit: 5 })
```

### Lấy tồn kho tháng hiện tại

```js
await API.get('getInventoryMonthlySummary', { month: '2026-06' })
```

### Lấy thông báo

```js
await API.call('getNotifications', { limit: 10 })
```

### Test role hiện tại

```js
Auth.isAdmin(Auth.session()?.role)
Auth.isManager(Auth.session()?.role)
```

### Test action bị chặn

Nếu đang là staff:

```js
await API.call('getAccounts', {})
```

Kết quả đúng là 403.

## 22. Chủ dự án có thể tự đổi gì?

Có thể tự đổi tương đối an toàn:

- Nội dung sản phẩm trong màn hình quản lý.
- Ảnh sản phẩm/banner qua UI admin.
- Text website trong Website settings.
- Chi phí vận hành.
- Tồn đầu kỳ khi đã kiểm kê đúng.
- Phiếu nhập/xuất kho theo chứng từ thật.
- Mật khẩu user qua UI.

Cần cẩn thận:

- Hủy đơn.
- Hủy phiếu kho.
- Xóa cứng dữ liệu test.
- Sửa giá sản phẩm cũ nếu cần giữ lịch sử.
- Chạy migration D1.

Nên cần Codex/architect review:

- Sửa code Worker.
- Thêm/sửa bảng D1.
- Đổi role/permission.
- Đổi logic hủy đơn/reversal.
- Đổi logic tồn kho.
- Đổi logic báo cáo doanh thu/lợi nhuận.
- Sửa encoding hàng loạt.
- Đổi upload/media/public URL.
- Deploy production khi có migration.

## 23. Vùng cần kiểm tra thêm

- Repo hiện tại không có Google Apps Script mặc dù tài liệu skill cũ có nhắc. Cần kiểm tra thêm nếu có hệ thống bên ngoài repo.
- Notification hiện đọc từ `audit_logs`, không thấy bảng notification riêng.
- Một số text tiếng Việt/Trung trong source đang hiển thị mojibake khi đọc bằng terminal. Cần kiểm tra trên browser/editor thực tế.
- Không thấy code tạo movement kho riêng khi tạo đơn bán; tồn kho sale-out đang được tính từ `sales_order_lines`.

## 24. Trước khi Codex làm việc mới phải đọc gì?

Trước khi GPT/Codex làm bất kỳ việc mới nào trong repo này, phải đọc:

- `docs/PROJECT_BLUEPRINT.md`
- `docs/OWNER_CODE_GUIDE.md`
- tất cả file `.skills/**/skill.md`

Ghi chú thực tế cho repo hiện tại: kiểm tra ngày 2026-06-09 thấy `.skills/` đang có file `.md` trực tiếp, không phải thư mục `*/skill.md`:

- `.skills/01_architecture.md`
- `.skills/02_performance.md`
- `.skills/03_security.md`
- `.skills/04_han_preferences.md`
- `.skills/05_working_style.md`
- `.skills/MSC_WEBAPP_REFACTOR_RULES.md`

Nếu sau này owner đổi cấu trúc thành `.skills/01_architecture/skill.md`, Codex phải đọc các file `skill.md` đó. Nếu repo vẫn là `.skills/*.md`, Codex phải đọc các file `.md` thực tế trong `.skills/`.

## 25. Thứ tự nguồn sự thật

Khi tài liệu và code có vẻ khác nhau, ưu tiên theo thứ tự:

1. `.skills/**/skill.md` = phong cách làm việc của owner, preference kiến trúc, quy tắc security/performance.
2. `PROJECT_BLUEPRINT.md` = kiến trúc app hiện tại và business rules.
3. `OWNER_CODE_GUIDE.md` = giải thích dễ hiểu, troubleshooting, commands.
4. Code/schema thật trong repo = sự thật triển khai cuối cùng.

Nói dễ hiểu: skill files nói "phải làm theo cách nào"; blueprint nói "app được thiết kế ra sao"; guide này giải thích cho người mới; code/schema cho biết app thật đang chạy thế nào.

## 26. Khi lỗi X thì gửi prompt nào cho Codex

Các prompt dưới đây dùng để yêu cầu Codex kiểm tra trước, không sửa mù. Khi gửi prompt, nên kèm ảnh lỗi, console log, action đang làm, tài khoản role gì.

### 403 permission/action blocked

Possible root cause:

- Role hiện tại không có action trong `api/fetch-data.js`.
- Worker handler cũng chặn role.
- Cookie login hết hạn.
- User bị inactive/frozen/archived.
- Vercel `WORKER_SECRET` không khớp Cloudflare `WORKER_SECRET`.

Files to inspect first:

- `api/fetch-data.js`
- `src/worker/index.js`
- `src/worker/lib/auth.js`
- handler liên quan trong `src/worker/handlers/`
- `src/worker/db/account-queries.js`

Copy-paste Codex inspection prompt:

```text
Codex, do not edit code yet. Inspect why this action returns 403.
Action: <ACTION_NAME>
Role/user: <ROLE_OR_USERNAME>
Screen/button: <WHERE_IT_HAPPENS>
Check api/fetch-data.js role whitelist, Worker index routing/session validation, and the related handler role check.
Report root cause with exact files/functions. Do not propose broad refactor.
```

What not to change blindly:

- Không thêm action vào `STAFF_ALLOWED` chỉ để hết lỗi nếu chưa hiểu nghiệp vụ.
- Không bỏ Worker role check.
- Không đổi `WORKER_SECRET`.
- Không set user lên admin để né lỗi.

### 400 bad payload

Possible root cause:

- Thiếu `action`.
- Thiếu required field.
- Frontend gửi camelCase nhưng handler đang đọc snake_case hoặc ngược lại.
- Date/month/url/email sai format.
- Form không tạo dòng sản phẩm.

Files to inspect first:

- frontend module gọi API trong `assets/js/modules/`
- `assets/js/core/api.js`
- handler liên quan trong `src/worker/handlers/`
- query file liên quan nếu lỗi đến từ SQL constraint.

Copy-paste Codex inspection prompt:

```text
Codex, do not edit code yet. Inspect why this API returns 400.
Action: <ACTION_NAME>
Payload from browser console/network: <PASTE_PAYLOAD>
Error response: <PASTE_RESPONSE>
Trace the payload from frontend module to handler validation. Identify missing/wrong fields and exact validation rule.
```

What not to change blindly:

- Không xóa validation.
- Không đổi tên field hàng loạt.
- Không cho handler nhận mọi key lạ.
- Không sửa DB schema nếu chỉ là payload sai.

### 500 server error

Possible root cause:

- Worker thiếu env/secret/binding.
- D1 chưa chạy migration.
- SQL gọi cột chưa tồn tại.
- Handler throw exception.
- R2/KV binding thiếu hoặc tên sai.

Files to inspect first:

- `src/worker/index.js`
- handler liên quan.
- query file liên quan.
- migration liên quan trong `src/worker/db/migrations/`
- `wrangler.toml`

Copy-paste Codex inspection prompt:

```text
Codex, do not edit code yet. Inspect this 500 server error.
Action: <ACTION_NAME>
Response body: <PASTE_RESPONSE>
Wrangler tail log: <PASTE_LOG>
Check Worker handler, DB query, migration/schema assumptions, and env/bindings. Give exact root cause before any fix.
```

What not to change blindly:

- Không catch lỗi rồi trả ok.
- Không đổi config/deploy secret nếu chưa xác định thiếu gì.
- Không sửa migration cũ.
- Không sửa frontend nếu lỗi nằm ở Worker/D1.

### Worker 1101

Possible root cause:

- Worker exception chưa catch.
- Import/export JS lỗi.
- Binding/env thiếu.
- SQL exception.
- Multipart upload bị parse sai.

Files to inspect first:

- `src/worker/index.js`
- handler action bị lỗi.
- `src/worker/lib/utils.js`
- query file liên quan.
- `api/upload.js` và `src/worker/handlers/media.js` nếu lỗi upload.

Copy-paste Codex inspection prompt:

```text
Codex, do not edit code yet. Diagnose Worker 1101.
I reproduced by doing: <STEPS>
Wrangler tail log: <PASTE_LOG>
Action/request path: <ACTION_OR_URL>
Find exact exception source and explain which file/function throws. Do not patch until root cause is clear.
```

What not to change blindly:

- Không deploy lại nhiều lần để thử may rủi.
- Không xóa code path lỗi.
- Không đổi runtime/config nếu log chưa chỉ ra.
- Không thêm fallback che lỗi thật.

### D1 duplicate column/migration error

Possible root cause:

- Migration `ALTER TABLE ADD COLUMN` đã chạy rồi.
- Chạy nhầm database.
- Chạy migration không đúng thứ tự.
- Local/remote schema khác nhau.

Files to inspect first:

- migration vừa chạy trong `src/worker/db/migrations/`
- `wrangler.toml`
- query file đang cần cột mới.

Copy-paste Codex inspection prompt:

```text
Codex, do not edit code yet. Inspect this D1 migration error.
Command run: <PASTE_COMMAND>
Error: <PASTE_ERROR>
Migration file: <FILE>
Check whether the column/table/index already exists and whether migration order is correct. Give safe next command. Do not modify old migrations.
```

What not to change blindly:

- Không sửa migration cũ đã chạy production.
- Không drop table.
- Không reset database.
- Không chạy lại toàn bộ migrations nếu chưa kiểm tra schema.

### Mojibake UTF-8

Possible root cause:

- File/source bị lưu sai encoding.
- Dữ liệu trong D1 đã bị lưu mojibake.
- Terminal hiển thị sai nhưng file/browser vẫn đúng.
- Migration repair chỉ sửa một phần actor name.

Files to inspect first:

- file UI có text lỗi: `index.html`, `assets/js/`, `assets/css/`
- `src/worker/lib/utils.js`
- migrations repair encoding `004`, `008`, `009`
- dữ liệu thật trong D1.

Copy-paste Codex inspection prompt:

```text
Codex, do not edit code yet. Inspect mojibake/UTF-8 issue.
Wrong text shown: <PASTE_BAD_TEXT>
Where shown: <SCREEN_OR_FILE>
Check whether issue is source file encoding, D1 stored data, terminal display, or browser rendering. Report root cause and exact affected files/rows before proposing repair.
```

What not to change blindly:

- Không replace toàn repo bằng find/replace mù.
- Không chạy repair migration nếu chưa biết dữ liệu lỗi nằm ở đâu.
- Không sửa text tiếng Trung/Vietnamese nếu không kiểm tra browser thật.
- Không mix encoding tools.

### Report number wrong

Possible root cause:

- Revenue chỉ tính `sales_orders.status = 'active'`.
- Void/reversal làm doanh thu/đơn thay đổi.
- Purchase cost được tạo từ phiếu nhập kho.
- Operating cost có date/period sai.
- Query aggregate sai tháng/năm.

Files to inspect first:

- `src/worker/handlers/reports.js`
- `src/worker/db/report-queries.js`
- `src/worker/db/order-queries.js`
- `src/worker/db/cost-queries.js`
- `src/worker/handlers/inventory.js` nếu liên quan nhập hàng.

Copy-paste Codex inspection prompt:

```text
Codex, do not edit code yet. Investigate wrong report number.
Report screen/month/year: <MONTH_OR_YEAR>
Expected number: <EXPECTED>
Actual number: <ACTUAL>
Check D1 source rows for sales_orders, sales_order_lines, purchase_costs, operating_costs. Explain the calculation path and identify exact row/query causing difference.
```

What not to change blindly:

- Không sửa frontend chart/table nếu số từ API đã sai.
- Không sửa aggregate query trước khi đối chiếu dữ liệu raw.
- Không xóa reversal/void lines.
- Không sửa số liệu bằng tay nếu chưa rõ nguồn.

### UI button/modal not showing

Possible root cause:

- Role UI ẩn bằng `data-nav-role`, `data-min-role`, `data-role`.
- Modal id trong HTML không khớp JS.
- Script load order sai.
- CSS class `hidden` hoặc layout che.
- JS exception trước đó làm module không init.

Files to inspect first:

- `index.html`
- `assets/js/core/auth.js`
- module liên quan trong `assets/js/modules/`
- `assets/css/app.css`
- browser console.

Copy-paste Codex inspection prompt:

```text
Codex, do not edit code yet. Inspect why this UI button/modal is not showing.
Screen: <SCREEN>
Role: <ROLE>
Expected element: <BUTTON_OR_MODAL>
Browser console errors: <PASTE_ERRORS>
Check index.html ids/classes/data-role attributes, Auth.applyRoleUI, related module open/close functions, and CSS hidden/layout rules.
```

What not to change blindly:

- Không xóa `hidden` class globally.
- Không bỏ role attributes.
- Không tạo modal mới nếu modal cũ tồn tại.
- Không đổi CSS rộng toàn app nếu chỉ một modal lỗi.

### Vercel deployed old commit

Possible root cause:

- Chưa push commit mới.
- Vercel đang trỏ branch khác.
- Deployment mới fail nên vẫn phục vụ bản cũ.
- Browser/service worker/cache đang giữ file cũ.
- Script/css query version chưa đổi nhưng file đã đổi.

Files to inspect first:

- `git status`
- `git log --oneline -10`
- Vercel deployment commit.
- `vercel.json`
- `sw.js`
- script/css tags trong `index.html`.

Copy-paste Codex inspection prompt:

```text
Codex, do not edit code yet. Inspect why Vercel appears to deploy an old commit.
Local git log: <PASTE_GIT_LOG>
Vercel deployment commit shown: <PASTE_COMMIT>
URL showing old behavior: <URL>
Check git state, deployment commit, vercel cache headers, service worker, and asset version query strings. Report exact cause.
```

What not to change blindly:

- Không redeploy nhiều lần nếu commit chưa đúng.
- Không xóa service worker code nếu chưa xác định cache.
- Không đổi Vercel config rộng nếu chỉ là browser cache.
- Không force push/reset.

## 27. Một API đi qua những file nào

Luồng API chuẩn:

```text
Browser UI
  -> assets/js/core/api.js
  -> api/fetch-data.js
  -> src/worker/index.js
  -> src/worker/handlers/*.js
  -> src/worker/db/*-queries.js
  -> D1/KV/R2
  -> response back to UI
```

Giải thích từng chặng:

- Browser UI: người dùng bấm nút hoặc mở màn hình.
- `assets/js/core/api.js`: `API.call()` hoặc `API.get()` gửi request.
- `api/fetch-data.js`: Vercel kiểm tra login, role, action whitelist, rồi proxy sang Worker.
- `src/worker/index.js`: Worker kiểm tra secret, session, route action.
- `src/worker/handlers/*.js`: xử lý nghiệp vụ.
- `src/worker/db/*-queries.js`: chạy SQL.
- D1/KV/R2: lưu database/cache/ảnh.
- Response quay về UI: frontend render bảng/modal/toast.

### Ví dụ `createOrder`

```text
OrdersModule.submitOrder()
  -> API.call('createOrder', payload)
  -> api/fetch-data.js checks role: staff/manager/admin allowed
  -> src/worker/index.js routes ORDER_ACTIONS
  -> src/worker/handlers/orders.js createOrder()
  -> src/worker/db/order-queries.js insertOrderSQL(), insertOrderLineSQL()
  -> D1 tables sales_orders, sales_order_lines
  -> audit_logs via writeActionLog()
  -> UI reloads order list
```

### Ví dụ `getInventoryMonthlySummary`

```text
InventoryModule.loadMonthly()
  -> API.get('getInventoryMonthlySummary', { month })
  -> api/fetch-data.js checks role: staff/manager/admin allowed
  -> src/worker/index.js routes INVENTORY_ACTIONS
  -> src/worker/handlers/inventory.js getInventoryMonthlySummary()
  -> src/worker/db/inventory-queries.js getInventoryMonthlySummarySQL()
  -> D1 reads products, inventory_opening_balances, inventory_movements, sales_order_lines, sales_orders
  -> UI renders monthly stock table
```

### Ví dụ `getPublicSiteConfig`

```text
CatalogModule.init()
  -> API.call('getPublicSiteConfig') or public fetch path
  -> api/fetch-data.js allows public action without JWT
  -> src/worker/index.js allows public action without actor
  -> src/worker/handlers/website.js getPublicSiteConfig()
  -> src/worker/db/website-settings-queries.js getWebsiteSettingSQL()
  -> D1 table website_settings, fallback default config if missing
  -> UI applies banner/text/contact/font settings
```

## 28. Checklist sửa UI

- Reproduce trên đúng role và đúng màn hình.
- Mở browser console, ghi lại lỗi JS nếu có.
- Kiểm tra `index.html` có đúng id/class/modal không.
- Kiểm tra module JS liên quan có expose function ra `window.*Module` không.
- Kiểm tra `Auth.applyRoleUI()` và `data-nav-role`/`data-min-role`.
- Kiểm tra CSS `.hidden`, z-index, responsive layout.
- Không sửa Worker/D1 nếu lỗi chỉ là hiển thị.
- Test desktop và mobile nếu là modal/table/menu.

## 29. Checklist sửa Worker

- Xác định action lỗi.
- Kiểm tra action có trong `api/fetch-data.js` whitelist không.
- Kiểm tra action có trong group của `src/worker/index.js` không.
- Kiểm tra handler switch có case không.
- Kiểm tra role check trong handler.
- Kiểm tra payload từ frontend.
- Kiểm tra query file và schema.
- Xem `wrangler tail` nếu có 500/1101.
- Không sửa nhiều module cùng lúc nếu root cause nằm một function.

## 30. Checklist sửa D1 migration

- Kiểm tra migration đã chạy chưa.
- Kiểm tra schema bằng `PRAGMA table_info(table_name);`.
- Không sửa migration cũ đã chạy.
- Tạo file migration mới nếu cần đổi schema.
- Với `ALTER TABLE ADD COLUMN`, nhớ D1 không có `IF NOT EXISTS` chuẩn.
- Chạy migration trước khi deploy Worker nếu code cần cột mới.
- Sau migration, test action đọc/ghi cột mới.
- Commit migration cùng code liên quan.

## 31. Checklist sửa role 403

- Xác định role user: `admin`, `manager01`, hay `staff`.
- Xác định action bị 403.
- Kiểm tra `STAFF_ALLOWED`, `MANAGER_ALLOWED`, `ADMIN_ALLOWED` trong `api/fetch-data.js`.
- Kiểm tra `MANAGER_ROLES` nếu role manager mới.
- Kiểm tra handler có `isManager()` hoặc `isAdmin()` không.
- Kiểm tra UI có đang ẩn/hiện đúng role không.
- Hỏi nghiệp vụ: role đó có thật sự được làm thao tác này không?
- Không mở quyền rộng hơn nhu cầu thật.

## 32. Checklist sửa báo cáo sai số

- Ghi rõ kỳ báo cáo: tháng/năm.
- Ghi số expected và actual.
- Query raw `sales_orders` và `sales_order_lines` cho kỳ đó.
- Kiểm tra đơn `voided` có bị loại đúng không.
- Kiểm tra reversal lines có đúng không.
- Query `purchase_costs` theo tháng.
- Query `operating_costs` theo tháng.
- Đối chiếu `report-queries.js` với công thức business.
- Không sửa frontend nếu API trả số sai.
- Không sửa dữ liệu production bằng tay nếu chưa có chứng cứ.
