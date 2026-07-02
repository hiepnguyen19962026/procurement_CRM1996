# Security — Procurement CRM

## Xác thực & session

- JWT ký qua Vercel gateway (`api/fetch-data.js`), lưu trong cookie `HttpOnly`, `Secure`, `SameSite=Strict`, Max-Age 7 ngày.
- Worker không tự xác thực người dùng cuối — chỉ tin request từ Vercel qua header `X-Worker-Secret` (server-to-server), sau đó nhận actor qua `X-App-Actor`.
- Session còn hợp lệ được kiểm tra lại trong bảng `users` (session_version) ở Worker, không chỉ tin JWT.

## Role — 2 lớp bắt buộc, không được bỏ lớp nào

1. **Gateway** (`api/fetch-data.js` cho JSON, `api/upload.js` cho multipart): whitelist action theo role trước khi proxy sang Worker.
2. **Worker handler**: tự `requireRole`/`isManager()`/`isAdmin()` lại, không tin gateway đã lọc đủ.

Role hiện có: `admin`, `manager`, `purchasing`, `viewer`. Không mở quyền rộng hơn nhu cầu nghiệp vụ thực tế — luôn hỏi lại nghiệp vụ trước khi thêm action vào whitelist role thấp.

`viewer`: chỉ xem/search/filter, không export dataset lớn, không hard delete, không xem audit log.

## R2 / Media

- `r2_key` là internal key, **không bao giờ** trả về trong API response — dùng `compactMediaRow()` để strip trước khi trả client hoặc ghi audit log.
- File truy xuất qua `getMediaFileContent` với JWT auth, không dùng URL R2 public. `public_url` luôn để trống.
- Upload đi qua `api/upload.js` + Worker media handler + R2, kiểm tra MIME + magic bytes. Không nhét base64 vào D1.

## Hai luồng xóa dữ liệu — phân biệt rõ

- **Archive** (soft, `status='archived'`): mặc định cho dữ liệu thật (quote hết hiệu lực). Vẫn tra được trong lịch sử.
- **Hard delete**: chỉ dùng cho dữ liệu nhập nhầm/test, không có giá trị lịch sử. Chỉ `manager`/`admin`. Luôn ghi audit log với `oldJson` trước khi xóa. Kéo theo cleanup `media_files` + R2 object liên quan trong background (`ctx.waitUntil`), không chặn response.

## Audit log

Mọi mutation quan trọng phải ghi audit: `action`, `entity_type`, `entity_id`, `old_json`/`new_json`, `actor_id`. Log message phải dễ hiểu cho người nghiệp vụ (không chỉ mã lỗi kỹ thuật). `new_json` không bao giờ chứa `r2_key`.

## Không hard-code thông tin công ty/khách hàng

Không hard-code tên bất kỳ CĐT, NCC, hay công ty cụ thể nào vào template, code export, hay chứng từ. Mọi tên đơn vị lấy động từ bảng `clients`/`suppliers`/field free-text theo từng bản ghi. Đây là bài học từ lỗi thực tế đã phát hiện và sửa (template phiếu giao/trả hàng từng in cứng tên khách hàng cũ).

## Trước khi sửa auth/role/upload/R2

Bắt buộc đọc lại file này + `PROCUREMENT_CRM_BLUEPRINT.md` mục 10 (Role) trước khi thay đổi bất kỳ whitelist hay logic upload nào. Không tự nới quyền để "hết lỗi 403" nếu chưa hiểu rõ nghiệp vụ đứng sau lỗi đó.
