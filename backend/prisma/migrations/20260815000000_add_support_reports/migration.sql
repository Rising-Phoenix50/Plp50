-- CreateTable
CREATE TABLE "SupportReport" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "repEmail" TEXT,
    "email" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportReport_orderId_idx" ON "SupportReport"("orderId");

-- CreateIndex
CREATE INDEX "SupportReport_createdAt_idx" ON "SupportReport"("createdAt");

-- AddForeignKey
ALTER TABLE "SupportReport"
ADD CONSTRAINT "SupportReport_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
