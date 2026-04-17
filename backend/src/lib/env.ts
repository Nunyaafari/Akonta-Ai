import dotenv from 'dotenv';

dotenv.config();

export const config = {
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  PORT: process.env.PORT ?? '4000',
  APP_ORIGIN: process.env.APP_ORIGIN ?? '*',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  BACKEND_API_KEY: process.env.BACKEND_API_KEY ?? '',
  ADMIN_API_KEY: process.env.ADMIN_API_KEY ?? '',
  WHATSAPP_PROVIDER: (process.env.WHATSAPP_PROVIDER ?? 'whatchimp').toLowerCase(),
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? '',
  TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM ?? '',
  TWILIO_WEBHOOK_URL: process.env.TWILIO_WEBHOOK_URL ?? '',
  TWILIO_WEBHOOK_VALIDATE_SIGNATURE: (process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE ?? 'false').toLowerCase() === 'true',
  INFOBIP_BASE_URL: process.env.INFOBIP_BASE_URL ?? 'https://api.infobip.com',
  INFOBIP_API_KEY: process.env.INFOBIP_API_KEY ?? '',
  INFOBIP_WHATSAPP_FROM: process.env.INFOBIP_WHATSAPP_FROM ?? '',
  INFOBIP_WEBHOOK_AUTH_TOKEN: process.env.INFOBIP_WEBHOOK_AUTH_TOKEN ?? '',
  WHATCHIMP_BASE_URL: process.env.WHATCHIMP_BASE_URL ?? '',
  WHATCHIMP_API_KEY: process.env.WHATCHIMP_API_KEY ?? '',
  WHATCHIMP_SENDER_ID: process.env.WHATCHIMP_SENDER_ID ?? '',
  WHATCHIMP_SEND_PATH: process.env.WHATCHIMP_SEND_PATH ?? '/api/messages/whatsapp',
  WHATCHIMP_AUTH_SCHEME: process.env.WHATCHIMP_AUTH_SCHEME ?? 'Bearer',
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY ?? '',
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY ?? '',
  PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET ?? '',
  PAYSTACK_PREMIUM_AMOUNT: Number(process.env.PAYSTACK_PREMIUM_AMOUNT ?? '50'),
  PAYSTACK_CURRENCY_CODE: process.env.PAYSTACK_CURRENCY_CODE ?? 'GHS'
};
