import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export interface GitingestResult {
  summary: string;
  tree: string;
  content: string;
}

type GitingestRunnerPayload = {
  success: boolean;
  summary?: string;
  tree?: string;
  content?: string;
  error?: string;
};

function redactSensitive(input: string): string {
  return input
    .replace(/ghp_[A-Za-z0-9_]+/g, "ghp_[REDACTED]")
    .replace(
      /Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/gi,
      "Authorization: Basic [REDACTED]",
    );
}

function summarizeOutputForError(output: string): string {
  const redacted = redactSensitive(output || "").trim();
  if (!redacted) return "(empty output)";

  const lines = redacted
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const tail = lines.slice(-6).join("\n");
  return tail.length > 3000 ? `${tail.slice(-3000)}\n[TRUNCATED]` : tail;
}

function parseRunnerOutput(stdout: string): GitingestRunnerPayload {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error("Failed to parse gitingest output: empty stdout");
  }

  try {
    return JSON.parse(trimmed) as GitingestRunnerPayload;
  } catch {
    // Some hosted environments emit JSON logs line-by-line before the final payload.
    // Parse each line from bottom-up and pick the first object with a `success` field.
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (!line.startsWith("{") || !line.endsWith("}")) {
        continue;
      }

      try {
        const parsed = JSON.parse(line) as GitingestRunnerPayload;
        if (typeof parsed.success === "boolean") {
          return parsed;
        }
      } catch {
        // continue scanning
      }
    }

    throw new Error(
      `Failed to parse gitingest output: ${summarizeOutputForError(trimmed)}`,
    );
  }
}

export async function fetchRepoDigest(
  repoUrl: string,
  options?: {
    includePatterns?: string[];
    excludePatterns?: string[];
    maxFileSize?: number;
  },
): Promise<GitingestResult> {
  const scriptPath = path.resolve(
    __dirname,
    "../../scripts/gitingest_runner.py",
  );

  const scriptArgs = [scriptPath, repoUrl];
  if (options?.includePatterns?.length) {
    scriptArgs.push("--include", options.includePatterns.join(","));
  }
  if (options?.excludePatterns?.length) {
    scriptArgs.push("--exclude", options.excludePatterns.join(","));
  }
  if (options?.maxFileSize) {
    scriptArgs.push("--max-size", String(options.maxFileSize));
  }

  const configuredBin = process.env.GITINGEST_PYTHON_BIN?.trim();
  const candidates: Array<{ cmd: string; preArgs: string[] }> = [];
  if (configuredBin) {
    candidates.push({ cmd: configuredBin, preArgs: [] });
  }

  function addPythonInstallPathCandidates(baseDir: string): void {
    if (!baseDir || !fs.existsSync(baseDir)) return;

    try {
      const dirs = fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter(
          (entry) => entry.isDirectory() && /^Python\d+/i.test(entry.name),
        )
        .map((entry) => entry.name);

      for (const dir of dirs) {
        const pythonExe = path.join(baseDir, dir, "python.exe");
        if (fs.existsSync(pythonExe)) {
          candidates.push({ cmd: pythonExe, preArgs: [] });
        }
      }
    } catch {
      // ignore probing errors and continue with command candidates
    }
  }

  if (process.platform === "win32") {
    candidates.push(
      { cmd: "py", preArgs: ["-3"] },
      { cmd: "python", preArgs: [] },
      { cmd: "python3", preArgs: [] },
    );

    const localProgramsPython = path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "Python",
    );
    addPythonInstallPathCandidates(localProgramsPython);

    const programFilesPython = path.join(
      process.env.ProgramFiles || "",
      "Python",
    );
    addPythonInstallPathCandidates(programFilesPython);

    const programFilesX86Python = path.join(
      process.env["ProgramFiles(x86)"] || "",
      "Python",
    );
    addPythonInstallPathCandidates(programFilesX86Python);
  } else {
    candidates.push(
      { cmd: "python3", preArgs: [] },
      { cmd: "python", preArgs: [] },
    );
  }

  const uniqueCandidates = candidates.filter(
    (candidate, index, arr) =>
      arr.findIndex(
        (x) =>
          x.cmd === candidate.cmd &&
          x.preArgs.join(" ") === candidate.preArgs.join(" "),
      ) === index,
  );

  function candidateDisplay(candidate: {
    cmd: string;
    preArgs: string[];
  }): string {
    return [candidate.cmd, ...candidate.preArgs].join(" ").trim();
  }

  async function runWithCandidate(
    candidateIndex: number,
    lastError?: string,
  ): Promise<GitingestResult> {
    if (candidateIndex >= uniqueCandidates.length) {
      throw new Error(
        lastError || "gitingest failed: no Python executable found",
      );
    }

    const candidate = uniqueCandidates[candidateIndex];
    const args = [...candidate.preArgs, ...scriptArgs];

    return new Promise<GitingestResult>((resolve, reject) => {
      const proc = spawn(candidate.cmd, args, { timeout: 120000 });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const maybeRetry = (message: string) => {
        runWithCandidate(candidateIndex + 1, message)
          .then(resolve)
          .catch(reject);
      };

      proc.on("close", (code) => {
        const combined = (stderr || stdout || "").trim();
        if (code !== 0) {
          const maybeMissingPython =
            /not found|No such file|is not recognized|App execution aliases/i.test(
              combined,
            );
          const maybeMissingGitingest =
            /No module named ['\"]?gitingest['\"]?/i.test(combined);

          if (maybeMissingPython) {
            maybeRetry(`gitingest failed: ${combined}`);
            return;
          }

          if (maybeMissingGitingest) {
            if (candidateIndex < uniqueCandidates.length - 1) {
              maybeRetry(`gitingest failed: ${combined}`);
              return;
            }

            const chosen = candidateDisplay(candidate);
            reject(
              new Error(
                `gitingest is not installed in the Python environment used by "${chosen}". Install it with "${chosen} -m pip install gitingest" (or set GITINGEST_PYTHON_BIN to a Python that has gitingest). Original error: ${combined}`,
              ),
            );
            return;
          }

          reject(new Error(`gitingest failed: ${combined}`));
          return;
        }

        try {
          const result = parseRunnerOutput(stdout);

          if (!result.success) {
            reject(new Error(result.error || "Unknown gitingest failure"));
            return;
          }

          resolve({
            summary: result.summary || "",
            tree: result.tree || "",
            content: result.content || "",
          });
        } catch {
          reject(
            new Error(
              `Failed to parse gitingest output: ${summarizeOutputForError(stdout)}`,
            ),
          );
        }
      });

      proc.on("error", (err) => {
        maybeRetry(`gitingest failed: ${String(err.message || err)}`);
      });
    });
  }

  return runWithCandidate(0);
}
