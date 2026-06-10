# Procurement CRM / RFQ Price History

Vanilla JS PWA for Phase 1 procurement work:

- Login, session, roles
- Clients/CDT CRUD
- Suppliers CRUD
- RFQ CRUD
- RFQ item CRUD
- Search with cursor pagination
- Audit log
- Basic media metadata and R2 upload path

Business center:

```text
RFQ -> RFQ items -> supplier quotes -> pricing decision -> technical changes -> contract items
```

Phase 1 intentionally does not build inventory, ERP, accounting, full Excel import, supplier quotes, pricing versions, technical change workflow, or contract history.

## Architecture

```text
Browser / PWA / Vanilla JS
  -> Vercel static + api/fetch-data.js + api/upload.js
  -> Cloudflare Worker
  -> D1 database
  -> KV cache
  -> R2 media/file storage
```

`src/worker/index.js` is router-only. Business logic stays in `src/worker/handlers/`. SQL stays in `src/worker/db/*-queries.js` and uses `prepare().bind()`.

## Setup Commands

Run from the repo root.

```powershell
npm install
```

Create Cloudflare resources:

```powershell
wrangler d1 create procurement-crm-db
wrangler kv namespace create KV
```

Create the R2 bucket in Cloudflare dashboard or with Wrangler:

```powershell
wrangler r2 bucket create procurement-crm-media
```

Update `wrangler.toml` with the real D1 database id and KV namespace id.

Set Worker secrets:

```powershell
wrangler secret put WORKER_SECRET
wrangler secret put SETUP_SECRET
```

Run D1 migrations manually. Do not run these against production until you have reviewed the files:

```powershell
wrangler d1 execute procurement-crm-db --file=src/worker/db/migrations/001_initial.sql
wrangler d1 execute procurement-crm-db --file=src/worker/db/migrations/002_indexes.sql
```

Deploy Worker when ready:

```powershell
wrangler deploy
```

## Vercel Env Vars

Set these in Vercel:

```text
WORKER_URL=https://<your-worker>.<your-subdomain>.workers.dev
WORKER_SECRET=<same value as Cloudflare WORKER_SECRET>
JWT_SECRET=<random 32+ character secret>
```

Optional:

```text
SETUP_SECRET=<same value as Cloudflare SETUP_SECRET>
```

`SETUP_SECRET` is not used directly by Vercel code, but keep the same value available for owner reference.

## First Admin Account

After migrations and Worker deploy, create the first admin from the browser console or any HTTP client:

```js
await API.call('initSetup', {
  setupSecret: '<SETUP_SECRET>',
  username: 'admin',
  password: 'change-this-password',
  displayName: 'Admin'
})
```

`initSetup` only works when the `users` table is empty.

## Local Checks

```powershell
npm run check
```

This only checks JavaScript syntax. It does not deploy and does not run D1 migrations.

## Phase 2+ Stubs

- `api/upload.js` and `src/worker/handlers/media.js` store original files in R2 and metadata in D1. Image resizing, variants, magic-byte validation, and Excel parsing are left for later.
- RFQ item schema includes `raw_row_json`, `source_file_id`, `source_sheet_name`, and `source_row_number`, but Excel import mapping UI is not implemented in Phase 1.
- Supplier quotes, pricing decisions, technical changes, and contract tables/modules are intentionally not implemented in Phase 1.
