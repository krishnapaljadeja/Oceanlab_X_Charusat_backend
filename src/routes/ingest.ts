import { Router, Response, NextFunction } from "express";
import {
  AuthenticatedRequest,
  getAuthUserId,
  requireAuth,
} from "../middleware/auth";
import { fetchRepoDigest } from "../utils/gitingestFetcher";
import { generateReadmeFromDigest } from "../services/readmeGenerator";

export const ingestRouter = Router();

interface IngestOptions {
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFileSize?: number;
}

function parseOptions(input: unknown): IngestOptions | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as IngestOptions;
  return {
    includePatterns: Array.isArray(raw.includePatterns)
      ? raw.includePatterns.filter((x) => typeof x === "string")
      : undefined,
    excludePatterns: Array.isArray(raw.excludePatterns)
      ? raw.excludePatterns.filter((x) => typeof x === "string")
      : undefined,
    maxFileSize:
      typeof raw.maxFileSize === "number" ? raw.maxFileSize : undefined,
  };
}

ingestRouter.post(
  "/ingest/fetch",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      getAuthUserId(req);
      const { repoUrl, options } = req.body as {
        repoUrl?: string;
        options?: IngestOptions;
      };

      if (!repoUrl || typeof repoUrl !== "string") {
        throw new Error("INVALID_URL");
      }

      const digest = await fetchRepoDigest(repoUrl, parseOptions(options));
      return res.json({ success: true, digest });
    } catch (err) {
      next(err);
    }
  },
);

ingestRouter.post(
  "/ingest/readme",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      getAuthUserId(req);
      const { repoUrl, digest } = req.body as {
        repoUrl?: string;
        digest?: { summary: string; tree: string; content: string };
      };

      if (!repoUrl || typeof repoUrl !== "string") {
        throw new Error("INVALID_URL");
      }

      const activeDigest =
        digest &&
        typeof digest.summary === "string" &&
        typeof digest.tree === "string" &&
        typeof digest.content === "string"
          ? digest
          : await fetchRepoDigest(repoUrl, {
              maxFileSize: 51200,
            });

      const readme = await generateReadmeFromDigest(repoUrl, activeDigest);
      return res.json({ success: true, readme, digest: activeDigest });
    } catch (err) {
      next(err);
    }
  },
);
