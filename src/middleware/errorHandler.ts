import { Request, Response, NextFunction } from "express";
import { ErrorResponse } from "../types";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const errorMap: Record<
    string,
    { status: number; message: string; code: string }
  > = {
    INVALID_URL: {
      status: 400,
      message:
        "Please enter a valid GitHub repository URL (e.g. https://github.com/owner/repo)",
      code: "INVALID_URL",
    },
    REPO_NOT_FOUND: {
      status: 404,
      message: "Repository not found. Make sure it exists and is public.",
      code: "REPO_NOT_FOUND",
    },
    BAD_TOKEN: {
      status: 401,
      message:
        "GitHub API token is invalid or missing. Check your server configuration.",
      code: "BAD_TOKEN",
    },
    RATE_LIMITED: {
      status: 429,
      message:
        "GitHub API rate limit reached. Please wait a few minutes and try again.",
      code: "RATE_LIMITED",
    },
    TOO_FEW_COMMITS: {
      status: 400,
      message:
        "This repository has too few commits for a meaningful analysis. At least 10 commits are required.",
      code: "TOO_FEW_COMMITS",
    },
    AUTH_REQUIRED: {
      status: 401,
      message: "Please login to continue.",
      code: "AUTH_REQUIRED",
    },
    AUTH_INVALID: {
      status: 401,
      message: "Your login session is invalid or expired. Please login again.",
      code: "AUTH_INVALID",
    },
    AUTH_CONFIG_MISSING: {
      status: 500,
      message:
        "Server authentication is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.",
      code: "AUTH_CONFIG_MISSING",
    },
    NARRATIVE_PARSE_FAILED: {
      status: 500,
      message: "Story generation encountered an issue. Please try again.",
      code: "NARRATIVE_PARSE_FAILED",
    },
    GEMINI_QUOTA_EXCEEDED: {
      status: 429,
      message:
        "AI story generation quota exceeded. Please wait a few minutes and try again, or check your Gemini API plan.",
      code: "GEMINI_QUOTA_EXCEEDED",
    },
    GEMINI_BAD_KEY: {
      status: 401,
      message:
        "Gemini API key is invalid or not authorized. Check your server configuration.",
      code: "GEMINI_BAD_KEY",
    },
    GEMINI_UNAVAILABLE: {
      status: 503,
      message:
        "AI story generation service is temporarily unavailable. Please try again later.",
      code: "GEMINI_UNAVAILABLE",
    },
  };

  const mapped = errorMap[err.message];
  const status = mapped?.status || 500;
  const body: ErrorResponse = {
    success: false,
    error: mapped?.message || "An unexpected error occurred. Please try again.",
    code: mapped?.code || "INTERNAL_ERROR",
  };

  console.error(
    `[Error] type=${err?.constructor?.name} message=${err.message}`,
  );
  console.error(err.stack);
  res.status(status).json(body);
}
