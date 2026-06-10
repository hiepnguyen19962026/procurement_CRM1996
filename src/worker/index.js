import { handleAccounts } from './handlers/accounts.js';
import { handleAudit } from './handlers/audit.js';
import { handleClients } from './handlers/clients.js';
import { handleImports } from './handlers/imports.js';
import { handleItems } from './handlers/items.js';
import { handleMedia } from './handlers/media.js';
import { handleRfqs } from './handlers/rfqs.js';
import { handleRfqItems } from './handlers/rfq-items.js';
import { handleSuppliers } from './handlers/suppliers.js';
import { handlePricingDecisions } from './handlers/pricing-decisions.js';
import { handleSupplierQuotes } from './handlers/supplier-quotes.js';
import { handleTechnicalClarifications } from './handlers/technical-clarifications.js';
import { handlePriceHistory } from './handlers/price-history.js';
import { actorFromRequest, validateActorSession, validateSecret } from './lib/auth.js';
import { json, readJson } from './lib/utils.js';

const ACCOUNT_ACTIONS = ['authLogin', 'initSetup', 'logout', 'getSession', 'changePassword', 'getAccounts', 'createAccount', 'updateAccount'];
const CLIENT_ACTIONS = ['getClients', 'createClient', 'updateClient'];
const SUPPLIER_ACTIONS = ['getSuppliers', 'createSupplier', 'updateSupplier'];
const RFQ_ACTIONS = ['getDashboard', 'getRfqs', 'createRfq', 'updateRfq'];
const RFQ_ITEM_ACTIONS = ['getRfqItems', 'createRfqItem', 'updateRfqItem'];
const TECHNICAL_CLARIFICATION_ACTIONS = ['getTechnicalClarifications', 'createTechnicalClarification', 'updateTechnicalClarification', 'deleteTechnicalClarification'];
const SUPPLIER_QUOTE_ACTIONS = ['getSupplierQuotes', 'searchSupplierQuotes', 'createSupplierQuote', 'updateSupplierQuote', 'archiveSupplierQuote'];
const PRICING_DECISION_ACTIONS = ['getPricingDecisions', 'createPricingDecision'];
const AUDIT_ACTIONS = ['getAuditLogs'];
const MEDIA_ACTIONS = ['getMediaFiles', 'uploadMedia', 'getMediaFileContent'];
const IMPORT_ACTIONS = ['getImportTemplates', 'saveImportTemplate', 'commitImportRows', 'getImportJob', 'getImportJobRows'];
const ITEM_ACTIONS = ['searchMasterItems', 'getMasterItemDetail', 'suggestMasterItemsForRfqItem', 'createMasterItem', 'updateMasterItem', 'linkRfqItemToMaster', 'unlinkRfqItemFromMaster'];
const PRICE_HISTORY_ACTIONS = ['searchPriceHistory', 'getPriceHistorySummary', 'exportPriceHistoryCsv'];
const PUBLIC_ACTIONS = ['authLogin', 'initSetup'];

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return cors(json({ ok: true }));
    if (!validateSecret(request, env)) return cors(json({ ok: false, error: 'Forbidden' }, 403));

    const action = await getAction(request);
    if (!action) return cors(json({ ok: false, error: 'Missing action' }, 400));

    let actor = null;
    if (!PUBLIC_ACTIONS.includes(action)) {
      actor = actorFromRequest(request);
      if (!await validateActorSession(env.DB, actor)) {
        return cors(json({ ok: false, error: 'Session het han' }, 401));
      }
    }

    let res;
    if (ACCOUNT_ACTIONS.includes(action)) res = await handleAccounts(action, request, env, ctx, actor);
    else if (CLIENT_ACTIONS.includes(action)) res = await handleClients(action, request, env, ctx, actor);
    else if (SUPPLIER_ACTIONS.includes(action)) res = await handleSuppliers(action, request, env, ctx, actor);
    else if (RFQ_ACTIONS.includes(action)) res = await handleRfqs(action, request, env, ctx, actor);
    else if (RFQ_ITEM_ACTIONS.includes(action)) res = await handleRfqItems(action, request, env, ctx, actor);
    else if (TECHNICAL_CLARIFICATION_ACTIONS.includes(action)) res = await handleTechnicalClarifications(action, request, env, ctx, actor);
    else if (SUPPLIER_QUOTE_ACTIONS.includes(action)) res = await handleSupplierQuotes(action, request, env, ctx, actor);
    else if (PRICING_DECISION_ACTIONS.includes(action)) res = await handlePricingDecisions(action, request, env, ctx, actor);
    else if (AUDIT_ACTIONS.includes(action)) res = await handleAudit(action, request, env, ctx, actor);
    else if (MEDIA_ACTIONS.includes(action)) res = await handleMedia(action, request, env, ctx, actor);
    else if (IMPORT_ACTIONS.includes(action)) res = await handleImports(action, request, env, ctx, actor);
    else if (ITEM_ACTIONS.includes(action)) res = await handleItems(action, request, env, ctx, actor);
    else if (PRICE_HISTORY_ACTIONS.includes(action)) res = await handlePriceHistory(action, request, env, ctx, actor);
    else res = json({ ok: false, error: 'Unknown action' }, 400);
    return cors(res);
  },
};

async function getAction(request) {
  if (request.method === 'GET') return new URL(request.url).searchParams.get('action') || '';
  if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
    const cloned = request.clone();
    return (await cloned.formData().catch(() => new FormData())).get('action') || 'uploadMedia';
  }
  const body = await readJson(request.clone());
  return body.action || '';
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Worker-Secret,X-App-Actor');
  return new Response(response.body, { status: response.status, headers });
}
