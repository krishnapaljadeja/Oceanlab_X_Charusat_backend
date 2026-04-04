import { Prisma } from "@prisma/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "../db/client";
import { supabase } from "../middleware/auth";
import { AnalysisSummary } from "../types";

export interface RagChunk {
  type: "commit" | "phase" | "contributor" | "milestone" | "filetree";
  text: string;
  metadata: Record<string, unknown>;
}

export interface RetrievedChunk {
  chunkType: string;
  chunkText: string;
  metadata: unknown;
  similarity: number;
}

interface MatchEmbeddingsRow {
  id: number;
  chunk_type: string;
  chunk_text: string;
  metadata: unknown;
  similarity: number;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const EMBEDDING_DIM = 768;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v : 0)).join(",")}]`;
}

function normalizeEmbedding(values: number[]): number[] {
  if (values.length === EMBEDDING_DIM) return values;

  if (values.length > EMBEDDING_DIM) {
    return values.slice(0, EMBEDDING_DIM);
  }

  return [...values, ...new Array(EMBEDDING_DIM - values.length).fill(0)];
}

export function buildChunks(summary: AnalysisSummary): RagChunk[] {
  const chunks: RagChunk[] = [];

  for (const phase of summary.phases) {
    const text = sanitizeText(
      `${phase.label} phase ran from ${phase.startDate.substring(0, 10)} to ${phase.endDate.substring(0, 10)} with ${phase.commitCount} commits. Dominant work type was ${phase.dominantType} at ${phase.velocity} velocity. Frequently touched files included ${phase.keyFiles.slice(0, 8).join(", ") || "no key files listed"}. Main contributors were ${phase.contributors.slice(0, 8).join(", ") || "unknown"}.`,
    );

    chunks.push({
      type: "phase",
      text,
      metadata: {
        label: phase.label,
        startDate: phase.startDate,
        endDate: phase.endDate,
        commitCount: phase.commitCount,
        dominantType: phase.dominantType,
        velocity: phase.velocity,
        keyFiles: phase.keyFiles,
        contributors: phase.contributors,
      },
    });
  }

  for (const contributor of summary.topContributors) {
    const text = sanitizeText(
      `${contributor.name} (login: ${contributor.login}) contributed ${contributor.commitCount} commits between ${contributor.firstCommitDate.substring(0, 10)} and ${contributor.lastCommitDate.substring(0, 10)}, primarily in ${contributor.primaryAreas.slice(0, 6).join(", ") || "unspecified areas"}.`,
    );

    chunks.push({
      type: "contributor",
      text,
      metadata: {
        name: contributor.name,
        login: contributor.login,
        commitCount: contributor.commitCount,
        primaryAreas: contributor.primaryAreas,
        firstCommitDate: contributor.firstCommitDate,
        lastCommitDate: contributor.lastCommitDate,
      },
    });
  }

  for (const milestone of summary.milestones) {
    const text = sanitizeText(
      `Milestone on ${milestone.date.substring(0, 10)}: ${milestone.title} (${milestone.type}). Significance: ${milestone.significance}.`,
    );

    chunks.push({
      type: "milestone",
      text,
      metadata: {
        date: milestone.date,
        sha: milestone.sha,
        title: milestone.title,
        type: milestone.type,
        significance: milestone.significance,
      },
    });
  }

  const repoText = sanitizeText(
    `${summary.repoMeta.fullName} is a ${summary.repoMeta.language || "mixed-language"} repository. ${summary.repoMeta.description || "No description provided."} It has ${summary.totalCommitsInRepo} commits from ${summary.dateRange.first.substring(0, 10)} to ${summary.dateRange.last.substring(0, 10)} with commit quality score ${summary.commitQualityScore}. Commit type breakdown: ${Object.entries(summary.commitTypeBreakdown)
      .map(([type, count]) => `${type}: ${count}`)
      .join(", ")}.`,
  );

  chunks.push({
    type: "filetree",
    text: repoText,
    metadata: {
      fullName: summary.repoMeta.fullName,
      description: summary.repoMeta.description,
      language: summary.repoMeta.language,
      totalCommitsInRepo: summary.totalCommitsInRepo,
      dateRange: summary.dateRange,
      commitQualityScore: summary.commitQualityScore,
      commitTypeBreakdown: summary.commitTypeBreakdown,
    },
  });

  return chunks;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const vectors: number[][] = [];
  const models = [
    process.env.GEMINI_EMBED_MODEL_PRIMARY || "gemini-embedding-001",
    process.env.GEMINI_EMBED_MODEL_SECONDARY || "gemini-embedding-2-preview",
    process.env.GEMINI_EMBED_MODEL_FALLBACK || "gemini-embedding-exp-03-07",
    "text-embedding-004",
    "embedding-001",
  ];

  for (const text of texts) {
    let embedded = false;
    let lastError: unknown = null;

    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.embedContent(text);
        const values = result.embedding.values || [];

        if (!Array.isArray(values) || values.length === 0) {
          throw new Error(
            `Unexpected embedding length ${values.length} for model ${modelName}`,
          );
        }

        vectors.push(normalizeEmbedding(values));
        embedded = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!embedded) {
      console.error("[RAG] embedTexts failed across models:", models);
      throw lastError instanceof Error
        ? lastError
        : new Error("Embedding generation failed");
    }

    await sleep(100);
  }

  return vectors;
}

export async function indexAnalysis(
  userId: string,
  owner: string,
  repo: string,
  summary: AnalysisSummary,
): Promise<void> {
  try {
    const chunks = buildChunks(summary);
    if (chunks.length === 0) return;

    const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));

    await prisma.$executeRaw`
      DELETE FROM embeddings
      WHERE user_id = ${userId} AND owner = ${owner} AND repo = ${repo}
    `;

    const values = chunks.map((chunk, index) => {
      const embedding = embeddings[index] || [];
      return Prisma.sql`(
        ${userId},
        ${owner},
        ${repo},
        ${chunk.type},
        ${chunk.text},
        ${vectorLiteral(embedding)}::vector,
        ${JSON.stringify(chunk.metadata)}::jsonb
      )`;
    });

    await prisma.$executeRaw`
      INSERT INTO embeddings (
        user_id,
        owner,
        repo,
        chunk_type,
        chunk_text,
        embedding,
        metadata
      )
      VALUES ${Prisma.join(values)}
    `;

    console.log(
      `[RAG] indexAnalysis success: ${chunks.length} chunks indexed for ${owner}/${repo} (user=${userId})`,
    );
  } catch (error) {
    console.error("[RAG] indexAnalysis failed:", error);
  }
}

export async function retrieveChunks(
  userId: string,
  owner: string,
  repo: string,
  query: string,
  topK: number = 12,
): Promise<RetrievedChunk[]> {
  try {
    if (!supabase) return [];

    const [queryEmbedding] = await embedTexts([query]);

    const { data, error } = await supabase.rpc("match_embeddings", {
      query_embedding: vectorLiteral(queryEmbedding),
      match_count: topK,
      p_user_id: userId,
      p_owner: owner,
      p_repo: repo,
    });

    if (error) {
      console.error("[RAG] retrieveChunks rpc failed:", error.message);
      return [];
    }

    const rows = (data || []) as MatchEmbeddingsRow[];
    console.log(
      `[RAG] retrieveChunks fetched: ${rows.length} chunks for ${owner}/${repo} (user=${userId}, topK=${topK})`,
    );
    return rows.map((row) => ({
      chunkType: row.chunk_type,
      chunkText: row.chunk_text,
      metadata: row.metadata,
      similarity: row.similarity,
    }));
  } catch (error) {
    console.error("[RAG] retrieveChunks failed:", error);
    return [];
  }
}
