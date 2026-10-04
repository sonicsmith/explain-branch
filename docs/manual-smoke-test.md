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

1. Review the plan and the estimated cost without calling the API or writing anything:

   ```bash
   npm run explain -- --dry-run
   ```

   Expect the branch/base/voice/output disclosure on stderr and a JSON summary on stdout.

2. Run the whole pipeline (inspect → plan → narrate → render → validate):

   ```bash
   npm run explain -- --base main
   ```

   Expect the stage banners, per-scene narration progress, and the human summary (scenes,
   duration, cost, output path, omissions, caveats) on stderr; the run report JSON on stdout.

3. Inspect the run directory `artifacts/<run-id>/`:
   - `plan.json` — narrated plan with `narrationAudioPath` + `narrationDurationMs` per scene;
   - `narration.txt` — the narration script;
   - `audio/<scene-id>.wav` — one clip per scene;
   - `render-input.json` — the props passed to the renderer;
   - `report.json` — the machine-readable run report.

4. Review the output MP4 (`artifacts/branch-explainer.mp4` by default):
   - [ ] The voice is audible and matches the on-screen scenes.
   - [ ] Captions advance with the speech (proportional per sentence).
   - [ ] No scene cuts narration off; there is a short lead-in and tail.
   - [ ] The total duration matches the run report's `videoDurationMs` within ~one frame.
   - [ ] No API key appears anywhere in the plan, logs, captions, or video.

## Cost

A short fixture plan is a few thousand characters; the `--dry-run` estimate covers text input
(the dominant audio-output cost is only known after generation). Clips are cached and a valid
`plan.json` is reused, so re-running does not re-bill unchanged scenes.

## Failure drills (optional)

- Unset `OPENAI_API_KEY` and run `npm run explain` → clear setup message, exit code `4`,
  nothing planned or rendered.
- Point `--out` at an existing file and run without `--overwrite` → a non-colliding timestamped
  output plus an "Existing output kept" notice.
- Fail or interrupt a render, then re-run → the run directory is kept and the re-run resumes
  from the cached clips without regenerating audio.
