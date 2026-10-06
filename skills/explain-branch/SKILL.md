---
name: explain-branch
description: Turn the current Git branch or pull request into a narrated explainer video. Use when the user asks to explain, walk through, break down, or summarise a branch or PR as a short video, or invokes explain-branch by name.
---

# explain-branch

`explain-branch` turns the current branch into a short **narrated explainer video** that walks
a viewer through what changed, how the changed code works, and how it fits the wider
application — like a developer walking another developer through a pull request.

It is a standalone Node CLI in this project (`bin/explain-branch.ts`). You drive it; it does
the work.

## What it does

The single command `npm run explain` (equivalently `explain-branch explain`) runs the whole
pipeline:

1. **Inspect** — inventory the branch's changes relative to a resolved comparison base.
2. **Author** — scaffold the scenes (grouping, source locations, walkthrough steps), then call
   a chat model to write the per-scene narration from the changed source.
3. **Narrate** — synthesise one voice clip per scene (OpenAI Text-to-Speech).
4. **Render** — produce the MP4 with Remotion.
5. **Validate** — check the plan, audio, and video, then write `report.json`.

## Prerequisites

- Node.js `>= 22.18` and `npm install` in this repository.
- `OPENAI_API_KEY` in the environment or a local `.env` (copy `.env.example`). It is used for
  both the TTS narration and the authoring chat model, and is never written to logs or output.
- macOS 15+ for rendering. Run `npm run browser:ensure` once to fetch Chrome Headless Shell.

## How to run it

Run from the repository you want explained:

```bash
npm run explain
```

Useful options:

- `--plan <plan.json>` — use your own authored plan instead of letting the CLI author one
  (useful when you want full control of the wording). Produce a starting scaffold with
  `npm run plan`.
- `--base <ref>` — comparison base (default: auto-resolved).
- `--author-model <id>` — chat model that authors the narration (default `gpt-4o-mini`).
- `--max-scenes <n>` — total scenes including the summary.
- `--voice`, `--model`, `--format` — TTS voice/model/format.
- `--out <path>` — output MP4 (default `artifacts/branch-explainer.mp4`).
- `--include-working-tree` — also analyse uncommitted changes.
- `--dry-run` — cost estimate only (needs `--plan`); writes nothing.

Run `explain-branch explain --help` for the full list. Stage commands (`inspect`, `plan`,
`narrate`, `render`) are independently runnable.

## Outputs and exit codes

Everything lands under `artifacts/<run-id>/`: `plan.json` (narrated plan), `authored-plan.json`,
`narration.txt`, `render-input.json`, `audio/`, and `report.json`. The MP4 defaults to
`artifacts/branch-explainer.mp4`. Machine-readable output (the report JSON) goes to **stdout**;
progress and the human summary go to **stderr**. Existing outputs are never silently
overwritten — a timestamped name is used unless `--overwrite`.

Exit codes: `0` success · `2` base/config could not be resolved · `3` plan missing or failed
validation · `4` missing/rejected `OPENAI_API_KEY` · the renderer's exit code on render failure ·
`1` other.

## Failure handling

- A missing key exits `4` before any planning; tell the user to set `OPENAI_API_KEY` and stop.
- An ambiguous base exits `2`; ask the user which ref to compare against and pass `--base`.
- On failure the run directory is kept and a resume command is printed. Re-running resumes
  without regenerating cached audio; add `--force` to regenerate.

## Privacy and safety

- **Sent to OpenAI:** the narration text per scene (TTS), and the redacted source excerpts for
  the referenced lines when the CLI authors the narration (chat). Nothing else.
- **Never sent:** the API key. Secret-looking values are redacted from narration **and** the
  source excerpts before transmission.
- The narration voice is **AI-generated**; surface this to the user.
- The tool is read-only with respect to tracked source: it never switches branches, commits, or
  writes tracked files. Writes go only under `artifacts/` and the output MP4.

## Reporting back

After a run, tell the user where the video and report are, and summarise the report's scenes,
omissions, and caveats. Do not claim success unless the command exited `0`.
