import { GoogleGenerativeAI } from "@google/generative-ai";
import { AnalysisSummary, GeneratedNarrative } from "../../../types";
import { buildPrompt, parseResponse } from "../prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export async function generateWithGemini(
  summary: AnalysisSummary,
): Promise<GeneratedNarrative> {
  const prompt = buildPrompt(summary);

  let responseText: string;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
