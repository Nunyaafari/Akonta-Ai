import dotenv from 'dotenv';

dotenv.config();

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const NODE_ENV = process.env.NODE_ENV ?? 'development';

export const config = {
  NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  PORT: process.env.PORT ?? '4000',
  APP_ORIGIN: process.env.APP_ORIGIN ?? '*',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  BACKEND_API_KEY: process.env.BACKEND_API_KEY ?? '',
  ADMIN_API_KEY: process.env.ADMIN_API_KEY ?? '',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? '',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? '',
  ALLOW_LEGACY_USER_HEADER_AUTH: parseBoolean(
    process.env.ALLOW_LEGACY_USER_HEADER_AUTH,
    NODE_ENV !== 'production'
  ),
  AUTH_EXPOSE_DEV_OTP: parseBoolean(
    process.env.AUTH_EXPOSE_DEV_OTP,
    NODE_ENV !== 'production'
  ),
  OTP_REQUEST_WINDOW_MINUTES: parseNumber(process.env.OTP_REQUEST_WINDOW_MINUTES, 15),
  OTP_MAX_REQUESTS_PER_PHONE_WINDOW: parseNumber(process.env.OTP_MAX_REQUESTS_PER_PHONE_WINDOW, 5),
  OTP_MAX_REQUESTS_PER_IP_WINDOW: parseNumber(process.env.OTP_MAX_REQUESTS_PER_IP_WINDOW, 20),
  OTP_MIN_SECONDS_BETWEEN_REQUESTS: parseNumber(process.env.OTP_MIN_SECONDS_BETWEEN_REQUESTS, 30),
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
