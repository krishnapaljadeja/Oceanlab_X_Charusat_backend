import {
  RawCommit,
  RawContributor,
  ProcessedCommit,
  NormalizedContributor,
  CommitType,
} from "../types";
import { isBot } from "../utils/botFilter";

const COMMIT_TYPE_MAP: Partial<Record<string, CommitType>> = {
  feat: "feat",
  feature: "feat",
  add: "feat",
  added: "feat",
  adds: "feat",
  adding: "feat",
  new: "feat",
  implement: "feat",
  implemented: "feat",
  implements: "feat",
  implementing: "feat",
  introduce: "feat",
  introduced: "feat",
  introduces: "feat",
  introducing: "feat",
  fix: "fix",
  fixed: "fix",
  fixes: "fix",
  fixing: "fix",
  bug: "fix",
  bugfix: "fix",
  hotfix: "fix",
  patch: "fix",
  patched: "fix",
  patches: "fix",
  patching: "fix",
  revert: "fix",
  reverted: "fix",
  reverts: "fix",
  reverting: "fix",
  perf: "refactor",
  style: "refactor",
  refactor: "refactor",
  ref: "refactor",
  cleanup: "refactor",
  cleaned: "refactor",
  clean: "refactor",
  simplify: "refactor",
  simplified: "refactor",
  simplif: "refactor",
  restructure: "refactor",
  reorganize: "refactor",
  reorganised: "refactor",
  rewrite: "refactor",
  rework: "refactor",
  improve: "refactor",
  improved: "refactor",
  improves: "refactor",
  improving: "refactor",
  optimize: "refactor",
  optimised: "refactor",
  optimized: "refactor",
  rename: "refactor",
  renamed: "refactor",
  remove: "refactor",
  removed: "refactor",
  extract: "refactor",
  migrate: "refactor",
  migrated: "refactor",
  switch: "refactor",
  change: "refactor",
  changed: "refactor",
  adjust: "refactor",
  adjusted: "refactor",
  tweak: "refactor",
  tweaked: "refactor",
  revamp: "refactor",
  overhaul: "refactor",
  test: "test",
  tests: "test",
  spec: "test",
  docs: "docs",
  doc: "docs",
  readme: "docs",
  changelog: "docs",
  documentation: "docs",
  document: "docs",
  comment: "docs",
  annotate: "docs",
  license: "docs",
  copyright: "docs",
  typo: "docs",
  ci: "infra",
  cd: "infra",
  build: "infra",
  deploy: "infra",
  release: "infra",
  tag: "infra",
  publish: "infra",
  workflow: "infra",
  pipeline: "infra",
  docker: "infra",
  dockerfile: "infra",
  terraform: "infra",
  helm: "infra",
  kubernetes: "infra",
  k8s: "infra",
  chore: "deps",
  deps: "deps",
  dep: "deps",
  bump: "deps",
  upgrade: "deps",
  update: "deps",
  updated: "deps",
  updating: "deps",
  dependency: "deps",
  dependencies: "deps",
  package: "deps",
  yarn: "deps",
  npm: "deps",
  pip: "deps",
  cargo: "deps",
  gemfile: "deps",
};

function classifyToken(token: string): CommitType | null {
  return COMMIT_TYPE_MAP[token] || null;
}

function classifyText(text: string): CommitType | null {
  const compact = text.toLowerCase().replace(/[_/.-]+/g, " ");

  const typeOrder: Array<{ type: CommitType; patterns: RegExp[] }> = [
    {
      type: "feat",
      patterns: [
        /\b(feat|feature|add|added|adds|adding|new|implement|implemented|implements|implementing|introduce|introduced|introduces|introducing)\b/,
      ],
    },
    {
      type: "fix",
      patterns: [
        /\b(fix|fixed|fixes|fixing|bug|bugfix|hotfix|patch|patched|patches|patching|resolve|resolved|resolves|resolving|repair|repaired|repairs|repairing|correct|corrected|corrects|correcting|address|addressed|addresses|addressing|prevent|prevented|prevents|preventing|avoid|avoided|avoids|avoiding|revert|reverted|reverts|reverting|error|issue|crash|exception|panic|regression)\b/,
      ],
    },
    {
      type: "test",
      patterns: [/\b(test|tests|testing|tested|spec|specs|coverage|assert)\b/],
    },
    {
      type: "docs",
      patterns: [/\b(doc|docs|readme|changelog|documentation|document|comment|annotate|license|copyright|typo)\b/],
    },
    {
      type: "infra",
      patterns: [
        /\b(ci|cd|deploy|deployment|docker|dockerfile|build|workflow|pipeline|release|tag|publish|version bump|bump version|terraform|helm|k8s|kubernetes)\b/,
      ],
    },
    {
      type: "deps",
      patterns: [
        /\b(bump|upgrade|update|updated|updating|dependency|dependencies|deps|chore|yarn|npm|pip|cargo|gemfile|package lock)\b/,
      ],
    },
    {
      type: "refactor",
      patterns: [
        /\b(refactor|refactored|refactoring|cleanup|clean up|cleaned up|restructure|reorganized?|reorganised?|rewrite|rewrote|rework|improve|improved|improves|improving|optimiz(?:e|ed|es|ing)|simplif(?:y|ied|ies|ying)|rename|renamed|remove|removed|extract|migrate|migrated|switch|change|changed|adjust|adjusted|tweak|tweaked|revamp|overhaul)\b/,
      ],
    },
  ];

  for (const group of typeOrder) {
    if (group.patterns.some((pattern) => pattern.test(compact))) {
      return group.type;
    }
  }

  const directTokens = compact.split(/\s+/);
  for (const token of directTokens) {
    const type = classifyToken(token);
    if (type) return type;
  }

  return null;
}

function classifyMergeBranch(message: string): CommitType | null {
  const lower = message.toLowerCase();
  const candidates = [
    ...lower.matchAll(/merge (?:branch|pull request)[^\n]*?(?:from\s+)?(?:['"])?([a-z0-9._/\-]+)(?:['"])?/g),
    ...lower.matchAll(/from\s+([a-z0-9._/\-]+)\s+into\s+/g),
    ...lower.matchAll(/into\s+([a-z0-9._/\-]+)(?:\s|$)/g),
  ].map((match) => match[1]);

  for (const candidate of candidates) {
    const type = classifyText(candidate);
    if (type) return type;
  }

  return null;
}

function classifyFromFiles(filenames: string[]): CommitType | null {
  if (filenames.length === 0) return null;

  const hasTestFile = filenames.some((f) =>
    /(\.(test|spec)\.[jt]sx?$|__tests__|\/tests?\/|_test\.[a-z]+$|_spec\.[a-z]+$|test\.[a-z]+$)/i.test(
      f,
    ),
  );
  if (hasTestFile) return "test";

  const hasDocFile = filenames.some((f) =>
    /(\.(md|markdown|txt|rst|adoc)$|^docs?\/|readme|changelog|license)/i.test(
      f,
    ),
  );
  if (hasDocFile) return "docs";

  const hasInfraFile = filenames.some((f) =>
    /(^\.github\/|dockerfile|\.ya?ml$|makefile$|^\.circleci\/|^\.travis\/|jenkinsfile|^helm\/|^k8s\/|^terraform\/|^infra\/|^deploy\/|\.env|vite\.config|tailwind\.config|tsconfig|package\.json|pnpm-lock|yarn\.lock|package-lock\.json)/i.test(
      f,
    ),
  );
  if (hasInfraFile) return "infra";

  const hasDepsFile = filenames.some((f) =>
    /(package(-lock)?\.json$|yarn\.lock$|pnpm-lock|go\.(sum|mod)$|requirements.*\.txt$|pipfile(\.lock)?$|cargo\.(toml|lock)$|gemfile(\.lock)?$|pom\.xml$|gradle\.(kts|properties)$)/i.test(
      f,
    ),
  );
  if (hasDepsFile) return "deps";

  return null;
}

function inferTypeFromNeighbors(
  commits: ProcessedCommit[],
  index: number,
): CommitType | null {
  const scores: Record<Exclude<CommitType, "unknown">, number> = {
    feat: 0,
    fix: 0,
    refactor: 0,
    infra: 0,
    test: 0,
    docs: 0,
    deps: 0,
  };

  for (let offset = 1; offset <= 3; offset += 1) {
    const weight = 4 - offset;
    const previous = commits[index - offset];
    const next = commits[index + offset];

    if (previous && previous.type !== "unknown") {
      scores[previous.type] += weight;
    }
    if (next && next.type !== "unknown") {
      scores[next.type] += weight;
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestType, bestScore] = ranked[0] || [null, 0];
  const secondScore = ranked[1]?.[1] || 0;

  if (!bestType) return null;
  if (bestScore >= 4 && bestScore >= secondScore + 2) {
    return bestType as Exclude<CommitType, "unknown">;
  }

  return null;
}

function getDominantKnownType(
  commits: ProcessedCommit[],
): Exclude<CommitType, "unknown"> | null {
  const counts: Record<Exclude<CommitType, "unknown">, number> = {
    feat: 0,
    fix: 0,
    refactor: 0,
    infra: 0,
    test: 0,
    docs: 0,
    deps: 0,
  };

  commits.forEach((commit) => {
    if (commit.type !== "unknown") {
      counts[commit.type] += 1;
    }
  });

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [bestType, bestCount] = ranked[0] || [null, 0];

  if (!bestType || bestCount <= 0) return null;
  return bestType as Exclude<CommitType, "unknown">;
}

// Classify a commit message into a CommitType.
// Uses a four-tier strategy so that as few commits as possible fall through
// to "unknown":
//   1. Conventional commit prefix  (feat:, fix(scope):, chore!, …)
//   2. Leading verb / noun pattern  (most common freeform starts)
//   3. Keyword scan anywhere in the first line
//   4. Changed-file path heuristics (*.test.ts, Dockerfile, package-lock…)
function classifyCommit(message: string, filenames: string[] = []): CommitType {
  const firstLine = message.split("\n")[0].trim();
  const headline = firstLine.toLowerCase();
  const fullText = message.toLowerCase();

  // ── 1. Conventional commit prefix ──────────────────────────────────────────
  // Matches: type:, type(scope):, type!:, type(scope)!:
  const conventionalMatch = headline.match(/^(\w+)(?:\([^)]*\))?!?\s*:/);
  if (conventionalMatch) {
    const prefix = conventionalMatch[1];
    const conventionalType = classifyToken(prefix);
    if (conventionalType) return conventionalType;
  }

  // ── 2. Leading verb / noun ──────────────────────────────────────────────────
  if (
    /^(feat|feature|add|added|adds|adding|new|implement|implemented|implements|implementing|introduce|introduced|introduces|introducing|create|created|creates|creating|support|supported|supports|supporting|enable|enabled|enables|enabling|allow|allowed|allows|allowing|initial commit|init\b)/.test(
      headline,
    )
  )
    return "feat";
  if (
    /^(fix|fixed|fixes|fixing|bug|bugfix|hotfix|patch|patched|patches|patching|resolve|resolved|resolves|resolving|repair|repaired|repairs|repairing|handle|handled|handles|handling|correct|corrected|corrects|correcting|address|addressed|addresses|addressing|prevent|prevented|prevents|preventing|avoid|avoided|avoids|avoiding|revert|reverted|reverts|reverting)/.test(
      headline,
    )
  )
    return "fix";
  if (
    /^(refactor|refactored|refactoring|restructure|reorganized?|reorganised?|cleanup|clean up|clean-up|cleaned up|rewrite|rewrote|simplify|simplified|rename|renamed|move|moved|replace|replaced|remove|removed|extract|extracted|migrate|migrated|convert|converted|switch|switched|rework|reworked|improve|improved|optimize|optimized|optimise|optimised|use|used|change|changed|adjust|adjusted|tweak|tweaked|revamp|overhaul|deduplicate|dedup)/.test(
      headline,
    )
  )
    return "refactor";
  if (
    /^(test|tests|testing|spec|specs|coverage|add test|add spec|unit test|integration test)/.test(
      headline,
    )
  )
    return "test";
  if (
    /^(docs?|doc|readme|changelog|documentation|document|comment|annotate|license|copyright|typo)/.test(
      headline,
    )
  )
    return "docs";
  if (
    /^(ci|cd|deploy|deployment|docker|build|github actions|workflow|pipeline|release|tag\b|publish|version bump|bump version|terraform|helm|k8s|kubernetes)/.test(
      headline,
    )
  )
    return "infra";
  if (
    /^(bump|upgrade|update|updated|updating|update dependencies|update deps|update packages|dependency|dependencies|deps|chore|yarn|npm|pip|cargo|gemfile)/.test(
      headline,
    )
  )
    return "deps";

  const mergeType = classifyMergeBranch(message);
  if (mergeType) return mergeType;

  // ── 3. Keyword anywhere in first line ──────────────────────────────────────
  // Order matters: more specific checks first so they win over broader ones
  if (/\b(feat|feature|implement|introduced?|creating?|adding?)\b/.test(fullText))
    return "feat";
  if (
    /\b(fix(e[sd])?|bug|defect|regression|crash|exception|panic|issue|error|resolve[sd]?|repair[sd]?|patch(ed|es|ing)?)\b/.test(
      fullText,
    )
  )
    return "fix";
  if (/\brevert(ed|s|ing)?\b/.test(fullText)) return "fix";
  if (/\b(test(s|ing|ed)?|spec(s)?|coverage|assert|unit test|integration test)\b/.test(fullText))
    return "test";
  if (/\b(docs?|readme|changelog|documentation|docstring|annotat(e|ed|ing))\b/.test(fullText))
    return "docs";
  if (
    /\b(ci|cd|dockerfile|docker|deploy(ment)?|workflow|pipeline|github.?actions?|k8s|kubernetes|helm|terraform)\b/.test(
      fullText,
    )
  )
    return "infra";
  if (/\b(bump|upgrade|updated?|updating|dependencies|dependency|package\.json|lockfile|chore|yarn|npm|pip|cargo|gemfile)\b/.test(fullText))
    return "deps";
  if (/\b(refactor|cleanup|restructure|reorganize|simplif|rewrite|optimiz|revamp|overhaul|rename|replace|remove|extract|migrate)\b/.test(fullText))
    return "refactor";

  // ── 4. File-path heuristics ─────────────────────────────────────────────────
  const fileType = classifyFromFiles(filenames);
  if (fileType) return fileType;

  // If every changed file is in the same top-level area, infer from that.
  // This mostly helps non-conventional commits whose messages are too terse.
  if (filenames.length > 0) {
    const allSrc = filenames.every((f) => /^src\/|^lib\/|^app\/|^pkg\//.test(f));
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

  const processed = allCommits
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

  const dominantType = getDominantKnownType(processed) || "feat";

  return processed.map((commit, index) => {
    if (commit.type !== "unknown") return commit;

    const inferred = inferTypeFromNeighbors(processed, index);
    const fallbackType = inferred || dominantType;

    const firstLine = commit.message.toLowerCase();
    const isGenericMerge =
      /^merge\b/.test(firstLine) ||
      /\bmerge (branch|pull request)\b/.test(firstLine) ||
      /\bfrom\b.*\binto\b/.test(firstLine);
    const isLowSignal =
      commit.qualityScore <= 4 ||
      /^(update|changes?|misc|cleanup|chore|wip|temp|fix|refactor|merge)\b/.test(
        firstLine,
      );

    return {
      ...commit,
      type: isGenericMerge || isLowSignal || !inferred ? fallbackType : inferred,
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
