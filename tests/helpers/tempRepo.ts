import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FIXED_DATE = "2020-01-01T00:00:00Z";

function execText(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: FIXED_DATE,
          GIT_COMMITTER_DATE: FIXED_DATE,
          GIT_TERMINAL_PROMPT: "0",
        },
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

/**
 * A throwaway Git repository used by integration tests. Built on demand so fixture
 * repositories never live inside the project's own history.
 */
export class TempRepo {
  readonly dir: string;

  private constructor(dir: string) {
    this.dir = dir;
  }

  static async create(initialBranch = "main"): Promise<TempRepo> {
    const dir = await realpath(
      await mkdtemp(path.join(tmpdir(), "explain-branch-test-")),
    );
    const repo = new TempRepo(dir);
    await repo.git(["init", "-b", initialBranch]);
    await repo.git(["config", "user.name", "Test User"]);
    await repo.git(["config", "user.email", "test@example.com"]);
    await repo.git(["config", "commit.gpgsign", "false"]);
    return repo;
  }

  /** Clones a local temp repo with a shallow history. Returns the clone directory. */
  static async shallowClone(sourceDir: string, depth = 1): Promise<string> {
    const parent = await realpath(
      await mkdtemp(path.join(tmpdir(), "explain-branch-clone-")),
    );
    const target = path.join(parent, "clone");
    await execText(
      "git",
      ["clone", "--depth", String(depth), `file://${sourceDir}`, target],
      parent,
    );
    return target;
  }

  async git(args: readonly string[]): Promise<string> {
    const { stdout } = await execText("git", args, this.dir);
    return stdout;
  }

  async tryGit(args: readonly string[]): Promise<string | null> {
    try {
      return await this.git(args);
    } catch {
      return null;
    }
  }

  async write(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.dir, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
  }

  async commit(message: string): Promise<string> {
    await this.git(["add", "-A"]);
    await this.git(["commit", "--no-verify", "-m", message]);
    return (await this.git(["rev-parse", "HEAD"])).trim();
  }

  async cleanup(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}
