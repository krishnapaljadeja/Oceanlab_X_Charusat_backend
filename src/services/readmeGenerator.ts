import { fetchRepoDigest } from "../utils/gitingestFetcher";
import { generateText } from "./llm";

export interface GeneratedReadmeDoc {
  readme: string;
}

export async function generateReadmeFromDigest(
  repoUrl: string,
  digest: { tree: string; content: string },
): Promise<string> {
  const prompt = `You are a senior technical writer. Generate a complete, polished, visually attractive README.md for this repository.

Repository URL:
${repoUrl}

Repository digest (directory tree + key config files):
${digest.tree}

${digest.content}

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
