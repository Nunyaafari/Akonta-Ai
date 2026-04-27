-- Telegram channel support + user chat linking fields.

ALTER TYPE "ConversationChannel" ADD VALUE IF NOT EXISTS 'telegram';

ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT,
ADD COLUMN IF NOT EXISTS "telegramUsername" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramChatId_key" ON "User"("telegramChatId");
