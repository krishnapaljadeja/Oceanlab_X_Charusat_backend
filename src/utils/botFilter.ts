const BOT_PATTERNS = [
  /\[bot\]/i,
  /^dependabot/i,
  /^github-actions/i,
  /^renovate/i,
  /^greenkeeper/i,
  /^snyk-bot/i,
  /^imgbot/i,
  /^allcontributors/i,
  /^semantic-release-bot/i,
  /^codecov/i,
];

export function isBot(authorLogin: string, authorName: string): boolean {
  const combined = `${authorLogin} ${authorName}`;
  return BOT_PATTERNS.some((pattern) => pattern.test(combined));
}

export function filterBotCommits<
  T extends { author: string; authorLogin: string },
>(commits: T[]): T[] {
  return commits.filter((c) => !isBot(c.authorLogin, c.author));
}
