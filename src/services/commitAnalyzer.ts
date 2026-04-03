import {
  RawCommit,
  RawContributor,
  ProcessedCommit,
  NormalizedContributor,
  CommitType,
} from "../types";
import { isBot } from "../utils/botFilter";

// Classify a commit message into a CommitType.
// Uses a four-tier strategy so that as few commits as possible fall through
// to "unknown":
//   1. Conventional commit prefix  (feat:, fix(scope):, chore!, …)
//   2. Leading verb / noun pattern  (most common freeform starts)
//   3. Keyword scan anywhere in the first line
//   4. Changed-file path heuristics (*.test.ts, Dockerfile, package-lock…)
function classifyCommit(message: string, filenames: string[] = []): CommitType {
  const firstLine = message.split("\n")[0].trim();
  const msg = firstLine.toLowerCase();

  // ── 1. Conventional commit prefix ──────────────────────────────────────────
  // Matches: type:, type(scope):, type!:, type(scope)!:
  const conventionalMatch = msg.match(/^(\w+)(?:\([^)]*\))?!?\s*:/);
  if (conventionalMatch) {
    const prefix = conventionalMatch[1];
    const conventionalMap: Partial<Record<string, CommitType>> = {
      feat: "feat",
      feature: "feat",
      add: "feat",
      new: "feat",
      fix: "fix",
      bug: "fix",
      hotfix: "fix",
      patch: "fix",
      revert: "fix",
      perf: "refactor",
      style: "refactor",
      refactor: "refactor",
      ref: "refactor",
      cleanup: "refactor",
      test: "test",
      tests: "test",
      spec: "test",
      docs: "docs",
      doc: "docs",
      ci: "infra",
      cd: "infra",
      build: "infra",
      deploy: "infra",
      release: "infra",
      chore: "deps",
      deps: "deps",
      dep: "deps",
      bump: "deps",
      upgrade: "deps",
    };
    if (conventionalMap[prefix]) return conventionalMap[prefix]!;
  }

  // ── 2. Leading verb / noun ──────────────────────────────────────────────────
  if (
    /^(feat|add|new|implement|introduce|create|support|enable|allow|initial commit|init\b)/.test(
      msg,
    )
  )
    return "feat";
  if (
    /^(fix|bug|patch|hotfix|resolve|repair|handle|correct|address|prevent|avoid|revert)/.test(
      msg,
    )
  )
    return "fix";
  if (
    /^(refactor|restructure|reorganize|cleanup|clean up|clean-up|rewrite|simplify|rename|move|replace|remove|extract|migrate|convert|switch|rework|improve|optimize|use|change|adjust|tweak|revamp|overhaul|deduplicate|dedup)/.test(
      msg,
    )
  )
    return "refactor";
  if (
    /^(test|spec|coverage|add test|add spec|unit test|integration test)/.test(
      msg,
    )
  )
    return "test";
  if (
    /^(docs?|readme|changelog|documentation|document|comment|annotate|license|copyright|typo)/.test(
      msg,
    )
  )
    return "docs";
  if (
    /^(ci|cd|deploy|docker|build|github actions|workflow|pipeline|release|tag\b|publish|version bump|bump version)/.test(
      msg,
    )
  )
    return "infra";
  if (
    /^(bump|upgrade|update dependencies|update deps|update packages|dependency|deps|chore|yarn|npm|pip|cargo|gemfile)/.test(
      msg,
    )
  )
    return "deps";

  // ── 3. Keyword anywhere in first line ──────────────────────────────────────
  // Order matters: more specific checks first so they win over broader ones
  if (/\b(feat|feature|implement|introduce)\b/.test(msg)) return "feat";
  if (
    /\b(fix(e[sd])?|bug|defect|regression|crash|exception|panic|issue|error)\b/.test(
      msg,
    )
  )
    return "fix";
  if (/\brevert\b/.test(msg)) return "fix";
  if (/\b(test(s|ing|ed)?|spec(s)?|coverage|assert)\b/.test(msg)) return "test";
  if (/\b(docs?|readme|changelog|documentation|docstring)\b/.test(msg))
    return "docs";
  if (
    /\b(ci|cd|dockerfile|docker|deploy(ment)?|workflow|pipeline|github.?actions?|k8s|kubernetes|helm|terraform)\b/.test(
      msg,
    )
  )
    return "infra";
  if (/\b(bump|upgrade|dependencies|dependency)\b/.test(msg)) return "deps";
  if (/\b(refactor|cleanup|restructure|reorganize|simplif|rewrite)\b/.test(msg))
    return "refactor";

  // ── 4. File-path heuristics ─────────────────────────────────────────────────
  if (filenames.length > 0) {
    const hasTestFile = filenames.some((f) =>
      /\.(test|spec)\.[jt]sx?$|__tests__|\/tests?\/|_test\.go$|_spec\.rb$/i.test(
        f,
      ),
    );
    const hasDocFile = filenames.some(
      (f) =>
        /\.(md|txt|rst|adoc)$|^docs?\//i.test(f) &&
        !/package(-lock)?\.json/i.test(f),
    );
    const hasInfraFile = filenames.some((f) =>
      /^\.github\/|dockerfile|\.ya?ml$|makefile|^\.circleci|^\.travis|jenkinsfile|^helm\/|^k8s\/|^terraform\//i.test(
        f,
      ),
    );
    const hasDepsFile = filenames.some((f) =>
      /package(-lock)?\.json$|yarn\.lock$|pnpm-lock|go\.(sum|mod)$|requirements.*\.txt$|pipfile(\.lock)?$|cargo\.(toml|lock)$|gemfile(\.lock)?$/i.test(
        f,
      ),
    );

    if (hasTestFile) return "test";
    if (hasDocFile) return "docs";
    if (hasInfraFile) return "infra";
    if (hasDepsFile) return "deps";

    // If every changed file is in the same top-level area, infer from that
    const allSrc = filenames.every((f) =>
      /^src\/|^lib\/|^app\/|^pkg\//.test(f),
    );
    if (allSrc && filenames.length <= 3) return "refactor";
  }

  return "unknown";
}

// Score commit message quality 0-10.
// Weighted heuristic to avoid score clustering and better reflect message clarity.
function scoreMessageQuality(message: string): number {
  const lines = message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstLine = (lines[0] || "").trim();
  const firstLower = firstLine.toLowerCase();

  if (!firstLine) return 0;

  // Very low quality quick exits
  if (
    /^(wip|fix|update|change|edit|misc|temp|test|asdf|\.|ok|done)$/i.test(
      firstLine,
    )
  )
    return 1;
  if (firstLine.length < 4) return 1;

  let score = 4.5; // baseline

  // Length quality band (sweet spot: informative but concise)
  if (firstLine.length < 10) score -= 2.0;
  else if (firstLine.length < 18) score -= 0.8;
  else if (firstLine.length <= 72) score += 1.4;
  else if (firstLine.length <= 100) score += 0.4;
  else score -= 1.2;

  // Signal of intent and structure
  if (/^[a-z]+(?:\([^)]*\))?!?:\s+/.test(firstLower)) score += 1.6; // conventional commit
  if (/^[a-z][a-z\s\-]+\b/.test(firstLower) && firstLine.includes(" "))
    score += 0.5;
  if (
    /\b(fix|add|remove|improve|refactor|support|prevent|handle|update|rename|optimize)\b/.test(
      firstLower,
    )
  )
    score += 0.6;
  if (/\b([A-Z]{2,}-\d+|#\d{2,})\b/.test(firstLine)) score += 0.4; // ticket refs

  // Helpful context in body
  if (lines.length > 1) score += 0.7;
  if (
    /\b(because|so that|why|impact|breaking change|migration|steps)\b/i.test(
      message,
    )
  )
    score += 0.5;

  // Penalties for noisy / low-signal messages
  if (/merge branch|merge pull request/i.test(firstLower)) score -= 1.2;
  if (/^revert\b/.test(firstLower)) score -= 0.4;
  if (/^[^a-zA-Z0-9]*$/.test(firstLine)) score -= 2.0;
  if ((firstLine.match(/[!?]{2,}/g) || []).length > 0) score -= 0.4;

  // Clamp 0-10 and keep a decimal for better repo-level variance
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

// Process raw commits into typed, classified commits
export function processCommits(
  allCommits: RawCommit[],
  detailedCommits: RawCommit[],
): ProcessedCommit[] {
  const detailedMap = new Map<string, RawCommit>();
  detailedCommits.forEach((c) => detailedMap.set(c.sha, c));

  return allCommits
    .filter((c) => !isBot(c.author?.login || "", c.commit.author.name))
    .map((c) => {
      const detailed = detailedMap.get(c.sha);
      const changedFilenames = detailed?.files?.map((f) => f.filename) || [];
      const type = classifyCommit(c.commit.message, changedFilenames);
      const quality = scoreMessageQuality(c.commit.message);

      return {
        sha: c.sha,
        shortSha: c.sha.substring(0, 7),
        message: c.commit.message.split("\n")[0].trim(),
        author: c.commit.author.name,
        authorEmail: c.commit.author.email,
        authorLogin: c.author?.login || c.commit.author.name,
        date: c.commit.author.date,
        type,
        qualityScore: quality,
        filesChanged: detailed?.files?.length || 0,
        additions: detailed?.stats?.additions || 0,
        deletions: detailed?.stats?.deletions || 0,
        changedFilenames,
        isDetailed: !!detailed?.stats,
        isMilestoneCandidate:
          quality >= 6 || (detailed?.stats?.total || 0) > 200,
      };
    });
}

// Normalize contributors — group same person across different emails
export function normalizeContributors(
  rawContributors: RawContributor[],
  processedCommits: ProcessedCommit[],
): NormalizedContributor[] {
  const contributors = rawContributors
    .filter((c) => !isBot(c.login, c.login))
    .map((contributor) => {
      const authorCommits = processedCommits.filter(
        (c) => c.authorLogin === contributor.login,
      );

      // Find top directories this person touched
      const dirCounts: Record<string, number> = {};
      authorCommits.forEach((c) => {
        c.changedFilenames.forEach((f) => {
          const dir = f.split("/")[0];
          dirCounts[dir] = (dirCounts[dir] || 0) + 1;
        });
      });
      const primaryAreas = Object.entries(dirCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([dir]) => dir);

      const dates = authorCommits.map((c) => c.date).sort();

      return {
        name: authorCommits[0]?.author || contributor.login,
        login: contributor.login,
        emails: [...new Set(authorCommits.map((c) => c.authorEmail))],
        // Use filtered commit window count, not all-time GitHub contributions.
        commitCount: authorCommits.length,
        firstCommitDate: dates[0] || "",
        lastCommitDate: dates[dates.length - 1] || "",
        primaryAreas,
      };
    })
    .filter((c) => c.commitCount > 0)
    .sort((a, b) => b.commitCount - a.commitCount);

  return contributors;
}

// Calculate overall commit quality score (0-100)
export function calculateOverallQuality(commits: ProcessedCommit[]): number {
  if (commits.length === 0) return 0;
  const avgOutOf10 =
    commits.reduce((sum, c) => sum + c.qualityScore, 0) / commits.length;
  return Math.round(avgOutOf10 * 10);
}

// Aggregate commit type breakdown
export function getTypeBreakdown(
  commits: ProcessedCommit[],
): Record<CommitType, number> {
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
  commits.forEach((c) => {
    breakdown[c.type]++;
  });
  return breakdown;
}
