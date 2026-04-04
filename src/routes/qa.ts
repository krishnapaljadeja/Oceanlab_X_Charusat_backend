import { Router, Request, Response, NextFunction } from "express";
import { getStoredAnalysis } from "../db/queries";
import {
  AuthenticatedRequest,
  getAuthUserId,
  requireAuth,
} from "../middleware/auth";
import {
  RepoMeta,
  AnalysisSummary,
  GeneratedNarrative,
  QARequest,
  QAResponse,
} from "../types";
import { retrieveChunks } from "../services/ragService";
import { generateText } from "../services/llm";

export const qaRouter = Router();

qaRouter.use(requireAuth);

qaRouter.post(
  "/qa",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = getAuthUserId(req);
      const body = req.body as Partial<QARequest>;
      const { owner, repo, question, history } = body;

      if (!owner || typeof owner !== "string" || !owner.trim()) {
        return res.status(400).json({
          success: false,
          error: "owner must be a non-empty string",
          code: "INVALID_REQUEST",
        });
      }

      if (!repo || typeof repo !== "string" || !repo.trim()) {
        return res.status(400).json({
          success: false,
          error: "repo must be a non-empty string",
          code: "INVALID_REQUEST",
        });
      }

      if (!question || typeof question !== "string" || !question.trim()) {
        return res.status(400).json({
          success: false,
          error: "question must be a non-empty string",
          code: "INVALID_REQUEST",
        });
      }

      if (question.length > 500) {
        return res.status(400).json({
          success: false,
          error: "question must be 500 characters or less",
          code: "INVALID_REQUEST",
        });
      }

      if (!Array.isArray(history)) {
        return res.status(400).json({
          success: false,
          error: "history must be an array",
          code: "INVALID_REQUEST",
        });
      }

      const stored = await getStoredAnalysis(userId, owner, repo);
      if (!stored) {
        return res.status(404).json({
          success: false,
          error:
            "No analysis found for this repository. Please analyze it first.",
          code: "NOT_FOUND",
        });
      }

      const repoMeta = stored.repoMeta as unknown as RepoMeta;
      const summary = stored.summary as unknown as AnalysisSummary;
      const narrative = stored.narrative as unknown as GeneratedNarrative;

      const retrieved = await retrieveChunks(userId, owner, repo, question, 12);
      const fallbackContextData = {
        repoName: repoMeta.fullName,
        description: repoMeta.description,
        language: repoMeta.language,
        totalCommits: summary.totalCommitsInRepo,
        dateRange: summary.dateRange,
        topContributors: summary.topContributors.slice(0, 5).map((c) => ({
          name: c.name,
          commits: c.commitCount,
          areas: c.primaryAreas,
        })),
        phases: summary.phases.map((p) => ({
          label: p.label,
          period: `${p.startDate.substring(0, 10)} to ${p.endDate.substring(0, 10)}`,
          commitCount: p.commitCount,
          dominantType: p.dominantType,
        })),
        milestones: summary.milestones.map((m) => ({
          date: m.date.substring(0, 10),
          title: m.title,
          type: m.type,
        })),
        commitBreakdown: summary.commitTypeBreakdown,
        narrative: {
          overview: narrative.projectOverview,
          currentState: narrative.currentState,
          architecturalObservations: narrative.architecturalObservations,
        },
      };

      const contextBlock =
        retrieved.length > 0
          ? `RELEVANT CONTEXT (retrieved from commit history):\n${retrieved
              .map((chunk) => `[${chunk.chunkType}] ${chunk.chunkText}`)
              .join("\n")}\n\nREPOSITORY OVERVIEW:\n${repoMeta.fullName}, ${repoMeta.language || "unknown language"}, ${summary.totalCommitsInRepo} commits,\n${summary.dateRange.first} to ${summary.dateRange.last}`
          : `REPOSITORY ANALYSIS DATA:\n${JSON.stringify(fallbackContextData, null, 2)}`;

      const recentHistory = history.slice(-5);
      const conversationHistory = recentHistory
        .map((msg) =>
          msg.role === "user"
            ? `User: ${msg.content}`
            : `Assistant: ${msg.content}`,
        )
        .join("\n");

      const prompt = `You are an expert analyst for the GitHub repository "${repoMeta.fullName}". You have access to a complete analysis of this repository's commit history.

${contextBlock}

CRITICAL RULES:
1. Answer ONLY based on the data provided above
2. If the data does not contain enough information to answer confidently, say so clearly — do not invent details
3. Be specific — mention actual dates, names, commit counts, file names where the data supports it
4. Keep answers concise — 2-4 sentences unless the question genuinely requires more detail
5. Write in plain English — no markdown, no bullet points, just clean prose unless a list is absolutely necessary

CONVERSATION HISTORY:
${conversationHistory || "No previous questions."}

CURRENT QUESTION: ${question}

Answer:`;

      let llmResponse: string;
      try {
        llmResponse = await generateText(prompt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("GEMINI_QUOTA_EXCEEDED") ||
          msg.includes("429") ||
          msg.toLowerCase().includes("quota")
        ) {
          return res.status(429).json({
            success: false,
            error:
              "AI answer quota is currently exceeded. Please retry in a minute.",
            code: "QA_QUOTA_EXCEEDED",
          });
        }

        if (
          msg.includes("GEMINI_UNAVAILABLE") ||
          msg.includes("OLLAMA_HTTP_") ||
          msg.toLowerCase().includes("fetch failed") ||
          msg.toLowerCase().includes("empty_response")
        ) {
          return res.status(503).json({
            success: false,
            error:
              "AI answer service is temporarily unavailable. Please try again shortly.",
            code: "QA_GENERATION_UNAVAILABLE",
          });
        }

        if (msg === "QA_GENERATION_FAILED") {
          return res.status(500).json({
            success: false,
            error: "Could not generate an answer. Please try again.",
            code: "QA_GENERATION_FAILED",
          });
        }
        throw err;
      }

      const response: QAResponse = {
        success: true,
        answer: llmResponse.trim(),
        timestamp: new Date().toISOString(),
      };

      return res.json(response);
    } catch (err) {
      next(err);
    }
  },
);
