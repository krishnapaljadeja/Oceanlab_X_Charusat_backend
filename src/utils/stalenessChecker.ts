import { githubAxios } from "../services/githubClient";
import { StalenessInfo } from "../types";

export async function checkStaleness(
  owner: string,
  repo: string,
  storedCommitCount: number,
  lastAnalyzedAt: Date,
): Promise<StalenessInfo> {
  try {
    const response = await githubAxios.get(
      `/repos/${owner}/${repo}/commits?per_page=1`,
    );

    const linkHeader = response.headers["link"] as string | undefined;
    let currentCount: number;

    if (!linkHeader) {
      currentCount = (response.data as unknown[]).length;
    } else {
      const lastMatch = linkHeader.match(/&page=(\d+)>;\s*rel="last"/);
      if (!lastMatch) {
        currentCount = (response.data as unknown[]).length;
      } else {
        currentCount = parseInt(lastMatch[1], 10);
      }
    }

    const threshold = parseInt(process.env.STALE_THRESHOLD_COMMITS || "5", 10);
    const newCommits = Math.max(0, currentCount - storedCommitCount);
    const isStale = newCommits >= threshold;

    return {
      isStale,
      newCommitsSince: newCommits,
      lastAnalyzedAt: lastAnalyzedAt.toISOString(),
      storedCommitCount,
      currentCommitCount: currentCount,
    };
  } catch (error) {
    console.warn("[Staleness] Failed to check staleness:", error);
    return {
      isStale: false,
      newCommitsSince: 0,
      lastAnalyzedAt: lastAnalyzedAt.toISOString(),
      storedCommitCount,
      currentCommitCount: storedCommitCount,
    };
  }
}
