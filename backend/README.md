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
- `POST /api/transactions` - create a transaction
- `GET /api/transactions?userId=...&start=...&end=...` - list transactions
- `GET /api/summaries/weekly?userId=...&start=...&end=...` - compute a weekly summary
- `GET /api/summaries/monthly?userId=...&year=...&month=...` - compute a monthly summary
- `POST /api/summaries` - create a summary record for a period
- `POST /api/whatsapp/webhook` - parse WhatsApp-style messages into transactions
- `POST /api/whatsapp/send` - send an outbound WhatsApp message through the configured provider
- `GET /api/whatsapp/providers` - list available WhatsApp providers and the selected default

## Notes

- Bookkeeping is powered by Prisma models for `User`, `Transaction`, and `Summary`.
- The `Summary` model stores computed totals plus `details` JSON for reporting.
- The WhatsApp webhook uses a simple parser for natural text such as "I made 500" and "Spent 100 on transport".
- Outbound WhatsApp can be routed through Twilio or Infobip using environment configuration.
