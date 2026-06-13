import { getDashboardV2SQL } from '../db/dashboard-queries.js';
import { getExpiredQuotesReportSQL } from '../db/supplier-quote-queries.js';
import { getRfqDeadlineReportSQL } from '../db/rfq-queries.js';
import { getOrphanMediaReportSQL } from '../db/media-queries.js';
import { setKv } from '../lib/cache.js';

const DASHBOARD_TTL = 300;    // 5 min — matches getDashboardV2 handler TTL
const REPORT_TTL    = 21600;  // 6 h  — reports are cheap reads, refresh daily is enough

function todayVN() {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function dateAddVN(days) {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000 + days * 86400000);
  return d.toISOString().slice(0, 10);
}

// Called from index.js scheduled() export.
// Dashboard warmup: every cron trigger ("*/4 * * * *").
// Daily reports: only on the "0 2 * * *" trigger (02:00 UTC = 09:00 VN).
export async function runScheduledTasks(env, cron) {
  await warmDashboard(env).catch(err => console.error('[cron] dashboard warmup failed:', err));

  if (cron === '0 2 * * *') {
    await Promise.allSettled([
      scanExpiredQuotes(env),
      scanRfqDeadlines(env),
      scanOrphanMedia(env),
    ]);
  }
}

// Rebuild dashboard:v2 KV cache proactively so the next user request hits cache.
async function warmDashboard(env) {
  const data = await getDashboardV2SQL(env.DB);
  await setKv(env, 'dashboard:v2', data, DASHBOARD_TTL);
  console.log('[cron] dashboard:v2 warmed');
}

// Report active supplier_quotes where valid_until has passed.
// Report-only — no archive, no mutation.
async function scanExpiredQuotes(env) {
  const today = todayVN();
  const report = await getExpiredQuotesReportSQL(env.DB, today);
  await setKv(env, 'quotes:expired:report', {
    count: report.count,
    samples: report.samples,
    generated_at: new Date().toISOString(),
  }, REPORT_TTL);
  console.log(`[cron] quotes:expired:report — count=${report.count}`);
}

// Report open RFQs (dang_khao_gia/treo) that are overdue or due within 7 days.
// Report-only — no status mutation.
async function scanRfqDeadlines(env) {
  const today = todayVN();
  const d7    = dateAddVN(7);
  const report = await getRfqDeadlineReportSQL(env.DB, today, d7);
  await setKv(env, 'rfq:deadline:scan', {
    overdue_count:  report.overdue_count,
    due_soon_count: report.due_soon_count,
    samples:        report.samples,
    generated_at:   new Date().toISOString(),
  }, REPORT_TTL);
  console.log(`[cron] rfq:deadline:scan — overdue=${report.overdue_count} due_soon=${report.due_soon_count}`);
}

// Report media_files rows whose owner no longer exists in D1 (quote or rfq_item deleted).
// D1-side only — no R2 listing, no R2 delete, no D1 delete.
async function scanOrphanMedia(env) {
  const report = await getOrphanMediaReportSQL(env.DB);
  await setKv(env, 'media:orphan:report', {
    quote_orphan_count:    report.quote_orphan_count,
    rfq_item_orphan_count: report.rfq_item_orphan_count,
    samples:               report.samples,
    generated_at:          new Date().toISOString(),
  }, REPORT_TTL);
  console.log(`[cron] media:orphan:report — quote=${report.quote_orphan_count} rfq_item=${report.rfq_item_orphan_count}`);
}
