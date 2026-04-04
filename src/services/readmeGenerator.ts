import { fetchRepoDigest } from "../utils/gitingestFetcher";
import { generateText } from "./llm";

export interface GeneratedReadmeDoc {
  readme: string;
}

function getReadmePromptCharBudget(): number {
  const parsed = Number.parseInt(
    process.env.INGEST_PROMPT_MAX_CHARS || "160000 ",
    10,
  );
  if (!Number.isFinite(parsed) || parsed < 50000) {
    return 160000 ;
  }
  return parsed;
}

function trimForPrompt(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  const kept = input.slice(0, maxChars);
  const omitted = input.length - kept.length;
  return `${kept}\n\n[TRUNCATED: omitted ${omitted} characters to fit model context budget]`;
}

export async function generateReadmeFromDigest(
  repoUrl: string,
  digest: { tree: string; content: string },
): Promise<string> {
  const promptBudget = getReadmePromptCharBudget();
  const treeBudget = Math.floor(promptBudget * 0.2);
  const contentBudget = promptBudget - treeBudget;

  const boundedTree = trimForPrompt(digest.tree || "", treeBudget);
  const boundedContent = trimForPrompt(digest.content || "", contentBudget);

  const prompt = `You are a senior technical writer. Generate a complete, polished, visually attractive README.md for this repository.

Repository URL:
${repoUrl}

Repository digest (directory tree + key config files):
${boundedTree}

${boundedContent}

Generate a README.md with these exact sections:
1. Project title and one-line description
2. Features (bullet list, inferred from commits and file structure)
3. Tech Stack (table: Technology | Purpose)
4. Getting Started (Prerequisites, Installation, Environment setup, Running locally)
5. Project Structure (brief explanation of top-level folders)
6. Contributors (table with login and their specialization)
7. License (placeholder: MIT)

Quality/style requirements:
- Use clean markdown hierarchy with strong headings and concise sections.
- Add a short badge row near the top (language/framework/build-style badges inferred from files).
- Add a compact table of contents under the intro.
- Add tasteful emoji/symbol accents in section headings and key bullets (for example: ⚡, 🧩, 🛠️, 🚀), but keep it professional and readable.
- Use lightweight visual structure like callouts (blockquote lines) and checkmark bullets where helpful.
- Prefer concrete commands and realistic examples, not placeholder prose.
- Keep wording crisp and product-like, avoid fluff.
- Output only valid Markdown.

Be concrete and specific. Do not use generic filler text. Output only valid Markdown.`;

  return generateText(prompt);
}

export async function generateRepoDocs(
  repoUrl: string,
): Promise<GeneratedReadmeDoc> {
  const digest = await fetchRepoDigest(repoUrl, {
    includePatterns: [
      "package.json",
      "requirements.txt",
      "Cargo.toml",
      "go.mod",
      "Dockerfile",
      "docker-compose.yml",
      "compose.yml",
      ".env.example",
      "*.config.*",
      "README.md",
      ".github/workflows/*.yml",
    ],
    maxFileSize: 30720,
  });

  const readme = await generateReadmeFromDigest(repoUrl, digest);

  return {
    readme,
  };
}
