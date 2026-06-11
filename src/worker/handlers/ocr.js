import { WRITE_ROLES, requireRole } from '../lib/auth.js';
import { cleanString } from '../lib/normalize.js';
import { json } from '../lib/utils.js';

const MAX_BYTES = 8 * 1024 * 1024;
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

export async function handleOcr(action, request, env, _ctx, actor) {
  const denied = requireRole(actor, WRITE_ROLES);
  if (denied) return denied;

  if (!env.AI) {
    return json({
      ok: false,
      error: 'OCR chưa cấu hình. Thêm [ai] binding = "AI" vào wrangler.toml rồi chạy wrangler deploy.',
    }, 503);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, error: 'Không đọc được form' }, 400);

  const file = form.get('file');
  const mode = cleanString(form.get('mode') || 'item', 20);

  if (!file || typeof file.arrayBuffer !== 'function') {
    return json({ ok: false, error: 'Thiếu file ảnh' }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ ok: false, error: 'File quá lớn (tối đa 8MB)' }, 400);
  }

  const bytes = await file.arrayBuffer();
  const mime = detectMime(bytes);
  if (mime === 'pdf') {
    return json({ ok: false, error: 'Phase 1 chưa hỗ trợ PDF — vui lòng chụp ảnh hoặc chuyển sang JPEG/PNG.' }, 400);
  }
  if (mime === 'unknown') {
    return json({ ok: false, error: 'Định dạng không hợp lệ. Chấp nhận JPEG, PNG, WebP.' }, 400);
  }

  let rawText = '';
  try {
    const resp = await env.AI.run(VISION_MODEL, {
      prompt: buildPrompt(mode),
      image: [...new Uint8Array(bytes)],
    });
    rawText = (resp && resp.response) ? String(resp.response) : '';
  } catch (err) {
    return json({ ok: false, error: 'Lỗi OCR: ' + (err.message || String(err)) }, 500);
  }

  if (mode === 'item') {
    const rows = extractTableRows(rawText);
    return json({ ok: true, mode, kind: 'table', rows, rawText });
  }
  const mapped = extractJson(rawText);
  return json({ ok: true, mapped, rawText, mode });
}

function buildPrompt(mode) {
  if (mode === 'rfq') {
    return 'Extract procurement package information from this image. Return ONLY a valid JSON object, no extra text:\n'
      + '{"tenGoi":"package name","maGoiTbmt":"package or tender code","nhaMayCdt":"owner or client company name",'
      + '"ngayNhanHoacDangTai":"YYYY-MM-DD or empty string","ngayHetHan":"YYYY-MM-DD or empty string",'
      + '"duToan":"budget number only or empty string","note":"any other relevant details"}';
  }
  if (mode === 'supplier') {
    return 'Extract contact information from this business card image. Return ONLY a valid JSON object, no extra text:\n'
      + '{"supplierName":"company name","contactName":"person full name","phone":"phone number","email":"email address",'
      + '"country":"country","zalo":"Zalo number if present or empty string","wechat":"WeChat ID if present or empty string",'
      + '"note":"job title, address, website, and any other info concatenated as one string"}';
  }
  return 'Extract ALL material rows from the procurement table in this image. '
    + 'Chinese header mapping: 序号→sttGoc, 物资编码→maVatTu, 物资名称→tenVatTu, 规格型号→requiredModel, 单位→unit, 数量→quantity. '
    + 'Return ONLY valid JSON. No markdown. No explanation.\n'
    + '{"rows":[{"sttGoc":"","maVatTu":"","tenVatTu":"","requiredModel":"","unit":"","quantity":""}]}';
}

function extractJson(text) {
  if (!text) return {};
  try { return JSON.parse(text.trim()); } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
  return {};
}

function extractTableRows(text) {
  if (!text) return [];
  let parsed = null;
  try { parsed = JSON.parse(text.trim()); } catch (_) {}
  if (!parsed) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (_) {} }
  }
  if (!parsed) return [];
  const rawRows = Array.isArray(parsed.rows) ? parsed.rows
    : Array.isArray(parsed) ? parsed
    : [];
  return rawRows
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      sttGoc:        String(r.sttGoc        ?? r['序号']   ?? '').trim(),
      maVatTu:       String(r.maVatTu       ?? r['物资编码'] ?? '').trim(),
      tenVatTu:      String(r.tenVatTu      ?? r['物资名称'] ?? '').trim(),
      requiredModel: String(r.requiredModel ?? r['规格型号'] ?? '').trim(),
      unit:          String(r.unit          ?? r['单位']   ?? '').trim(),
      quantity:      String(r.quantity      ?? r['数量']   ?? '').trim(),
      rawRow:        r,
    }));
}

function detectMime(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return 'unknown';
}
