# Excel Template Files for Đơn Export

Place the following files in this directory:

- `vt1-don-giao-hang.xlsx` — Delivery order (送货单 ĐƠN GIAO HÀNG)
- `vt1-don-tra-hang.xlsx`  — Return order   (退货单 ĐƠN TRẢ HÀNG)

## Required layout (JS fills these exact positions)

| Excel Row | 0-based index | Content |
|-----------|--------------|---------|
| Row 1     | r=0          | Company name CN — static, formatted in template |
| Row 2     | r=1          | Company name VN — static |
| Row 3     | r=2          | Blank (narrow spacer) |
| Row 4     | r=3          | Document title — static |
| **Row 5** | **r=4**      | Info: col C (c=2) = Tên Hợp đồng value; col I (c=8) = Mã Hợp đồng value |
| **Row 6** | **r=5**      | Info: col C (c=2) = recv/return unit; col I (c=8) = send unit |
| Row 7     | r=6          | Date / Sender — blank fill-in row |
| Row 8     | r=7          | Blank spacer |
| Row 9     | r=8          | Column headers — static, formatted |
| **Rows 10–109** | **r=9–108** | **100 pre-formatted blank data rows** |
| Row 110   | r=109        | Blank footer spacer |
| Row 111+  | r=110+       | Footer / signature rows — static |

## Data columns (A–L, 12 columns)

| Col | Index | Field |
|-----|-------|-------|
| A   | 0     | STT (序号) |
| B   | 1     | STT hợp đồng (合同序号) |
| C   | 2     | Mã vật tư (物资编号) — text format |
| D   | 3     | Tên vật tư (名称) |
| E   | 4     | Mã quy cách (规格型号) |
| F   | 5     | Chất liệu/Thương hiệu (材质/品牌) |
| G   | 6     | Số lượng (数量) |
| H   | 7     | Đơn vị (单位) |
| I   | 8     | Nhà CC/NSX/Thương hiệu (原设备供货商) |
| J   | 9     | Mã yêu cầu MIS (MIS需求单号) |
| K   | 10    | Mã đơn hàng MIS (MIS订单号) |
| L   | 11    | Ghi chú (备注) |

## How JS uses the template

1. Fetches `/assets/templates/vt1-don-giao-hang.xlsx` (or `vt1-don-tra-hang.xlsx`)
2. Reads workbook with `XLSX.read(..., { cellStyles: true })` — preserves all borders, merges, colors, page setup
3. Sets values in info cells (Row 5 col C/I, Row 6 col C/I)
4. Fills data rows 10–(10+n-1) with export data
5. Clears data rows (10+n)–109 — leaves them blank but keeps formatting
6. Downloads the result

## Template preparation tips

- Format 100 data rows (rows 10–109) with borders, wrap text, row height
- Set print area in Excel: e.g. A1:L111
- Set page setup: A4 portrait, fit to 1 page wide
- Lock/freeze top rows through row 9 (optional)
- If row count exceeds 100: JS will warn. Adjust DATA_ROWS constant in rfq-items.js if needed.
- If template file is missing, JS falls back to a generated (no-border) XLSX automatically.
