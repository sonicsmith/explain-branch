# Manual smoke test — narrated render (end to end)

This is **not** part of `npm test`. It calls the real text-to-speech API and the Remotion
renderer, so it requires `OPENAI_API_KEY`, network access, and Chrome Headless Shell.

## Prerequisites

```bash
export OPENAI_API_KEY=sk-...      # required; read from the environment only
npm install
npm run browser:ensure            # one-time Chrome Headless Shell download
```

## Steps

1. Build the scaffold (deterministic grouping + suggested steps, no narration):

   ```bash
   npm run plan -- --base main --out artifacts/smoke/plan.scaffold.json
   ```

2. **Author the plan.** Read the changed code and write `artifacts/smoke/plan.json` (schema v3):
   one scene per meaningful change, ordered `steps` per scene (each a few lines + its
   explanation), and `narrationText` set to the steps joined. This is what the host coding
   agent does in the skill — see [`../skills/explain-branch/SKILL.md`](../skills/explain-branch/SKILL.md).

3. Review the estimated cost without calling the API or writing audio:

   ```bash
   npm run explain -- --plan artifacts/smoke/plan.json --dry-run
   ```

   Expect the branch/base/voice/output disclosure on stderr and a JSON summary on stdout.

4. Run the pipeline (validate → narrate → render → validate):

   ```bash
   npm run explain -- --plan artifacts/smoke/plan.json --base main
   ```

   Expect the stage banners, per-scene narration progress, and the human summary (scenes,
   duration, cost, output path, omissions, caveats) on stderr; the run report JSON on stdout.

5. Inspect the run directory `artifacts/smoke/`:
   - `plan.json` — the authored plan rewritten with `narrationAudioPath` + `narrationDurationMs`;
   - `authored-plan.json` — the plan you supplied;
   - `narration.txt` — the narration script;
   - `audio/<scene-id>.wav` — one clip per scene;
   - `render-input.json` — the props passed to the renderer;
   - `report.json` — the machine-readable run report.

6. Review the output MP4 (`artifacts/branch-explainer.mp4` by default):
   - [ ] The narration explains what the code **does** (not file counts or line restatement).
   - [ ] For a stepped scene, the highlighted lines advance a few lines at a time as it plays.
   - [ ] Each caption matches the step being highlighted.
   - [ ] The voice is audible and matches the on-screen scenes.
   - [ ] No scene cuts narration off; there is a short lead-in and tail.
   - [ ] The total duration matches the run report's `videoDurationMs` within ~one frame.
   - [ ] No API key appears anywhere in the plan, logs, captions, or video.

## Cost

A short fixture plan is a few thousand characters; the `--dry-run` estimate covers text input
(the dominant audio-output cost is only known after generation). Clips are cached per scene, so
re-running with the same narration text does not re-bill unchanged scenes.

## Failure drills (optional)

- Run `npm run explain` with no `--plan` → exit code `3` and a message pointing at
  `npm run plan`; nothing is narrated or rendered.
- Unset `OPENAI_API_KEY` and run with a valid `--plan` → clear setup message, exit code `4`,
  nothing rendered.
- Point `--out` at an existing file and run without `--overwrite` → a non-colliding timestamped
  output plus an "Existing output kept" notice.
- Fail or interrupt a render, then re-run with the same `--plan` → the run directory is kept and
  the re-run resumes from the cached clips without regenerating audio.
