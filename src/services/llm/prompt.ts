import { AnalysisSummary, GeneratedNarrative } from "../../types";

export function buildPrompt(summary: AnalysisSummary): string {
  const phaseSummaries = summary.phases.map((p) => ({
    label: p.label,
    period: `${p.startDate.substring(0, 10)} to ${p.endDate.substring(0, 10)}`,
    commitCount: p.commitCount,
    velocity: p.velocity,
    dominantActivity: p.dominantType,
    keyFiles: p.keyFiles,
    contributors: p.contributors.slice(0, 5),
  }));

  const contributorSummaries = summary.topContributors.slice(0, 5).map((c) => ({
    name: c.name,
    commits: c.commitCount,
    primaryAreas: c.primaryAreas,
    activeFrom: c.firstCommitDate?.substring(0, 10),
    activeTo: c.lastCommitDate?.substring(0, 10),
  }));

  const data = {
    repository: {
      name: summary.repoMeta.fullName,
      description: summary.repoMeta.description,
      primaryLanguage: summary.repoMeta.language,
      createdAt: summary.repoMeta.createdAt?.substring(0, 10),
      stars: summary.repoMeta.stars,
      topics: summary.repoMeta.topics,
    },
    commitStats: {
      total: summary.totalCommitsInRepo,
      analyzed: summary.analyzedCommitCount,
      isCapped: summary.isCapped,
      dateRange: summary.dateRange,
      qualityScore: summary.commitQualityScore,
      typeBreakdown: summary.commitTypeBreakdown,
    },
    phases: phaseSummaries,
    milestones: summary.milestones.map((m) => ({
      date: m.date.substring(0, 10),
      title: m.title,
      type: m.type,
      significance: m.significance,
    })),
    contributors: contributorSummaries,
    tags: summary.tags.slice(0, 10),
  };

  return `You are a technical writer analyzing a software project's Git history. Your task is to generate a structured, documentary-style narrative about how this project evolved over time.

CRITICAL RULES:
1. Base your narrative STRICTLY on the data provided. Do not invent events, decisions, or technical details not evidenced in the data.
2. If commit message quality is low (qualityScore below 40), acknowledge this and note that the narrative is based primarily on structural signals.
3. Be specific and technical — mention actual file names, phases, and dates where relevant.
4. Write in past tense, third person, as if narrating a documentary.
5. Return ONLY valid JSON. No markdown, no preamble, no backticks.

REPOSITORY DATA:
${JSON.stringify(data, null, 2)}

Return a JSON object with EXACTLY this structure:
{
  "projectOverview": "2-3 sentence overview of what this project is and its development journey",
  "narrativeChapters": [
    {
      "title": "chapter title",
      "period": "date range",
      "story": "2-4 paragraph narrative of this development phase",
      "keyEvents": ["list of 3-5 specific events or observations from this phase"]
    }
  ],
  "milestoneHighlights": [
    {
      "date": "YYYY-MM-DD",
      "title": "milestone name",
      "significance": "one sentence explaining why this matters"
    }
  ],
  "contributorInsights": "2-3 paragraphs separated by \\n\\n about team dynamics and contributor patterns",
  "architecturalObservations": "1-2 paragraphs separated by \\n\\n about structural or architectural shifts observed in the history",
  "currentState": "1-2 paragraphs separated by \\n\\n summarizing the current state of the repository based on recent activity",
  "dataConfidenceNote": "one sentence noting the reliability of this narrative based on data quality"
}`;
}

export function parseResponse(rawText: string): GeneratedNarrative {
  // Strip any accidental markdown code fences
  const clean = rawText.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(clean) as GeneratedNarrative;
    return parsed;
  } catch {
    throw new Error("NARRATIVE_PARSE_FAILED");
  }
}
