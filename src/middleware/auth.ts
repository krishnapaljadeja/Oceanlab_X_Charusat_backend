import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? "";

const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

export interface AuthenticatedRequest extends Request {
  authUserId?: string;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    if (!supabase) {
      throw new Error("AUTH_CONFIG_MISSING");
    }

    const header = req.header("authorization");
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      throw new Error("AUTH_REQUIRED");
    }

    const token = header.slice(7).trim();
    if (!token) {
      throw new Error("AUTH_REQUIRED");
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      throw new Error("AUTH_INVALID");
    }

    req.authUserId = data.user.id;
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