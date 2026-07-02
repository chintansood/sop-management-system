import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * Prisma 7 requires every PrismaClient to be constructed with an explicit
 * driver adapter (see prisma/seed.ts for the original explanation of why).
 *
 * Rather than repeat that adapter setup in every controller/service file
 * that needs database access, we build ONE client here and import it
 * everywhere else. This also avoids a real problem: creating multiple
 * PrismaClient instances in one running app opens multiple separate
 * database connection pools, which wastes connections and can hit
 * Postgres's connection limit under load.
 * ─────────────────────────────────────────────────────────────────────────
 */

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });