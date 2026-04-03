import { Analysis, Prisma } from "@prisma/client";
import { prisma } from "./client";
import { RepoMeta, AnalysisSummary, GeneratedNarrative } from "../types";

export async function getStoredAnalysis(
  owner: string,
  repo: string,
): Promise<Analysis | null> {
  try {
    return await prisma.analysis.findUnique({
      where: { owner_repo: { owner, repo } },
    });
  } catch (error) {
    console.error("[DB] getStoredAnalysis failed:", error);
    return null;
  }
}

export async function saveAnalysis(
  owner: string,
  repo: string,
  commitCount: number,
  repoMeta: RepoMeta,
  summary: AnalysisSummary,
  narrative: GeneratedNarrative,
): Promise<void> {
  try {
    await prisma.analysis.upsert({
      where: { owner_repo: { owner, repo } },
      create: {
        owner,
        repo,
        fullName: `${owner}/${repo}`,
        commitCount,
        repoMeta: repoMeta as unknown as Prisma.InputJsonValue,
        summary: summary as unknown as Prisma.InputJsonValue,
        narrative: narrative as unknown as Prisma.InputJsonValue,
      },
      update: {
        analyzedAt: new Date(),
        commitCount,
        repoMeta: repoMeta as unknown as Prisma.InputJsonValue,
        summary: summary as unknown as Prisma.InputJsonValue,
        narrative: narrative as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("[DB] saveAnalysis failed:", error);
  }
}

export async function listAllAnalyses(): Promise<Analysis[]> {
  try {
    return await prisma.analysis.findMany({
      orderBy: { analyzedAt: "desc" },
    });
  } catch (error) {
    console.error("[DB] listAllAnalyses failed:", error);
    return [];
  }
}

export async function deleteAnalysis(
  owner: string,
  repo: string,
): Promise<void> {
  try {
    await prisma.analysis.deleteMany({
      where: { owner, repo },
    });
  } catch (error) {
    console.error("[DB] deleteAnalysis failed:", error);
    throw error;
  }
}

export async function getStoredCommitCount(
  owner: string,
  repo: string,
): Promise<number | null> {
  try {
    const result = await prisma.analysis.findUnique({
      where: { owner_repo: { owner, repo } },
      select: { commitCount: true },
    });
    return result?.commitCount ?? null;
  } catch (error) {
    console.error("[DB] getStoredCommitCount failed:", error);
    return null;
  }
}
