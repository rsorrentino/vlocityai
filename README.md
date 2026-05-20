# Vlocity DataPack Manager - Enterprise Edition

A modern, enterprise-grade Node.js application with React frontend for managing Salesforce Vlocity DataPack exports and deployments. This production-ready application provides a comprehensive web interface with authentication, real-time monitoring, database persistence, Docker deployment support, and enterprise-level features.

## 🎯 Overview

Vlocity DataPack Manager is a complete solution for managing Vlocity DataPack operations across multiple Salesforce orgs. It provides:

- **Web-Based Interface**: Modern React UI with persistent left sidebar navigation (desktop) and slide-in drawer (mobile/tablet)
- **AI Chat Agent**: Natural-language interface for querying Vlocity/Salesforce data — ask questions like "how many catalogs do we have?" or "any promotions for this product?" Supports Anthropic Claude, OpenAI GPT-4o, GitHub Copilot, and Ollama (local)
- **Enterprise Features**: Monitoring, audit logging, circuit breakers, bounded execution queue with real abort
- **Real-Time Monitoring**: WebSocket-based live job progress with manual reconnect controls
- **Database Persistence**: PostgreSQL with complete job history, automatic SQLite fallback when PostgreSQL is unavailable
- **Multi-Org Support**: Manage multiple Salesforce environments
- **Catalog Manager**: Unified CRUD interface for products, price lists, promotions, attributes, picklists, pricing variables, catalogs, product relationships, rate codes, and rate tables — with snapshot/rollback
- **Data Migration (SFDMU)**: SF CLI plugin integration for cross-org data migration
- **Environment Comparison**: Side-by-side org comparison with missing record detection
- **Service Creation**: CSV-driven product and pricing ingestion with org comparison and staging area diff
- **Full Vlocity CLI Support**: All 21 Vlocity Build commands implemented
- **Docker Ready**: Complete containerization support

---

## 🆕 Recent Changes (2026 Release)

### AI Chat Agent (`/chat`)

A full conversational AI interface that lets users query live Vlocity/Salesforce org data in natural language — no SOQL required.

#### How it works

The AI agent runs a server-side agentic loop: it receives your question, decides which tools to call, runs SOQL queries against the connected org via the `sf data query` CLI, and streams the final answer back to the browser token-by-token using Server-Sent Events (SSE).

#### Supported AI adapters

| Adapter | Provider | Key source |
|---------|----------|-----------|
| Anthropic (Claude) | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` env var or UI |
| OpenAI (GPT-4o) | `openai` npm package | `OPENAI_API_KEY` env var or UI |
| GitHub Copilot | `openai` (custom base URL) | `GITHUB_TOKEN` env var or UI |
| Ollama (local) | `openai` (localhost) | No key needed |

API keys entered in the UI are held in `localStorage` and sent per-request — they are **never stored on the server or in the database**.

#### Available agent tools

| Tool | Salesforce object queried | Example question |
|------|--------------------------|-----------------|
| `list_catalogs` | `vlocity_cmt__Catalog__c` | "how many catalogs do we have?" |
| `get_product` | `Product2` | "tell me about product X" |
| `list_promotions` | `vlocity_cmt__Promotion__c` | "any promotions for product Y?" |
| `get_catalog_products` | `vlocity_cmt__CatalogProductRelationship__c` | "what's in the Hearing Aids catalog?" |
| `get_pricing` | `vlocity_cmt__PriceListEntry__c` | "what's the price of product Z?" |
| `list_price_lists` | `vlocity_cmt__PriceList__c` | "list all price lists" |
| `get_product_attributes` | `vlocity_cmt__AttributeAssignment__c` | "what attributes does product X have?" |
| `run_soql` | any object (SELECT only) | any custom question |

#### UI layout

- **History pane**: searchable conversation history grouped by date, with rename/delete and mobile drawer access
- **Chat pane**: markdown message thread with collapsible tool-call chips, copy/reuse actions, timestamps, and streaming state
- **Top bar**: inline org selector, adapter/model settings, status chips, and quick new-chat access
- **Composer**: larger multi-line input with starter prompts, keyboard hints, and send/stop controls
- The chat page auto-creates the first conversation on first open so users land in a ready-to-use chat instead of an empty placeholder state

#### New files

| File | Purpose |
|------|---------|
| `server/routes/chat.js` | REST + SSE endpoints |
| `server/services/chatService.js` | Agentic loop, DB persistence, SSE streaming, auto-titling |
| `server/services/vlocityAgentTools.js` | Tool definitions and SOQL executor |
| `server/services/aiAdapters/anthropicAdapter.js` | Claude streaming with tool use |
| `server/services/aiAdapters/openaiAdapter.js` | OpenAI / Copilot / Ollama |
| `server/migrations/20260519000001-create-chat-tables.js` | `chat_conversations` + `chat_messages` tables |
| `client/src/pages/ChatPage.js` | Page layout |
| `client/src/components/chat/ChatWindow.js` | SSE stream consumer, input bar |
| `client/src/components/chat/ChatMessage.js` | Markdown message bubbles with tool chips |
| `client/src/components/chat/ConversationList.js` | Date-grouped conversation list |
| `client/src/components/chat/AdapterSettings.js` | Adapter/org/key config (localStorage-backed) |

#### Setup

```bash
# Run the DB migration once to create the chat tables
npm run db:migrate

# Add your preferred API key to .env (or enter it in the UI per-session)
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or
GITHUB_TOKEN=ghp_...
# or — for Ollama, just ensure it's running locally (no key needed)
OLLAMA_BASE_URL=http://localhost:11434
```

---

### Left Sidebar Navigation — Desktop Persistent, Mobile Drawer

The sidebar is now **collapsible on desktop** as well: the hamburger in the top bar toggles between a full left nav (**icons + labels**) and a compact rail (**icons only**). On mobile/tablet it still opens as an overlay drawer.

The navigation has been moved from the crowded top bar into a **permanent left sidebar** on desktop and a **temporary slide-in drawer** on mobile/tablet triggered by the hamburger icon.

#### Layout

| Breakpoint | Behaviour |
|---|---|
| **md+ (≥ 900 px)** | Permanent 240 px sidebar always visible; page content shifts right automatically |
| **xs / sm (< 900 px)** | Sidebar hidden; hamburger button (☰) in top bar opens a temporary overlay drawer |

The shared app shell is constrained to the viewport height and keeps page scrolling inside the main content pane, which prevents the top bar from overlapping page content.

The chat page now follows that shell instead of using a negative top margin and viewport-based height override, so its full-height layout no longer slides underneath the top bar.

The chat workspace also pins its root content surface to `background-color: white`, ensuring the main chat pane renders on a solid white canvas instead of inheriting the app background.

New file: `client/src/components/Sidebar.js`.

#### Top bar — slimmed down

The `AppBar` (`Navbar.js`) now contains only three items on the right side:

| Element | Purpose |
|---|---|
| 🔔 **Notifications** | `NotificationCenter` bell with unread badge |
| **Role chip** | Coloured pill showing the current user role (ADMIN / DEVELOPER / FUNCTIONAL) |
| 👤 **Profile avatar** | Dropdown with user name, email, and Logout |

The hamburger icon appears on the left of the top bar on mobile/tablet only.

#### Sidebar navigation groups

Navigation items are organised into seven groups with small category headers:

| Group | Items |
|---|---|
| **AI** | Chat |
| **Jobs** | Dashboard, Export Jobs, Deploy Jobs, Job History, Job Monitor |
| **Management** | Org Management, Vlocity Commands |
| **Catalog** | Catalog Manager, Service Creation, Env Comparison, Data Migration |
| **Quality** | Validation, Export Health, Config Tester |
| **Configuration** | YAML Configs, Pipelines |
| **System** | Settings, User Management, Audit Logs, API Docs |

Active item is highlighted with a solid primary-colour background. Permission filtering is identical to the previous navbar.

---

### Execution Queue — Bounded Concurrency, Abort & Dashboard Widget

#### Backend — centralized execution queue

All Vlocity CLI and SF CLI invocations now run through a single `JobExecutionService` queue instead of spawning processes unboundedly.

New file: `server/services/jobExecutionService.js`.

Key behaviours:

| Feature | Detail |
|---|---|
| **Max concurrency** | Configurable via `JOB_EXECUTION_MAX_CONCURRENT` env var (default **2**) |
| **Bounded queue** | Excess jobs wait in a pending queue; they start automatically as slots free up |
| **Abort queued job** | Immediately ejects the job from the queue with `JOB_ABORTED` error |
| **Abort running job** | Marks job as aborted and calls `taskkill /PID /T /F` on Windows (SIGTERM on Linux/Mac) to stop the child process |
| **Status endpoint** | `GET /api/jobs/execution/status` returns `activeCount`, `queuedCount`, `maxConcurrentExecutions`, and the job IDs in both states |
| **Events** | Emits `queued`, `started`, `aborted` events for observability |

#### Abort endpoint improvements

All three abort routes now call `jobExecutionService.abortJob()` before updating the DB, ensuring the underlying process is actually stopped:

- `POST /api/jobs/:jobId/abort`
- `POST /api/exports/jobs/:jobName/abort`
- `POST /api/deploys/jobs/:jobName/abort`

Aborted jobs are recorded with status `aborted` (not `failed`) — the `JOB_ABORTED` error code is checked in the catch blocks of both the export and deploy run handlers.

#### Dashboard — Execution Queue card

The Dashboard now shows an **Execution Queue** card above the key metrics:

- **Workers** bar — `activeCount / maxConcurrentExecutions` with a Linear progress fill
- **Queued** count — shown in orange when > 0
- **Job ID chips** — clickable abbreviated IDs for both active (blue) and queued (orange) jobs; full UUID in tooltip; clicking navigates to Job Details
- **ACTIVE / IDLE** status chip
- Card only renders when the `/api/jobs/execution/status` endpoint responds (graceful no-render otherwise)
- Data refreshes with the existing 30-second dashboard auto-refresh

---

### WebSocket Reconnect Controls

Manual reconnect without a browser reload is now available on all real-time job pages:

- **JobDetails** — OFFLINE chip + "Reconnect" button appear when the WebSocket drops; clicking immediately tries a fresh connection without remounting the page
- **ExportJobs** — LIVE / OFFLINE chip in the card header; "Reconnect" button appears when OFFLINE
- **DeployJobs** — same LIVE / OFFLINE chip and "Reconnect" button

Reconnect is safe to call multiple times — a `reconnectingRef` guard prevents overlapping connection attempts. WebSocket cleanup now checks `readyState === OPEN` before calling `.close()` to eliminate spurious close errors.

---

### Service Creation — Comparison, Apply & Gap Fix

The Service Creation page provides comparison and remediation workflows across two tabs.

#### Price File Comparison tab
Upload a CSV → preview row counts → compare against org. Results show match/mismatch/missing/extra with:
- Search by SKU or price list
- Dynamic "Filter by field" dropdown (populated from actual diff fields in the result)
- Expandable rows — click to see field-level diff: File value vs Org value
- CSV/JSON export

#### Staging vs Products tab
Compares `GT_StagingArea__c` records against `Product2` via the `GT_ProductSKU__c` bridge table.

**Comparison results:**
- Search by SKU or product code
- Filter by status (mismatch/missing/match/extra) and by specific differing field
- Expandable rows — click any mismatch to see all differing fields with Staging value vs Product2 value side by side
- Defaults to "mismatch" filter on load
- **Product2 Id column** — shows the exact Salesforce record Id that will be updated, confirming the correct record is targeted
- **Product Name column** — human-readable name alongside ProductCode for identity verification
- Query form is a single compact horizontal row (Org + Country Code + Staging Status + Run button) — no more vertical stacking

**Apply staging → Product2:**
- Checkbox column on every mismatch row; select-all checkbox in header
- "Apply N to Product2" button PATCHes the selected Product2 records with staging values (only differing fields)
- Confirmation dialog shows org name and record count before writing
- Result alert after apply; re-run comparison to verify

**Org field compatibility:**
- Belgium-specific Product2 fields (`GT_Mutual__c`, `GT_PriceBand__c`, `GT_RIZIVCode__c`) are automatically skipped when querying AU orgs that don't have them — no more 400 INVALID_FIELD errors

**Related record gap fixes (GapFixPanel):**
When the comparison detects gaps, an actionable panel appears with targeted fix buttons:

| Gap | Fix |
|---|---|
| `GT_ProductSKU__c` missing for N staging records | **Run Service Creation Batch** — triggers `AMP_ServiceCreationSingleBatch` via Execute Anonymous Apex, which creates Product2, GT_ProductSKU__c, GT_RateTable__c and all related records |
| `GT_RateTable__c` missing for N products | **Create Rate Tables** — directly creates `GT_RateTable__c` records via REST API: looks up `GT_RateCode__c` by orgCode + GT_SalesVatCode__c, then bulk-upserts rate tables with Ordinary VAT type |

Affected SKUs are shown as chips (up to 10, then "+N more") before each action button.

---

### Navbar Reorganization — 6 Logical Groups

The top navigation bar was reorganised from 4 groups (with 9 items crammed under "Configuration") into 6 focused groups:

| Group | Items |
|---|---|
| **Jobs** | Export Jobs, Deploy Jobs, Job History, Job Monitor |
| **Management** | Org Management, Vlocity Commands |
| **Catalog** | Catalog Manager, Service Creation, Env Comparison & Sync, Data Migration (SFDMU) |
| **Quality** | Validation Dashboard, Export Health, Config Tester |
| **Configuration** | YAML Configs, Deployment Pipelines |
| **System** | Settings, User Management, Audit Logs, API Docs |

---

### Service Creation — CSV Ingestion, Pricing Upsert & Staging Comparison

A new **Service Creation** page (`/service-creation`) provides a full lifecycle tool for ingesting business-supplied CSV files and comparing them against live Salesforce org data.

#### Price file ingestion

Upload a CSV with columns `ItemNumberSKU, PriceList, PricingVariable, Amount, EffectiveStartDate`. For each row:

1. Ensures a `vlocity_cmt__PriceListEntry__c` record exists (product on price list) — creates if missing.
2. Upserts `vlocity_cmt__PricingElement__c` on `vlocity_cmt__GlobalKey__c = {SKU}_{PriceList}_{PricingVariable}` — creates or updates, never duplicates.

Pre-flight batch-resolves all Product2, PriceList, and PricingVariable IDs before processing. Missing SKUs are skipped with a warning; missing PriceLists or PricingVariables are reported as errors.

#### Price file comparison

After upload, switch to **Compare only** mode to diff the CSV against live PricingElement records by GlobalKey. Results are categorised as `match`, `mismatch` (Amount or date differs), `missing` (not in org), or `extra` (in org but not in CSV). Export as CSV or JSON. **Apply Fixes** re-runs the upsert for only the mismatch and missing rows.

#### Staging Area vs Product2 comparison

The **Staging vs Products** tab queries `GT_StagingArea__c` directly (no file upload) and diffs against `Product2` via `GT_ProductSKU__c` as the join key (matching how `AMP_ServiceCreationSingleBatch.cls` creates records).

Match key: `GT_StagingArea__c.GT_ItemNumber__c` → `GT_ProductSKU__c.GT_ProductSKU__c` → `Product2.Id`

50+ fields are compared (full mapping from the Apex batch), including AU compliance codes, Belgium-specific renamed fields (`GT_IsRiziv__c` → `GT_Mutual__c`, `GT_PriceBrand__c` → `GT_PriceBand__c`), and related record completeness (SKU records, Rate Tables).

Status values: `match`, `mismatch`, `missing` (product not found), `no_sku_record` (service creation not yet run), `extra` (product with no staging counterpart).

#### New API (`/api/service-creation/`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload CSV, returns preview + jobId |
| `POST` | `/run` | Run upsert or compare for a jobId |
| `POST` | `/apply-fixes` | Re-upsert only mismatch/missing rows |
| `GET` | `/compare/:jobId/export` | Download comparison as CSV or JSON |
| `GET` | `/staging-comparison` | Diff staging area vs Product2 (live query) |
| `GET` | `/template?type=price\|product` | Download reference CSV template |

New files: `server/routes/serviceCreation.js`, `server/services/serviceCreationService.js`, `server/services/sourceComparisonService.js`, `server/config/service-creation-mapping.json`, `client/src/pages/ServiceCreationPage.js`.

---

### Validation Dashboard — YAML Tests & Schema-Mismatch Handling

The validation test runner has been extended with four new YAML test suites and improved error handling:

#### New YAML validation suites

**`StagingAreaIntegrity.yaml`** — 13 tests mirroring the exact validation logic in `AMP_ServiceCreationSingleBatch.cls`:
- Required field checks: missing `GT_ItemNumber__c`, `GT_ProductName__c`, `GT_OrganizationCode__c`, `GT_Lifecycle__c`, `GT_AmplifonSubclass__c`, `GT_SalesVatCode__c` on New staging records
- Status checks: records stuck in `Error` or `Progress` status
- Post-creation completeness: products without SKU record, Rate Table, Commercial Offer, Color Attribute Assignment, or Standard Pricebook Entry

**`PricingToolIntegrity.yaml`** — 6 tests:
- Duplicate `PricingElement` records per product/price list/variable
- Duplicate `PricebookEntry` records per product/pricebook/currency
- Duplicate products by Name or ProductCode (SKU)
- Active products without any Price List Entry
- HA products without a Price List Entry

**`DeploymentReadiness.yaml`** — checks for `CalculationProcedure` records missing `GlobalKey` or `Type`.

**`RepairProducts.yaml`** — 5 tests for repair product data completeness (GT_Reason__c, GT_SupplierCode__c, GT_RepairType__c, GT_ProductClassification__c, Supplier AttributeAssignment). Tests reference org-specific GT_ namespace fields and are automatically skipped if those fields don't exist.

#### Schema-mismatch graceful skip

The validation runner previously logged `[error]` three times per test when a SOQL field didn't exist in the org. Now:
- `salesforceService.js`: HTTP 400 responses with `INVALID_FIELD` or `MALFORMED_QUERY` Salesforce error codes are logged at `[warn]` level instead of `[error]`
- `validationService.js`: expanded `isSchemaMismatch` detection covers `"No such column"` and `"Didn't understand relationship"` error text (the actual messages returned after service wrapping), returning `{ skipped: true }` instead of propagating the error

---

### Strict Sequential Deployment (27-Step Dependency Order)

A new **"Use Standard Sequential Deployment Order"** toggle in the Deploy Jobs Run dialog orchestrates deployments in the exact dependency sequence required to avoid cross-reference errors across complex org migrations.

#### How it works

When enabled, the backend iterates through all 27 object types in strict order — without race conditions — mixing Vlocity DataPack and sf CLI (manual) steps:

- **DataPack steps** → a focused single-type YAML job file is written per step and passed to `vlocityService.deployDataPacks()`
- **Manual steps** (GT objects, Catalog relationships) → the individual JSON file is isolated in a per-step temp directory and passed to `sfCliService.deployCustomObjects()`
- Steps are **skipped automatically** if the object type is absent from the project path or was already deployed as a nested child of a prior step
- Real-time progress streams via WebSocket for every step
- `continueOnError` flag (default `true`) lets remaining steps run even if one step fails

#### Deployment sequence

| Step | Object Type | Type | Notes |
|------|-------------|------|-------|
| 1 | ObjectClass__c | DataPack | Base class definitions |
| 2 | ObjectFieldAttribute__c | DataPack | |
| 3 | UIFacet__c | DataPack | |
| 4 | UISection__c | DataPack | |
| 5 | ObjectLayout__c | DataPack | Brings ObjectFacet, ObjectSection, ObjectElement |
| 6 | Picklist__c | DataPack | |
| 7 | AttributeCategory__c | DataPack | Brings Attribute__c |
| 8 | Attribute__c | DataPack | Skipped if already in AttributeCategory |
| 9 | VlocityFunction__c | DataPack | |
| 10 | ContextDimension__c | DataPack | Brings ContextMapping__c |
| 11 | ContextScope__c | DataPack | |
| 12 | EntityFilter__c | DataPack | Brings EntityFilterCondition__c |
| 13 | Rule__c | DataPack | Brings RuleVariable, RuleAction, RuleFilter |
| 14 | vlocity_cmt__PriceList__c | DataPack | Brings PricingElement, PricingVariable |
| 15 | PricingPlan__c | DataPack | Brings PricingPlanStep__c |
| 16 | vlocity_cmt__PricingVariable__c | DataPack | Skipped if already in PriceList |
| 17 | vlocity_cmt__PricingElement__c | DataPack | Skipped if already in PriceList; GlobalKey required |
| 18 | Product2 | DataPack | Brings 13 sub-objects including PricebookEntry, AttributeAssignment, PricingElement |
| 19 | vlocity_cmt__PriceListEntry__c | DataPack | Skipped if already in Product2 |
| 20 | vlocity_cmt__Promotion__c | DataPack | Brings PromotionItem__c |
| 21 | vlocity_cmt__AttributeAssignment__c | DataPack | Skipped if already in Product2 |
| 22 | GT_ProductSKU__c | Manual (sf CLI) | |
| 23 | GT_RateTable__c | Manual (sf CLI) | |
| 24 | vlocity_cmt__Catalog__c | Manual (sf CLI) | |
| 25 | vlocity_cmt__CatalogRelationship__c | Manual (sf CLI) | |
| 26 | vlocity_cmt__CatalogProductRelationship__c | Manual (sf CLI) | |
| 27 | String__c | DataPack | Brings StringTranslation__c |

New files: `server/config/deploymentSequence.js`, `server/services/sequentialDeploymentService.js`.
New endpoints: `POST /api/deploys/sequential`, `GET /api/deploys/sequential/sequence`.

---

### Enterprise Validation Rule Engine (15 Checks)

A new centralised `ValidationRuleEngine` (replaces ad-hoc inline guards) runs typed validation rules before create/update operations and during deploy preflight. Each rule returns structured `{ errors, warnings }` with full details for the React UI.

#### Rule registry

| # | Rule ID | Category | Severity | Triggered by |
|---|---------|----------|----------|--------------|
| 1 | `pricing.duplicate-pricing-element` | Pricing | ERROR | `createPricingElement` (inline) |
| 2 | `pricing.duplicate-pricelist-entry` | Pricing | ERROR | `POST /api/validation/pricing` |
| 3 | `pricing.duplicate-offer` | Pricing | ERROR | `POST /api/validation/pricing` |
| 4 | `pricing.missing-offer-price` | Pricing | WARNING | `POST /api/validation/pricing` |
| 5 | `repair.missing-reason-picklist` | RepairProduct | ERROR | `POST /api/validation/repair-product` |
| 6 | `repair.missing-required-fields` | RepairProduct | ERROR | `POST /api/validation/repair-product` |
| 7 | `repair.missing-supplier-attribute` | RepairProduct | ERROR | `POST /api/validation/repair-product` |
| 8 | `deployment.missing-gt-object-layout` | Deployment | WARNING | Deploy preflight (automatic) |
| 9 | `deployment.invalid-record-type-id` | Deployment | ERROR | Deploy preflight (automatic) |
| 10 | `deployment.pricing-element-trigger` | Deployment | ERROR | Deploy preflight (automatic) |
| 11 | `deployment.inactive-calculation-procedures` | Deployment | WARNING | Deploy preflight (automatic) |
| 12 | `pricing.ha-zero-price` | Pricing | WARNING | `POST /api/validation/pricing` |
| 13 | `pricing.sku-format` | Pricing | WARNING | `POST /api/validation/pricing` (includes `autoCorrect.sku`) |
| 14 | `pricing.async-apex-job-failure` | Pricing | ERROR | `POST /api/validation/pricing` |
| 15 | `catalog.duplicate-catalog-product-relationship` | Catalog | ERROR | `createCatalogProduct` (inline) |

#### Integration points

- Rules **1 and 15** are wired **inline** into `catalogManagerService.js` — they execute before every `createPricingElement` / `createCatalogProduct` call and throw a `ValidationError` (HTTP 400) if a duplicate is detected.
- Rules **8–11** are appended **automatically** to the existing deploy preflight (`deployPreflightService.runDeployPreflightChecks()`) — they run whenever a deploy preflight is triggered from the UI.
- All 15 rules are also available on demand via the new REST endpoints below.

#### New API endpoints (`/api/validation/`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/validation/pricing` | Run any subset of pricing rules (1–4, 12–14) |
| `POST` | `/api/validation/catalog` | Catalog duplicate check (rule 15) |
| `POST` | `/api/validation/repair-product` | Repair product checks (rules 5–7) |
| `POST` | `/api/validation/deployment` | Deployment org checks (rules 8–11) |
| `GET` | `/api/validation/rules` | List all registered rule IDs per engine |

New files: `server/services/validationRuleEngine.js`, `server/validators/pricingValidators.js`, `server/validators/catalogValidators.js`, `server/validators/repairProductValidators.js`, `server/validators/deploymentValidators.js`.

> **Note:** The Validation Dashboard (`/validation`) currently runs the YAML-based test suite (`GET /api/validation/run`). The new rule-engine endpoints are available for direct API calls and are auto-triggered inline / during preflight, but are not yet surfaced in the Validation Dashboard UI.

---

### Country Configuration — AU, BE, ES

The default country set has been corrected from the placeholder list (`US`, `IT`, `DE`, `FR`, `ES`) to the actual operating countries:

| Code | Country | Currency | Timezone |
|------|---------|----------|----------|
| AU | Australia | AUD | Australia/Sydney |
| BE | Belgium | EUR | Europe/Brussels |
| ES | Spain | EUR | Europe/Madrid |

Default country fallback updated from `US` → `AU`. Configurable via `DEFAULT_COUNTRY` environment variable.

---

### Deploy Lifecycle Improvements (D1–D6)

End-to-end observability and safety for deploy jobs — mirroring the export lifecycle features introduced in Features 1–6.

#### D1 — Deploy Artifact Preservation

Deploy jobs now preserve `VlocityBuildLog.yaml` and `VlocityBuildErrors.log` per-job to `logs/jobs/{jobId}-build-log.yaml` and `logs/jobs/{jobId}-build-errors.log` immediately after the deploy exits (both success and failure paths). Previously these files were overwritten by the next CLI run, making post-mortem analysis impossible.

#### D2 — Deploy Build Log Analysis

The **Build Log Analysis** section in Job Details now renders for `deploy` jobs in addition to `export` jobs. The analysis uses the same `BuildLogAnalyzer` component and `/api/exports/:jobId/build-analysis` endpoint — both already work with deploy artifact paths. Deploy-specific remediation hints were added to `buildLogParser.js`:

| Error Pattern | Remediation |
|---|---|
| No Matching Record | Deploy parent type first; check dependency ordering |
| Missing Dependency | Include all dependency types in the deploy scope |
| Permission Error / INSUFFICIENT_ACCESS | Grant required CRUD permissions in target org |
| Settings Mismatch | Review custom settings/metadata before redeploying |
| Duplicate Developer Name | Delete or rename the existing record in target org |

#### D3 — Deploy Preflight Validator

A preflight check runs automatically when "Start Deploy" is clicked — before any Salesforce calls or CLI invocation. Blocking errors prevent the deploy from starting; warnings are surfaced with a "Run Anyway" option.

**Preflight checks:**
1. **Same-org deploy** (blocking) — source and target org must differ
2. **Export path exists** (blocking) — project directory must exist on disk
3. **Export directory not empty** (blocking) — must contain at least one DataPack type folder
4. **Dependency coverage** (warning) — known type dependencies (VlocityUILayout → VlocityCard, etc.) must be present in the export
5. **Apex heap risk** (warning) — Product2/Catalog with `defaultMaxParallel > 10` risks governor limit errors
6. **Source org reachability** (optional, blocking)
7. **Target org reachability** (optional, blocking)

New files: `server/services/deployPreflightService.js`, `POST /api/deploys/preflight` endpoint.
`PreflightCheckDialog` component reused with zero changes.

#### D4 — Post-Deploy Validation

The deploy run dialog now includes a **"Run post-deploy validation after completion"** checkbox. When enabled, `validationService.runYamlTests()` is called against the target org after the deploy completes, and the result is stored on the job record. Job Details displays a **Post-Deploy Validation** card showing pass/fail counts and a progress bar for passing percentage.

#### D5 — Rollback UI

`rollbackService.js` already creates a snapshot of the target org before every deploy. Job Details now surfaces this:

- **Rollback panel** appears on completed/failed deploy jobs showing snapshot timestamp, record counts, and target org
- **Rollback button** opens a confirmation dialog, then calls `POST /api/deploys/jobs/:jobId/rollback`
- The rollback runs as a tracked job — after confirmation, Job Details navigates to the restore job for real-time progress
- If no snapshot is available the panel shows "No rollback snapshot available for this deploy"

New endpoints: `GET /api/deploys/jobs/:jobId/rollback-status`, `POST /api/deploys/jobs/:jobId/rollback`.

#### D6 — Deploy Notifications

Deploy job completions and failures now publish to the in-app Notification Center (bell icon in the header):

- **Deploy completed** → "Deploy completed: {name}" with link to Job Details
- **Deploy failed** → "Deploy failed: {name}" with error count and link to Build Log Analysis
- **Rollback completed** → "Rollback completed" with link to original deploy job

---

### Configuration Lifecycle Improvements (Features 1–6)

Full lifecycle observability for export jobs — from design-phase validation through post-export analysis and staged deployment.

#### Feature 1 — Export Template Cleanup

Removed `CatalogProductRelationship` and `PriceListEntry` as standalone query types from the Full Catalog Export template. These are sub-objects (included automatically when their parent types export) and their presence as standalone queries caused ~4,600+ "No DataPack Configuration Set" errors per run — approximately 75% of all export errors.

#### Feature 2 — Build Log Analyzer

In-app analysis of `VlocityBuildLog.yaml` and `VlocityBuildErrors.log` after every export (and deploy — see D2):

- **Summary cards** — success, error, remaining, health score (colour-coded), duration
- **By DataPack Type table** — per-type success/error/remaining counts with status badges
- **Error Categories** — collapsible accordion with remediation hints per error pattern
- **Missing Cross-References** — lists every broken object reference with source and target
- **Download** — full JSON report or CSV of the by-type table

New: `server/services/buildLogParser.js`, `server/routes/exportAnalysis.js` (`GET /api/exports/:jobId/build-analysis`), `client/src/components/BuildLogAnalyzer.js`. Build artifacts are preserved per-job to `logs/jobs/` immediately after the export exits.

#### Feature 3 — Pre-Export Preflight Validator

Runs before every export (and deploy — see D3). Catches structural issues in job config — invalid sub-object types, missing dependency coverage, org reachability, Apex heap risk — before any Salesforce calls are made.

New: `server/services/preflightService.js`, `POST /api/exports/preflight`, `client/src/components/PreflightCheckDialog.js`.

#### Feature 4 — Export Health Dashboard (`/export-health`)

Post-export directory analysis available from the sidebar:

- **Health score** (0–100) based on success rate and cross-reference integrity
- **Deployability verdict** — Deployable / Caution / Not Ready
- **DataPack coverage table** — which types exported and how many records
- **Cross-reference issues** — broken object references detected by scanning DataPack JSON files
- **Download** — JSON or CSV health report

New: `server/services/exportHealthService.js`, `server/routes/exportHealth.js`, `client/src/pages/ExportHealthPage.js`.

#### Feature 5 — Deployment Pipeline (`/pipeline`)

Multi-stage deployment pipelines with approval gates:

- Define N-stage pipelines (e.g. Dev → UAT → Production) with per-stage org, export path, and validation settings
- Each stage runs preflight → deploy → optional post-validation, then pauses for approval
- Approval required before advancing to the next stage (role-gated: admin/developer)
- Abort at any time — cancels the running deploy job if one is active
- Real-time stage progress via WebSocket
- Pipeline history stored in DB

New: `server/services/pipelineService.js`, `server/routes/pipelines.js`, `client/src/pages/DeploymentPipeline.js`, `client/src/pages/PipelineDetails.js`.

#### Feature 6 — In-App Notification Center

Bell icon in the header with unread badge:

- **Real-time toasts** — job completed/failed, pipeline stage awaiting approval
- **Persistent history** — last 50 notifications, unread first
- **Click-to-navigate** — each notification links to the related job or pipeline
- **Mark all read** — single action to clear the badge

New: `server/services/notificationService.js`, `server/routes/notifications.js`, `client/src/components/NotificationCenter.js`. Export Health and Deployment Pipelines added to the sidebar nav under Configuration.

---

### Export Job Fixes — WebSocket Streaming, Recovery Loop & Unsupported sObjects

#### WebSocket log streaming for re-run export jobs

Export jobs that were run a second time (reusing an existing DB record) silently dropped all log messages — the Execution Console showed "Connected" but no output appeared.

**Root cause:** `jobMonitor.addJobLog()` only streams logs for jobs registered in `activeJobs`. `jobHistoryService.createJob()` registers the job automatically via `startJob()`, but when an existing job record is found and updated (via `Job.findOne()` + `save()`), no `startJob()` call was made, so the entry was never added to `activeJobs`.

**Fix (`server/routes/exports.js`):** Added an explicit `jobMonitor.startJob()` call immediately after updating an existing job record to `running` status.

#### Export recovery infinite loop on non-recoverable errors

The iterative recovery loop (`exportRecoveryService.runIterativeRecovery()`) could loop indefinitely when a non-recoverable error (e.g. an unsupported sObject type) persisted across retries — each iteration found no new missing IDs but the build log still reported errors, so the loop never exited.

**Fix (`server/services/exportRecoveryService.js`):** Added a `staleIterations` counter that increments whenever an iteration finds no new missing IDs. After 3 consecutive stale iterations the loop breaks with a warning log, preventing infinite retries on non-recoverable errors.

#### `vlocity_cmt__ObjectContextRule__c` unsupported sObject

The Vlocity CLI internally queries `vlocity_cmt__ObjectContextRule__c` when processing `ObjectClass` records. This object does not exist in some orgs, causing a SOQL error that triggered the recovery loop repeatedly.

**Fixes:**
- Removed `ObjectContextRule` from the Full Catalog Export and Rules & Object Configuration Export templates in `server/routes/exports.js`
- Set `continueAfterError: true` in `jobs/Full Catalog Export - *.yaml` so the CLI skips unsupported objects and continues the export rather than aborting

---

### Validation Auto-Fix & Duplicate Review

One-click remediation for validation errors directly from the Validation Dashboard:

- **Simple fixes** (⚡ button) — assign missing `GlobalKeys` or delete orphaned records in a single click. A preview dialog shows how many records will be affected before you confirm.
- **Duplicate review** (🔍 button) — opens a rich interactive dialog listing every duplicate group, with the oldest record pre-selected as the keeper. Change keepers per group, then delete the rest in bulk.
- **Fix All Simple** — a green bar at the top of the Errors tab lets you trigger all assignable/deletable fixes in one go.
- **Server-side fix engine** (`server/services/validationFixService.js`) — 44 registered checks across 3 fix types (assign GlobalKeys, delete orphaned, delete duplicates). Uses Salesforce Composite API in chunks of 25 for bulk operations with full SOQL pagination.
- **Client-side fix registry** mirrors the server registry to drive button rendering in `ValidationDashboard.js` without extra API calls.

---

### DB-backed Org Management with SF CLI Sync

- Org list is now persisted in the database rather than only in `environments.properties`
- **Sync from CLI** button pulls the current authenticated orgs from `sf org list` and upserts them into the DB
- Org labels, sandbox flags, and metadata stored per-org
- Edit and delete operations update both the DB and `environments.properties` in a single transaction

---

### Export / Deploy Icon Fix

The job-type icons in the Dashboard and Job History tables now correctly reflect their action:

- **Export** → `CloudDownload` icon (was `GetApp`)
- **Deploy** → `CloudUpload` icon (was `Visibility` — an eye icon)

This matches the icons already used in the Navbar.

---

### Vlocity Validation (`/validation`) — Comprehensive Overhaul

#### New YAML-based test suites

Five new declarative test files under `server/config/validation-tests/` — no code changes needed to add new checks:

| File | Checks | Purpose |
|------|--------|---------|
| `GlobalKeys.yaml` | 12 | Ensure every key object has a `vlocity_cmt__GlobalKey__c` |
| `DuplicateRecords.yaml` | 8 | Detect duplicate Name/Code across pricing & catalog objects |
| `CatalogIntegrity.yaml` | 7 | Orphaned/duplicate CatalogProductRelationship, ProductChildItem, AttributeAssignment, PicklistValue |
| `PricingIntegrity.yaml` | 7 | Broken price list ↔ product/entry references; inactive price list entries |
| `ObjectLayouts.yaml` | 10 | ObjectClass → ObjectLayout → UISection → UIFacet hierarchy integrity |

#### New validation rule types

| Rule | Behaviour |
|------|-----------|
| `expect_empty` | SOQL query returns violations; any returned record = failure |
| `check_duplicates_composite` | Detects rows sharing the same combination of multiple fields |

#### Price List Product Coverage check

A new hardcoded multi-query validation (`validatePriceListProductCoverage`) verifies that every product in a commercial offer's hierarchy (offer → children → bundle children) has a **"One Time Std Price"** `PriceListEntry` in the same price list as the offer. Mirrors the logic of the existing Apex validation script.

#### Validation UI improvements

- **Category names** formatted from `PascalCase` to readable labels (`CatalogIntegrity` → `Catalog Integrity`)
- **Structured details panel** per check type — no more raw JSON dumps:
  - `DuplicateCompositeValue` → scrollable table of duplicate key combinations
  - `UnexpectedRecords` → table with Salesforce ID + Name columns
  - `DuplicateValue` → table of duplicate values with affected records
- **Salesforce links** — every record ID in the details panel links directly to the record in Salesforce (uses `instanceUrl` returned by the validation API)
- **Category details dialog** now shows all individual checks (errors / warnings / passed) for the selected category instead of just a count
- **Validation Legend** — an `ⓘ` button next to "Run Validation" opens a collapsible panel listing every check that will be run, grouped by category with error/warning count chips
- **Check names** now use the YAML `name` field (e.g. `DuplicateProductChildItems`) rather than the generic `UniqueCompositeValues`

#### Removed

- **Deploy Metadata tab** removed from the Validation page (it only showed a warning to use Export/Deploy Jobs instead)
- **Duplicate "Vlocity Management" nav link** removed (only "Validation Dashboard" remains)

---

### Job Details — Duration Formatting

Job duration is now displayed as `29h 44m 28s` instead of `107068.87 seconds`. The `formatDuration(ms)` helper converts milliseconds to a human-readable `Xh Ym Zs` string, omitting leading zero units.

---

### SFDMU Templates — Object Layouts group & cleanup

- **New "Object Layouts" group** added to the SFDMU template dialog: `ObjectClass`, `ObjectLayout`, `UISection`, `UIFacet` (in dependency order)
- **`GT_InteractionCatalogue__c` removed** from the GT Custom Objects group (not a Vlocity/product-related object)

---

### Job History & Dashboard — UI Consistency

- **Unified column order** across both tables: `Job Name | Type | Status | Org | Started | Duration | Actions`
- **Dashboard** now shows a `Duration` column (computed from `startedAt`/`completedAt`; shows elapsed time for running jobs) and uses `Started` instead of `Created`
- **Running chip color** aligned to blue (`info`) in both tables (was orange/`warning` in Job History)
- **Animated blue dot** next to the running chip in both tables
- **N/A duration for running jobs** fixed — shows elapsed time from `startedAt` to now (e.g. `12m 34s`)
- **View Details button** standardised to outlined `Button + OpenInNew icon` in both tables (Dashboard previously used an icon-only `IconButton`)

### Organization Management — Editable Labels

The Edit button on org cards now opens a real dialog for changing the org's display label (previously it showed a CLI-instructions alert). Labels are persisted to `environments.properties` via `PUT /api/orgs/label`. The button is disabled for default orgs that have no label property.

### SFDMU Config — Object Templates

A **"Templates"** button has been added to the *Objects to Migrate* section of the SFDMU config editor. Clicking it opens a dialog with 10 predefined object groups:

| Group | Objects |
|---|---|
| Product Catalog | Product2, Pricebook2, PricebookEntry |
| Vlocity Attributes | AttributeCategory, Attribute, AttributeAssignment |
| Vlocity Picklists | Picklist, PicklistValue |
| Pricing | PricingElement, PriceListEntry, EntityFilter |
| Product Relations | ProductChildItem, CatalogProductRelationship |
| Calculation Matrices | CalculationMatrix, CalculationMatrixVersion, CalculationMatrixRow |
| Calculation Procedures | CalculationProcedure, CalculationProcedureVersion, CalculationProcedureStep |
| Rules & Filters | Rule, Ruleset |
| GT Custom Objects | GT_ProductSKU__c, GT_RateCode__c, GT_RateTable__c |
| Standard Objects | Campaign, WorkType |

Objects are listed in dependency order within each group. Objects already present in the config are shown with an "already added" badge and skipped on apply. Individual objects or whole groups can be selected via checkboxes.

---

### Job Report — Enhanced Error Visibility & Metrics

#### Salesforce record links in error table

Error messages that reference Salesforce records (e.g. `SObject/Id: a439r000001HdsRAAS` or `orgUrl: /a439r000001HdsRAAS`) now render the record ID as a **clickable highlighted badge**. When the org's instance URL can be resolved (via `POST /api/orgs/test-connection`), the badge links directly to the record in Salesforce (opens in a new tab).

- IDs with an `orgUrl` path → **blue link** (clickable, opens Salesforce record)
- IDs referenced in `SObject/Id:` without a URL → **orange highlight** (visually prominent)
- Detection is context-based (only highlights IDs inside known Vlocity error patterns), eliminating false positives from timestamps and hashes

#### Accurate item metrics from tail logs

Large jobs produce more than 5,000 log lines. Previously the report fetched only the first 5,000 entries, so the final `Success >> N` and `Elapsed Time >> Xm Ys` summary lines printed by the Vlocity CLI were never seen — the counts shown were intermediate values.

**Fix:** the report now also fetches the last 500 log lines (`?tail=500`) in a separate request and runs a second pass over them to extract the definitive summary metrics. Item counts and elapsed time now reflect the true final values.

#### Duration converted to hours

The Duration card now converts the Vlocity CLI's `Xm Ys` format to `Xh Ym Zs` (e.g. `554m 55s` → `9h 14m 55s`). When the job's DB-stored duration is available it is used instead; otherwise the log-parsed elapsed time is shown.

#### DUPLICATE_DEVELOPER_NAME errors suppressed

Salesforce reports `DUPLICATE_DEVELOPER_NAME` when deploying custom metadata that already exists in the target org — this is not a real failure. These multi-line error blocks are now excluded from:
- the error count and error list in the Errors accordion
- the Success % calculation
- the `VlocityBuildErrors.log` parser (`server/services/errorLogParser.js`)

#### Success rate capped at 99 % when errors exist

Showing 100 % success alongside a non-zero error count was misleading. The Success row in the Execution Summary table now caps at 99 % whenever error log entries are present (matching the existing logic in the success-rate pie chart).

#### Errors row shows a real percentage

The Errors row in the Execution Summary table previously always showed `—`. It now shows the error count as a percentage of items retrieved (minimum 1 % when errors exist).

#### Success section title shows item count

The "Success" accordion header now reads **"Success (30,208 items — 1,689 / 1,689 files)"** instead of the misleading "Success (1689 / 1689)" — distinguishing the total items exported from the number of DataPack files generated.

#### Analyze Errors — fixed SF ID extraction and SOQL execution

- **ID extraction** (`server/services/errorAnalysisService.js`): the previous filter (`/^[A-Z0-9]{3}/`) rejected IDs whose prefix starts with a lowercase letter (e.g. `a439r...`). The filter is now `must contain at least one letter AND one digit`, which accepts all real Salesforce IDs regardless of case.
- **SOQL quoting** (`server/services/salesforceMetadataService.js`): on Windows, `shell: true` with an args array splits the SOQL on spaces. The SOQL is now passed as a single quoted shell string to prevent splitting.
- **ANSI stripping**: the SF CLI returns colour-coded JSON even with `--result-format json`; `JSON.parse` was failing on the escape sequences. ANSI codes are now stripped before parsing.
- **Graceful fallback**: if prefix resolution via SF CLI fails for any reason, the dialog still opens and groups all extracted IDs under "Unknown" so the IDs are always visible and copyable.

---

### Vlocity Export/Deploy — Dependency Ordering & Smart Retry

Eliminates the manual "retry until it works" loop caused by Vlocity DataPack type dependencies (e.g. `Product2` must exist before `PriceList`, `DataRaptor` before `OmniScript`).

#### Dependency-ordered export/deploy

All 21 known Vlocity DataPack types are ranked into 9 dependency tiers. Before writing the YAML job file, queries are automatically sorted from least-dependent to most-dependent so that parent types are always exported/deployed before their children.

Controlled by the **"Use dependency ordering"** toggle in the Run dialog of both Export Jobs and Deploy Jobs pages (on by default for Vlocity CLI jobs; not applicable for SF CLI jobs).

#### Smart 3-phase deploy retry

The old strategy (repeat `packDeploy` N times) is replaced with the correct Vlocity sequence:

| Phase | Command | Behaviour |
|-------|---------|-----------|
| 1 | `packDeploy` | Initial deploy; auto-fixes settings mismatches and duplicate field errors |
| 2 | `packContinue` × N | Continues from where the last run stopped, skipping already-deployed packs; stops early if 0 DataPacks are deployed in an iteration (**Stop when no progress** toggle) |
| 3 | `packRetry` | Clean reset pass; triggers export recovery if missing IDs are detected |

New controls in the Deploy Jobs **Run** dialog:
- **Max Retries** — maximum `packContinue` iterations (default **10**, was 3)
- **Use dependency ordering** — sort types before deploy (Vlocity CLI only, on by default)
- **Stop when no progress** — abort the `packContinue` loop if nothing new is deployed (on by default)

#### Export recovery default changed

**"Enable Missing Dependencies Recovery"** is now **on by default** in the Export Jobs Run dialog (was opt-in). Dependency errors are the primary export failure mode, so recovery mode is the right default.

---

### Redis — Automatic Start & Reconnect

Redis is an optional cache layer. Previously, if Redis was not running at startup the app logged `[error]: AggregateError [ECONNREFUSED]` repeatedly and never reconnected even after Redis was started.

**What changed:**

- **Auto-start attempt** — on startup, the app tries `service redis-server start` then `sudo -n service redis-server start` (non-interactive, fails fast if a password is needed). No hang, no blocking.
- **Auto-reconnect** — the redis client now uses the correct redis v4 `socket.reconnectStrategy` (exponential backoff up to 30 s, unlimited retries). When Redis comes back up — whether started manually or automatically — the app reconnects within ≤ 30 s without restarting.
- **Noise-free logs** — `ECONNREFUSED` is downgraded from `[error]` to `[warn]` since Redis is optional. The repeated error spam is gone.
- **`prestart` / `predev` npm scripts** — `npm start` and `npm run dev` now attempt to start Redis before Node.js launches.

**For fully automatic startup (no manual command ever):**

Add a sudoers rule once in WSL:

```bash
echo "$(whoami) ALL=(ALL) NOPASSWD: /usr/sbin/service redis-server start" \
  | sudo tee /etc/sudoers.d/redis-autostart
```

After that, `npm run dev` starts Redis automatically every time.

---

### SFDMU — Saved Configurations & Advanced Object Config

The Data Migration page now supports full configuration management, mirroring the SFDMU Desktop App workflow.

#### Saved Configurations (`/sfdmu/config/new`, `/sfdmu/config/:id`)

- **Save configs to database and/or JSON** — give a configuration a name, save it, reuse it across sessions
- **Import from `export.json`** — paste an existing SFDMU job file to create a saved config
- **Export to server** — write `export.json` to a chosen directory on the server for CLI use

#### Advanced per-object settings (4-tab dialog)

| Tab | Fields |
|-----|--------|
| **Basic** | sObject API name, operation, external ID, custom SOQL query |
| **Advanced** | `ORDER BY`, `LIMIT`, `OFFSET`, `useQueryAll`, delete old data before insert, delete query, skip existing records, excluded fields, excluded-from-update fields |
| **Field Mapping** | Map source field names to differently-named target fields |
| **Anonymization** | Replace field values with mock data (string mask, email mask, phone mask, credit card mask, random string, static value) |

#### Preview dialog

Before running, click **Preview** to see:
- The generated `export.json` with copy/download buttons
- The exact CLI command that will be executed

#### New SFDMU API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sfdmu/configs` | List saved configs |
| `POST` | `/api/sfdmu/configs` | Create config |
| `GET` | `/api/sfdmu/configs/:id` | Get single config |
| `PUT` | `/api/sfdmu/configs/:id` | Update config |
| `DELETE` | `/api/sfdmu/configs/:id` | Delete config |
| `POST` | `/api/sfdmu/configs/import` | Import from `export.json` body |
| `POST` | `/api/sfdmu/configs/:id/export` | Write `export.json` to server disk |
| `POST` | `/api/sfdmu/configs/:id/run` | Run saved config as migration job |

---

### Catalog Manager (`/catalog`)
A unified tool replacing the previous `/pricing` and `/enhanced-pricing` pages:

- **12 Tabs**: Products, Price Lists, Promotions, Attributes, Picklists, Pricing Variables, Catalogs, **Product Relationships**, Rate Codes, Rate Tables, Batch Jobs, Snapshots
- **Single-Record Navigation**: Click any row to open a dedicated detail page with all fields, edit form, and delete action
- **Session State Persistence**: Org selection, filters, and active tab are preserved when navigating to a detail page and back
- **Price Lists with Inline Entries + Pricing Elements**: Expanding a price list row shows two sub-tabs — Price List Entries and Pricing Elements — both with full CRUD
- **Attributes Tab**: Two-panel layout — Attribute Categories on the left, Attributes for the selected category on the right; full CRUD on both sides
- **Picklists Tab**: Two-panel layout — Picklists on the left, Picklist Values for the selected picklist on the right; full CRUD on both sides
- **Pricing Variables Tab**: Full-width CRUD grid for `vlocity_cmt__PricingVariable__c`
- **Catalogs Tab**: Two-panel layout — Catalogs on the left (full CRUD); right panel has two sub-tabs: **Products** (CatalogProductRelationship with ItemType="Product") and **Sub-Catalogs** (ItemType="Catalog"); add/remove via search autocomplete; uses describe-based field discovery
- **Product Relationships Tab**: Flat table of `vlocity_cmt__ProductChildItem__c` records (parent → child product hierarchy); filter by parent product; add/remove relationships with search autocompletes
- **Promotions with Rules Drawer**: Clicking "Rules" opens a MUI Drawer with the promotion's rules
- **Snapshot & Rollback**: Create manual snapshots, auto-snapshot before every deploy, restore from any snapshot via a new deploy job
- **Export DataPack Bridge**: Every record has an "Export DataPack" action that pre-fills the Export Jobs page
- **View in Salesforce**: Every record row includes a direct link to the record in Salesforce (requires a connected org)
- **User-Friendly / Technical toggle**: Switch in the header hides/shows GlobalKey columns and API field names
- **SOQL Injection Protection**: All filters sanitised via `escapeSoql()` utility
- **Server-side Pagination**: `LIMIT / OFFSET` prevents loading thousands of records
- **500 error fix on Price List Entries**: SOQL relationship traversal failures (`__r.Name`) are caught and retried with a simpler fallback query

Routes:
- `/catalog` — main page
- `/catalog/:objectType/:id` — single-record detail page
- `/pricing` and `/enhanced-pricing` redirect to `/catalog`

### Data Migration — SFDMU (`/sfdmu`)
New page powered by the [SFDX-Data-Move-Utility](https://github.com/forcedotcom/SFDX-Data-Move-Utility) (`sf sfdmu run`) SF CLI plugin.

#### What it does
- Migrate records between any two authenticated Salesforce orgs (or to/from CSV files)
- Configurable per-object: sObject API name, operation (Insert / Upsert / Update / Delete / …), external ID field, optional WHERE clause
- Advanced settings: simulation mode (dry run), All-or-None rollback, concurrency mode, Bulk API threshold
- Real-time log streaming via WebSocket — jobs are monitored on the Job Monitor page
- Recent migration jobs shown in a history table on the page itself

#### Prerequisites — SFDMU Plugin
SFDMU is **not** an npm dependency. It is a Salesforce CLI plugin that must be installed separately:

```bash
sf plugins install sfdmu@latest
```

Verify installation:

```bash
sf plugins list | grep sfdmu
# or
sf sfdmu --version
```

The Settings → System Status page will show a green "SFDMU Plugin installed" badge when the plugin is detected, or a warning with the install command if it is missing.

#### Using the Data Migration page
1. Navigate to **Configuration → Data Migration (SFDMU)** (`/sfdmu`).
2. Select a **Source Org** and a **Target Org** from the dropdowns (both must be authenticated via `sf org login`). Select `CSV Files (local)` to use local CSV files as source or target.
3. Add one or more **sObjects** to migrate:
   - **sObject API Name** — e.g. `Account`, `vlocity_cmt__PriceList__c`
   - **Operation** — `Upsert` (default), `Insert`, `Update`, `Delete`, `Readonly`, `DeleteSource`, `Hard_Delete`
   - **External ID** — field used to match records during Upsert (e.g. `Name`, `vlocity_cmt__GlobalKey__c`); disabled for Insert/Delete
   - **WHERE clause** — optional filter, e.g. `IsActive = true`; leave empty to migrate all records
4. (Optional) Expand **Advanced Settings**:
   - **Simulation mode** — dry run, no data is written
   - **All or none** — roll back all changes on any error
   - **Concurrency Mode** — Serial (default) or Parallel
   - **Bulk API Threshold** — records above this count use Bulk API (default 1000)
5. Click **Run Migration**. The job starts immediately and you are redirected to the **Job Monitor** to watch live logs.

#### PostgreSQL migration (if upgrading from an older version)
If you are using PostgreSQL and see an error like `invalid input value for enum enum_jobs_type: "sfdmu"`, run the migration script once:

```bash
npm run migrate-sfdmu-type
```

### Environment Comparison (`/env-comparison`)
- Compare any two orgs (Source / Target) side-by-side across all key Vlocity objects
- **Supported objects** (21+): Product2, PriceList, PriceListEntry, PricingElement, **Catalog**, ProductChildItem, CatalogProductRelationship, AttributeAssignment, Attribute, AttributeCategory, Picklist, PicklistValue, CalculationMatrix, CalculationMatrixRow, CalculationProcedure/Version/Step, Rule, Ruleset, EntityFilter, ObjectClass, ObjectLayout, UISection, UIFacet
- Identifies missing records in either org using `vlocity_cmt__GlobalKey__c` matching (composite keys for junction objects)
- Generates Vlocity export YAML to sync differences in either direction
- **Sync status logic**: "In sync" is only shown when Source > 0 and no records are missing; Source=0 with Target records correctly shows "Source empty"

### System Status (Settings → System Status)
The system status panel now checks:
- Node.js / npm version
- Vlocity CLI availability
- Salesforce CLI (`sf`) availability
- **SFDMU Plugin** — shows `healthy` if installed, `warning` with install command if missing
- Database connectivity
- WebSocket service

---

## 🚀 Enterprise Features

### ✅ **Advanced Monitoring & Observability**
- **Distributed Tracing**: Full request tracing with OpenTelemetry-ready architecture
- **Custom Metrics**: Business and technical metrics (jobs, API calls, data packs, errors)
- **Performance Monitoring**: Real-time performance tracking with P50/P95/P99 latencies
- **System Health**: Comprehensive health checks for all dependencies
- **Prometheus Integration**: Production-ready metrics export at `/metrics`
- **Enterprise Monitoring Service**: Complete APM solution

### ✅ **Enterprise Security & Compliance**
- **Comprehensive Audit Logging**: Every action logged with full context
- **Compliance Ready**: GDPR, SOC2, HIPAA ready with compliance tags
- **Authentication Events**: Login, logout, password changes tracked
- **Authorization Events**: Access grants/denials logged
- **Data Access Logging**: All data operations audited
- **Security Events**: Threat detection and suspicious activity logging
- **Configurable Retention**: Flexible retention policies (default: 365 days)

### ✅ **Fault Tolerance & Resilience**
- **Circuit Breaker Pattern**: Prevents cascade failures
- **Three States**: CLOSED, OPEN, HALF_OPEN with automatic recovery
- **Configurable Thresholds**: Customizable failure/success thresholds
- **Timeout Handling**: Automatic timeout management
- **Circuit Statistics**: Full visibility into circuit states
- **Manual Control**: Reset and force open capabilities

### ✅ **Enterprise Job Management**
- **Priority Queues**: Critical, High, Normal, Low priority levels
- **Job Scheduling**: Cron-like scheduling support
- **Resource Limits**: Per-user and per-tenant limits
- **Automatic Retries**: Exponential backoff retry strategy
- **Job Timeouts**: Configurable timeout handling
- **Concurrent Execution**: Configurable concurrent job limits (default: 10)
- **Job Cancellation**: Support for job cancellation
- **Queue Statistics**: Real-time queue monitoring

---

## 🔧 Core Functionality

### **Dual CLI Support**
- **Vlocity CLI**: Full support for Vlocity DataPack exports and deployments
- **Salesforce CLI (SF CLI)**: Support for custom objects like GT_ProductSKU, GT_RateCode, GT_RateTable, plus SFDMU data migration
- **CLI Type Selection**: Choose the appropriate CLI for each export/deploy job
- **Automatic Routing**: System automatically routes to the correct CLI based on job configuration
- **External Key Reference Updates**: Automatically updates external key references before SF CLI deployment

### **Complete Vlocity CLI Command Support (21/21 Commands)**

#### Primary Commands (4/4)
- ✅ `packExport` - Export from Salesforce org into DataPack Directory
- ✅ `packExportSingle` - Export single DataPack by Id with dependencies
- ✅ `packExportAllDefault` - Export all default DataPacks
- ✅ `packDeploy` - Deploy all contents of DataPacks Directory

#### Troubleshooting Commands (6/6)
- ✅ `packContinue` - Continue failed jobs
- ✅ `packRetry` - Retry failed jobs with error reset
- ✅ `validateLocalData` - Check for missing Global Keys
- ✅ `cleanOrgData` - Clean org data and add Global Keys
- ✅ `refreshProject` - Refresh project to latest format
- ✅ `checkStaleObjects` - Check for stale references

#### Additional Commands (11/11)
- ✅ `packGetDiffs` - Find differences between org and local files
- ✅ `packGetDiffsAndDeploy` - Deploy only changed files
- ✅ `packBuildFile` - Build DataPack file from directory
- ✅ `runJavaScript` - Run JavaScript on DataPacks
- ✅ `runApex` - Run anonymous Apex
- ✅ `packGetAllAvailableExports` - List all exportable DataPacks
- ✅ `refreshVlocityBase` - Deploy base Vlocity DataPacks
- ✅ `installVlocityInitial` - Install initial Vlocity setup
- ✅ `installDPsfromStaticResource` - Install from Static Resources
- ✅ `packUpdateSettings` - Refresh DataPack settings
- ✅ `packValidate` - Validate DataPacks before deployment

---

## 📋 Prerequisites

### **Required Software**
- **Node.js** >= 18.0.0
- **npm** >= 8.0.0
- **PostgreSQL** >= 13 (or SQLite for local dev — auto-fallback when PostgreSQL is unavailable)
- **Vlocity CLI** (`npm install -g vlocity`)
- **Salesforce CLI** (`npm install -g @salesforce/cli` or via the installer at developer.salesforce.com/tools/salesforcecli)

### **Optional Software**
- **AI API Key** — required for the Chat feature. One of:
  - `ANTHROPIC_API_KEY` for Claude
  - `OPENAI_API_KEY` for GPT-4o
  - `GITHUB_TOKEN` for GitHub Copilot
  - [Ollama](https://ollama.com) running locally (no key needed)
- **SFDMU Plugin** — required only for the Data Migration page:
  ```bash
  sf plugins install sfdmu@latest
  ```
- **Redis** >= 7.0 (for caching — app runs without it; see [Redis auto-start](#redis--automatic-start--reconnect))
- **Docker** >= 20.0 (for containerized deployment)
- **PM2** (for process management in production)

---

## 🛠️ Installation

### **Quick Start (Development)**

```bash
# Complete setup (installs dependencies and CLI tools)
npm run setup

# Copy environment template
cp env.template .env

# Create default users
npm run create-users

# Start development server
npm run dev-full
```

### **NPM Scripts**

```bash
# Installation
npm run install-vlocity          # Install Vlocity CLI globally
npm run install-sfdx             # Install Salesforce CLI globally
npm run install-cli-tools        # Install both CLI tools
npm run setup                    # Complete setup

# Development
npm start                        # Start production server
npm run dev                      # Start development server
npm run dev-full                 # Start both backend and frontend
npm run build                    # Build React frontend

# Testing
npm test                         # Run all tests
npm run test:unit                # Run unit tests
npm run test:integration         # Run integration tests
npm run test:enterprise          # Run enterprise tests
npm run test:e2e                 # Run E2E tests
npm run test:load                # Run load tests

# Code Quality
npm run lint                     # Run ESLint
npm run format                   # Format code with Prettier

# Database
npm run create-users             # Create default users
npm run migrate-schema           # Migrate existing tables to schema
npm run migrate-sfdmu-type       # Add 'sfdmu' to PostgreSQL job type enum (run once after upgrade)
```

---

## ⚙️ Configuration

Repository-specific GitHub Copilot guidance lives in `.github/copilot-instructions.md`.
Playwright MCP is preconfigured in `.vscode/mcp.json` for VS Code workspaces and `.github/mcp.json` for project-level Copilot sessions.

### **Environment Variables (.env)**

```env
# Application
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/vlocity_manager
DB_SCHEMA=vlocity_datapack_manager
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h
BCRYPT_ROUNDS=12

# Vlocity Configuration
VLOCITY_VERSION=1.17.12
VLOCITY_TIMEOUT=300000

# Security
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
CORS_ORIGIN=http://localhost:3000,http://localhost:3001

# Enterprise Features (Enabled by Default)
ENABLE_ENTERPRISE_MONITORING=true
ENABLE_AUDIT_LOGGING=true
ENABLE_ENTERPRISE_JOB_QUEUE=true

# Audit Configuration
AUDIT_RETENTION_DAYS=365
AUDIT_BATCH_SIZE=100

# Job Queue Configuration
MAX_CONCURRENT_JOBS=10
MAX_JOBS_PER_USER=5
MAX_JOBS_PER_TENANT=20

# Monitoring
ENABLE_METRICS=true
METRICS_PORT=9090

# Logging
LOG_LEVEL=info
LOG_MAX_SIZE=5242880
LOG_MAX_FILES=5
```

---

## 🔐 Authentication & Authorization

### **Role-Based Access Control (RBAC)**

#### **👑 Admin Role**
- Full system access, user management, system configuration, all permissions

#### **👨‍💻 Developer Role**
- Job management, org management, configuration management, system monitoring
- Limited permissions (no user management)

#### **👤 Functional Role**
- Job execution, pricing management, promotions management
- Read-only access on most resources

### **Default User Accounts**

| Username    | Email                     | Password  | Role        |
|-------------|---------------------------|-----------|-------------|
| `admin`     | admin@amplifon.com        | Admin123! | Admin       |
| `developer` | developer@amplifon.com    | Dev123!   | Developer   |
| `functional`| functional@amplifon.com   | Func123!  | Functional  |

---

## 🚀 Running the Application

### **Development Mode**

```bash
npm run dev-full
# Frontend: http://localhost:3001
# Backend API: http://localhost:3000/api
```

### **Production Mode**

```bash
npm run build
npm start
# Application: http://localhost:3000
```

### **Docker Mode**

```bash
docker-compose up -d
docker-compose logs -f app
```

---

## 📊 Application URLs

| Page | Path | Description |
|------|------|-------------|
| **AI Chat** | `/chat` | Natural-language agent for querying Vlocity org data |
| Dashboard | `/` | Live KPIs and recent job history |
| Export Jobs | `/exports` | Create and run DataPack export jobs |
| Deploy Jobs | `/deploys` | Create and run DataPack deploy jobs |
| Job History | `/jobs` | All job history with filters |
| Job Monitor | `/jobs/:type/:id` | Real-time log streaming for a job |
| **Catalog Manager** | `/catalog` | Products, prices, promotions, rate codes/tables, snapshots |
| **Data Migration** | `/sfdmu` | Cross-org data migration via SFDMU plugin |
| Env Comparison | `/env-comparison` | Compare two orgs for missing records |
| YAML Configs | `/yaml` | Manage Vlocity YAML configuration files |
| Validation | `/validation` | Validate DataPacks before deployment |
| Config Tester | `/tester` | Test configuration setups |
| Users | `/users` | User and role management (admin only) |
| Audit Logs | `/audit` | Compliance audit log viewer |
| Settings | `/settings` | System status, backup/restore, preferences |

---

## 🔧 API Endpoints

### **Authentication**
- `POST /api/auth/login` — User login
- `GET /api/auth/me` — Current user info
- `POST /api/auth/change-password` — Change password

### **Organizations**
- `GET /api/orgs/list` — List configured orgs
- `POST /api/orgs/validate` — Validate org connection

### **Jobs**
- `GET /api/jobs/history` — Job execution history
- `GET /api/jobs/:jobId` — Specific job details
- `GET /api/jobs/:jobId/logs` — Job logs
- `POST /api/jobs/:jobId/abort` — Abort running job
- `WebSocket /ws/jobs/:jobId` — Real-time job monitoring

### **Export / Deploy Jobs**
- `GET /api/exports/jobs` — List export jobs
- `POST /api/exports/create-job` — Create export job
- `POST /api/exports/run` — Execute export job
- `GET /api/deploys/jobs` — List deploy jobs
- `POST /api/deploys/create-job` — Create deploy job
- `POST /api/deploys/run` — Execute deploy job

### **Catalog Manager**
- `GET /api/catalog/products` — List products (`?username=&page=&limit=`)
- `POST /api/catalog/products` — Create product
- `GET /api/catalog/products/:id` — Get single product
- `PATCH /api/catalog/products/:id` — Update product
- `DELETE /api/catalog/products/:id` — Delete product
- Same pattern for `/price-lists`, `/price-lists/:id/entries`, `/promotions`, `/rate-codes`, `/rate-tables`
- `GET /api/catalog/price-lists/:id/pricing-elements` — List pricing elements for a price list
- `POST /api/catalog/price-lists/:id/pricing-elements` — Create pricing element
- `PATCH /api/catalog/price-lists/:id/pricing-elements/:elemId` — Update pricing element
- `DELETE /api/catalog/price-lists/:id/pricing-elements/:elemId` — Delete pricing element
- `GET /api/catalog/pricing-variables` — List pricing variables
- `POST /api/catalog/pricing-variables` — Create pricing variable
- `PATCH /api/catalog/pricing-variables/:id` — Update pricing variable
- `DELETE /api/catalog/pricing-variables/:id` — Delete pricing variable
- `GET /api/catalog/attribute-categories` — List attribute categories
- `POST /api/catalog/attribute-categories` — Create attribute category
- `PATCH /api/catalog/attribute-categories/:id` — Update attribute category
- `DELETE /api/catalog/attribute-categories/:id` — Delete attribute category
- `GET /api/catalog/attribute-categories/:catId/attributes` — List attributes for a category
- `POST /api/catalog/attribute-categories/:catId/attributes` — Create attribute
- `PATCH /api/catalog/attribute-categories/:catId/attributes/:attrId` — Update attribute
- `DELETE /api/catalog/attribute-categories/:catId/attributes/:attrId` — Delete attribute
- `GET /api/catalog/picklists` — List picklists
- `POST /api/catalog/picklists` — Create picklist
- `PATCH /api/catalog/picklists/:id` — Update picklist
- `DELETE /api/catalog/picklists/:id` — Delete picklist
- `GET /api/catalog/picklists/:id/values` — List picklist values
- `POST /api/catalog/picklists/:id/values` — Create picklist value
- `PATCH /api/catalog/picklists/:id/values/:valueId` — Update picklist value
- `DELETE /api/catalog/picklists/:id/values/:valueId` — Delete picklist value
- `GET /api/catalog/catalogs` — List catalogs
- `POST /api/catalog/catalogs` — Create catalog
- `PATCH /api/catalog/catalogs/:id` — Update catalog
- `DELETE /api/catalog/catalogs/:id` — Delete catalog
- `GET /api/catalog/catalogs/:id/products` — List CatalogProductRelationships (`?itemType=Product|Catalog`)
- `POST /api/catalog/catalogs/:id/products` — Add a product or sub-catalog to a catalog
- `DELETE /api/catalog/catalogs/:id/products/:relId` — Remove a product/sub-catalog from a catalog
- `GET /api/catalog/product-child-items` — List ProductChildItem records (`?parentProductId=` to filter)
- `POST /api/catalog/product-child-items` — Create a ProductChildItem (parent → child product relationship)
- `DELETE /api/catalog/product-child-items/:id` — Delete a ProductChildItem
- `GET /api/catalog/instance-url` — Get Salesforce instance URL for an org (`?username=`)
- `GET /api/catalog/snapshots` — List snapshots for org
- `POST /api/catalog/snapshots` — Create manual snapshot
- `POST /api/catalog/snapshots/:id/restore` — Restore from snapshot
- `GET /api/catalog/batch/jobs` — List Apex batch jobs
- `POST /api/catalog/batch/execute` — Execute Apex batch job

### **Data Migration (SFDMU)**
- `GET /api/sfdmu/status` — Check whether SFDMU plugin is installed
- `GET /api/sfdmu/jobs` — List recent SFDMU migration jobs
- `POST /api/sfdmu/run` — Start a quick (ad-hoc) migration job
- `GET /api/sfdmu/configs` — List saved configurations
- `POST /api/sfdmu/configs` — Create saved configuration
- `GET /api/sfdmu/configs/:id` — Get saved configuration
- `PUT /api/sfdmu/configs/:id` — Update saved configuration
- `DELETE /api/sfdmu/configs/:id` — Delete saved configuration
- `POST /api/sfdmu/configs/import` — Import config from export.json body
- `POST /api/sfdmu/configs/:id/export` — Write export.json to server disk
- `POST /api/sfdmu/configs/:id/run` — Run saved config as migration job

### **AI Chat**
- `GET /api/chat/conversations` — List user's conversations
- `POST /api/chat/conversations` — Create new conversation
- `GET /api/chat/conversations/:id` — Get conversation with messages
- `PATCH /api/chat/conversations/:id/title` — Rename conversation
- `DELETE /api/chat/conversations/:id` — Delete conversation
- `POST /api/chat/message` — Send message; returns SSE stream of `token`, `tool_start`, `tool_end`, `done` events

### **System**
- `GET /api/system/status` — System status (all services)
- `GET /health` — Health check
- `GET /metrics` — Prometheus metrics

---

## 📁 Project Structure

```
vlocity-datapack-manager/
├── server/
│   ├── routes/
│   │   ├── chat.js               # AI chat REST + SSE endpoints
│   │   ├── catalogManager.js     # Catalog CRUD endpoints
│   │   ├── sfdmu.js              # Data migration endpoints
│   │   ├── envComparison.js      # Env comparison endpoints
│   │   └── ...
│   ├── config/
│   │   └── datapckDependencies.js     # DataPack type dependency tiers + sort utility
│   ├── services/
│   │   ├── chatService.js              # Agentic loop, DB persistence, SSE streaming
│   │   ├── vlocityAgentTools.js        # SOQL tools for the AI agent
│   │   ├── aiAdapters/
│   │   │   ├── anthropicAdapter.js     # Claude streaming with tool use
│   │   │   └── openaiAdapter.js        # OpenAI / GitHub Copilot / Ollama
│   │   ├── catalogManagerService.js    # Salesforce CRUD + getById
│   │   ├── cacheService.js             # Redis with auto-start + v4 reconnect strategy
│   │   ├── rollbackService.js          # Snapshot + restore
│   │   ├── sfdmuService.js             # SFDMU CLI integration + buildExportJson()
│   │   ├── envComparisonService.js     # Cross-org comparison logic
│   │   ├── systemStatusService.js      # Health checks incl. SFDMU + Redis
│   │   └── ...
│   └── index.js
├── client/src/
│   ├── pages/
│   │   ├── ChatPage.js                # AI Chat page (conversation list + chat window)
│   │   ├── CatalogManager.js          # Main catalog page (12 tabs)
│   │   ├── CatalogRecordPage.js       # Single-record detail page
│   │   ├── SfdmuPage.js               # Data Migration + Saved Configurations
│   │   ├── SfdmuConfigPage.js         # Config editor (new/edit)
│   │   ├── ExportJobs.js              # Export jobs + dependency ordering toggle
│   │   ├── DeployJobs.js              # Deploy jobs + smart retry controls
│   │   ├── EnvComparisonPage.js       # Env comparison page
│   │   └── ...
│   ├── utils/
│   │   └── catalogHelpers.js          # formatFieldLabel() + sfRecordUrl() utilities
│   └── components/
│       ├── chat/
│       │   ├── ChatWindow.js          # SSE stream consumer + message input bar
│       │   ├── ChatMessage.js         # Markdown bubbles with collapsible tool chips
│       │   ├── ConversationList.js    # Date-grouped conversation list
│       │   └── AdapterSettings.js    # Adapter/org/key config (localStorage)
│       ├── catalog/
│       │   ├── CatalogObjectGrid.js        # Reusable CRUD grid (+ SF link)
│       │   ├── PriceListsTab.js            # Price lists → Entries + Pricing Elements sub-tabs
│       │   ├── AttributesTab.js            # AttributeCategories → Attributes two-panel
│       │   ├── PicklistsTab.js             # Picklists → PicklistValues two-panel
│       │   ├── PricingVariablesTab.js      # Pricing variables CRUD grid
│       │   ├── CatalogsTab.js              # Catalogs → Products/Sub-Catalogs two-panel (sub-tabs by ItemType)
│       │   ├── ProductRelationshipsTab.js  # ProductChildItem flat table (parent → child hierarchy)
│       │   ├── PromotionsTab.js            # Promotions with rules drawer
│       │   ├── BatchJobsPanel.js           # Apex batch execution
│       │   └── SnapshotsPanel.js           # Snapshot/rollback UI
│       └── sfdmu/
│           ├── GlobalSettingsPanel.js # SFDMU global settings (4 accordions)
│           ├── SfdmuObjectDialog.js   # Per-object config dialog (4 tabs)
│           └── PreviewDialog.js       # export.json + CLI command preview
├── scripts/
│   ├── migrate-sfdmu-job-type.js      # Add 'sfdmu' to PostgreSQL enum
│   └── ...
├── snapshots/                         # Snapshot JSON files (auto-created)
├── temp/                              # SFDMU work directories (auto-created)
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 🐛 Troubleshooting

### **1. Application Won't Start**
```bash
node --version    # Must be >= 18.0.0
cat .env          # Check environment variables
tail -f logs/error.log
```

### **2. Database Connection Issues**
```bash
psql -c "SELECT 1;"
echo $DATABASE_URL
```

> **Automatic SQLite fallback**: if PostgreSQL is configured but unreachable (e.g. server not started, wrong credentials), the app automatically falls back to an embedded SQLite database stored at `data/vlocity_manager.db`. The server logs will print a warning such as `⚠️  PostgreSQL unavailable … Falling back to internal SQLite database…`. The app remains fully functional with SQLite; data is stored locally and all features work. Switching back to PostgreSQL only requires making the server reachable again and restarting the app.

### **3. Vlocity CLI Issues**
```bash
npm install -g vlocity
vlocity --version
```

### **4. SFDMU Plugin Not Found**
```bash
# Install the plugin
sf plugins install sfdmu@latest

# Verify
sf plugins list | grep sfdmu

# If PostgreSQL — run the enum migration once
npm run migrate-sfdmu-type
```

### **5. SFDMU Migration Fails**
- Ensure both orgs are authenticated: `sf org list`
- Check the real-time logs on the Job Monitor page (`/jobs/sfdmu/:jobId`)
- Run in **Simulation mode** first to test without writing data
- Verify the sObject API names are correct (e.g. `vlocity_cmt__PriceList__c` not `PriceList`)
- If migrating from CSV, set Source Org to `CSV Files (local)` and ensure CSV files exist in the work directory

### **6. Redis — ECONNREFUSED at Startup**

The app works without Redis (caching is simply disabled). The connection error is expected when Redis is not running and is logged at `warn` level (not `error`).

```bash
# Start Redis manually (WSL)
sudo service redis-server start

# For fully automatic startup, add a sudoers rule once:
echo "$(whoami) ALL=(ALL) NOPASSWD: /usr/sbin/service redis-server start" \
  | sudo tee /etc/sudoers.d/redis-autostart
```

After adding the sudoers rule, `npm start` / `npm run dev` will start Redis automatically via the `prestart`/`predev` scripts. If Redis goes down and comes back up, the app reconnects automatically (≤ 30 s) — no restart needed.

### **7. Vlocity Deploy — Stuck in Retry Loop**

If deploys keep failing with reference errors even after multiple retries, enable the new smart retry features in the **Run** dialog:
- **Use dependency ordering** — ensures types like `Product2` are deployed before `PriceList`
- **Max Retries** — increase from default 10 if there are many dependent types
- **Stop when no progress** — keeps the `packContinue` loop from running uselessly when truly stuck

### **8. Catalog Manager — Empty Lists After Back Navigation**
State (org, filters, tab) is persisted in `sessionStorage`. If lists are empty, either:
- The session was cleared (open a new tab to confirm)
- The org connection expired — re-select the org from the dropdown

---

## 🔒 Security

- **JWT in httpOnly cookies** — never stored in localStorage
- **SOQL injection protection** — all user-supplied values escaped via `escapeSoql()`
- **Helmet security headers** with strict CSP (no `unsafe-eval`)
- **CORS** configurable via `CORS_ORIGIN`
- **Rate limiting** per user (100 req / 15 min)
- **Input validation** on every endpoint (`ValidationError` → HTTP 400)
- **JWT_SECRET required** in production (app will not start without it)
- **Audit logging** — every data-modifying action is logged

---

## 📄 License

This project is licensed under the MIT License.

---

**Version**: 3.0.0 Enterprise Edition
**Status**: ✅ Production Ready
**Enterprise Features**: ✅ All Enabled
