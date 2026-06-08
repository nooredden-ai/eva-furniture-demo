-- CreateTable
CREATE TABLE "AccountingSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "defaultCashAccountId" TEXT,
    "defaultBankAccountId" TEXT,
    "defaultSalesAccountId" TEXT,
    "defaultPurchasesAccountId" TEXT,
    "defaultInventoryAccountId" TEXT,
    "defaultCOGSAccountId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AccountingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingSettings_companyId_key" ON "AccountingSettings"("companyId");

-- AddForeignKey
ALTER TABLE "AccountingSettings" ADD CONSTRAINT "AccountingSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
