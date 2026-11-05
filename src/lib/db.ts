import { PrismaClient } from "@prisma/client";

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

export const db = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: datasourceUrl() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
