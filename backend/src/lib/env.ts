import { readFileSync } from 'node:fs';
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

const parseOrigins = (value: string): string[] => {
  const raw = value.trim();
  if (!raw || raw === '*') return ['*'];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\/$/, ''));
};

const readConfigValue = (name: string, fallback = ''): string => {
  const directValue = process.env[name];
  if (directValue && directValue.trim().length > 0) {
    return directValue.trim();
  }

  const fileValue = process.env[`${name}_FILE`];
  if (fileValue && fileValue.trim().length > 0) {
    const filePath = fileValue.trim();
    try {
      return readFileSync(filePath, 'utf8').trim();
    } catch (error) {
      throw new Error(
        `Unable to read ${name} from ${name}_FILE (${filePath}): ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  }

  return fallback;
};

const NODE_ENV = readConfigValue('NODE_ENV', 'development');
const APP_ORIGIN = readConfigValue('APP_ORIGIN', '*');

export const config = {
  NODE_ENV,
  DATABASE_URL: readConfigValue('DATABASE_URL', ''),
  PORT: readConfigValue('PORT', '4000'),
  APP_ORIGIN,
  APP_ORIGINS: parseOrigins(APP_ORIGIN),
  OPENAI_API_KEY: readConfigValue('OPENAI_API_KEY', ''),
  BACKEND_API_KEY: readConfigValue('BACKEND_API_KEY', ''),
  ADMIN_API_KEY: readConfigValue('ADMIN_API_KEY', ''),
  JWT_ACCESS_SECRET: readConfigValue('JWT_ACCESS_SECRET', ''),
  JWT_REFRESH_SECRET: readConfigValue('JWT_REFRESH_SECRET', ''),
  ALLOW_LEGACY_USER_HEADER_AUTH: parseBoolean(
    readConfigValue('ALLOW_LEGACY_USER_HEADER_AUTH', NODE_ENV !== 'production' ? 'true' : 'false'),
    NODE_ENV !== 'production'
  ),
  AUTH_EXPOSE_DEV_OTP: parseBoolean(
    readConfigValue('AUTH_EXPOSE_DEV_OTP', NODE_ENV !== 'production' ? 'true' : 'false'),
    NODE_ENV !== 'production'
  ),
  OTP_REQUEST_WINDOW_MINUTES: parseNumber(readConfigValue('OTP_REQUEST_WINDOW_MINUTES', '15'), 15),
  OTP_MAX_REQUESTS_PER_PHONE_WINDOW: parseNumber(readConfigValue('OTP_MAX_REQUESTS_PER_PHONE_WINDOW', '5'), 5),
  OTP_MAX_REQUESTS_PER_IP_WINDOW: parseNumber(readConfigValue('OTP_MAX_REQUESTS_PER_IP_WINDOW', '20'), 20),
  OTP_MIN_SECONDS_BETWEEN_REQUESTS: parseNumber(readConfigValue('OTP_MIN_SECONDS_BETWEEN_REQUESTS', '30'), 30),
  WHATSAPP_PROVIDER: readConfigValue('WHATSAPP_PROVIDER', 'whatchimp').toLowerCase(),
  TWILIO_ACCOUNT_SID: readConfigValue('TWILIO_ACCOUNT_SID', ''),
  TWILIO_AUTH_TOKEN: readConfigValue('TWILIO_AUTH_TOKEN', ''),
  TWILIO_WHATSAPP_FROM: readConfigValue('TWILIO_WHATSAPP_FROM', ''),
  TWILIO_WEBHOOK_URL: readConfigValue('TWILIO_WEBHOOK_URL', ''),
  TWILIO_WEBHOOK_VALIDATE_SIGNATURE: parseBoolean(readConfigValue('TWILIO_WEBHOOK_VALIDATE_SIGNATURE', 'false'), false),
  INFOBIP_BASE_URL: readConfigValue('INFOBIP_BASE_URL', 'https://api.infobip.com'),
  INFOBIP_API_KEY: readConfigValue('INFOBIP_API_KEY', ''),
  INFOBIP_WHATSAPP_FROM: readConfigValue('INFOBIP_WHATSAPP_FROM', ''),
  INFOBIP_WEBHOOK_AUTH_TOKEN: readConfigValue('INFOBIP_WEBHOOK_AUTH_TOKEN', ''),
  TELEGRAM_BOT_TOKEN: readConfigValue('TELEGRAM_BOT_TOKEN', ''),
  TELEGRAM_WEBHOOK_SECRET: readConfigValue('TELEGRAM_WEBHOOK_SECRET', ''),
  WHATCHIMP_BASE_URL: readConfigValue('WHATCHIMP_BASE_URL', ''),
  WHATCHIMP_API_KEY: readConfigValue('WHATCHIMP_API_KEY', ''),
  WHATCHIMP_SENDER_ID: readConfigValue('WHATCHIMP_SENDER_ID', ''),
  WHATCHIMP_SEND_PATH: readConfigValue('WHATCHIMP_SEND_PATH', '/api/messages/whatsapp'),
  WHATCHIMP_AUTH_SCHEME: readConfigValue('WHATCHIMP_AUTH_SCHEME', 'Bearer'),
  PAYSTACK_PUBLIC_KEY: readConfigValue('PAYSTACK_PUBLIC_KEY', ''),
  PAYSTACK_SECRET_KEY: readConfigValue('PAYSTACK_SECRET_KEY', ''),
  PAYSTACK_WEBHOOK_SECRET: readConfigValue('PAYSTACK_WEBHOOK_SECRET', ''),
  PAYSTACK_BASIC_AMOUNT: parseNumber(readConfigValue('PAYSTACK_BASIC_AMOUNT', '60'), 60),
  PAYSTACK_PREMIUM_AMOUNT: parseNumber(readConfigValue('PAYSTACK_PREMIUM_AMOUNT', '200'), 200),
  PAYSTACK_CURRENCY_CODE: readConfigValue('PAYSTACK_CURRENCY_CODE', 'GHS')
};
