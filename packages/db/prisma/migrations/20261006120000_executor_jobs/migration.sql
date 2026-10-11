CREATE TABLE "executorJob" (
    "id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "taskRef" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "sourceAccount" TEXT NOT NULL,
    "sourceEmailId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "sourceFrom" TEXT,
    "sourceSubject" TEXT,
    "sourceTo" TEXT[] NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "envelope" JSONB NOT NULL,
    "queueHash" TEXT,
    "result" JSONB,
    "receipt" JSONB,
    "resultEmailId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executorJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "executorCheckpoint" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "cursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "executorCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "executorJob_sourceAccount_sourceEmailId_key" ON "executorJob"("sourceAccount", "sourceEmailId");
CREATE UNIQUE INDEX "executorJob_resultEmailId_key" ON "executorJob"("resultEmailId");
CREATE INDEX "executorJob_status_leaseUntil_idx" ON "executorJob"("status", "leaseUntil");
CREATE INDEX "executorJob_taskRef_createdAt_idx" ON "executorJob"("taskRef", "createdAt");
CREATE UNIQUE INDEX "executorCheckpoint_provider_account_key" ON "executorCheckpoint"("provider", "account");
