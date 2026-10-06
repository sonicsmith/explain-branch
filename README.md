# explain-branch

A command-line tool that analyses the current Git branch and produces a **narrated explainer
video** showing what changed, how the changed code works, and how it fits the wider
application.

Explanations are **authored by you** (scaffold → author → render): each code scene walks
through the change a few lines at a time. The tool never writes narration — with no authored
plan it stops rather than emitting a mechanical script. See [`docs/cli.md`](docs/cli.md).

## Requirements

- Node.js `>= 22.18` — runs `.ts` files directly, no build step.
- macOS 15+ for Remotion rendering.
- `OPENAI_API_KEY` for narration (OpenAI Text-to-Speech API) — put it in a local `.env` file
  (copy `.env.example`) or set it in the environment.

## Quick start

Run from the repository you want explained:

```bash
npm install
npm run browser:ensure            # one-time Chrome Headless Shell download
cp .env.example .env              # then put your real OPENAI_API_KEY in .env

npm run plan -- --out artifacts/run/plan.scaffold.json   # 1. scaffold (grouping + steps)
# 2. author artifacts/run/plan.json (schema v3 — see docs/cli.md)
npm run explain -- --plan artifacts/run/plan.json        # 3. narrate → render → validate
```

`.env` is loaded automatically from the current directory (a real `OPENAI_API_KEY` in the
environment takes precedence). It is gitignored — never commit it.

The tool resolves the branch/base; you read the changed code and author the plan and per-scene
narration; then it narrates, renders, and validates the MP4. Everything is written under
`artifacts/`; it never switches branches or edits tracked files.

Outputs land in `artifacts/<run-id>/` (plan, narration script, audio clips, report); the MP4
defaults to `artifacts/branch-explainer.mp4`. Exit codes: `0` ok · `2` base/config · `3` plan
missing or invalid · `4` missing/rejected key · the renderer's code on render failure.

## Commands

| Command                  | What it does                                         |
| ------------------------ | ---------------------------------------------------- |
| `explain-branch explain` | Run the whole pipeline (narrate → render → validate) |
| `explain-branch inspect` | Print the change inventory (read-only)               |
| `explain-branch plan`    | Build the scene scaffold (no narration)              |
| `explain-branch narrate` | Generate per-scene narration audio                   |
| `explain-branch render`  | Render a narrated plan to an MP4                     |

Each is also available as `npm run inspect` / `plan` / `narrate` / `explain` / `render:narrated`.
Run `explain-branch --help` for the command list and `explain-branch <command> --help` for
options.

## Privacy

- **Sent to OpenAI:** the narration text per scene (derived from the diff). Nothing else.
- **Never sent:** the API key — read from the environment (or a local, gitignored `.env`),
  never written to the plan, logs, or video.
- Secret-looking values are redacted from narration before transmission.
- The narration voice is **AI-generated**, not a human voice.

## Docs

- [`docs/cli.md`](docs/cli.md) — command reference and the authoring workflow.
- [`docs/flags.md`](docs/flags.md) — flags, exit codes, stdout/stderr contract.
- [`docs/plan-schema.md`](docs/plan-schema.md) — plan (v3) and report schemas.
- [`docs/manual-smoke-test.md`](docs/manual-smoke-test.md) — real-API end-to-end smoke test.
- [`docs/adr/`](docs/adr/) — architecture decision records.
