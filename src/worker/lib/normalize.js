export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSearchText(parts = []) {
  return normalizeText(parts.filter(Boolean).join(' '));
}

export function cleanString(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export function cleanMoney(value) {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
