import { Router, Request, Response, NextFunction } from "express";
import { parseGitHubUrl } from "../utils/urlParser";
import {
  fetchRepoMeta,
  fetchContributors,
  fetchTags,
} from "../services/repoFetcher";
import {
  fetchAllCommitMetadata,
  selectSignificantCommits,
  fetchCommitDetails,
  fetchContributorCommitMetadata,
} from "../services/commitFetcher";
import {
  processCommits,
  normalizeContributors,
  calculateOverallQuality,
  getTypeBreakdown,
} from "../services/commitAnalyzer";
import { detectPhases } from "../services/phaseDetector";
import { detectMilestones } from "../services/milestoneDetector";
import { generateNarrative } from "../services/llm";
import { buildPrompt } from "../services/llm/prompt";
import { getRateLimitStatus, githubAxios } from "../services/githubClient";
import { buildContributorProfile } from "../services/contributorAnalyzer";
import {
  AnalysisSummary,
  AnalysisResponse,
  RepoMeta,
  GeneratedNarrative,
  HistoryItem,
  StalenessInfo,
  HeatmapDay,
  HeatmapWeek,
  HeatmapStats,
  HeatmapResponse,
  AnalysisFilters,
  RawCommit,
} from "../types";
import {
  getStoredAnalysis,
  saveAnalysis,
  listAllAnalyses,
  deleteAnalysis,
} from "../db/queries";
import { checkStaleness } from "../utils/stalenessChecker";
import { getAuthUserId, requireAuth, AuthenticatedRequest } from "../middleware/auth";

const MIN_COMMITS = parseInt(process.env.MIN_COMMITS_REQUIRED || "10");

export const analyzeRouter = Router();

analyzeRouter.use(["/analyze", "/history", "/heatmap"], requireAuth);
analyzeRouter.use(["/contributors/profile"], requireAuth);

function parseAnalysisFilters(input: unknown): AnalysisFilters | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Partial<AnalysisFilters>;

  const dateRangeRaw = raw.dateRange || { type: "all" as const };
  const dateRangeType = dateRangeRaw.type;
  if (
    dateRangeType !== "all" &&
    dateRangeType !== "last_n_months" &&
    dateRangeType !== "last_n_commits" &&
    dateRangeType !== "custom"
  ) {
    return undefined;
  }

  return {
    dateRange: {
      type: dateRangeType,
      months:
        typeof dateRangeRaw.months === "number"
          ? dateRangeRaw.months
          : undefined,
      commitCount:
        typeof dateRangeRaw.commitCount === "number"
          ? dateRangeRaw.commitCount
          : undefined,
      from:
        typeof dateRangeRaw.from === "string" ? dateRangeRaw.from : undefined,
      to: typeof dateRangeRaw.to === "string" ? dateRangeRaw.to : undefined,
    },
    excludeMergeCommits: Boolean(raw.excludeMergeCommits),
    branchFilter:
      typeof raw.branchFilter === "string" ? raw.branchFilter : undefined,
    pathFilter: typeof raw.pathFilter === "string" ? raw.pathFilter : undefined,
    minLinesChanged:
      typeof raw.minLinesChanged === "number" ? raw.minLinesChanged : undefined,
  };
}

async function fetchCommitDetailsInBatches(
  owner: string,
  repo: string,
  commits: RawCommit[],
  batchSize: number = 10,
): Promise<RawCommit[]> {
  const detailed: RawCommit[] = [];

  for (let i = 0; i < commits.length; i += batchSize) {
    const batch = commits.slice(i, i + batchSize);
    const fetched = await Promise.all(
      batch.map(async (commit) => {
        try {
          const { data } = await githubAxios.get(
            `/repos/${owner}/${repo}/commits/${commit.sha}`,
          );
          return data as RawCommit;
        } catch {
          return commit;
        }
      }),
    );
    detailed.push(...fetched);
  }

  return detailed;
}

async function runFullAnalysis(
  owner: string,
  repo: string,
): Promise<{
  repoMeta: RepoMeta;
  summary: AnalysisSummary;
  narrative: GeneratedNarrative;
}> {
  const [repoMeta, contributors, tags] = await Promise.all([
    fetchRepoMeta(owner, repo),
    fetchContributors(owner, repo),
    fetchTags(owner, repo),
  ]);

  const { commits: rawCommits, isCapped } = await fetchAllCommitMetadata(
    owner,
    repo,
  );

  if (rawCommits.length < MIN_COMMITS) {
    throw new Error("TOO_FEW_COMMITS");
  }

  const tagShas = new Set(tags.map((t) => t.commit.sha));
  const significantCommits = selectSignificantCommits(rawCommits, tagShas);
  const detailedCommits = await fetchCommitDetails(
    owner,
    repo,
    significantCommits,
  );

  const processedCommits = processCommits(rawCommits, detailedCommits);
  const normalizedContributors = normalizeContributors(
    contributors,
    processedCommits,
  );
  const phases = detectPhases(processedCommits);
  const milestones = detectMilestones(processedCommits, tags);
  const qualityScore = calculateOverallQuality(processedCommits);
  const typeBreakdown = getTypeBreakdown(processedCommits);

  const summary: AnalysisSummary = {
    repoMeta,
    totalCommitsInRepo: rawCommits.length,
    analyzedCommitCount: processedCommits.length,
    detailedCommitCount: detailedCommits.length,
    dateRange: {
      first: processedCommits[processedCommits.length - 1]?.date || "",
      last: processedCommits[0]?.date || "",
    },
    topContributors: normalizedContributors,
    phases,
    milestones,
    commitQualityScore: qualityScore,
    commitTypeBreakdown: typeBreakdown,
    tags: tags.map((t) => ({ name: t.name, sha: t.commit.sha })),
    isCapped,
    dataConfidenceLevel:
      qualityScore >= 6 ? "high" : qualityScore >= 3 ? "medium" : "low",
  };

  const narrative = await generateNarrative(summary);
  return { repoMeta, summary, narrative };
}

analyzeRouter.post(
  "/contributors/profile",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      getAuthUserId(req);
      const { repoUrl, login, filters } = req.body as {
        repoUrl?: string;
        login?: string;
        filters?: AnalysisFilters;
      };

      if (!repoUrl || typeof repoUrl !== "string") {
        throw new Error("INVALID_URL");
      }
      if (!login || typeof login !== "string") {
        return res.status(400).json({
          success: false,
          error: "Contributor login is required.",
          code: "INVALID_REQUEST",
        });
      }

      const { owner, repo } = parseGitHubUrl(repoUrl);
      const activeFilters = parseAnalysisFilters(filters);

      const { commits } = await fetchContributorCommitMetadata(
        owner,
        repo,
        login,
        activeFilters,
      );

      if (commits.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No commits found for this contributor in the selected range.",
          code: "NOT_FOUND",
        });
      }

      const detailedCommits = await fetchCommitDetailsInBatches(
        owner,
        repo,
        commits,
      );
      const firstWithAvatar = commits.find(
        (commit) => commit.author?.avatar_url,
      );
      const avatarUrl = firstWithAvatar?.author?.avatar_url || "";

      const profile = await buildContributorProfile(
        login,
        detailedCommits,
        avatarUrl,
      );

      return res.json({ success: true, profile });
    } catch (err) {
      next(err);
    }
  },
);

analyzeRouter.post(
  "/analyze",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = getAuthUserId(req);
      const { repoUrl } = req.body as { repoUrl?: string };
      if (!repoUrl || typeof repoUrl !== "string") {
        throw new Error("INVALID_URL");
      }

      const { owner, repo } = parseGitHubUrl(repoUrl);

      const stored = await getStoredAnalysis(userId, owner, repo);
      if (stored) {
        console.log(`[Analyze] Returning stored result for ${owner}/${repo}`);
        const staleness = await checkStaleness(
          owner,
          repo,
          stored.commitCount,
          stored.analyzedAt,
        );
        const repoMeta = stored.repoMeta as unknown as RepoMeta;
        const summary = stored.summary as unknown as AnalysisSummary;
        const narrative = stored.narrative as unknown as GeneratedNarrative;

        const response: AnalysisResponse = {
          success: true,
          repoMeta,
          summary,
          narrative,
          analyzedAt: stored.analyzedAt.toISOString(),
          fromCache: true,
          staleness,
          analysisVersion: "1.0.0",
        };
        return res.json(response);
      }

      console.log(`[Analyze] Starting fresh analysis for ${owner}/${repo}`);
      const { repoMeta, summary, narrative } = await runFullAnalysis(
        owner,
        repo,
      );

      await saveAnalysis(
        userId,
        owner,
        repo,
        summary.totalCommitsInRepo,
        repoMeta,
        summary,
        narrative,
      );

      const now = new Date().toISOString();
      const staleness: StalenessInfo = {
        isStale: false,
        newCommitsSince: 0,
        lastAnalyzedAt: now,
        storedCommitCount: summary.totalCommitsInRepo,
        currentCommitCount: summary.totalCommitsInRepo,
      };

      const response: AnalysisResponse = {
        success: true,
        repoMeta,
        summary,
        narrative,
        analyzedAt: now,
        fromCache: false,
        staleness,
        analysisVersion: "1.0.0",
      };

      console.log(`[Analyze] Completed analysis for ${owner}/${repo}`);
      return res.json(response);
    } catch (err) {
      next(err);
    }
  },
);

analyzeRouter.post(
  "/analyze/refresh",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = getAuthUserId(req);
      const { repoUrl } = req.body as { repoUrl?: string };
      if (!repoUrl || typeof repoUrl !== "string") {
        throw new Error("INVALID_URL");
      }

      const { owner, repo } = parseGitHubUrl(repoUrl);
      console.log(`[Analyze] Forced refresh for ${owner}/${repo}`);

      await deleteAnalysis(userId, owner, repo);

      const { repoMeta, summary, narrative } = await runFullAnalysis(
        owner,
        repo,
      );

      await saveAnalysis(
        userId,
        owner,
        repo,
        summary.totalCommitsInRepo,
        repoMeta,
        summary,
        narrative,
      );

      const now = new Date().toISOString();
      const staleness: StalenessInfo = {
        isStale: false,
        newCommitsSince: 0,
        lastAnalyzedAt: now,
        storedCommitCount: summary.totalCommitsInRepo,
        currentCommitCount: summary.totalCommitsInRepo,
      };

      const response: AnalysisResponse = {
        success: true,
        repoMeta,
        summary,
        narrative,
        analyzedAt: now,
        fromCache: false,
        staleness,
        analysisVersion: "1.0.0",
      };

      return res.json(response);
    } catch (err) {
      next(err);
    }
  },
);

// Demo route: shows all fetched + processed data and the exact LLM prompt,
// without calling the LLM. Useful for presentations.
analyzeRouter.post(
  "/analyze/preview",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      getAuthUserId(req);
      const { repoUrl } = req.body as { repoUrl?: string };
      if (!repoUrl || typeof repoUrl !== "string") {
        throw new Error("INVALID_URL");
      }

      const { owner, repo } = parseGitHubUrl(repoUrl);
      console.log(`[Preview] Fetching raw data for ${owner}/${repo}`);

      const [repoMeta, contributors, tags] = await Promise.all([
        fetchRepoMeta(owner, repo),
        fetchContributors(owner, repo),
        fetchTags(owner, repo),
      ]);

      const { commits: rawCommits, isCapped } = await fetchAllCommitMetadata(
        owner,
        repo,
      );

      if (rawCommits.length < MIN_COMMITS) {
        throw new Error("TOO_FEW_COMMITS");
      }

      const tagShas = new Set(tags.map((t) => t.commit.sha));
      const significantCommits = selectSignificantCommits(rawCommits, tagShas);
      const detailedCommits = await fetchCommitDetails(
        owner,
        repo,
        significantCommits,
      );

      const processedCommits = processCommits(rawCommits, detailedCommits);
      const normalizedContributors = normalizeContributors(
        contributors,
        processedCommits,
      );
      const phases = detectPhases(processedCommits);
      const milestones = detectMilestones(processedCommits, tags);
      const qualityScore = calculateOverallQuality(processedCommits);
      const typeBreakdown = getTypeBreakdown(processedCommits);

      const summary: AnalysisSummary = {
        repoMeta,
        totalCommitsInRepo: rawCommits.length,
        analyzedCommitCount: processedCommits.length,
        detailedCommitCount: detailedCommits.length,
        dateRange: {
          first: processedCommits[processedCommits.length - 1]?.date || "",
          last: processedCommits[0]?.date || "",
        },
        topContributors: normalizedContributors,
        phases,
        milestones,
        commitQualityScore: qualityScore,
        commitTypeBreakdown: typeBreakdown,
        tags: tags.map((t) => ({ name: t.name, sha: t.commit.sha })),
        isCapped,
        dataConfidenceLevel:
          qualityScore >= 6 ? "high" : qualityScore >= 3 ? "medium" : "low",
      };

      const llmPrompt = buildPrompt(summary);

      return res.json({
        success: true,
        _description:
          "Raw data fetched from GitHub + processed locally. llmPrompt is the exact text sent to the AI.",
        pipeline: {
          step1_repoMeta: repoMeta,
          step2_commitStats: {
            totalFetched: rawCommits.length,
            isCapped,
            capLimit: parseInt(process.env.MAX_COMMITS_TO_FETCH || "1000"),
            significantCommitsSelected: significantCommits.length,
            detailedCommitsFetched: detailedCommits.length,
          },
          step3_sampleCommits: rawCommits.slice(0, 10).map((c) => ({
            sha: c.sha.substring(0, 7),
            message: c.commit.message.split("\n")[0],
            author: c.commit.author?.name,
            date: c.commit.author?.date,
          })),
          step4_contributors: normalizedContributors,
          step5_phases: phases,
          step6_milestones: milestones,
          step7_tags: tags.map((t) => ({
            name: t.name,
            sha: t.commit.sha.substring(0, 7),
          })),
          step8_commitTypeBreakdown: typeBreakdown,
          step9_qualityScore: qualityScore,
        },
        summary,
        llmPrompt,
      });
    } catch (err) {
      next(err);
    }
  },
);

analyzeRouter.get(
  "/history",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = getAuthUserId(req);
      const analyses = await listAllAnalyses(userId);
      const history: HistoryItem[] = analyses.map((record) => {
        const meta = record.repoMeta as unknown as RepoMeta;
        return {
          owner: record.owner,
          repo: record.repo,
          fullName: record.fullName,
          analyzedAt: record.analyzedAt.toISOString(),
          commitCount: record.commitCount,
          language: meta.language,
          description: meta.description,
          stars: meta.stars,
        };
      });
      return res.json({ success: true, history });
    } catch (err) {
      next(err);
    }
  },
);

analyzeRouter.get(
  "/status",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const rateLimit = await getRateLimitStatus();
      res.json({ success: true, rateLimit });
    } catch (err) {
      next(err);
    }
  },
);

analyzeRouter.get("/health", (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

analyzeRouter.get(
  "/heatmap/:owner/:repo",
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = getAuthUserId(req);
      const { owner, repo } = req.params as { owner: string; repo: string };

      const stored = await getStoredAnalysis(userId, owner, repo);
      if (!stored) {
        return res.status(404).json({
          success: false,
          error: "No analysis found. Please analyze this repository first.",
          code: "NOT_FOUND",
        });
      }

      const summary = stored.summary as unknown as AnalysisSummary;

      // Build a daily commit count map from contributor first/last dates
      // and phases which carry per-phase commit counts with date ranges.
      // We distribute phase commits across their date range as an approximation
      // since individual commit dates per day aren't stored in AnalysisSummary.
      // Milestones have exact single dates so we count those precisely.
      const dailyMap: Record<string, number> = {};

      // Use milestones as exact data points (they each represent real dated activity)
      for (const milestone of summary.milestones) {
        const d = milestone.date.substring(0, 10);
        dailyMap[d] = (dailyMap[d] ?? 0) + 1;
      }

      // Distribute each phase's commits evenly across its calendar days
      for (const phase of summary.phases) {
        const start = new Date(phase.startDate);
        const end = new Date(phase.endDate);
        // Count calendar days in range
        const msPerDay = 86400000;
        const dayCount =
          Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
        if (dayCount <= 0) continue;
        // Commits per day (fractional, but we use weighted rounding)
        const raw = phase.commitCount / dayCount;
        for (let i = 0; i < dayCount; i++) {
          const d = new Date(start.getTime() + i * msPerDay);
          const key = d.toISOString().substring(0, 10);
          // Add fractional and accumulate; final rounding applied later
          dailyMap[key] = (dailyMap[key] ?? 0) + raw;
        }
      }

      // Round all values to integers
      for (const key of Object.keys(dailyMap)) {
        dailyMap[key] = Math.round(dailyMap[key]);
        if (dailyMap[key] <= 0) delete dailyMap[key];
      }

      // Determine target year from most recent commit
      const lastDateStr = summary.dateRange.last;
      const targetYear = lastDateStr
        ? new Date(lastDateStr).getFullYear()
        : new Date().getFullYear();

      // Find Sunday on or before Jan 1 of target year
      const jan1 = new Date(`${targetYear}-01-01T00:00:00Z`);
      const dayOfWeek = jan1.getUTCDay(); // 0 = Sunday
      const gridStart = new Date(jan1.getTime() - dayOfWeek * 86400000);

      // Build 52 weeks × 7 days
      const maxCount = Object.values(dailyMap).reduce(
        (m, v) => Math.max(m, v),
        0,
      );

      function getLevel(count: number): 0 | 1 | 2 | 3 | 4 {
        if (count === 0 || maxCount === 0) return 0;
        if (count <= maxCount * 0.25) return 1;
        if (count <= maxCount * 0.5) return 2;
        if (count <= maxCount * 0.75) return 3;
        return 4;
      }

      const weeks: HeatmapWeek[] = [];
      for (let w = 0; w < 52; w++) {
        const days: HeatmapDay[] = [];
        for (let d = 0; d < 7; d++) {
          const cellDate = new Date(
            gridStart.getTime() + (w * 7 + d) * 86400000,
          );
          const dateStr = cellDate.toISOString().substring(0, 10);
          const count = dailyMap[dateStr] ?? 0;
          days.push({ date: dateStr, count, level: getLevel(count) });
        }
        weeks.push({ days });
      }

      // Calculate stats over the flat list of days
      const allDays = weeks.flatMap((w) => w.days);
      const totalCommits = allDays.reduce((s, d) => s + d.count, 0);
      const activeDays = allDays.filter((d) => d.count > 0).length;

      // Longest streak
      let longestStreak = 0;
      let streakCurrent = 0;
      for (const day of allDays) {
        if (day.count > 0) {
          streakCurrent++;
          if (streakCurrent > longestStreak) longestStreak = streakCurrent;
        } else {
          streakCurrent = 0;
        }
      }

      // Current streak — walk backwards from today
      const todayStr = new Date().toISOString().substring(0, 10);
      const allDaysSorted = [...allDays].sort((a, b) =>
        b.date.localeCompare(a.date),
      );
      let currentStreak = 0;
      let pastToday = false;
      for (const day of allDaysSorted) {
        if (day.date > todayStr) continue;
        pastToday = true;
        if (day.count > 0) {
          currentStreak++;
        } else {
          break;
        }
      }
      if (!pastToday) currentStreak = 0;

      // Most active day
      let mostActiveDay = "";
      let mostActiveDayCount = 0;
      for (const day of allDays) {
        if (day.count > mostActiveDayCount) {
          mostActiveDayCount = day.count;
          mostActiveDay = day.date;
        }
      }

      // Most active day of week
      const DAY_NAMES = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const dowTotals: number[] = [0, 0, 0, 0, 0, 0, 0];
      for (const day of allDays) {
        const dow = new Date(day.date + "T12:00:00Z").getUTCDay();
        dowTotals[dow] += day.count;
      }
      const bestDow = dowTotals.indexOf(Math.max(...dowTotals));
      const mostActiveDayOfWeek = DAY_NAMES[bestDow];

      const averageCommitsPerActiveDay =
        activeDays === 0
          ? 0
          : Math.round((totalCommits / activeDays) * 10) / 10;

      const stats: HeatmapStats = {
        totalCommits,
        activeDays,
        longestStreak,
        currentStreak,
        mostActiveDay,
        mostActiveDayCount,
        mostActiveDayOfWeek,
        averageCommitsPerActiveDay,
      };

      const response: HeatmapResponse = {
        success: true,
        weeks,
        stats,
        year: targetYear,
        owner,
        repo,
      };

      return res.json(response);
    } catch (err) {
      next(err);
    }
  },
);
