-- Email signatures as pictures, several per person (owner, 2026-11-26). Additive.
CREATE TABLE "MailSignature" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailSignature_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MailSignature_userId_idx" ON "MailSignature"("userId");
ALTER TABLE "MailSignature" ADD CONSTRAINT "MailSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
