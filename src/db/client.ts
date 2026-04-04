/*
 * DEVELOPER SETUP — run these before starting the server:
 *
 * 1. Install PostgreSQL and make sure it is running locally
 * 2. Create the database:
 *    psql -U postgres -c "CREATE DATABASE gitstory;"
 * 3. Set DATABASE_URL in backend/.env:
 *    DATABASE_URL="postgresql://postgres:password@localhost:5432/gitstory"
 * 4. Run Prisma migration:
 *    cd backend && npx prisma migrate dev --name init
 * 5. To view your data visually:
 *    cd backend && npx prisma studio
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function testConnection(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("[DB] Postgres connected successfully");
  } catch (error) {
    console.error("[DB] Postgres connection failed:", error);
    console.warn("[DB] Server will run without persistence");
  }
}

export async function ensureAuthTables(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    console.log("[DB] Auth tables are ready");
  } catch (error) {
    console.error("[DB] ensureAuthTables failed:", error);
  }
}
