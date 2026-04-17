import { config } from '../lib/env.js';
import db from '../lib/db.js';

export type WhatsAppProvider = 'twilio' | 'infobip' | 'whatchimp';

type WhatchimpRuntimeConfig = {
  baseUrl: string;
  apiKey: string;
  senderId: string;
  sendPath: string;
  authScheme: string;
};

const sendWithTwilio = async (to: string, message: string) => {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.TWILIO_ACCOUNT_SID}/Messages.json`;
  const body = new URLSearchParams({
    From: config.TWILIO_WHATSAPP_FROM,
    To: `whatsapp:${to}`,
    Body: message
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Twilio send failed: ${response.status} ${errorBody}`);
  }

  return response.json();
};

const sendWithInfobip = async (to: string, message: string) => {
  const url = `${config.INFOBIP_BASE_URL}/whatsapp/1/message/text`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `App ${config.INFOBIP_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: config.INFOBIP_WHATSAPP_FROM,
      to,
      content: [
        {
          type: 'text',
          text: message
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Infobip send failed: ${response.status} ${errorBody}`);
  }

  return response.json();
};

const normalizeBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');
const normalizePath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '/api/messages/whatsapp';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const resolveWhatchimpConfig = async (): Promise<WhatchimpRuntimeConfig> => {
  try {
    const settings = await db.appConfig.findUnique({
      where: { id: 'global' },
      select: {
        whatchimpBaseUrl: true,
        whatchimpApiKey: true,
        whatchimpSenderId: true,
        whatchimpSendPath: true,
        whatchimpAuthScheme: true
      }
    });

    return {
      baseUrl: normalizeBaseUrl(settings?.whatchimpBaseUrl || config.WHATCHIMP_BASE_URL),
      apiKey: (settings?.whatchimpApiKey || config.WHATCHIMP_API_KEY).trim(),
      senderId: (settings?.whatchimpSenderId || config.WHATCHIMP_SENDER_ID).trim(),
      sendPath: normalizePath(settings?.whatchimpSendPath || config.WHATCHIMP_SEND_PATH),
      authScheme: (settings?.whatchimpAuthScheme || config.WHATCHIMP_AUTH_SCHEME || 'Bearer').trim()
    };
  } catch {
    return {
      baseUrl: normalizeBaseUrl(config.WHATCHIMP_BASE_URL),
      apiKey: config.WHATCHIMP_API_KEY.trim(),
      senderId: config.WHATCHIMP_SENDER_ID.trim(),
      sendPath: normalizePath(config.WHATCHIMP_SEND_PATH),
      authScheme: (config.WHATCHIMP_AUTH_SCHEME || 'Bearer').trim()
    };
  }
};

const sendWithWhatchimp = async (to: string, message: string) => {
  const whatchimp = await resolveWhatchimpConfig();
  if (!whatchimp.baseUrl) {
    throw new Error('Whatchimp send failed: base URL is not configured.');
  }
  if (!whatchimp.apiKey) {
    throw new Error('Whatchimp send failed: API key is not configured.');
  }

  const endpoint = `${whatchimp.baseUrl}${whatchimp.sendPath}`;
  const authValue = whatchimp.authScheme.toLowerCase() === 'none'
    ? whatchimp.apiKey
    : `${whatchimp.authScheme} ${whatchimp.apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: authValue,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to,
      message,
      text: message,
      sender: whatchimp.senderId || undefined,
      from: whatchimp.senderId || undefined,
      type: 'text'
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Whatchimp send failed: ${response.status} ${errorBody}`);
  }

  return response.json().catch(() => ({ success: true }));
};

export const availableProviders: WhatsAppProvider[] = ['whatchimp', 'twilio', 'infobip'];

export const resolveProvider = (provider?: string): WhatsAppProvider => {
  const selected = provider?.toLowerCase() as WhatsAppProvider;
  if (selected && availableProviders.includes(selected)) {
    return selected;
  }
  const fallback = config.WHATSAPP_PROVIDER as WhatsAppProvider;
  return availableProviders.includes(fallback) ? fallback : 'whatchimp';
};

export const getConfiguredProvider = async (): Promise<WhatsAppProvider> => {
  try {
    const settings = await db.appConfig.findUnique({
      where: { id: 'global' },
      select: { whatsappProvider: true }
    });
    if (settings?.whatsappProvider) {
      return settings.whatsappProvider;
    }
  } catch {
    // fall back to env when table is not migrated yet
  }
  return resolveProvider();
};

export const setConfiguredProvider = async (provider: WhatsAppProvider): Promise<WhatsAppProvider> => {
  const updated = await db.appConfig.upsert({
    where: { id: 'global' },
    update: { whatsappProvider: provider },
    create: {
      id: 'global',
      whatsappProvider: provider
    },
    select: { whatsappProvider: true }
  });
  return updated.whatsappProvider;
};

export const sendWhatsAppMessage = async (to: string, message: string, provider?: string) => {
  const selectedProvider = provider ? resolveProvider(provider) : await getConfiguredProvider();

  if (selectedProvider === 'whatchimp') {
    return sendWithWhatchimp(to, message);
  }

  if (selectedProvider === 'twilio') {
    return sendWithTwilio(to, message);
  }

  if (selectedProvider === 'infobip') {
    return sendWithInfobip(to, message);
  }

  throw new Error(`Unsupported WhatsApp provider: ${selectedProvider}`);
};
