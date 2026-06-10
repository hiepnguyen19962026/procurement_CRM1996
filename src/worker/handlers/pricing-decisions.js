import { listPricingDecisionsSQL, getNextPricingVersionSQL, insertPricingDecisionSQL } from '../db/pricing-decision-queries.js';
import { getSupplierQuoteSQL } from '../db/supplier-quote-queries.js';
import { getRfqItemSQL } from '../db/rfq-item-queries.js';
import { MANAGE_ROLES, WRITE_ROLES, requireRole } from '../lib/auth.js';
import { writeActionLog } from '../lib/action-log.js';
import { cleanNumber, cleanString } from '../lib/normalize.js';
import { json, makeId, nowIso, publicActorName, readJson } from '../lib/utils.js';

const VALID_SELECTION_REASONS = new Set([
  'lowest_price', 'better_lead_time', 'better_warranty',
  'preferred_brand', 'client_approved', 'available_stock', 'other',
]);
const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high']);

export async function handlePricingDecisions(action, request, env, ctx, actor) {
  const body = await readJson(request);

  if (action === 'getPricingDecisions') {
    const roleCheck = requireRole(actor, WRITE_ROLES);
    if (roleCheck) return roleCheck;

    const rfqItemId = cleanString(body.rfqItemId, 200);
    if (!rfqItemId) return json({ ok: false, error: 'rfqItemId required' }, 400);

    const rows = await listPricingDecisionsSQL(env.DB, rfqItemId);
    return json({ ok: true, rows });
  }

  if (action === 'createPricingDecision') {
    const roleCheck = requireRole(actor, MANAGE_ROLES);
    if (roleCheck) return roleCheck;

    const rfqItemId  = cleanString(body.rfqItemId, 200);
    const baseQuoteId = cleanString(body.baseQuoteId, 200);

    if (!rfqItemId)   return json({ ok: false, error: 'rfqItemId required' }, 400);
    if (!baseQuoteId) return json({ ok: false, error: 'baseQuoteId required' }, 400);

    const [quote, item] = await Promise.all([
      getSupplierQuoteSQL(env.DB, baseQuoteId),
      getRfqItemSQL(env.DB, rfqItemId),
    ]);

    if (!quote) return json({ ok: false, error: 'Bao gia khong ton tai' }, 400);
    if (quote.status !== 'active') return json({ ok: false, error: 'Chi co the chon bao gia dang active' }, 400);
    if (quote.rfq_item_id !== rfqItemId) return json({ ok: false, error: 'Bao gia khong thuoc dong vat tu nay' }, 400);
    if (!item) return json({ ok: false, error: 'RFQ item khong ton tai' }, 400);

    const selectionReason = cleanString(body.selectionReason, 100);
    if (selectionReason && !VALID_SELECTION_REASONS.has(selectionReason)) {
      return json({ ok: false, error: 'selectionReason khong hop le' }, 400);
    }

    const pricingNote = cleanString(body.pricingNote, 2000);
    if (selectionReason === 'other' && !pricingNote) {
      return json({ ok: false, error: 'pricingNote bat buoc khi ly do la "other"' }, 400);
    }

    const riskLevel = cleanString(body.riskLevel, 50);
    if (riskLevel && !VALID_RISK_LEVELS.has(riskLevel)) {
      return json({ ok: false, error: 'riskLevel khong hop le' }, 400);
    }

    const rawMarkup = cleanNumber(body.markupRate);
    const markupRate = rawMarkup < 1.0 ? 1.0 : rawMarkup > 9.99 ? 9.99 : rawMarkup;

    const basePriceVndInclTax = Number(quote.price_vnd_incl_tax) || 0;
    const proposedUnitPrice   = Math.round(basePriceVndInclTax * markupRate);
    const quantity            = cleanNumber(item.quantity ?? item.so_luong);
    const proposedLineTotal   = Math.round(proposedUnitPrice * quantity);

    const version    = await getNextPricingVersionSQL(env.DB, rfqItemId);
    const pricingId  = makeId('PDC');
    const createdAt  = nowIso();
    const createdBy  = actor?.id || '';

    const row = {
      pricing_id:              pricingId,
      rfq_item_id:             rfqItemId,
      base_quote_id:           baseQuoteId,
      base_price_vnd_incl_tax: basePriceVndInclTax,
      markup_rate:             markupRate,
      selection_reason:        selectionReason || null,
      risk_level:              riskLevel || null,
      risk_note:               cleanString(body.riskNote, 1000) || null,
      proposed_unit_price:     proposedUnitPrice,
      proposed_line_total:     proposedLineTotal,
      pricing_note:            pricingNote || null,
      version,
      created_by:              createdBy,
      created_at:              createdAt,
    };

    await insertPricingDecisionSQL(env.DB, row);

    const actorName = publicActorName(actor);
    ctx.waitUntil(writeActionLog(env, {
      action: 'createPricingDecision',
      entityType: 'pricing_decision',
      entityId: pricingId,
      oldJson: null,
      newJson: row,
      actor,
      message: actorName + ' tao can gia v' + version + ' cho ' + rfqItemId
        + ': base ' + baseQuoteId + ', markup x' + markupRate
        + ', de xuat ' + proposedUnitPrice + ' VND',
    }));

    return json({ ok: true, pricingDecision: row });
  }

  return json({ ok: false, error: 'Unknown action' }, 400);
}
