import { PrismaClient } from "@prisma/client";
import { makeAuditHook } from "./audit-core";

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma sizes its pool from the CPU count (2 × CPUs + 1). On a small hosted instance that can be
// as low as 3 connections, which would queue the ~10–15 queries a screen runs in parallel.
// A fixed pool of 10 keeps them parallel and stays far below Neon's connection limit.
function datasourceUrl() {
  const url = process.env.DATABASE_URL;
  if (!url || /[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connection_limit=10&pool_timeout=20`;
}

function build(): PrismaClient {
  const base = new PrismaClient({ datasourceUrl: datasourceUrl() });
  // #4 Audit trail: material writes are recorded automatically (see audit-core.ts).
  const audit = makeAuditHook(base);
  const ext = base.$extends({ query: { $allModels: { $allOperations: audit.hook } } });
  // Rows from a transaction are written only once it commits (a rolled-back change leaves no record).
  // The extension only adds behavior, not types, so the client keeps its normal PrismaClient type.
  const tx = ext.$transaction.bind(ext) as (...a: unknown[]) => Promise<unknown>;
  return new Proxy(ext, {
    get(target, prop, receiver) {
      if (prop === "$transaction") return (...a: unknown[]) => audit.inTx(() => tx(...a));
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as PrismaClient;
}

export const db = globalForPrisma.prisma ?? build();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
