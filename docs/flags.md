# Flag reference

## Orchestrator — `src/cli/explainBranchVideo.ts` (`npm run explain`)

The single command that narrates, renders, and validates an **authored plan**: narrate →
render → validate. It requires `--plan`; it writes only under the run directory and `--out`.

The explanations are authored by you, not by the script. Use `npm run plan` for a scaffold
first (see [`cli.md`](./cli.md)).

| Flag                     | Meaning                                                      | Default                                                                    |
| ------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `--plan <path>`          | Authored plan JSON to narrate and render                     | **required** unless `--stdout`                                             |
| `--base <ref>`           | Comparison base                                              | auto-resolved (flag > config > `origin/HEAD` > upstream > `main`/`master`) |
| `--include-working-tree` | Include uncommitted working-tree changes                     | `false`                                                                    |
| `--max-scenes <n>`       | Total scenes including the summary                           | `5` (or project config)                                                    |
| `--provider <name>`      | Narration provider                                           | `openai`                                                                   |
| `--model <id>`           | TTS model                                                    | `gpt-4o-mini-tts`                                                          |
| `--voice <name>`         | Voice                                                        | `marin`                                                                    |
| `--format <fmt>`         | Audio format (`mp3`/`opus`/`aac`/`flac`/`wav`/`pcm`)         | `wav`                                                                      |
| `--instructions <txt>`   | Tone/style instructions (`gpt-4o-mini-tts` only)             | built-in default                                                           |
| `--out <path>`           | Output MP4                                                   | `<repo>/artifacts/branch-explainer.mp4`                                    |
| `--run-id <id>`          | Run directory name                                           | sanitised branch name                                                      |
| `--run-dir <path>`       | Explicit run directory                                       | `<repo>/artifacts/<run-id>`                                                |
| `--force`                | Ignore the resume checkpoint (re-plan and regenerate)        | `false`                                                                    |
| `--overwrite`            | Replace an existing output                                   | `false` (a timestamped name is used)                                       |
| `--dry-run`              | Narration cost estimate only; no audio, no render, no writes | `false`                                                                    |
| `--stdout`               | Scaffold-only: print the scene scaffold JSON and stop        | `false`                                                                    |
| `--repo <path>`          | Path inside the repository                                   | cwd                                                                        |
| `-h`, `--help`           | Show help                                                    | —                                                                          |

### Exit codes

`0` success · `2` base/config could not be resolved · `3` plan missing or failed validation ·
`4` missing/rejected `OPENAI_API_KEY` · the renderer's exit code on render failure · `1` other.

### stdout / stderr

- **stdout** carries only the machine-readable result: the run report JSON on success, the
  scaffold JSON with `--stdout`, a JSON summary with `--dry-run`.
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

| Command                   | What it does                                | Notable flags                                                                                 |
| ------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm run inspect`         | Print the change inventory (read-only)      | `--base`, `--include-working-tree`, `--repo`, `--json`                                        |
| `npm run plan`            | Build the scene **scaffold** (no narration) | `--base`, `--include-working-tree`, `--repo`, `--out`, `--max-scenes`, `--stdout`             |
| `npm run narrate`         | Generate per-scene narration audio          | `--plan`, `--run-id`/`--run-dir`, `--out`, `--dry-run`, `--force`, `--scene`, narration flags |
| `npm run render:narrated` | Render a narrated plan to MP4               | `--plan`, `--out`, `--overwrite`                                                              |

## Invocation contract

- The entry point is `bin/explain-branch.ts`, dispatched as `explain-branch <command> [flags…]`
  (or `npm run <script> -- [flags…]`). Each subcommand re-execs the stage CLI in its own `node`
  process, so exit codes and stdio pass through unchanged.
- Run from the repository being explained (**cwd**). All paths resolve against the cwd unless
  `--repo` is given.
- Flags are passed through as **argv** unchanged.
