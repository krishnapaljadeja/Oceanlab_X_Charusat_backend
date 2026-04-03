import { ProcessedCommit, Milestone, RawTag } from "../types";

export function detectMilestones(
  commits: ProcessedCommit[],
  tags: RawTag[],
): Milestone[] {
  const milestones: Milestone[] = [];
  const tagShaSet = new Set(tags.map((t) => t.commit.sha));
  const tagNameMap = new Map(tags.map((t) => [t.commit.sha, t.name]));

  const sorted = [...commits].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  // Initial commit
  if (sorted.length > 0) {
    const first = sorted[0];
    milestones.push({
      date: first.date,
      sha: first.sha,
      title: "Project Initialized",
      type: "initial_commit",
      significance: `The repository was created. First commit: "${first.message}"`,
    });
  }

  // Version tag milestones
  sorted.forEach((commit) => {
    if (tagShaSet.has(commit.sha)) {
      milestones.push({
        date: commit.date,
        sha: commit.sha,
        title: `Release: ${tagNameMap.get(commit.sha)}`,
        type: "version_release",
        significance: `A version was tagged at this commit, marking a stable release point.`,
      });
    }
  });

  // First test file introduced
  const firstTestCommit = sorted.find((c) =>
    c.changedFilenames.some(
      (f) =>
        f.includes("test") ||
        f.includes("spec") ||
        f.includes(".test.") ||
        f.includes(".spec."),
    ),
  );
  if (firstTestCommit) {
    milestones.push({
      date: firstTestCommit.date,
      sha: firstTestCommit.sha,
      title: "Testing Introduced",
      type: "test_introduction",
      significance:
        "First test files were added to the repository, signaling a shift toward quality assurance.",
    });
  }

  // First CI/CD configuration
  const firstCiCommit = sorted.find((c) =>
    c.changedFilenames.some(
      (f) =>
        f.includes(".github/workflows") ||
        f.includes(".travis.yml") ||
        f.includes("Jenkinsfile") ||
        f.includes(".circleci") ||
        f.includes("gitlab-ci"),
    ),
  );
  if (firstCiCommit) {
    milestones.push({
      date: firstCiCommit.date,
      sha: firstCiCommit.sha,
      title: "CI/CD Pipeline Introduced",
      type: "ci_introduction",
      significance:
        "Automated build and deployment pipelines were configured for the first time.",
    });
  }

  // Large refactor (single commit with very high churn)
  const largeRefactors = sorted.filter(
    (c) =>
      c.isDetailed && c.additions + c.deletions > 500 && c.type === "refactor",
  );
  largeRefactors.slice(0, 2).forEach((commit) => {
    milestones.push({
      date: commit.date,
      sha: commit.sha,
      title: "Major Refactoring",
      type: "large_refactor",
      significance: `A large-scale refactoring changed ${commit.filesChanged} files with ${commit.additions + commit.deletions} total line changes.`,
    });
  });

  // Commit count thresholds: 100, 500
  [100, 500].forEach((threshold) => {
    if (sorted.length >= threshold) {
      const commit = sorted[threshold - 1];
      milestones.push({
        date: commit.date,
        sha: commit.sha,
        title: `${threshold}th Commit`,
        type: "commit_count_threshold",
        significance: `The repository reached ${threshold} commits, indicating sustained development activity.`,
      });
    }
  });

  // Sort all milestones by date
  milestones.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  return milestones;
}
