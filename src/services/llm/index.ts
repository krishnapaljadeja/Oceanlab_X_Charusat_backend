import { AnalysisSummary, GeneratedNarrative } from "../../types";
import { generateWithGemini } from "./adapters/gemini";
import { generateWithOllama } from "./adapters/ollama";

type LLMProvider = "gemini" | "ollama";

const SUPPORTED_PROVIDERS: LLMProvider[] = ["gemini", "ollama"];

export async function generateNarrative(
  summary: AnalysisSummary,
): Promise<GeneratedNarrative> {
  const provider = (process.env.LLM_PROVIDER || "gemini") as LLMProvider;

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(
      `Unknown LLM provider: "${provider}". Supported providers are: ${SUPPORTED_PROVIDERS.join(", ")}`,
    );
  }

  console.log(`[LLM] Using provider: ${provider}`);

  if (provider === "gemini") return generateWithGemini(summary);
  if (provider === "ollama") return generateWithOllama(summary);

  // TypeScript exhaustiveness — should never reach here
  throw new Error(`Unhandled provider: ${provider}`);
}
