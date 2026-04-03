import { paginateAll, githubAxios } from "./githubClient";
import { RawCommit } from "../types";

const MAX_COMMITS = parseInt(process.env.MAX_COMMITS_TO_FETCH || "1000");
const MAX_DETAILED = parseInt(process.env.MAX_DETAILED_COMMITS || "50");

// Step 1: Fetch all commit metadata (no diff stats yet)
export async function fetchAllCommitMetadata(
  owner: string,
  repo: string,
): Promise<{ commits: RawCommit[]; isCapped: boolean }> {
  const commits = await paginateAll<RawCommit>(
    `/repos/${owner}/${repo}/commits`,
    {},
    MAX_COMMITS + 1, // fetch one extra to detect capping
  );

  const isCapped = commits.length > MAX_COMMITS;
  return {
    commits: commits.slice(0, MAX_COMMITS),
    isCapped,
  };
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
