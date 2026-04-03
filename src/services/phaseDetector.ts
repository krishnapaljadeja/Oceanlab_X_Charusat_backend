import { ProcessedCommit, DevelopmentPhase, CommitType } from "../types";

type PhaseLabel = DevelopmentPhase["label"];

function dominantType(breakdown: Record<CommitType, number>): CommitType {
  return Object.entries(breakdown).sort(
    (a, b) => b[1] - a[1],
  )[0][0] as CommitType;
}

function labelFromDominant(
  type: CommitType,
  index: number,
  totalPhases: number,
  commitCount: number,
  totalCommits: number,
): PhaseLabel {
  if (index === 0 && commitCount / totalCommits < 0.15) return "Initial Setup";
  if (index === totalPhases - 1) return "Maintenance";
  switch (type) {
    case "feat":
      return "Feature Development";
    case "fix":
      return "Bug Fix & Stabilization";
    case "refactor":
      return "Refactoring";
    case "infra":
      return "Infrastructure & DevOps";
    case "deps":
      return "Maintenance";
    default:
      return "Feature Development";
  }
}

function getVelocity(
  commitCount: number,
  daySpan: number,
): DevelopmentPhase["velocity"] {
  const perDay = commitCount / Math.max(daySpan, 1);
  if (perDay >= 2) return "high";
  if (perDay >= 0.5) return "medium";
  return "low";
}

export function detectPhases(commits: ProcessedCommit[]): DevelopmentPhase[] {
  if (commits.length === 0) return [];

  // Sort chronologically
  const sorted = [...commits].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // Split into time windows — group by month
  const monthBuckets: Map<string, ProcessedCommit[]> = new Map();
  sorted.forEach((commit) => {
    const key = commit.date.substring(0, 7); // "YYYY-MM"
    if (!monthBuckets.has(key)) monthBuckets.set(key, []);
    monthBuckets.get(key)!.push(commit);
  });

  const buckets = Array.from(monthBuckets.values());

  // Build raw phases from buckets
  const rawPhases: DevelopmentPhase[] = buckets.map((bucket, i) => {
    const breakdown: Record<CommitType, number> = {
      feat: 0,
      fix: 0,
      refactor: 0,
      infra: 0,
      test: 0,
      docs: 0,
      deps: 0,
      unknown: 0,
    };
    bucket.forEach((c) => {
      breakdown[c.type]++;
    });

    const dominant = dominantType(breakdown);
    const startDate = bucket[0].date;
    const endDate = bucket[bucket.length - 1].date;
    const daySpan =
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000;

    const allFiles = bucket.flatMap((c) => c.changedFilenames);
    const fileCounts: Record<string, number> = {};
    allFiles.forEach((f) => {
      fileCounts[f] = (fileCounts[f] || 0) + 1;
    });
    const keyFiles = Object.entries(fileCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([f]) => f);

    const contributors = [...new Set(bucket.map((c) => c.authorLogin))];

    return {
      name: `Phase ${i + 1}`,
      label: "Feature Development" as PhaseLabel, // will be reassigned
      startDate,
      endDate,
      commitCount: bucket.length,
      dominantType: dominant,
      commitTypeBreakdown: breakdown,
      keyFiles,
      contributors,
      velocity: getVelocity(bucket.length, Math.max(daySpan, 1)),
    };
  });

  // Assign proper labels now that we know total phases
  rawPhases.forEach((phase, i) => {
    phase.label = labelFromDominant(
      phase.dominantType,
      i,
      rawPhases.length,
      phase.commitCount,
      sorted.length,
    );
    phase.name = `${phase.label} (${phase.startDate.substring(0, 7)})`;
  });

  // Keep monthly phases distinct so timeline and chapter pagination reflect
  // the full project evolution instead of collapsing many months into a few labels.
  return rawPhases;
}
