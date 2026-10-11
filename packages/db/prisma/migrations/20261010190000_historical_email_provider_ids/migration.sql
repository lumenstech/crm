ALTER TABLE "emailThread"
ADD COLUMN "provider" TEXT,
ADD COLUMN "mailbox" TEXT,
ADD COLUMN "providerThreadId" TEXT;

CREATE UNIQUE INDEX "emailThread_provider_mailbox_providerThreadId_key"
ON "emailThread"("provider", "mailbox", "providerThreadId");
