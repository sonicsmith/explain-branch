# Flag reference

## Orchestrator — `src/cli/explainBranchVideo.ts` (`npm run explain`)

The single end-to-end command: inspect → plan → narrate → render → validate. Requires no
arguments; it writes only under the run directory and `--out`.

| Flag                     | Meaning                                                   | Default                                                    |
| ------------------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| `--base <ref>`           | Comparison base                                           | auto-resolved (flag > config > upstream > `main`/`master`) |
| `--include-working-tree` | Include uncommitted working-tree changes                  | `false`                                                    |
| `--max-scenes <n>`       | Total scenes including the summary                        | `5` (or project config)                                    |
| `--provider <name>`      | Narration provider                                        | `openai`                                                   |
| `--model <id>`           | TTS model                                                 | `gpt-4o-mini-tts`                                          |
| `--voice <name>`         | Voice                                                     | `marin`                                                    |
| `--format <fmt>`         | Audio format (`mp3`/`opus`/`aac`/`flac`/`wav`/`pcm`)      | `wav`                                                      |
| `--instructions <txt>`   | Tone/style instructions (`gpt-4o-mini-tts` only)          | built-in default                                           |
| `--out <path>`           | Output MP4                                                | `<repo>/artifacts/branch-explainer.mp4`                    |
| `--run-id <id>`          | Run directory name                                        | sanitised branch name                                      |
| `--run-dir <path>`       | Explicit run directory                                    | `<repo>/artifacts/<run-id>`                                |
| `--force`                | Ignore the resume checkpoint (re-plan and regenerate)     | `false`                                                    |
| `--overwrite`            | Replace an existing output                                | `false` (a timestamped name is used)                       |
| `--dry-run`              | Plan + cost estimate only; no audio, no render, no writes | `false`                                                    |
| `--stdout`               | Plan-only: print the scene plan JSON and stop             | `false`                                                    |
| `--repo <path>`          | Path inside the repository                                | cwd                                                        |
| `-h`, `--help`           | Show help                                                 | —                                                          |

### Exit codes

`0` success · `2` base/config could not be resolved · `3` plan failed validation ·
`4` missing/rejected `OPENAI_API_KEY` · the renderer's exit code on render failure · `1` other.

### stdout / stderr

- **stdout** carries only the machine-readable result: the run report JSON on success, the
  plan JSON with `--stdout`, a JSON summary with `--dry-run`.
- **stderr** carries the stage banners, pre-flight disclosure, narration progress, warnings,
  and the human summary.

## Project config

Set defaults once in `.explain-branch.json` (or `package.json` → `explainBranch`):

```json
{
  "base": "main",
  "maxScenes": 5,
  "narration": { "voice": "cedar", "model": "gpt-4o-mini-tts", "format": "wav" }
}
```

Narration precedence: CLI flag > `.explain-branch.json` > `package.json` >
`EXPLAIN_BRANCH_TTS_*` env > built-in defaults.

## Stage CLIs (independently runnable)

| Command                   | What it does                           | Notable flags                                                                                 |
| ------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run inspect`         | Print the change inventory (read-only) | `--base`, `--include-working-tree`, `--repo`, `--json`                                        |
| `npm run plan`            | Build a validated scene plan           | `--base`, `--include-working-tree`, `--repo`, `--out`, `--max-scenes`, `--stdout`             |
| `npm run narrate`         | Generate per-scene narration audio     | `--plan`, `--run-id`/`--run-dir`, `--out`, `--dry-run`, `--force`, `--scene`, narration flags |
| `npm run render:narrated` | Render a narrated plan to MP4          | `--plan`, `--out`, `--overwrite`                                                              |

## Invocation contract (skill → CLI)

- **Codex surface:** the skill is invoked as `$explain-branch`; the Claude/other surface uses
  `/explain-branch`.
- The host sets **`PLUGIN_ROOT`** to the plugin directory and runs the skill with the target
  repository as the **cwd**. The skill runs:
  `node "${PLUGIN_ROOT}/src/cli/explainBranchVideo.ts" [flags…]`
- Flags are passed through as **argv** unchanged. All paths are resolved against the cwd
  (the repository being explained) unless `--repo` is given.

> The exact trigger token and argv/stdin contract must be confirmed in the target client
> (no Codex CLI is available in this environment). See
> `docs/adr/0003-phase-5-integration-decisions.md` (Decision 6).
