import { CommitDetail, ContributorProfile, RawCommit } from "../types";
import { generateText } from "./llm";

type ImpactLabel = "Critical" | "High" | "Medium" | "Low";

function safeMessage(commit: RawCommit): string {
  return commit.commit.message.split("\n")[0]?.trim() || "No commit message";
}

function getFiles(commit: RawCommit): string[] {
  return (commit.files || []).map((file) => file.filename);
}

function getLinesAdded(commit: RawCommit): number {
  return commit.stats?.additions ?? 0;
}

function getLinesDeleted(commit: RawCommit): number {
  return commit.stats?.deletions ?? 0;
}

function getFilesChanged(commit: RawCommit): number {
  return commit.files?.length ?? 0;
}

function getMonthLabel(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function getDirCandidates(filePath: string): string[] {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length === 1) return [parts[0]];
  return [parts[0], `${parts[0]}/${parts[1]}`];
}

function mapSpecialization(area: string): string {
  const normalized = area.toLowerCase();
  if (
    normalized.includes("src/api") ||
    normalized.includes("routes") ||
    normalized.includes("controllers")
  ) {
    return "API Layer";
  }
  if (
    normalized.includes("src/components") ||
    normalized.includes("ui") ||
    normalized.includes("views")
  ) {
    return "UI Components";
  }
  if (
    normalized.includes("prisma") ||
    normalized.includes("migrations") ||
    normalized.includes("db")
  ) {
    return "Database";
  }
  if (normalized.includes("src/services")) {
    return "Business Logic";
  }
  if (
    normalized.includes("__tests__") ||
    normalized.includes("spec") ||
    normalized.includes("test")
  ) {
    return "Testing";
  }
  if (normalized.includes("src/middleware")) {
    return "Middleware";
  }
  if (
    normalized.includes(".github") ||
    normalized.includes("ci") ||
    normalized.includes("docker")
  ) {
    return "DevOps";
  }
  return area;
}

export function computeImpactScore(commit: RawCommit): number {
  const linesAdded = getLinesAdded(commit);
  const linesDeleted = getLinesDeleted(commit);
  const filesChanged = getFilesChanged(commit);

  const sizeScore = (linesAdded + linesDeleted) * 0.4;
  const fileScore = filesChanged * 10 * 0.3;

  const msg = safeMessage(commit).toLowerCase();
  let keywordScore = 0;
  if (/feat|feature|implement|add|build|create|introduce/.test(msg)) {
    keywordScore += 30;
  } else if (/fix|resolve|patch|correct|repair/.test(msg)) {
    keywordScore += 20;
  } else if (/refactor|optimize|improve|enhance|migrate/.test(msg)) {
    keywordScore += 15;
  } else if (/update|upgrade|bump/.test(msg)) {
    keywordScore += 10;
  }

  if (/typo|formatting|lint|whitespace|style/.test(msg)) {
    keywordScore -= 10;
  }

  const rawScore = Math.max(0, sizeScore + fileScore + keywordScore * 0.3);
  return Math.min(100, rawScore);
}

export function getImpactLabel(score: number): ImpactLabel {
  if (score >= 80) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}

function parseSummaryArray(raw: string, expected: number): string[] {
  const clean = raw.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(clean) as string[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, expected).map((item) => String(item || "").trim());
  } catch {
    return [];
  }
}

async function buildCommitSummaries(
  commits: CommitDetail[],
): Promise<string[]> {
  const batchSize = 20;
  const results: string[] = new Array(commits.length).fill("");

  for (let i = 0; i < commits.length; i += batchSize) {
    const batch = commits.slice(i, i + batchSize);
    const prompt = `You are summarizing git commits for engineering impact review.\n\nFor each commit below, write one concise sentence describing the practical impact.\nKeep each sentence factual and specific.\nReturn ONLY a JSON array of strings in the same order.\n\nCommits:\n${batch
      .map(
        (commit, idx) =>
          `${idx + 1}. ${commit.sha}: ${commit.message} | files=${commit.filesChanged} | +${commit.linesAdded}/-${commit.linesDeleted} | label=${commit.impactLabel}`,
      )
      .join("\n")}`;

    try {
      const text = await generateText(prompt);
      const parsed = parseSummaryArray(text, batch.length);
      batch.forEach((commit, idx) => {
        results[i + idx] =
          parsed[idx] ||
          `Touches ${commit.filesChanged} files with ${commit.impactLabel.toLowerCase()} impact.`;
      });
    } catch {
      batch.forEach((commit, idx) => {
        results[i + idx] =
          `Touches ${commit.filesChanged} files with ${commit.impactLabel.toLowerCase()} impact.`;
      });
    }
  }

  return results;
}

async function buildContributorSummary(
  login: string,
  topCommits: CommitDetail[],
  primaryWorkAreas: string[],
  specializations: string[],
): Promise<string> {
  const prompt = `You are writing a concise contributor profile.\n\nContributor: ${login}\nPrimary work areas: ${primaryWorkAreas.join(", ") || "Unknown"}\nSpecializations: ${specializations.join(", ") || "Unknown"}\n\nTop commits by impact:\n${topCommits
    .map(
      (commit) =>
        `- ${commit.sha} (${commit.impactScore.toFixed(1)}): ${commit.message}`,
    )
    .join(
      "\n",
    )}\n\nWrite 3-4 sentences describing this contributor's impact and strengths.\nReturn plain text only.`;

  try {
    const text = await generateText(prompt);
    return text.trim() || "Contributor impact summary unavailable.";
  } catch {
    return "Contributor impact summary unavailable.";
  }
}

export async function buildContributorProfile(
  login: string,
  commits: RawCommit[],
  avatarUrl: string,
): Promise<ContributorProfile> {
  const sorted = [...commits].sort(
    (a, b) =>
      new Date(b.commit.author.date).getTime() -
      new Date(a.commit.author.date).getTime(),
  );

  const commitDetails: CommitDetail[] = sorted.map((commit) => {
    const impactScore = computeImpactScore(commit);
    return {
      sha: commit.sha,
      message: safeMessage(commit),
      date: commit.commit.author.date,
      filesChanged: getFilesChanged(commit),
      linesAdded: getLinesAdded(commit),
      linesDeleted: getLinesDeleted(commit),
      impactScore: Math.round(impactScore * 10) / 10,
      impactLabel: getImpactLabel(impactScore),
      aiImpactSummary: "",
      filesAffected: getFiles(commit),
    };
  });

  const aiImpactSummaries = await buildCommitSummaries(commitDetails);
  const commitsWithSummary = commitDetails.map((commit, idx) => ({
    ...commit,
    aiImpactSummary: aiImpactSummaries[idx] || "No summary available.",
  }));

  const totalCommits = commitsWithSummary.length;
  const totalLinesAdded = commitsWithSummary.reduce(
    (sum, c) => sum + c.linesAdded,
    0,
  );
  const totalLinesDeleted = commitsWithSummary.reduce(
    (sum, c) => sum + c.linesDeleted,
    0,
  );
  const totalFilesChanged = commitsWithSummary.reduce(
    (sum, c) => sum + c.filesChanged,
    0,
  );
  const overallImpactScore =
    totalCommits === 0
      ? 0
      : Math.round(
          (commitsWithSummary.reduce((sum, c) => sum + c.impactScore, 0) /
            totalCommits) *
            10,
        ) / 10;

  const dirCounts: Record<string, number> = {};
  for (const commit of commitsWithSummary) {
    const touchedDirs = new Set<string>();
    for (const filePath of commit.filesAffected) {
      getDirCandidates(filePath).forEach((dir) => touchedDirs.add(dir));
    }
    touchedDirs.forEach((dir) => {
      dirCounts[dir] = (dirCounts[dir] || 0) + 1;
    });
  }

  const primaryWorkAreas = Object.entries(dirCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([dir]) => dir);

  const specializations = [...new Set(primaryWorkAreas.map(mapSpecialization))];

  const monthCounts: Record<string, number> = {};
  for (const commit of commitsWithSummary) {
    const key = commit.date.slice(0, 7);
    monthCounts[key] = (monthCounts[key] || 0) + 1;
  }

  const peakMonth = Object.entries(monthCounts).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  const peakActivityPeriod = peakMonth
    ? getMonthLabel(`${peakMonth}-01T00:00:00Z`)
    : "Unknown";

  const allDates = commitsWithSummary
    .map((commit) => commit.date)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

  const firstCommitDate = allDates[0] || "";
  const lastCommitDate = allDates[allDates.length - 1] || "";

  const firstMs = firstCommitDate
    ? new Date(firstCommitDate).getTime()
    : Date.now();
  const lastMs = lastCommitDate
    ? new Date(lastCommitDate).getTime()
    : Date.now();
  const weekSpan = Math.max(1, (lastMs - firstMs) / (1000 * 60 * 60 * 24 * 7));
  const weeklyRate = totalCommits / weekSpan;
  const commitFrequency = `avg ${weeklyRate.toFixed(1)} commits/week`;

  const topCommits = [...commitsWithSummary]
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 10);

  const aiContributorSummary = await buildContributorSummary(
    login,
    topCommits,
    primaryWorkAreas,
    specializations,
  );

  return {
    login,
    avatarUrl,
    totalCommits,
    totalLinesAdded,
    totalLinesDeleted,
    totalFilesChanged,
    overallImpactScore,
    primaryWorkAreas,
    specializations,
    peakActivityPeriod,
    firstCommitDate,
    lastCommitDate,
    commitFrequency,
    aiContributorSummary,
    commits: commitsWithSummary,
  };
}
