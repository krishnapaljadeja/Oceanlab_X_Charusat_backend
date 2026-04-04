import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

const AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET ?? "";
const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

export interface AuthTokenPayload {
  sub: string;
  email: string;
}

interface EmailVerificationTokenPayload extends AuthTokenPayload {
  purpose: "email_verification";
}

export function signAuthToken(payload: AuthTokenPayload): string {
  if (!AUTH_JWT_SECRET) {
    throw new Error("AUTH_CONFIG_MISSING");
  }

  const expiresIn =
    (process.env.AUTH_JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]) || "7d";

  return jwt.sign(payload, AUTH_JWT_SECRET, {
    expiresIn,
  });
}

function verifyAuthToken(token: string): AuthTokenPayload {
  if (!AUTH_JWT_SECRET) {
    throw new Error("AUTH_CONFIG_MISSING");
  }

  const decoded = jwt.verify(token, AUTH_JWT_SECRET);
  if (!decoded || typeof decoded !== "object") {
    throw new Error("AUTH_INVALID");
  }

  const payload = decoded as Partial<AuthTokenPayload>;
  if (!payload.sub || !payload.email) {
    throw new Error("AUTH_INVALID");
  }

  return {
    sub: payload.sub,
    email: payload.email,
  };
}

export interface AuthenticatedRequest extends Request {
  authUserId?: string;
  authEmail?: string;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    const header = req.header("authorization");
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      throw new Error("AUTH_REQUIRED");
    }

    const token = header.slice(7).trim();
    if (!token) {
      throw new Error("AUTH_REQUIRED");
    }

    const payload = verifyAuthToken(token);

    req.authUserId = payload.sub;
    req.authEmail = payload.email;
    next();
  } catch (error) {
    next(error);
  }
}

export function getAuthUserId(req: AuthenticatedRequest): string {
  if (!req.authUserId) {
    throw new Error("AUTH_REQUIRED");
  }
  return req.authUserId;
}

export function signEmailVerificationToken(payload: AuthTokenPayload): string {
  if (!AUTH_JWT_SECRET) {
    throw new Error("AUTH_CONFIG_MISSING");
  }

  const tokenPayload: EmailVerificationTokenPayload = {
    ...payload,
    purpose: "email_verification",
  };
  const expiresIn =
    (process.env.AUTH_VERIFY_EXPIRES_IN as jwt.SignOptions["expiresIn"]) ||
    "24h";

  return jwt.sign(tokenPayload, AUTH_JWT_SECRET, {
    expiresIn,
  });
}

export function verifyEmailVerificationToken(
  token: string,
): AuthTokenPayload {
  if (!AUTH_JWT_SECRET) {
    throw new Error("AUTH_CONFIG_MISSING");
  }

  const decoded = jwt.verify(token, AUTH_JWT_SECRET);
  if (!decoded || typeof decoded !== "object") {
    throw new Error("AUTH_VERIFY_INVALID");
  }

  const payload = decoded as Partial<EmailVerificationTokenPayload>;
  if (
    !payload.sub ||
    !payload.email ||
    payload.purpose !== "email_verification"
  ) {
    throw new Error("AUTH_VERIFY_INVALID");
  }

  return {
    sub: payload.sub,
    email: payload.email,
  };
}