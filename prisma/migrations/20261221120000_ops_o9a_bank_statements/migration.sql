-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "bank" TEXT NOT NULL DEFAULT 'Bank of America',
    "last4" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sellerKey" TEXT NOT NULL DEFAULT 'USA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "rowsRead" INTEGER NOT NULL,
    "added" INTEGER NOT NULL,
    "duplicates" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "balance" DECIMAL(14,2),
    "fingerprint" TEXT NOT NULL,
    "classifiedAs" TEXT,
    "classNote" TEXT,
    "classByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankMatch" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "customerPaymentId" TEXT,
    "paymentExecutionId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankStatement_bankAccountId_idx" ON "BankStatement"("bankAccountId");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_date_idx" ON "BankTransaction"("bankAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_bankAccountId_fingerprint_key" ON "BankTransaction"("bankAccountId", "fingerprint");

-- CreateIndex
CREATE INDEX "BankMatch_transactionId_idx" ON "BankMatch"("transactionId");

-- CreateIndex
CREATE INDEX "BankMatch_customerPaymentId_idx" ON "BankMatch"("customerPaymentId");

-- CreateIndex
CREATE INDEX "BankMatch_paymentExecutionId_idx" ON "BankMatch"("paymentExecutionId");

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_customerPaymentId_fkey" FOREIGN KEY ("customerPaymentId") REFERENCES "CustomerPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankMatch" ADD CONSTRAINT "BankMatch_paymentExecutionId_fkey" FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

