// Raw data from GitHub API
export interface RawCommit {
  sha: string;
  parents?: Array<{ sha: string }>;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
  author: {
    login: string;
    avatar_url?: string;
    html_url?: string;
  } | null;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  files?: Array<{
    filename: string;
    additions: number;
    deletions: number;
    status: string;
  }>;
}

export interface AnalysisFilters {
  dateRange: {
    type: "last_n_months" | "last_n_commits" | "all" | "custom";
    months?: number;
    commitCount?: number;
    from?: string;
    to?: string;
  };
  excludeMergeCommits: boolean;
  branchFilter?: string;
  pathFilter?: string;
  minLinesChanged?: number;
}

export interface CommitDetail {
  sha: string;
  message: string;
  date: string;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  impactScore: number;
  impactLabel: "Critical" | "High" | "Medium" | "Low";
  aiImpactSummary: string;
  filesAffected: string[];
}

export interface ContributorProfile {
  login: string;
  avatarUrl: string;
  totalCommits: number;
  totalLinesAdded: number;
  totalLinesDeleted: number;
  totalFilesChanged: number;
  overallImpactScore: number;
  primaryWorkAreas: string[];
  specializations: string[];
  peakActivityPeriod: string;
  firstCommitDate: string;
  lastCommitDate: string;
  commitFrequency: string;
  aiContributorSummary: string;
  commits: CommitDetail[];
}

export interface RawContributor {
  login: string;
  contributions: number;
  avatar_url: string;
  html_url: string;
}

export interface RawTag {
  name: string;
  commit: {
    sha: string;
  };
}

export interface RepoMeta {
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  createdAt: string;
  updatedAt: string;
  defaultBranch: string;
  htmlUrl: string;
  topics: string[];
}

// Processed/analyzed data
export type CommitType =
  | "feat"
  | "fix"
  | "refactor"
  | "infra"
  | "test"
  | "docs"
  | "deps"
  | "unknown";

export interface ProcessedCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authorEmail: string;
  authorLogin: string;
  date: string;
  type: CommitType;
  qualityScore: number; // 0-10
  filesChanged: number;
  additions: number;
  deletions: number;
  changedFilenames: string[];
  isDetailed: boolean; // true if we fetched full stats
  isMilestoneCandidate: boolean;
}

export interface NormalizedContributor {
  name: string;
  login: string;
  emails: string[];
  commitCount: number;
  firstCommitDate: string;
  lastCommitDate: string;
  primaryAreas: string[]; // top directories they touched
}

export interface DevelopmentPhase {
  name: string;
  label:
    | "Initial Setup"
    | "Feature Development"
    | "Bug Fix & Stabilization"
    | "Refactoring"
    | "Infrastructure & DevOps"
    | "Maintenance"
    | "Major Release Prep";
  startDate: string;
  endDate: string;
  commitCount: number;
  dominantType: CommitType;
  commitTypeBreakdown: Record<CommitType, number>;
  keyFiles: string[];
  contributors: string[];
  velocity: "high" | "medium" | "low";
}

export interface Milestone {
  date: string;
  sha: string;
  title: string;
  type:
    | "initial_commit"
    | "version_release"
    | "test_introduction"
    | "ci_introduction"
    | "contributor_spike"
    | "large_refactor"
    | "new_module"
    | "commit_count_threshold";
  significance: string;
}

export interface AnalysisSummary {
  repoMeta: RepoMeta;
  totalCommitsInRepo: number;
  analyzedCommitCount: number;
  detailedCommitCount: number;
  dateRange: {
    first: string;
    last: string;
  };
  topContributors: NormalizedContributor[];
  phases: DevelopmentPhase[];
  milestones: Milestone[];
  commitQualityScore: number; // 0-100 aggregate score derived from commit-message quality
  commitTypeBreakdown: Record<CommitType, number>;
  tags: Array<{ name: string; sha: string }>;
  isCapped: boolean; // true if we hit the 1000 commit cap
  dataConfidenceLevel: "high" | "medium" | "low";
}

// Claude output schema
export interface NarrativeChapter {
  title: string;
  period: string;
  story: string;
  keyEvents: string[];
}

export interface GeneratedNarrative {
  projectOverview: string;
  narrativeChapters: NarrativeChapter[];
  milestoneHighlights: Array<{
    date: string;
    title: string;
    significance: string;
  }>;
  contributorInsights: string;
  architecturalObservations: string;
  currentState: string;
  dataConfidenceNote: string;
}

// Final API response
export interface StalenessInfo {
  isStale: boolean;
  newCommitsSince: number;
  lastAnalyzedAt: string;
  storedCommitCount: number;
  currentCommitCount: number;
}

export interface AnalysisResponse {
  success: true;
  repoMeta: RepoMeta;
  summary: AnalysisSummary;
  narrative: GeneratedNarrative;
  analyzedAt: string;
  fromCache: boolean;
  staleness: StalenessInfo;
  analysisVersion: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
}

export interface RateLimitStatus {
  limit: number;
  remaining: number;
  resetAt: string;
  isLow: boolean;
}

export interface HistoryItem {
  owner: string;
  repo: string;
  fullName: string;
  analyzedAt: string;
  commitCount: number;
  language: string | null;
  description: string | null;
  stars: number;
}

export interface QAMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface QARequest {
  owner: string;
  repo: string;
  question: string;
  history: QAMessage[]; // last 5 messages for context
}

export interface QAResponse {
  success: true;
  answer: string;
  timestamp: string;
}

export interface HeatmapDay {
  date: string; // "YYYY-MM-DD"
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface HeatmapWeek {
  days: HeatmapDay[]; // always 7 entries
}

export interface HeatmapStats {
  totalCommits: number;
  activeDays: number;
  longestStreak: number;
  currentStreak: number;
  mostActiveDay: string; // "YYYY-MM-DD"
  mostActiveDayCount: number;
  mostActiveDayOfWeek: string; // "Monday" etc
  averageCommitsPerActiveDay: number;
}

export interface HeatmapResponse {
  success: true;
  weeks: HeatmapWeek[];
  stats: HeatmapStats;
  year: number;
  owner: string;
  repo: string;
}
