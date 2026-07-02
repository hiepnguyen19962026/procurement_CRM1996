# Performance — Procurement CRM

## Nguyên tắc bắt buộc

- **Không load toàn bộ dữ liệu lên frontend.** Danh sách RFQ Item mặc định 500 dòng, user chọn được 500/1000/2000/All. "All" nghĩa là toàn bộ bản ghi khớp điều kiện hiện tại, không phải toàn bộ bảng.
- **Filtering/searching/sorting luôn chạy tại D1/backend.** Không filter/sort ở frontend sau khi đã load.
- **Danh sách không preload dữ liệu phụ.** RFQ Item list không load kèm: technical clarifications, supplier quotations, pricing decisions, media evidence, contract items, price history. Các dữ liệu này chỉ load khi mở detail/modal của một RFQ Item cụ thể.
- **Dashboard là summary tính ở backend, không aggregate ở frontend.** Action `getDashboardV2`, cache KV `dashboard:v2` TTL 300 giây. Nếu vừa sửa dữ liệu mà dashboard chưa cập nhật, chờ tối đa cache warm lại qua cron `*/4 * * * *` — không phải bug.
- **Dùng cursor pagination cho bảng lớn, không dùng OFFSET.**
- **Ảnh/file không lưu base64 trong D1.** D1 chỉ lưu metadata + `r2_key`. Ảnh có biến thể thumb/medium/original tùy nhu cầu; danh sách chỉ dùng thumb.

## Index bắt buộc khi thêm field search mới

Mọi field dùng để filter/sort trên bảng lớn (`rfq_items`, `supplier_quotes`, `contract_items`...) phải có index tương ứng trong migration. Tham khảo danh sách index hiện có ở `PROCUREMENT_CRM_BLUEPRINT.md` mục 9 trước khi thêm index trùng.

`normalized_search` dùng để search tiếng Việt/Trung/Anh không dấu — mọi bảng có nhu cầu search text phải có cột này.

## KV cache

Dùng cho dữ liệu ít thay đổi: dashboard snapshot, filter options. TTL ngắn (vài phút), không dùng KV làm nguồn sự thật — D1 luôn là nguồn dữ liệu chính.

## Khi nghi ngờ vấn đề performance

1. Xác định action/màn hình cụ thể đang chậm.
2. Kiểm tra query D1 có dùng index không (`EXPLAIN QUERY PLAN`).
3. Kiểm tra frontend có đang load thừa dữ liệu phụ không (list kèm detail).
4. Kiểm tra ảnh/file có đang tải bản gốc thay vì thumb không.
5. Không tự thêm cache tùy tiện nếu chưa xác định rõ bottleneck nằm ở D1 hay frontend.
