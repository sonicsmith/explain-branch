# ADR 0001 — Phase 0: Tooling and Platform Decisions

- **Status:** Accepted
- **Date:** 2026-10-03
- **Phase:** 0 (Verify tooling) — see [`plan/phase-0.md`](../../plan/phase-0.md)
- **Scope:** Records the five decisions required by Phase 0. No product features are
  built here; these decisions de-risk Phases 1–6.

> **Historical note (2026-10-06):** the plugin/skill packaging described in Decision 1 was
> removed in [ADR 0005](0005-drop-plugin-packaging.md). The project is now a standalone CLI;
> see [`docs/cli.md`](../cli.md). The rest of this ADR is retained as a record.

## Context

The plan depends on four external systems: the Codex plugin/skill format, a local
TypeScript runtime, the Remotion renderer, and a TTS provider. Each was verified against
current official documentation plus a local experiment rather than from memory.

Target / verified environment:

| Item          | Value                                     | Source             |
| ------------- | ----------------------------------------- | ------------------ |
| Platform      | macOS 26.6.2 (build 25G83), Apple silicon | `sw_vers`          |
| Node.js       | v24.21.0                                  | `node --version`   |
| npm           | 11.19.0                                   | `npm --version`    |
| git           | 2.55.0                                    | `git --version`    |
| System FFmpeg | **not installed**                         | `which ffmpeg`     |
| Codex CLI     | **not installed** (`~/.codex` absent)     | `command -v codex` |

The absence of a local Codex CLI is a hard limit on verification: the plugin can be
authored to the documented conventions and smoke-tested locally, but the final
"invoked from Codex" step must be confirmed by the user in the ChatGPT desktop app /
Codex client. Open items are listed at the end.

---

## Decision 1 — Plugin entry point and invocation mechanism

**Decision.** Ship a **portable Agent Plugins package** at the repository root, with an
optional Codex compatibility overlay:

- `plugin.json` at the plugin root — the portable entry point
  (`$schema: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, `name`,
  `version`, `description`). Codex-specific metadata lives under `extensions.com.openai`.
- `.codex-plugin/plugin.json` — compatibility fallback that declares
  `"skills": "./skills/"`. It is only consulted when the inline `extensions.com.openai`
  object is absent (the two are _not_ merged).
- Skills are discovered from the fixed root path `skills/`; each skill is
  `skills/<skill-name>/SKILL.md` with YAML frontmatter `name` + `description`.
- Supporting material sits beside the skill: `references/`, `assets/`, and `scripts/`
  (the docs explicitly recommend `scripts/` for deterministic computation).
- Local executable code is allowed: skill `scripts/` and plugin lifecycle hooks
  (`hooks/hooks.json`, `type: "command"`). Hook commands run with `PLUGIN_ROOT` and
  `PLUGIN_DATA` (and `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`) set in the environment.
- Local testing uses a **repo marketplace** at `.agents/plugins/marketplace.json`; a
  personal marketplace would live at `~/.agents/plugins/marketplace.json`.

**Invocation.** Codex/ChatGPT surfaces skills by name with a `$` prefix (documented
examples: `$plugin-creator`, `$skill-creator`, `$remotion`). The plan's
`/explain-branch` spelling is the Claude Code / other-host surface. **Our skill is
therefore invoked as `$explain-branch` in Codex**, and `skills/explain-branch/SKILL.md`
is written so its `description` triggers on branch/PR explainer requests. Confirm the
exact token in the target client at handoff (open item #1).

**Rejected alternatives.** A legacy-only `.codex-plugin/plugin.json` package (no
forward path for other Agent Plugins hosts) and a bare `skills/` folder with no
manifest (no stable identity, no marketplace distribution).

**Evidence.**

- Package your plugin — <https://developers.openai.com/plugins/build/plugins>
  (portable `plugin.json`, `extensions.com.openai`, `.codex-plugin/plugin.json`
  fallback, `skills/` discovery, `hooks/hooks.json` + `PLUGIN_ROOT`/`PLUGIN_DATA`,
  marketplace files at `.agents/plugins/marketplace.json`).
- Build skills — <https://developers.openai.com/plugins/build/skills.md>
  (`SKILL.md` frontmatter, `references/`/`assets/`/`scripts/`, `$`-prefixed invocation).

---

## Decision 2 — How TypeScript code will be executed

**Decision.** Run TypeScript files **directly with Node's built-in type stripping** for
all local scripts; use `tsc` only for type-checking, and keep `tsx` as a fallback for
runtimes older than Node 22.18.

- Node ≥ 22.18 / 24 executes `.ts` files directly, no flag required. Verified locally:
  a typed `.ts` file printed `hello phase-0` with `exit=0` under Node v24.21.0.
- Because scripts run as native ESM, relative imports use explicit extensions, so the
  project sets `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`,
  `"allowImportingTsExtensions": true`, and `"noEmit": true`.
- Type-checking: `npx tsc --noEmit` (TypeScript pinned to `^5.9.3`; `latest` is the new
  TypeScript 7 line and is deliberately avoided to limit tooling churn).
- Data exchange: arguments arrive via `process.argv`; structured data via stdin/stdout
  as JSON; a non-zero exit code signals failure. Working directory is the user's
  repository (to be confirmed — open item #2).
- No bundler is required for local scripts. Remotion bundles its own compositions
  separately at render time.

**Evidence.**

- Local probe (`/tmp/_ts_probe.ts` → `node _ts_probe.ts` → `hello phase-0`, `exit=0`).
- Node.js type-stripping is on by default from v23.6.0 and backported to v22.18.0.

---

## Decision 3 — How the renderer will run + system dependencies

**Decision.** Use **Remotion 4.0.532** with **React / React-DOM 19.3.0**, invoked via the
Remotion CLI (`npx remotion render`) and/or the programmatic `@remotion/renderer` API.

- Pin every `remotion`/`@remotion/*` package to the **same exact version** (4.0.532):
  `remotion`, `@remotion/cli`, `@remotion/bundler`, `@remotion/renderer`.
- Remotion v4 requires **Node ≥ 16** (v5 would raise this to 22) and **macOS 15+
  (Sequoia)**. The host (Node 24, macOS 26.6.2) satisfies both.
- **Chrome Headless Shell is downloaded and pinned by Remotion** into
  `node_modules/.remotion/chrome-headless-shell/<platform>/`. Pre-provision before long
  runs with `npx remotion browser ensure`. Do not point Remotion at a system Chrome.
- **FFmpeg is bundled with Remotion v4** (the `--ffmpeg-executable` flag was removed in
  v4). The host has no system `ffmpeg`; this is fine.
- Render invocation: `npx remotion render <entry-point> <composition-id> <output>`; pass
  `--props` via a **file** (inline JSON breaks on Windows shells); use `--overwrite=false`
  to protect existing outputs.
- **Licensing:** Remotion ships under a special licence that requires a company licence
  in some cases — confirm eligibility before distribution.
- Remotion publishes its own Codex plugin + Agent Skills (`npx skills add
remotion-dev/skills`); useful for authoring compositions in Phases 3–4.

**Evidence.**

- Remotion `getting-started.mdx` (system requirements: Node/Bun minimums, macOS 15+).
- Remotion `no-react.ts` (`MIN_NODE_VERSION` is 16 on v4, 22 under `ENABLE_V5_BREAKING_CHANGES`).
- Remotion `cli/render.mdx` (`npx remotion render`; `--overwrite`; `--props` note;
  `--ffmpeg-executable` removed in v4).
- Remotion `miscellaneous/chrome-headless-shell.mdx` (auto-download location, `browser
ensure`, bundled Chrome pinning).
- Published versions: `npm view remotion version` → `4.0.532`, `react` → `19.3.0`.

---

## Decision 4 — How narration is generated and authenticated

**Decision.** Use the **OpenAI Speech API** via the official `openai` Node SDK
(`^7.27.0`), authenticated by the `OPENAI_API_KEY` environment variable.

- Endpoint: `POST https://api.openai.com/v1/audio/speech`; SDK call
  `client.audio.speech.create({ model, voice, input, response_format })`.
- Default model **`gpt-4o-mini-tts`** (alternatives `tts-1`, `tts-1-hd`); recommended
  voices `marin` / `cedar`. Voice/model/`instructions` are configurable.
- Output formats: `mp3` (default), `opus`, `aac`, `flac`, `wav`, `pcm`. **Prefer `wav`**
  for per-scene clips: lossless, low-latency, and its header yields duration without a
  decode step.
- **Credentials:** read `OPENAI_API_KEY` from the environment. If absent, stop with a
  clear setup message and never claim voice is available. Never write the key to logs,
  the scene plan, or the video.
- **Duration** per scene is read from the generated clip (WAV header parse, or FFprobe
  bundled with Remotion) and drives the timeline.
- **Rate limits / failures:** treat 429 and 5xx as retryable with exponential backoff;
  per-scene clips (per plan §10) make retries cheap and re-renders independent.
- **Privacy:** the spoken text is derived from repository content and **is transmitted
  to OpenAI**. This must be documented to the user, and secret-looking content must be
  filtered before narration.

**Evidence.**

- Text to speech — <https://developers.openai.com/api/docs/guides/text-to-speech>
  (endpoint, `gpt-4o-mini-tts`, voice list, `wav`/`pcm` formats,
  `OpenAI()` reading `OPENAI_API_KEY`, AI-voice disclosure requirement).
- Published version: `npm view openai version` → `7.27.0`.

---

## Decision 5 — How outputs and temporary files are managed

**Decision.**

- **Final output:** `artifacts/branch-explainer.mp4`. Never overwrite silently — write a
  timestamped filename or require explicit confirmation.
- **Intermediates:** `artifacts/<run-id>/` holds `plan.json`, the narration script,
  per-scene audio clips, and the captured source snapshot, so a failed render can be
  retried without repeating Git analysis or TTS.
- **Version control:** `.gitignore` excludes `artifacts/`, `node_modules/`, `out/`, and
  `.remotion/`. Remotion's downloaded Chrome lives under `node_modules/.remotion/`, so it
  is ignored transitively.
- **Repository safety:** the pipeline never checks out, resets, stashes, or writes to
  tracked files; all writes are confined to `artifacts/`.

**Evidence.** Plan §2, §10, §15 (fail safely, recoverable intermediates, respect privacy).

---

## Open items to confirm in a real Codex client

These could not be verified locally because no Codex CLI / `~/.codex` is installed:

1. **Invocation token** — confirm the skill is reached as `$explain-branch` (vs a slash
   form) in the target Codex/ChatGPT desktop surface.
2. **Script invocation contract** — confirm the working directory (assumed: the user's
   repo) and whether stdin/stdout + argv handling matches Decision 2.
3. **Marketplace root** — confirm the repo marketplace accepts `source.path: "./"` when
   the plugin _is_ the repo root; otherwise relocate the plugin under `plugins/`.

## Consequences

- The skeleton is dependency-light for execution (Node strips types; no bundler) while
  Remotion/React/Shiki/OpenAI are installed and pinned for later phases.
- Phases 3–4 must use macOS 15+ and may pre-fetch Chrome + accept a one-time Remotion
  licence check.
- Any change to the plugin manifest shape must be re-verified against the live docs,
  since the format is explicitly marked as evolving.
