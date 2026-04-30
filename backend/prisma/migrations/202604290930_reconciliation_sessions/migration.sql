DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReconciliationChannel') THEN
    CREATE TYPE "ReconciliationChannel" AS ENUM ('cash', 'momo');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ReconciliationSession" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "channel" "ReconciliationChannel" NOT NULL,
  "asOf" TIMESTAMP(3) NOT NULL,
  "bookBalance" DOUBLE PRECISION NOT NULL,
  "countedBalance" DOUBLE PRECISION NOT NULL,
  "variance" DOUBLE PRECISION NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ReconciliationSession_businessId_channel_asOf_idx"
  ON "ReconciliationSession"("businessId", "channel", "asOf");

CREATE INDEX IF NOT EXISTS "ReconciliationSession_createdByUserId_idx"
  ON "ReconciliationSession"("createdByUserId");
