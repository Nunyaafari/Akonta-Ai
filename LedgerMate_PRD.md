# 📄 Product Requirements Document (PRD)

## 🏷️ Product Name  
LedgerMate (Working Name)  
“Your Accountant on WhatsApp”

---

## 🎯 1. Product Vision

To make financial tracking effortless, conversational, and consistent for small business owners across Ghana and West Africa.

“If you can reply to a message, you can run your accounts.”

---

## 👥 2. Target Users

Primary Users:
- Traders (market sellers, shop owners)
- Informal businesses
- Freelancers & side hustlers

Secondary Users:
- Small SMEs without accountants
- Early-stage entrepreneurs

---

## 😤 3. Problem Statement

Small business owners:
- Don’t track finances daily
- Forget transactions
- Only check numbers during crisis

Traditional tools:
- Are too complex
- Require discipline users don’t have

---

## 💡 4. Solution Overview

A conversational AI accountant that:
- Engages users daily via WhatsApp
- Collects financial data through chat
- Builds habit loop
- Generates weekly & monthly reports
- Unlocks premium insights

---

## 🎯 5. MVP Goals

- 2,000+ users in 90 days
- ≥40% daily response rate
- ≥25% weekly retention
- ≥10% paid conversion

---

## 🧩 6. Core Features (MVP)

### Conversational Data Entry
- “I made 500”
- “Sold 500, spent 200”
- “No sales today”

### Daily Prompts
- Scheduled check-ins
- Follow-ups if no response

### Transaction Logging
- Revenue
- Expenses
- Date
- Notes

### Weekly Summary
- Revenue
- Expenses
- Profit

### Monthly Summary
- Financial overview

### Premium Features
- Expense breakdown
- AI insights
- PDF reports
- Cash flow alerts

### Web Dashboard
- View/edit transactions
- Charts (premium)

---

## 🚫 7. Out of Scope
- Payroll
- Tax filing
- IFRS compliance
- Inventory system

---

## 🧱 8. Tech Requirements

- WhatsApp API
- Web app (React/Next.js)
- Backend API
- NLP parsing engine

---

## 🗄️ Database

Users:
- id
- phone
- preferred_time
- subscription_status

Transactions:
- id
- user_id
- type
- amount
- date
- notes

Summaries:
- id
- user_id
- period
- totals

---

## 🧠 9. Conversation Principles
- One question at a time
- Short messages
- Friendly tone
- Confirm before saving

---

## 📈 10. Growth Strategy
- WhatsApp onboarding
- Referrals
- Market targeting

---

## 💰 11. Monetization
Free:
- Basic tracking
- Weekly/monthly summaries

Paid:
- Insights
- Reports
- Forecasting

---

## 🗓️ 12. Timeline
Week 1: Design
Week 2: WhatsApp integration
Week 3: AI parsing
Week 4: Launch

---

## 🚀 13. Next Phase Plan (May–July 2026)

### Phase 1: Reporting Hardening (2 weeks)
- Finalize modular report architecture (`HTML`, `PDF`, `CSV`, shared types/utilities).
- Add regression tests for statement builders and export generators.
- Ensure branding consistency (new logo + favicon across app shell, landing, manifest, service worker).

### Phase 2: Reliability + Observability (2 weeks)
- Add structured error logging for report generation, sync, and payment flows.
- Add retry-safe handling for offline queue and background sync failures.
- Introduce release health metrics (PDF success rate, sync failure rate, daily active usage).

### Phase 3: Product Expansion (3 weeks)
- Improve insights quality: better categorization and clearer action recommendations.
- Enhance premium value: stronger cash-flow alerts and period-over-period comparisons.
- Add admin-facing diagnostics for onboarding, subscription, and message delivery issues.

### Phase 4: Launch Readiness (1 week)
- Execute full QA checklist on dashboard, reports, chat classification, and settings.
- Run performance and bundle-size review before release.
- Publish release notes and rollback plan.

### Success Criteria
- Report generation errors below 1%.
- No P1 regressions in dashboard/report workflows during release window.
- Weekly retention and premium conversion exceed current baseline.

---

## 🔥 Final Insight
This is a behavioral system, not accounting software.
