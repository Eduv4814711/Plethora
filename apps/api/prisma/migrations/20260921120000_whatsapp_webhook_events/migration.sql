-- CreateTable
CREATE TABLE IF NOT EXISTS "WhatsAppWebhookEvent" (
    "id" TEXT NOT NULL,
    "metaEventId" TEXT NOT NULL,
    "phoneNumberId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppWebhookEvent_metaEventId_key" ON "WhatsAppWebhookEvent"("metaEventId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WhatsAppWebhookEvent_receivedAt_idx" ON "WhatsAppWebhookEvent"("receivedAt");
