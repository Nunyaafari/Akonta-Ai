# Onboarding + Master Data + Ledger Foundation Sprint Board

Date: 2026-04-28  
Owner: Akonta AI Product/Engineering

## Goal
Ship a record-first onboarding and setup foundation that improves classification accuracy and reporting quality without blocking daily bookkeeping.

## Guiding Rules
1. Recording transactions must never be blocked by incomplete setup.
2. Products/customers/suppliers improve insights, but are optional.
3. Default ledgers are internal and hidden from non-accounting users.
4. Ambiguous parsing requires follow-up or confirmation.
5. All high-impact edits remain auditable and approval-safe.

## Sprint 1 (Foundation) - Completed
Status: Completed

### Scope
1. Data model for onboarding/profile + master data + ledger foundation.
2. Safe feature flags for staged rollout.
3. Backend setup endpoints for business profile and core setup modules.
4. Automatic default categories and default ledger account provisioning per workspace.

### Completed in this sprint
1. Added schema support for:
   - `BusinessCategory`, `ProductService`, `Customer`, `Supplier`
   - `LedgerAccount`, `LedgerJournalEntry`, `LedgerJournalLine`
   - Transaction interpretation metadata (`rawInputText`, `parseConfidence`, `requiresReview`, `interpretedFields`, `ledgerPostingStatus`)
2. Added migration:
   - `backend/prisma/migrations/202604281430_onboarding_masterdata_ledger_foundation/migration.sql`
3. Added setup defaults service:
   - `backend/src/services/setupDefaults.ts`
4. Added settings routes:
   - `backend/src/routes/settings.ts`
5. Added new permissions:
   - `settings:view`, `settings:manage`, `masterdata:manage`, `ledger:view`
6. Added feature flags:
   - `ONBOARDING_V2_ENABLED`
   - `MASTERDATA_V1_ENABLED`
   - `DEFAULT_LEDGER_V1_ENABLED`
   - `CLASSIFICATION_GUARDRAILS_V1_ENABLED`
7. Build check passed:
   - `cd backend && npm run build`
8. Added master data maintenance APIs:
   - update + deactivate endpoints for categories, products/services, customers, suppliers
   - frontend API wrappers + mock fallback handlers for same contract
9. Added settings RBAC integration test coverage:
   - `backend/scripts/integration-settings-rbac.ts`
   - `backend/package.json` scripts: `test:settings` and `test:ci` chain update
10. Added onboarding profile completion contract in settings profile API:
   - required profile checks + setup module checks
   - completion percentages for onboarding wizard gating/UX
11. Completed settings integration execution evidence:
   - `npm run test:settings` passing against Docker backend
12. Completed migration rehearsal evidence with integrity checks:
   - `npm run rehearsal:staging-migration:docker` PASS
   - artifacts under `backend/rehearsal-artifacts/20260428T145822Z/`
13. Added legacy business backfill migration for nullable workspace links:
   - `backend/prisma/migrations/202604281500_legacy_business_backfill/migration.sql`

### Remaining for Sprint 1
1. Run one more rehearsal against production-like staging snapshot and attach artifact path in release ticket.

## Sprint 2 (Onboarding UX + Settings IA)
Status: Planned

### Scope
1. New onboarding flow (minimal required fields):
   - Business name
   - Business type
   - Currency
   - Payment methods
2. Settings page restructure:
   - Business Profile
   - Payment Methods
   - Products & Services
   - Customers
   - Suppliers
   - Categories
   - Team & Permissions
   - Advanced
3. Progressive suggestions from usage signals.

### Acceptance Criteria
1. User can complete onboarding in under 2 minutes.
2. User can record first transaction immediately after onboarding.
3. Setup modules are optional and accessible from Settings.

## Sprint 3 (Classification Guardrails + Trust Signals)
Status: In progress

### Scope
1. Upgrade parser and interpretation confidence handling.
2. Add follow-up prompts for ambiguous intents.
3. Add confirmation flow for AI-calculated totals and high-risk actions.
4. Add completeness indicators to reports.

### Acceptance Criteria
1. Ambiguous messages no longer auto-post silently.
2. Quantity x unit messages require confirmation before posting.
3. Reports show completeness (assigned vs unassigned quality indicators).

### Progress completed
1. Added parser interpretation engine with:
   - confidence scoring (`high`, `medium`, `low`)
   - ambiguity follow-up prompts (e.g. generic paid/received, transfer without accounts)
   - calculated-total detection requiring explicit confirmation
2. Wired guardrails into chat flow for `idle`, `ask_sales`, and `ask_expense` steps.
3. Persisted interpretation metadata on draft transactions:
   - `rawInputText`
   - `parseConfidence`
   - `requiresReview`
   - `interpretedFields`
4. Added regression assertions in integration script for:
   - ambiguous intent follow-up
   - calculated-entry confirmation requirement
5. Added report completeness metrics in backend and frontend summaries:
   - product assignment coverage
   - unassigned sales amount
   - low-confidence and review-flag counts
   - completeness score
6. Added Dashboard "Report quality" card to surface data quality and transparency.
7. Added History filter and row badges for:
   - low confidence
   - medium confidence
   - needs review

## Sprint 4 (Ledger Posting Projection)
Status: Planned

### Scope
1. Add transaction-to-journal posting worker/service.
2. Post journal entries only when mapping confidence is sufficient.
3. Maintain transaction validity when ledger posting is pending/failed.

### Acceptance Criteria
1. Transaction recording remains available even if ledger posting fails.
2. Ledger posting status visible for audit/debug.
3. Trial balance and balance-sheet-ready account structure is produced incrementally.

## Release Safety Checklist
1. Staging DB backup before migration rehearsal.
2. Migration apply + integrity checks:
   - row counts
   - FK health
   - unique constraint violations
3. Smoke test:
   - onboarding
   - create product/customer/supplier
   - create transaction via chat
4. Rollback playbook:
   - app rollback
   - DB restore
   - post-restore validation
