import { Router, Response, NextFunction } from "express";
import { getStoredAnalysis } from "../db/queries";
import {
  AuthenticatedRequest,
  getAuthUserId,
  requireAuth,
} from "../middleware/auth";
import { parseGitHubUrl } from "../utils/urlParser";
import { fetchRepoDigest } from "../utils/gitingestFetcher";
import { generateText } from "../services/llm";
import { buildOnboardingPrompt } from "../services/onboardingPrompt";
import { retrieveChunks } from "../services/ragService";
import {
  AnalysisSummary,
  GeneratedNarrative,
  OnboardingGuideRequest,
  OnboardingGuideResponse,
  RepoMeta,
} from "../types";

export const onboardRouter = Router();

onboardRouter.post(
  "/onboard",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = getAuthUserId(req);
      const body = req.body as Partial<OnboardingGuideRequest>;
      const repoUrl = body.repoUrl;
      const roleHint = body.options?.roleHint;

      if (!repoUrl || typeof repoUrl !== "string") {
        throw new Error("INVALID_URL");
      }

      const { owner, repo } = parseGitHubUrl(repoUrl);
      const stored = await getStoredAnalysis(userId, owner, repo);

      if (!stored) {
        return res.status(404).json({
          success: false,
          code: "NOT_FOUND",
          error:
            "No stored analysis found for this repository. Please call POST /api/analyze first.",
        });
      }

      const repoMeta = stored.repoMeta as unknown as RepoMeta;
      const summary = stored.summary as unknown as AnalysisSummary;
      const narrative = stored.narrative as unknown as GeneratedNarrative;

      const digest = await fetchRepoDigest(repoUrl, { maxFileSize: 1024 });
      const ragChunks = await retrieveChunks(
        userId,
        owner,
        repo,
        roleHint || "new contributor",
        15,
      );

      const prompt = buildOnboardingPrompt(
        {
          repoMeta,
          summary,
          narrative,
          digest: {
            summary: digest.summary,
            tree: digest.tree,
          },
          roleHint,
        },
        ragChunks,
      );

      const guide = (await generateText(prompt)).trim();
      const response: OnboardingGuideResponse = {
        success: true,
        guide,
        repoFullName: repoMeta.fullName,
        generatedAt: new Date().toISOString(),
        fromStoredAnalysis: true,
      };

      return res.json(response);
    } catch (err) {
      next(err);
    }
  },
);
