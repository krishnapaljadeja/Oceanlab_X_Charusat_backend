import {
  AnalysisSummary,
  GeneratedNarrative,
  RepoMeta,
} from "../types";
import { RetrievedChunk } from "./ragService";

interface BuildOnboardingPromptInput {
  repoMeta: RepoMeta;
  summary: AnalysisSummary;
  narrative: GeneratedNarrative;
  digest: {
    summary: string;
    tree: string;
  };
  roleHint?: string;
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

export function buildOnboardingPrompt(
  input: BuildOnboardingPromptInput,
  retrievedChunks: RetrievedChunk[] = [],
): string {
  const { repoMeta, summary, narrative, digest, roleHint } = input;

  const compactData = {
    repoMeta: {
      fullName: repoMeta.fullName,
      description: repoMeta.description,
      language: repoMeta.language,
      stars: repoMeta.stars,
      topics: repoMeta.topics,
      createdAt: repoMeta.createdAt,
    },
    summary: {
      totalCommitsInRepo: summary.totalCommitsInRepo,
      dateRange: summary.dateRange,
      commitQualityScore: summary.commitQualityScore,
      commitTypeBreakdown: summary.commitTypeBreakdown,
      dataConfidenceLevel: summary.dataConfidenceLevel,
      topContributors: summary.topContributors.slice(0, 8).map((c) => ({
        name: c.name,
        login: c.login,
        commitCount: c.commitCount,
        primaryAreas: c.primaryAreas.slice(0, 3),
        firstCommitDate: c.firstCommitDate,
        lastCommitDate: c.lastCommitDate,
      })),
      phases: summary.phases.slice(-4).map((p) => ({
        label: p.label,
        startDate: p.startDate,
        endDate: p.endDate,
        commitCount: p.commitCount,
        velocity: p.velocity,
        dominantType: p.dominantType,
        keyFiles: p.keyFiles.slice(0, 5),
        contributors: p.contributors.slice(0, 4),
      })),
      milestones: summary.milestones.slice(-6).map((m) => ({
        date: m.date,
        title: m.title,
        type: m.type,
      })),
    },
    narrative: {
      projectOverview: narrative.projectOverview,
      currentState: narrative.currentState,
      architecturalObservations: narrative.architecturalObservations,
    },
    digest: {
      summary: digest.summary,
      tree: clipText(digest.tree, 3000),
    },
  };

  const roleLine = roleHint?.trim()
    ? `Personalization role hint from user: ${roleHint.trim()}`
    : "Personalization role hint from user: none provided";

  const ragBlock = retrievedChunks.length
    ? `RELEVANT CONTEXT (retrieved from commit history):\n${retrievedChunks
        .map((chunk) => `[${chunk.chunkType}] ${chunk.chunkText}`)
        .join("\n")}`
    : "RELEVANT CONTEXT (retrieved from commit history):\nNo retrieved chunks available.";

  return `You are generating a repository onboarding guide for a new contributor.

${roleLine}

${ragBlock}

Use ONLY the structured data below as source of truth:
${JSON.stringify(compactData, null, 2)}

Output requirements:
- Return only markdown, with no code fences and no preamble.
- Ground everything strictly in the provided data.
- Do not invent file names, directories, contributors, milestones, or workflows.
- If some detail is unavailable, state it briefly without inventing.
- Keep writing concise, practical, and action-oriented.

Return exactly these sections in this exact order:
1. # Onboarding guide: {repo full name}
2. A one-sentence blockquote tagline
3. ## What this project is
4. ## How the codebase is organised
5. ## Where to start reading
6. ## Who to talk to about what
7. ## How the team works
8. ## What is actively being worked on
9. ## Things to know before you start

Section instructions:
- "What this project is": 2-3 sentences covering purpose, primary language, and development history.
- "How the codebase is organised": bullet list of top-level directories from file tree and one short description each.
- "Where to start reading": 3-7 specific files/directories frequently touched in recent phases and why each matters.
- "Who to talk to about what": up to 6 contributors using @login, commit count, and ownership areas.
- "How the team works": 2-3 sentences about commit conventions, velocity, and dominant work types.
- "What is actively being worked on": infer from most recent phase plus recent milestones.
- "Things to know before you start": 3-5 bullets from architectural observations and milestone history.`;
}
