import { prisma } from "./client";

export interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function createAuthUser(
  id: string,
  email: string,
  passwordHash: string,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO app_users (id, email, password_hash, email_verified)
    VALUES (${id}, ${email}, ${passwordHash}, false)
  `;
}

export async function findAuthUserByEmail(
  email: string,
): Promise<AuthUserRecord | null> {
  const rows = await prisma.$queryRaw<AuthUserRecord[]>`
    SELECT
      id,
      email,
      password_hash AS "passwordHash",
      email_verified AS "emailVerified",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app_users
    WHERE email = ${email}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function findAuthUserById(
  id: string,
): Promise<AuthUserRecord | null> {
  const rows = await prisma.$queryRaw<AuthUserRecord[]>`
    SELECT
      id,
      email,
      password_hash AS "passwordHash",
      email_verified AS "emailVerified",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM app_users
    WHERE id = ${id}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

export async function markAuthUserEmailVerified(id: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE app_users
    SET email_verified = true,
        updated_at = NOW()
    WHERE id = ${id}
  `;
}
