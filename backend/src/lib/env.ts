import dotenv from 'dotenv';

dotenv.config();

export const config = {
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  PORT: process.env.PORT ?? '4000',
  APP_ORIGIN: process.env.APP_ORIGIN ?? '*',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  BACKEND_API_KEY: process.env.BACKEND_API_KEY ?? '',
  ADMIN_API_KEY: process.env.ADMIN_API_KEY ?? '',
  WHATSAPP_PROVIDER: (process.env.WHATSAPP_PROVIDER ?? 'twilio').toLowerCase(),
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? '',
  TWILIO_WHATSAPP_FROM: process.env.TWILIO_WHATSAPP_FROM ?? '',
  TWILIO_WEBHOOK_URL: process.env.TWILIO_WEBHOOK_URL ?? '',
  TWILIO_WEBHOOK_VALIDATE_SIGNATURE: (process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE ?? 'false').toLowerCase() === 'true',
  INFOBIP_BASE_URL: process.env.INFOBIP_BASE_URL ?? 'https://api.infobip.com',
  INFOBIP_API_KEY: process.env.INFOBIP_API_KEY ?? '',
  INFOBIP_WHATSAPP_FROM: process.env.INFOBIP_WHATSAPP_FROM ?? '',
  INFOBIP_WEBHOOK_AUTH_TOKEN: process.env.INFOBIP_WEBHOOK_AUTH_TOKEN ?? ''
};
