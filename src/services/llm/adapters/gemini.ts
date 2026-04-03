import { GoogleGenerativeAI } from "@google/generative-ai";
import { AnalysisSummary, GeneratedNarrative } from "../../../types";
import { buildPrompt, parseResponse } from "../prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

function getGeminiMaxOutputTokens(): number {
  const raw = process.env.GEMINI_MAX_OUTPUT_TOKENS;
  const parsed = Number.parseInt(raw || "", 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 2048;
  }

  return parsed;
}

export async function generateWithGemini(
  summary: AnalysisSummary,
): Promise<GeneratedNarrative> {
  const prompt = buildPrompt(summary);
  const modelName = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const maxOutputTokens = getGeminiMaxOutputTokens();

  let responseText: string;
  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        maxOutputTokens,
      },
    });
    const result = await model.generateContent(prompt);
    responseText = result.response.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
      throw new Error("GEMINI_QUOTA_EXCEEDED");
    }
    if (
      msg.includes("400") ||
      msg.toLowerCase().includes("api key") ||
      msg.includes("403")
    ) {
      throw new Error("GEMINI_BAD_KEY");
    }
    throw new Error("GEMINI_UNAVAILABLE");
  }

  return parseResponse(responseText);
}
