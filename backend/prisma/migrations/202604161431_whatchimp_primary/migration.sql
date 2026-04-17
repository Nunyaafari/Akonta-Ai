-- Postgres enum values must be committed in a prior migration before use.
ALTER TABLE "AppConfig"
ALTER COLUMN "whatsappProvider" SET DEFAULT 'whatchimp';

UPDATE "AppConfig"
SET "whatsappProvider" = 'whatchimp',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'global';
