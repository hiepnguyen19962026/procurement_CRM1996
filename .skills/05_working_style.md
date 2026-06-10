# HAN TRAN WORKING STYLE

## Nguyên tắc 1 — Không code mù. Tìm root cause trước.

Đây là nguyên tắc quan trọng nhất. Lặp lại nhiều nhất trong mọi dự án.

**Không được đề xuất sửa code khi chưa xác định root cause.**

Quy trình bắt buộc khi có lỗi:
```
1. Reproduce lỗi — mô tả chính xác điều kiện xảy ra
2. Kiểm tra DB — query trực tiếp, xem data thực tế
3. Kiểm tra API — response thực, không đoán
4. Kiểm tra Console — log thực, error thực
5. Đưa ra nguyên nhân — "lỗi xảy ra vì X"
6. Mới đề xuất sửa — và chỉ sửa đúng chỗ đó
```

Không được đoán nguyên nhân rồi sửa thử. Nếu chưa biết root cause → nói thẳng "chưa xác định được, cần kiểm tra thêm X".

---

## Nguyên tắc 2 — Targeted edit. Không refactor diện rộng.

Lỗi nằm ở 1 function → chỉ sửa function đó.

**Không được đề xuất:**
- Đổi framework
- Đổi kiến trúc
- Đổi database schema khi không cần
- Refactor file không liên quan đến lỗi
- Rewrite module chỉ vì sửa 1 bug nhỏ

**Phải:**
- Xác định chính xác file + function + dòng cần sửa
- Sửa ít nhất có thể
- Không chạm vào code đang hoạt động tốt

Nếu cần thay đổi lớn hơn → hỏi trước, không tự ý.

---

## Nguyên tắc 3 — Reuse trước. Không tạo mới khi đã có.

**Trước khi viết bất kỳ function, component, UI element, hay D1 table mới — phải hỏi: cái này đã tồn tại chưa?**

Ví dụ thực tế từ spa-booking:
- Void bill đã có function + UI cho manager/director
- Khi thêm quyền cho receptionist/supervisor → KHÔNG tạo luồng "Yêu cầu void" mới với nút khác, tên khác, D1 table khác
- Đúng: reuse cùng function void, chỉ thêm role check + approval step nếu cần
- Sai: vẽ thêm luồng mới → 2 luồng cùng chức năng, D1 phình, KV phình, frontend phình

**Quy tắc cụ thể:**

Phân quyền khác nhau → KHÔNG tạo function mới. Chỉ thêm role condition vào function cũ.

UI khác nhau theo role → KHÔNG tạo component mới. Dùng `data-min-role` hoặc `if (role)` trong component cũ.

Workflow có thêm bước duyệt → KHÔNG tạo table mới nếu có thể thêm cột `status/requested_by` vào table cũ.

**Nếu không chắc có nên reuse hay tạo mới → hỏi trước. Không tự quyết.**

```
Câu hỏi phải tự hỏi trước khi tạo mới:
- Function này đã có ở file nào chưa?
- Table này đã có cột tương tự chưa?
- Component này đã render ở đâu chưa?
- Chỉ khác role/quyền → extend cái cũ, không tạo cái mới
```

---

## Nguyên tắc 4 — Performance là yêu cầu, không phải option.

22 giây là không chấp nhận. 504 là lỗi thiết kế, không phải lỗi server.

**Không được:**
- Load toàn bộ lịch sử vào frontend
- Load 5000 dòng để render rồi filter
- Aggregate ở frontend
- Query không có index
- Polling liên tục

**Phải:**
- Pagination mặc định (50 rows)
- Summary/aggregation ở D1
- Cache KV cho data ít thay đổi
- Snapshot cho dashboard
- Index trước khi query

Khi đề xuất giải pháp, luôn nghĩ đến tốc độ response trước.

---

## Nguyên tắc 5 — Tóm tắt trạng thái khi chat dài.

Khi cuộc trao đổi kéo dài, hoặc khi chuẩn bị chuyển sang chat mới, phải tóm tắt:

```
Trạng thái hiện tại: [đang làm gì, đến đâu rồi]
Đã sửa: [file, function cụ thể]
Đang hoạt động: [những gì đã test và OK]
Pending: [những gì chưa xong]
Lỗi còn lại: [nếu có]
Next step: [bước tiếp theo cụ thể]
```

Không tóm tắt chung chung. Phải cụ thể đến tên file và function.

---

## Nguyên tắc 6 — UI theo production software. Popup phải chuyên nghiệp.

**Chuẩn tham chiếu:** phần mềm kế toán, quản lý khách sạn, ERP đơn giản — dành cho người dùng nghiệp vụ, không phải IT dev. Người không biết IT vẫn dùng được.

**Không được:**
- Card màu mè, dashboard giả lập kiểu marketing
- `window.alert()`, `window.confirm()`, `window.prompt()` — không bao giờ
- Layout demo, animation không cần thiết
- Popup/modal đơn giản chỉ có 1 ô input — phải thiết kế đẹp, có label rõ, có nút cancel/confirm rõ ràng
- Bảng bị tràn, chữ đè nhau, cột quá hẹp không đọc được

**Phải:**
- Bảng với đủ cột, filter, search, sort
- Modal/popup: có tiêu đề, layout cân đối, nút hành động rõ ràng, đóng được bằng ESC hoặc click ngoài
- Responsive thật sự: trên điện thoại vuốt lướt mượt, không tràn ngang, không đè chữ
- Cột và dòng fit nội dung — text dài thì wrap xuống dòng, không truncate trừ khi có tooltip
- Font size đọc được trên mobile (min 13px)
- Thao tác nhanh: inline action, không phải navigate sang trang khác cho mọi thứ

---

## Nguyên tắc 7 — Phân quyền theo vận hành thực tế.

**Không:** chặn máy móc theo role vì "bảo mật"

**Phải hỏi:** ai cần dữ liệu này để làm việc hàng ngày?

- Therapist cần xem lịch của mình → cho xem
- Receptionist cần xem revenue để in bill → cho xem
- Supervisor cần duyệt nhưng cần đủ context → không che data

Phân quyền phản ánh quy trình vận hành thực tế. Hỏi "ngoài đời người ta có cần không?" trước khi block.

---

## Nguyên tắc 8 — Google Sheet là source of truth. D1 là query engine.

```
Google Sheet  →  nơi nhập liệu, source of truth, backup
GAS           →  sync, bridge
Worker + D1   →  xử lý logic, query nhanh
KV            →  cache
Frontend      →  render, không tính toán
```

Khi data ở Sheet và D1 lệch → Sheet thắng. Sync D1 từ Sheet, không ngược lại.

---

## Nguyên tắc 9 — Không over-engineering. Scale theo thực tế.

App vài chục người dùng nội bộ không cần Kubernetes, microservices, Redis cluster, Kafka, MongoDB, GraphQL.

**Ưu tiên:** đơn giản, dễ bảo trì 1 mình, chi phí thấp (Vercel + Cloudflare free tier là đủ).

Khi đề xuất giải pháp → hỏi: "có cần phức tạp đến vậy không?"

---

## Nguyên tắc 10 — Deploy: đưa lệnh, không tự deploy.

Sau khi viết hoặc sửa code xong, **không tự chạy deploy**. Phải đưa lệnh deploy để người dùng tự chạy — vì cần inspect, QA, kiểm tra kết quả trước khi push lên production.

**Format lệnh deploy chuẩn** (PowerShell, đứng ở thư mục gốc repo):

```powershell
# Worker
wrangler deploy

# GAS
clasp push

# GitHub (sau khi đã review)
git add .
git commit -m "mô tả thay đổi"
git push
```

**Không deploy Vercel** — Vercel tự deploy khi push GitHub.

**Không gộp** tất cả vào 1 lệnh dài. Đưa từng bước riêng để người dùng kiểm tra từng bước.

Nếu có migration D1 → đưa lệnh riêng, nhắc chạy trước khi deploy Worker:
```powershell
wrangler d1 execute <db-name> --file=src/worker/db/migrations/00N_xxx.sql
```

---

## Áp dụng

Tất cả 10 nguyên tắc áp dụng mọi cuộc trao đổi — debug, viết mới, sửa lỗi, thiết kế UI, phân quyền, deploy — cho mọi app, mọi dự án. Không cần nhắc lại.
