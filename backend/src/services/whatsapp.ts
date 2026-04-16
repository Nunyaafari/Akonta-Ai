import { config } from '../lib/env.js';
import db from '../lib/db.js';

export type WhatsAppProvider = 'twilio' | 'infobip';

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

export const availableProviders: WhatsAppProvider[] = ['twilio', 'infobip'];

export const resolveProvider = (provider?: string): WhatsAppProvider => {
  const selected = provider?.toLowerCase() as WhatsAppProvider;
  if (selected && availableProviders.includes(selected)) {
    return selected;
  }
  const fallback = config.WHATSAPP_PROVIDER as WhatsAppProvider;
  return availableProviders.includes(fallback) ? fallback : 'twilio';
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

  if (selectedProvider === 'twilio') {
    return sendWithTwilio(to, message);
  }

  if (selectedProvider === 'infobip') {
    return sendWithInfobip(to, message);
  }

  throw new Error(`Unsupported WhatsApp provider: ${selectedProvider}`);
};
