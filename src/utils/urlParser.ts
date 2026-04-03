export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
}

export function parseGitHubUrl(url: string): ParsedGitHubUrl {
  const trimmed = url
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const match = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/,
  );
  if (!match) {
    throw new Error("INVALID_URL");
  }
  return { owner: match[1], repo: match[2] };
}

export function buildCacheKey(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}
