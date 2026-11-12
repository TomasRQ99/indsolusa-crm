-- Línea de comunicaciones: how a registered call, email or visit ended (answered, pending reply, cancelled…).
ALTER TABLE "Activity" ADD COLUMN "outcome" TEXT;
