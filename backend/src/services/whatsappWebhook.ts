import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../lib/env.js';

type AnyRecord = Record<string, unknown>;

export interface NormalizedWebhookMessage {
  provider: 'twilio' | 'infobip';
  eventId: string;
  from: string;
  message: string;
  payload: unknown;
}

const asString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
};

const toArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  return [];
};

const canonicalizePhone = (input: string): string => {
  const withoutPrefix = input.replace(/^whatsapp:/i, '').trim();
  return withoutPrefix;
};

export const normalizePhoneDigits = (input: string): string => {
  return canonicalizePhone(input).replace(/\D/g, '');
};

const appendTwilioParam = (key: string, value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((entry) => `${key}${String(entry ?? '')}`).join('');
  }
  return `${key}${String(value ?? '')}`;
};

const secureEqual = (a: string, b: string): boolean => {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
};

const resolvePublicUrl = (request: FastifyRequest, overrideUrl?: string): string => {
  if (overrideUrl && overrideUrl.trim().length > 0) {
    return overrideUrl.trim();
  }

  const forwardedProto = asString(request.headers['x-forwarded-proto'])?.split(',')[0]?.trim();
  const forwardedHost = asString(request.headers['x-forwarded-host'])?.split(',')[0]?.trim();
  const protocol = forwardedProto ?? request.protocol ?? 'https';
  const host = forwardedHost ?? asString(request.headers.host) ?? 'localhost';
  return `${protocol}://${host}${request.url}`;
};

export const validateTwilioSignature = (params: {
  request: FastifyRequest;
  body: AnyRecord;
  providedSignature: string | null;
}): boolean => {
  if (!config.TWILIO_WEBHOOK_VALIDATE_SIGNATURE) return true;
  if (!config.TWILIO_AUTH_TOKEN) return false;
  if (!params.providedSignature) return false;

  const targetUrl = resolvePublicUrl(params.request, config.TWILIO_WEBHOOK_URL);
  const sortedKeys = Object.keys(params.body).sort();
  const payload = sortedKeys.reduce((acc, key) => acc + appendTwilioParam(key, params.body[key]), targetUrl);

  const expected = crypto
    .createHmac('sha1', config.TWILIO_AUTH_TOKEN)
    .update(payload)
    .digest('base64');

  return secureEqual(expected, params.providedSignature);
};

export const parseTwilioWebhook = (body: AnyRecord): NormalizedWebhookMessage | null => {
  const message = asString(body.Body);
  const from = asString(body.From);
  const eventId = asString(body.MessageSid) ?? asString(body.SmsMessageSid) ?? asString(body.WaId);

  if (!message || !from || !eventId) return null;

  return {
    provider: 'twilio',
    eventId,
    from: canonicalizePhone(from),
    message,
    payload: body
  };
};

const resolveInfobipResult = (body: AnyRecord): AnyRecord | null => {
  const results = toArray((body as AnyRecord).results);
  const firstResult = results.find((entry) => entry && typeof entry === 'object') as AnyRecord | undefined;
  if (!firstResult) return null;
  return firstResult;
};

const extractInfobipMessageText = (result: AnyRecord): string | null => {
  const messageObj = result.message as AnyRecord | undefined;
  const messageText = asString(messageObj?.text);
  if (messageText) return messageText;
  return asString(result.text);
};

export const validateInfobipSignature = (params: {
  authorizationHeader: string | null;
}): boolean => {
  if (!config.INFOBIP_WEBHOOK_AUTH_TOKEN) return true;
  if (!params.authorizationHeader) return false;

  const header = params.authorizationHeader.trim();
  const validValues = new Set([
    config.INFOBIP_WEBHOOK_AUTH_TOKEN,
    `App ${config.INFOBIP_WEBHOOK_AUTH_TOKEN}`,
    `Bearer ${config.INFOBIP_WEBHOOK_AUTH_TOKEN}`
  ]);

  return Array.from(validValues).some((value) => secureEqual(value, header));
};

export const parseInfobipWebhook = (body: AnyRecord): NormalizedWebhookMessage | null => {
  const result = resolveInfobipResult(body);
  if (!result) return null;

  const from = asString(result.from);
  const message = extractInfobipMessageText(result);
  const eventId = asString(result.messageId) ?? asString(result.id);

  if (!from || !message || !eventId) return null;

  return {
    provider: 'infobip',
    eventId,
    from: canonicalizePhone(from),
    message,
    payload: body
  };
};
