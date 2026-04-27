import Dexie, { type Table } from 'dexie';

export type PendingChatMessage = {
  id: string;
  userId: string;
  clientMessageId: string;
  message: string;
  channel: 'web' | 'whatsapp' | 'telegram';
  createdAt: string;
  attempts: number;
  lastError?: string;
};

class AkontaOfflineDb extends Dexie {
  pendingChatMessages!: Table<PendingChatMessage, string>;

  constructor() {
    super('akonta-offline-store');
    this.version(1).stores({
      pendingChatMessages: 'id,userId,createdAt,clientMessageId'
    });
  }
}

const db = new AkontaOfflineDb();

const createQueueId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const enqueuePendingChatMessage = async (payload: {
  userId: string;
  clientMessageId: string;
  message: string;
  channel?: 'web' | 'whatsapp' | 'telegram';
}): Promise<PendingChatMessage> => {
  const item: PendingChatMessage = {
    id: createQueueId(),
    userId: payload.userId,
    clientMessageId: payload.clientMessageId,
    message: payload.message,
    channel: payload.channel ?? 'web',
    createdAt: new Date().toISOString(),
    attempts: 0
  };
  await db.pendingChatMessages.put(item);
  return item;
};

export const listPendingChatMessages = async (userId: string): Promise<PendingChatMessage[]> => {
  return db.pendingChatMessages
    .where('userId')
    .equals(userId)
    .sortBy('createdAt');
};

export const removePendingChatMessage = async (id: string): Promise<void> => {
  await db.pendingChatMessages.delete(id);
};

export const markPendingChatMessageFailure = async (id: string, error: string): Promise<void> => {
  const current = await db.pendingChatMessages.get(id);
  if (!current) return;
  await db.pendingChatMessages.put({
    ...current,
    attempts: current.attempts + 1,
    lastError: error
  });
};

export const getPendingChatCount = async (userId: string): Promise<number> => {
  return db.pendingChatMessages.where('userId').equals(userId).count();
};
