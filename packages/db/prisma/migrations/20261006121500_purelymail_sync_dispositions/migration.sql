CREATE TABLE "mailboxSyncDisposition" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rfcMessageId" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "uidValidity" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "candidateIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailboxSyncDisposition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mailboxSyncDisposition_source_rfcMessageId_key" ON "mailboxSyncDisposition"("source", "rfcMessageId");
CREATE INDEX "mailboxSyncDisposition_userId_source_idx" ON "mailboxSyncDisposition"("userId", "source");
