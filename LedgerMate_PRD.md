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

## 🔥 Final Insight
This is a behavioral system, not accounting software.
