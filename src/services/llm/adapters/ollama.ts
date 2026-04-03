import { AnalysisSummary, GeneratedNarrative } from "../../../types";
import { buildPrompt, parseResponse } from "../prompt";

interface OllamaApiResponse {
  message: {
    content: string;
  };
}

export async function generateWithOllama(
  summary: AnalysisSummary,
): Promise<GeneratedNarrative> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.1";
  const prompt = buildPrompt(summary);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Ollama request failed with status ${response.status}: ${errorText}`,
    );
  }

  const data = (await response.json()) as OllamaApiResponse;

  if (!data?.message?.content) {
    throw new Error("Ollama returned an empty response");
  }

  return parseResponse(data.message.content);
}
