ALTER TABLE "emailMessage"
ADD COLUMN "purelymailMessageId" TEXT;

CREATE UNIQUE INDEX "emailMessage_purelymailMessageId_key"
ON "emailMessage"("purelymailMessageId");
