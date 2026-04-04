import { Router, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  AuthenticatedRequest,
  requireAuth,
  signAuthToken,
  verifyEmailVerificationToken,
} from "../middleware/auth";
import {
  createAuthUser,
  findAuthUserByEmail,
  findAuthUserById,
  markAuthUserEmailVerified,
} from "../db/authQueries";

export const authRouter = Router();

function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || "http://localhost:5173";
}

function getBackendUrl(req: AuthenticatedRequest): string {
  return process.env.BACKEND_URL || `${req.protocol}://${req.get("host")}`;
}

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

authRouter.post(
  "/auth/signup",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body as {
        email?: string;
        password?: string;
      };

      if (!email || !password) {
        throw new Error("AUTH_INVALID_INPUT");
      }

      const normalizedEmail = normalizeEmail(email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error("AUTH_INVALID_INPUT");
      }
      if (password.length < 6) {
        throw new Error("AUTH_WEAK_PASSWORD");
      }

      const existing = await findAuthUserByEmail(normalizedEmail);
      if (existing) {
        throw new Error("AUTH_EMAIL_IN_USE");
      }

      const id = randomUUID();
      const passwordHash = await bcrypt.hash(password, 10);
      await createAuthUser(id, normalizedEmail, passwordHash);
      await markAuthUserEmailVerified(id);

      const token = signAuthToken({ sub: id, email: normalizedEmail });

      return res.json({
        success: true,
        session: {
          accessToken: token,
          user: {
            id,
            email: normalizedEmail,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post(
  "/auth/login",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body as {
        email?: string;
        password?: string;
      };

      if (!email || !password) {
        throw new Error("AUTH_INVALID_INPUT");
      }

      const normalizedEmail = normalizeEmail(email);
      const user = await findAuthUserByEmail(normalizedEmail);
      if (!user) {
        throw new Error("AUTH_INVALID_CREDENTIALS");
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        throw new Error("AUTH_INVALID_CREDENTIALS");
      }

      const token = signAuthToken({ sub: user.id, email: user.email });

      return res.json({
        success: true,
        session: {
          accessToken: token,
          user: {
            id: user.id,
            email: user.email,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

authRouter.get(
  "/auth/verify-email",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const redirect =
        typeof req.query.redirect === "string"
          ? req.query.redirect
          : `${getFrontendUrl()}/login`;

      if (!token) {
        throw new Error("AUTH_VERIFY_INVALID");
      }

      const payload = verifyEmailVerificationToken(token);
      const user = await findAuthUserById(payload.sub);
      if (!user || user.email !== payload.email) {
        throw new Error("AUTH_VERIFY_INVALID");
      }

      if (!user.emailVerified) {
        await markAuthUserEmailVerified(user.id);
      }

      const accessToken = signAuthToken({
        sub: user.id,
        email: user.email,
      });
      const target = new URL(redirect);
      target.searchParams.set("email_verified", "true");
      target.searchParams.set("access_token", accessToken);

      return res.redirect(target.toString());
    } catch (err) {
      if (err instanceof Error && err.message === "AUTH_VERIFY_INVALID") {
        const fallback = new URL(`${getFrontendUrl()}/login`);
        fallback.searchParams.set("verification", "failed");
        return res.redirect(fallback.toString());
      }
      return next(err);
    }
  },
);

authRouter.post("/auth/logout", (_req: AuthenticatedRequest, res: Response) => {
  return res.json({ success: true });
});

authRouter.get(
  "/auth/me",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.authUserId) {
        throw new Error("AUTH_REQUIRED");
      }
      const user = await findAuthUserById(req.authUserId);
      if (!user) {
        throw new Error("AUTH_INVALID");
      }

      return res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);
