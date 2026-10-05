# explain-branch

A Codex plugin/skill that analyses the current Git branch and produces a **narrated
explainer video** showing what changed, how the changed code works, and how it fits the
wider application.

Explanations are **authored by the host coding agent** (scaffold → author → render): each code
scene walks through the change a few lines at a time. The script never writes narration — with
no authored plan it stops rather than emitting a mechanical script. See
[`skills/explain-branch/SKILL.md`](skills/explain-branch/SKILL.md).

## Requirements

- Node.js `>= 22.18` — runs `.ts` files directly, no build step.
- macOS 15+ for Remotion rendering.
- `OPENAI_API_KEY` in the environment for narration (OpenAI Text-to-Speech API).

## Run in Codex (primary path)

Narration is a local script calling the OpenAI Speech API, so the key must be in the
environment **of the process that launches Codex**. Today that means running Codex from a
terminal where the key is exported:

```bash
npm install
npm run browser:ensure            # one-time Chrome Headless Shell download
export OPENAI_API_KEY=sk-...      # read from the environment only

codex                             # launch Codex from this shell
```

Then, inside Codex, from the repository you want explained:

```text
$explain-branch
```

The agent resolves the branch/base, builds a scaffold, reads the changed code, authors the
plan and per-scene narration, then narrates, renders, and validates the MP4. Everything is
written under `artifacts/`; it never switches branches or edits tracked files.

> **Desktop app:** the ChatGPT desktop app does not inherit your shell environment, so the
> exported key will not reach it. There is no supported way to supply the key to the desktop
> app yet — run the plugin from the Codex CLI.

## Run from the command line (fallback)

Same pipeline without the agent; you author `plan.json` yourself:

```bash
npm run plan -- --out artifacts/run/plan.scaffold.json   # 1. scaffold (grouping + steps)
# 2. author artifacts/run/plan.json (schema v3 — see the skill docs)
npm run explain -- --plan artifacts/run/plan.json        # 3. narrate → render → validate
```

Outputs land in `artifacts/<run-id>/` (plan, narration script, audio clips, report); the MP4
defaults to `artifacts/branch-explainer.mp4`. Exit codes: `0` ok · `2` base/config · `3` plan
missing or invalid · `4` missing/rejected key · the renderer's code on render failure.

## Privacy

- **Sent to OpenAI:** the narration text per scene (derived from the diff). Nothing else.
- **Never sent:** the API key — read from the environment only, never written to the plan,
  logs, or video.
- Secret-looking values are redacted from narration before transmission.
- The narration voice is **AI-generated**, not a human voice.

## Docs

- [`skills/explain-branch/SKILL.md`](skills/explain-branch/SKILL.md) — the skill and workflow.
- [`skills/explain-branch/references/flags.md`](skills/explain-branch/references/flags.md) — flags, exit codes, invocation.
- [`skills/explain-branch/references/plan-schema.md`](skills/explain-branch/references/plan-schema.md) — plan (v3) and report schemas.
- [`docs/manual-smoke-test.md`](docs/manual-smoke-test.md) — real-API end-to-end smoke test.
- [`docs/adr/`](docs/adr/) — architecture decision records.
