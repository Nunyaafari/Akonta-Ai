# Akonta AI Backend

This backend service provides bookkeeping, transaction recording, summary reporting, and WhatsApp integration for Akonta AI.

## Setup

1. Copy `.env.example` to `.env`
2. Update `DATABASE_URL` to your PostgreSQL database
3. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
4. Generate Prisma client:
   ```bash
   npm run prisma:generate
   ```
5. Run migrations:
   ```bash
   npm run prisma:migrate
   ```
6. Start the backend:
   ```bash
   npm run dev
   ```

## Available endpoints

- `POST /api/users` - create a user
- `GET /api/users/:id` - fetch a user
- `GET /api/users` - list users
- `POST /api/transactions` - create a transaction (`status` can be `draft` or `confirmed`)
- `GET /api/transactions?userId=...&start=...&end=...` - list transactions (`status`, `eventType`, `includeCorrections=true` supported)
- `PATCH /api/transactions/:id` - update a draft transaction
- `PATCH /api/transactions/:id/confirm` - confirm a draft transaction
- `POST /api/transactions/:id/corrections` - create a corrected replacement entry for a confirmed transaction
- `GET /api/summaries/weekly?userId=...&start=...&end=...` - compute a weekly summary
- `GET /api/summaries/monthly?userId=...&year=...&month=...` - compute a monthly summary
- `POST /api/summaries` - create a summary record for a period
- `GET /api/insights/current?userId=...` - compute month-to-date target, overrun, and credit-readiness insights
- `GET /api/insights/monthly?userId=...&year=...&month=...` - compute insights for a specific month
- `POST /api/whatsapp/webhook/twilio` - Twilio-native inbound webhook with optional signature validation
- `POST /api/whatsapp/webhook/infobip` - Infobip-native inbound webhook with optional auth-token validation
- `POST /api/whatsapp/webhook` - generic signed/internal webhook entry point (API key protected)
- `POST /api/whatsapp/send` - send an outbound WhatsApp message through the configured provider
- `GET /api/whatsapp/providers` - list available WhatsApp providers and the selected default
- `GET /api/whatsapp/webhook/events?provider=...&limit=...` - inspect deduplicated webhook events
- `POST /api/chat` - process a stateful accounting conversation turn (`channel: web|whatsapp`)

## Notes

- Bookkeeping is powered by Prisma models for `User`, `Transaction`, and `Summary`.
- The `Summary` model stores computed totals plus `details` JSON for reporting.
- The WhatsApp webhook uses a simple parser for natural text such as "I made 500" and "Spent 100 on transport".
- Outbound WhatsApp can be routed through Twilio or Infobip using environment configuration.
- Transaction records now support event classification (`cash_sale`, `credit_sale`, `debtor_recovery`, `owner_withdrawal`, `loan_received`, etc.).
- Confirmed summaries only include `status=confirmed` entries and exclude superseded corrected originals.
- Conversation orchestration now runs on the backend with persisted `ConversationSession` state per user/channel (`web` and `whatsapp`).
- Daily flow is draft-first: entries stay in `draft` status until the user explicitly replies `SAVE`.
- API key auth can be enforced globally using `BACKEND_API_KEY` (`x-akonta-api-key` or `Authorization: Bearer ...`).
- Webhook ingestion is idempotent using `ProcessedWebhookEvent` records keyed by provider + event ID.

## Security configuration

- `BACKEND_API_KEY` enables global API-key protection for all API routes except health and provider webhooks.
- `TWILIO_WEBHOOK_VALIDATE_SIGNATURE=true` turns on Twilio `X-Twilio-Signature` verification.
- `TWILIO_WEBHOOK_URL` can be set to your public webhook URL if your server sits behind a proxy/load balancer.
- `INFOBIP_WEBHOOK_AUTH_TOKEN` enables authorization-header validation for Infobip inbound webhooks.
