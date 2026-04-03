import { AnalysisSummary, GeneratedNarrative } from "../../types";
import { generateWithGemini } from "./adapters/gemini";
import { generateWithOllama } from "./adapters/ollama";
import { GoogleGenerativeAI } from "@google/generative-ai";

type LLMProvider = "gemini" | "ollama";

const SUPPORTED_PROVIDERS: LLMProvider[] = ["gemini", "ollama"];

interface ProviderState {
  consecutiveFailures: number;
  lastFailureTime: number | null;
  isCircuitOpen: boolean;
  lastFailureConfigSignature: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
}

interface ProviderStatus {
  primary: LLMProvider;
  secondary: LLMProvider;
  primaryCircuitOpen: boolean;
  secondaryCircuitOpen: boolean;
  primaryFailures: number;
  secondaryFailures: number;
  primaryLastErrorCode: string | null;
  primaryLastErrorMessage: string | null;
  primaryLastFailureAt: string | null;
  secondaryLastErrorCode: string | null;
  secondaryLastErrorMessage: string | null;
  secondaryLastFailureAt: string | null;
  lastSwitchReason: string | null;
}

const providerState: Record<LLMProvider, ProviderState> = {
  gemini: {
    consecutiveFailures: 0,
    lastFailureTime: null,
    isCircuitOpen: false,
    lastFailureConfigSignature: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  },
  ollama: {
    consecutiveFailures: 0,
    lastFailureTime: null,
    isCircuitOpen: false,
    lastFailureConfigSignature: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  },
};

let lastSwitchReason: string | null = null;

const geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

function nowIso(): string {
  return new Date().toISOString();
}

function getPrimaryProvider(): LLMProvider {
  const configured = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  if (configured === "gemini" || configured === "ollama") {
    return configured;
  }
  return "gemini";
}

function getSecondaryProvider(primary: LLMProvider): LLMProvider {
  return primary === "gemini" ? "ollama" : "gemini";
}

function getMaxFailures(): number {
  const parsed = parseInt(process.env.LLM_MAX_FAILURES || "3", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function getCooldownMs(): number {
  const parsed = parseInt(process.env.LLM_COOLDOWN_MS || "300000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000;
}

function logSwitch(reason: string, activeProvider: LLMProvider): void {
  lastSwitchReason = reason;
  console.warn(
    `[${nowIso()}] [LLM] Provider switch: active=${activeProvider}; reason=${reason}`,
  );
}

function markSuccess(provider: LLMProvider): void {
  providerState[provider] = {
    consecutiveFailures: 0,
    lastFailureTime: null,
    isCircuitOpen: false,
    lastFailureConfigSignature: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
}

function getErrorDetails(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof Error) {
    const msg = error.message || "UNKNOWN_ERROR";
    const code = msg.split(":")[0].trim().slice(0, 100) || "UNKNOWN_ERROR";
    return {
      code,
      message: msg.slice(0, 300),
    };
  }

  const raw = String(error || "UNKNOWN_ERROR");
  return {
    code: raw.split(":")[0].trim().slice(0, 100) || "UNKNOWN_ERROR",
    message: raw.slice(0, 300),
  };
}

function getProviderConfigSignature(provider: LLMProvider): string {
  if (provider === "gemini") {
    const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
    const key = process.env.GEMINI_API_KEY || "";
    return `gemini:${model}:klen${key.length}:tail${key.slice(-4)}`;
  }

  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.1";
  return `ollama:${baseUrl}:${model}`;
}

function markFailure(provider: LLMProvider, error: unknown): void {
  const maxFailures = getMaxFailures();
  const prev = providerState[provider];
  const nextFailures = prev.consecutiveFailures + 1;
  const shouldOpenCircuit = nextFailures >= maxFailures;
  const errorDetails = getErrorDetails(error);

  providerState[provider] = {
    consecutiveFailures: nextFailures,
    lastFailureTime: Date.now(),
    isCircuitOpen: shouldOpenCircuit,
    lastFailureConfigSignature: getProviderConfigSignature(provider),
    lastErrorCode: errorDetails.code,
    lastErrorMessage: errorDetails.message,
  };
}

function isCooldownElapsed(provider: LLMProvider): boolean {
  const state = providerState[provider];
  if (!state.lastFailureTime) return true;
  return Date.now() - state.lastFailureTime >= getCooldownMs();
}

async function generateNarrativeWithProvider(
  provider: LLMProvider,
  summary: AnalysisSummary,
): Promise<GeneratedNarrative> {
  if (provider === "gemini") return generateWithGemini(summary);
  return generateWithOllama(summary);
}

async function generateTextWithProvider(
  provider: LLMProvider,
  prompt: string,
): Promise<string> {
  if (provider === "gemini") {
    const modelName = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
    const model = geminiClient.getGenerativeModel({
      model: modelName,
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.1";

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
    throw new Error(`OLLAMA_HTTP_${response.status}`);
  }

  const data = (await response.json()) as {
    message?: { content?: string };
  };

  const content = data?.message?.content?.trim();
  if (!content) {
    throw new Error("OLLAMA_EMPTY_RESPONSE");
  }

  return content;
}

async function executeWithFallback<T>(
  operation: (provider: LLMProvider) => Promise<T>,
): Promise<T> {
  const primary = getPrimaryProvider();
  const secondary = getSecondaryProvider(primary);
  const primaryState = providerState[primary];
  const currentPrimarySig = getProviderConfigSignature(primary);
  const configChangedSinceFailure =
    primaryState.lastFailureConfigSignature !== null &&
    primaryState.lastFailureConfigSignature !== currentPrimarySig;

  if (
    primaryState.isCircuitOpen &&
    !isCooldownElapsed(primary) &&
    !configChangedSinceFailure
  ) {
    logSwitch("primary circuit open; cooldown active", secondary);
    try {
      const secondaryResult = await operation(secondary);
      markSuccess(secondary);
      return secondaryResult;
    } catch (secondaryError) {
      markFailure(secondary, secondaryError);
      throw secondaryError;
    }
  }

  if (primaryState.isCircuitOpen) {
    if (configChangedSinceFailure) {
      logSwitch("primary config changed; early half-open probe", primary);
    } else if (isCooldownElapsed(primary)) {
      logSwitch("primary cooldown elapsed; half-open probe", primary);
    }
  }

  try {
    const primaryResult = await operation(primary);
    const wasOpen = providerState[primary].isCircuitOpen;
    markSuccess(primary);
    if (wasOpen) {
      logSwitch("half-open probe succeeded; primary circuit closed", primary);
    }
    return primaryResult;
  } catch (primaryError) {
    markFailure(primary, primaryError);
    const primaryErrorDetails = getErrorDetails(primaryError);
    const fallbackReason = `primary failed (${primaryErrorDetails.code})`;

    if (providerState[primary].isCircuitOpen) {
      logSwitch(
        `${fallbackReason}; reached failure threshold (${getMaxFailures()}); opening circuit`,
        secondary,
      );
    } else {
      logSwitch(
        `${fallbackReason}; temporary fallback to secondary`,
        secondary,
      );
    }

    try {
      const secondaryResult = await operation(secondary);
      markSuccess(secondary);
      return secondaryResult;
    } catch (secondaryError) {
      markFailure(secondary, secondaryError);
      throw secondaryError instanceof Error ? secondaryError : primaryError;
    }
  }
}

export function getLLMProviderStatus(): ProviderStatus {
  const primary = getPrimaryProvider();
  const secondary = getSecondaryProvider(primary);
  return {
    primary,
    secondary,
    primaryCircuitOpen: providerState[primary].isCircuitOpen,
    secondaryCircuitOpen: providerState[secondary].isCircuitOpen,
    primaryFailures: providerState[primary].consecutiveFailures,
    secondaryFailures: providerState[secondary].consecutiveFailures,
    primaryLastErrorCode: providerState[primary].lastErrorCode,
    primaryLastErrorMessage: providerState[primary].lastErrorMessage,
    primaryLastFailureAt: providerState[primary].lastFailureTime
      ? new Date(providerState[primary].lastFailureTime).toISOString()
      : null,
    secondaryLastErrorCode: providerState[secondary].lastErrorCode,
    secondaryLastErrorMessage: providerState[secondary].lastErrorMessage,
    secondaryLastFailureAt: providerState[secondary].lastFailureTime
      ? new Date(providerState[secondary].lastFailureTime).toISOString()
      : null,
    lastSwitchReason,
  };
}

export async function generateNarrative(
  summary: AnalysisSummary,
): Promise<GeneratedNarrative> {
  const current = getPrimaryProvider();
  if (!SUPPORTED_PROVIDERS.includes(current)) {
    throw new Error(
      `Unknown LLM provider: "${current}". Supported providers are: ${SUPPORTED_PROVIDERS.join(", ")}`,
    );
  }

  return executeWithFallback((provider) =>
    generateNarrativeWithProvider(provider, summary),
  );
}

export async function generateText(prompt: string): Promise<string> {
  return executeWithFallback((provider) =>
    generateTextWithProvider(provider, prompt),
  );
}
