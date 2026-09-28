CREATE TYPE "ExternalCashFlowType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT');

CREATE TABLE "ExternalCashFlow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "currency" TEXT NOT NULL,
    "type" "ExternalCashFlowType" NOT NULL,
    "transferGroupId" TEXT,
    "source" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalCashFlow_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExternalCashFlow_positive_amount" CHECK ("amount" > 0 AND "amount" <> 'NaN'::numeric),
    CONSTRAINT "ExternalCashFlow_transfer_group" CHECK (
        ("type" IN ('TRANSFER_IN', 'TRANSFER_OUT') AND "transferGroupId" IS NOT NULL)
        OR ("type" IN ('DEPOSIT', 'WITHDRAWAL') AND "transferGroupId" IS NULL)
    )
);

CREATE INDEX "ExternalCashFlow_userId_date_idx" ON "ExternalCashFlow"("userId", "date");
CREATE INDEX "ExternalCashFlow_userId_accountId_date_idx" ON "ExternalCashFlow"("userId", "accountId", "date");
CREATE INDEX "ExternalCashFlow_userId_transferGroupId_idx" ON "ExternalCashFlow"("userId", "transferGroupId");
CREATE UNIQUE INDEX "ExternalCashFlow_userId_transferGroupId_type_key" ON "ExternalCashFlow"("userId", "transferGroupId", "type");

ALTER TABLE "ExternalCashFlow" ADD CONSTRAINT "ExternalCashFlow_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Prevent account deletion while preserving the existing user-erasure cascade.
ALTER TABLE "ExternalCashFlow" ADD CONSTRAINT "ExternalCashFlow_accountId_userId_fkey"
    FOREIGN KEY ("accountId", "userId") REFERENCES "Account"("id", "userId")
    ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
