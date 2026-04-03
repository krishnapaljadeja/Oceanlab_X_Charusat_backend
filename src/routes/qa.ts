import { Router, Request, Response, NextFunction } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getStoredAnalysis } from "../db/queries";
import {
  RepoMeta,
  AnalysisSummary,
  GeneratedNarrative,
  QARequest,
  QAResponse,
} from "../types";

interface OllamaApiResponse {
  message: {
    content: string;
  };
}

async function callLLM(prompt: string): Promise<string> {
  const provider = process.env.LLM_PROVIDER || "gemini";

  if (provider === "gemini") {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  if (provider === "ollama") {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const ollamaModel = process.env.OLLAMA_MODEL || "llama3.1";

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error("QA_GENERATION_FAILED");
    }

    const data = (await response.json()) as OllamaApiResponse;

    if (!data?.message?.content) {
      throw new Error("QA_GENERATION_FAILED");
    }

    return data.message.content;
  }

  throw new Error("QA_GENERATION_FAILED");
}

export const qaRouter = Router();

qaRouter.post(
  "/qa",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
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

      const stored = await getStoredAnalysis(owner, repo);
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

      const contextData = {
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

      const recentHistory = history.slice(-5);
      const conversationHistory = recentHistory
        .map((msg) =>
          msg.role === "user"
            ? `User: ${msg.content}`
            : `Assistant: ${msg.content}`,
        )
        .join("\n");

      const prompt = `You are an expert analyst for the GitHub repository "${repoMeta.fullName}". You have access to a complete analysis of this repository's commit history.

REPOSITORY ANALYSIS DATA:
${JSON.stringify(contextData, null, 2)}

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
        llmResponse = await callLLM(prompt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
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
