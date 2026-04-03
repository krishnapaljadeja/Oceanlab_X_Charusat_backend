import { paginateAll, githubAxios } from "./githubClient";
import { RawCommit, AnalysisFilters } from "../types";

const MAX_COMMITS = parseInt(process.env.MAX_COMMITS_TO_FETCH || "1000");
const MAX_DETAILED = parseInt(process.env.MAX_DETAILED_COMMITS || "50");

const DEFAULT_FILTERS: AnalysisFilters = {
  dateRange: { type: "all" },
  excludeMergeCommits: false,
};

function toIsoMonthsAgo(months: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString();
}

function normalizeFilters(filters?: AnalysisFilters): AnalysisFilters {
  return {
    ...DEFAULT_FILTERS,
    ...filters,
    dateRange: {
      ...DEFAULT_FILTERS.dateRange,
      ...(filters?.dateRange || {}),
    },
  };
}

function buildCommitParams(
  activeFilters: AnalysisFilters,
  extra: Record<string, string> = {},
): Record<string, string | number> {
  const params: Record<string, string | number> = { ...extra };

  if (activeFilters.dateRange.type === "last_n_months") {
    const months = activeFilters.dateRange.months ?? 3;
    params.since = toIsoMonthsAgo(months);
  }
  if (activeFilters.dateRange.type === "custom") {
    if (activeFilters.dateRange.from) {
      params.since = new Date(activeFilters.dateRange.from).toISOString();
    }
    if (activeFilters.dateRange.to) {
      params.until = new Date(activeFilters.dateRange.to).toISOString();
    }
  }
  if (activeFilters.branchFilter) {
    params.sha = activeFilters.branchFilter;
  }
  if (activeFilters.pathFilter) {
    params.path = activeFilters.pathFilter;
  }

  return params;
}

async function withStatsIfNeeded(
  owner: string,
  repo: string,
  commit: RawCommit,
): Promise<RawCommit> {
  if (commit.stats) return commit;
  try {
    const { data } = await githubAxios.get<RawCommit>(
      `/repos/${owner}/${repo}/commits/${commit.sha}`,
    );
    return data;
  } catch {
    return commit;
  }
}

// Step 1: Fetch all commit metadata (no diff stats yet)
export async function fetchAllCommitMetadata(
  owner: string,
  repo: string,
  filters?: AnalysisFilters,
): Promise<{ commits: RawCommit[]; isCapped: boolean }> {
  const activeFilters = normalizeFilters(filters);
  const params = buildCommitParams(activeFilters);

  const fetched = await paginateAll<RawCommit>(
    `/repos/${owner}/${repo}/commits`,
    params,
    MAX_COMMITS + 1, // fetch one extra to detect capping
  );

  const isCapped = fetched.length > MAX_COMMITS;
  let commits = fetched.slice(0, MAX_COMMITS);

  if (activeFilters.excludeMergeCommits) {
    commits = commits.filter((commit) => (commit.parents?.length ?? 1) <= 1);
  }

  if (activeFilters.minLinesChanged && activeFilters.minLinesChanged > 0) {
    const enriched = await Promise.all(
      commits.map((commit) => withStatsIfNeeded(owner, repo, commit)),
    );

    commits = enriched.filter((commit) => {
      const added = commit.stats?.additions ?? 0;
      const deleted = commit.stats?.deletions ?? 0;
      return added + deleted >= activeFilters.minLinesChanged!;
    });
  }

  if (
    activeFilters.dateRange.commitCount &&
    activeFilters.dateRange.commitCount > 0
  ) {
    commits = commits.slice(0, activeFilters.dateRange.commitCount);
  }

  return {
    commits,
    isCapped,
  };
}

export async function fetchContributorCommitMetadata(
  owner: string,
  repo: string,
  login: string,
  filters?: AnalysisFilters,
): Promise<{ commits: RawCommit[]; isCapped: boolean }> {
  const activeFilters = normalizeFilters(filters);
  const params = buildCommitParams(activeFilters, { author: login });

  const fetched = await paginateAll<RawCommit>(
    `/repos/${owner}/${repo}/commits`,
    params,
    MAX_COMMITS + 1,
  );

  const isCapped = fetched.length > MAX_COMMITS;
  let commits = fetched.slice(0, MAX_COMMITS);

  if (activeFilters.excludeMergeCommits) {
    commits = commits.filter((commit) => (commit.parents?.length ?? 1) <= 1);
  }

  if (activeFilters.minLinesChanged && activeFilters.minLinesChanged > 0) {
    const enriched = await Promise.all(
      commits.map((commit) => withStatsIfNeeded(owner, repo, commit)),
    );

    commits = enriched.filter((commit) => {
      const added = commit.stats?.additions ?? 0;
      const deleted = commit.stats?.deletions ?? 0;
      return added + deleted >= activeFilters.minLinesChanged!;
    });
  }

  if (
    activeFilters.dateRange.commitCount &&
    activeFilters.dateRange.commitCount > 0
  ) {
    commits = commits.slice(0, activeFilters.dateRange.commitCount);
  }

  return { commits, isCapped };
}

// Step 2: Score a commit to determine if it's worth fetching details for
function scoreCommitImportance(
  commit: RawCommit,
  index: number,
  total: number,
  tagShas: Set<string>,
): number {
  let score = 0;
  const msg = commit.commit.message.toLowerCase();

  // Always include first and last commits
  if (index === 0 || index === total - 1) score += 100;

  // Tag/release commits are always important
  if (tagShas.has(commit.sha)) score += 50;

  // Keyword scoring
  const highValueKeywords = [
    "initial",
    "init",
    "first",
    "feat:",
    "feature",
    "add",
    "implement",
    "introduce",
    "breaking",
    "major",
    "release",
    "v1",
    "v2",
    "v3",
    "refactor",
    "rewrite",
    "restructure",
    "migrate",
    "migration",
    "architecture",
    "overhaul",
  ];
  const medValueKeywords = [
    "fix:",
    "bugfix",
    "hotfix",
    "patch",
    "test",
    "ci",
    "cd",
    "deploy",
  ];

  highValueKeywords.forEach((kw) => {
    if (msg.includes(kw)) score += 10;
  });
  medValueKeywords.forEach((kw) => {
    if (msg.includes(kw)) score += 5;
  });

  // Distribute across time: pick commits evenly spread through history
  if (index % Math.floor(total / 20) === 0) score += 8;

  return score;
}

// Step 3: Select top N commits for detailed fetching
export function selectSignificantCommits(
  commits: RawCommit[],
  tagShas: Set<string>,
  maxCount: number = MAX_DETAILED,
): RawCommit[] {
  const scored = commits.map((commit, index) => ({
    commit,
    score: scoreCommitImportance(commit, index, commits.length, tagShas),
  }));

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, maxCount).map((s) => s.commit);

  // Re-sort by date (chronological)
  selected.sort(
    (a, b) =>
      new Date(a.commit.author.date).getTime() -
      new Date(b.commit.author.date).getTime(),
  );

  return selected;
}

// Step 4: Fetch full details (stats + files) for selected commits
export async function fetchCommitDetails(
  owner: string,
  repo: string,
  commits: RawCommit[],
): Promise<RawCommit[]> {
  const detailed: RawCommit[] = [];

  for (const commit of commits) {
    try {
      const { data } = await githubAxios.get(
        `/repos/${owner}/${repo}/commits/${commit.sha}`,
      );
      detailed.push(data);
      // Small delay to avoid hammering the API
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      // If fetching details fails, push the metadata-only version
      detailed.push(commit);
    }
  }

  return detailed;
}
