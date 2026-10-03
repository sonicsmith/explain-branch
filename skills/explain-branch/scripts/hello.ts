#!/usr/bin/env node
/**
 * Phase 0 placeholder script for the `explain-branch` skill.
 *
 * Purpose: prove that the plugin can execute a local TypeScript file and that we can
 * observe how Codex invokes it. It performs no branch analysis and reads nothing from
 * the repository.
 *
 * Run directly (Node >= 22.18 / 24 strips types, no build step):
 *   node skills/explain-branch/scripts/hello.ts --demo
 *
 * Exit code 0 on success.
 */

const args: string[] = process.argv.slice(2);

function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return Promise.resolve("");
  }

  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main(): Promise<void> {
  const stdin = (await readStdin()).trim();

  const report = {
    status: "ok",
    message: "explain-branch skeleton ran successfully",
    node: process.version,
    cwd: process.cwd(),
    pluginRoot: process.env.PLUGIN_ROOT ?? null,
    pluginData: process.env.PLUGIN_DATA ?? null,
    args,
    stdinBytes: Buffer.byteLength(stdin, "utf8"),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ status: "error", message: String(error) }, null, 2),
  );
  process.exitCode = 1;
});
