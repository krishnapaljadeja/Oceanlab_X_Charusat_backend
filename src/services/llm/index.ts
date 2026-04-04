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

function toDate(value: string): number {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function findMilestonesInRange(
  summary: AnalysisSummary,
  from: string,
  to: string,
): string[] {
  const fromTs = toDate(from);
  const toTs = toDate(to);

  return summary.milestones
    .filter((m) => {
      const ts = toDate(m.date);
      return ts >= fromTs && ts <= toTs;
    })
    .slice(0, 2)
    .map((m) => `${m.title} (${m.date.substring(0, 10)})`);
}

function normalizeNarrativeChapters(
  summary: AnalysisSummary,
  narrative: GeneratedNarrative,
): GeneratedNarrative {
  const phaseCount = summary.phases.length;
  if (phaseCount <= 0) return narrative;

  const current = narrative.narrativeChapters || [];
  if (current.length >= phaseCount) return narrative;

  const expanded = summary.phases.map((phase, index) => {
    const sourceIndex = Math.min(
      current.length - 1,
      Math.floor((index * Math.max(current.length, 1)) / phaseCount),
    );
    const source = current[sourceIndex] || current[0];
    const phasePeriod = `${phase.startDate.substring(0, 10)} to ${phase.endDate.substring(0, 10)}`;
    const milestoneEvents = findMilestonesInRange(
      summary,
      phase.startDate,
      phase.endDate,
    );

    const keyEvents = [
      `${phase.commitCount} commits with ${phase.velocity} velocity`,
      `Dominant activity: ${phase.label} (${phase.dominantType})`,
      phase.keyFiles[0]
        ? `Most touched file: ${phase.keyFiles[0]}`
        : `Primary contributors: ${phase.contributors.slice(0, 2).join(", ") || "unknown"}`,
      ...milestoneEvents,
    ].slice(0, 5);

    return {
      title:
        source?.title || `${phase.label} - ${phase.startDate.substring(0, 7)}`,
      period: phasePeriod,
      story:
        source?.story ||
        `${phase.label} activity was observed during this period with ${phase.commitCount} commits. The work pattern was ${phase.velocity} velocity and focused on ${phase.dominantType} changes.`,
      keyEvents,
    };
  });

  return {
    ...narrative,
    narrativeChapters: expanded,
  };
}

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

function buildFallbackNarrative(summary: AnalysisSummary): GeneratedNarrative {
  const chapters = summary.phases.slice(0, 6).map((phase) => ({
    title: phase.label,
    period: `${phase.startDate.substring(0, 10)} to ${phase.endDate.substring(0, 10)}`,
    story: `${phase.label} activity included ${phase.commitCount} commits with ${phase.velocity} velocity and mostly ${phase.dominantType} work.`,
    keyEvents: [
      `Dominant type: ${phase.dominantType}`,
      `Key files: ${phase.keyFiles.slice(0, 3).join(", ") || "not available"}`,
      `Contributors: ${phase.contributors.slice(0, 3).join(", ") || "not available"}`,
    ],
  }));

  return {
    projectOverview: `${summary.repoMeta.fullName} is a ${summary.repoMeta.language || "mixed-language"} project with ${summary.totalCommitsInRepo} analyzed commits.`,
    narrativeChapters: chapters,
    milestoneHighlights: summary.milestones.slice(0, 6).map((m) => ({
      date: m.date,
      title: m.title,
      significance: m.significance,
    })),
    contributorInsights:
      summary.topContributors.length > 0
        ? `Top contributors include ${summary.topContributors
            .slice(0, 3)
            .map((c) => `${c.name} (${c.commitCount} commits)`)
            .join(", ")}.`
        : "Contributor insights are limited in fallback mode.",
    architecturalObservations:
      "Automated fallback narrative generated from structured commit metadata due to temporary LLM unavailability.",
    currentState:
      summary.phases.length > 0
        ? `Most recent phase is ${summary.phases[summary.phases.length - 1].label}.`
        : "Current state is derived from limited summary data.",
    dataConfidenceNote:
      "Narrative generated in fallback mode because all configured LLM providers were unavailable for this request.",
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

  let narrative: GeneratedNarrative;
  try {
    narrative = await executeWithFallback((provider) =>
      generateNarrativeWithProvider(provider, summary),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[${nowIso()}] [LLM] Both providers unavailable; using fallback narrative. reason=${message}`,
    );
    narrative = buildFallbackNarrative(summary);
  }

  return normalizeNarrativeChapters(summary, narrative);
}

export async function generateText(prompt: string): Promise<string> {
  return executeWithFallback((provider) =>
    generateTextWithProvider(provider, prompt),
  );
}
