# Manual smoke test — narrated render

This is **not** part of `npm test`. It calls the real text-to-speech API and the Remotion
renderer, so it requires `OPENAI_API_KEY`, network access, and Chrome Headless Shell.

## Prerequisites

```bash
export OPENAI_API_KEY=sk-...      # required; read from the environment only
npm install
npm run browser:ensure            # one-time Chrome Headless Shell download
```

## Steps

1. Produce a plan for the current branch (read-only):

   ```bash
   npm run plan -- --base main
   ```

2. Review the narration and cost without calling the API:

   ```bash
   npm run narrate -- --dry-run
   ```

3. Generate the audio (one cached WAV clip per scene) and the enriched plan:

   ```bash
   npm run narrate
   ```

   Expect per-scene `artifacts/<branch>/audio/<scene-id>.wav`, an updated
   `artifacts/<branch>/plan.json` with `narrationAudioPath` + `narrationDurationMs`, and a
   final `Validated: N scene(s) with narration audio.` line.

4. Render the video. Audio requires the public dir to be the repository root:

   ```bash
   npm run render:narrated -- --props=artifacts/<branch>/plan.json
   ```

5. Check the output MP4 (`artifacts/branch-explainer.mp4`):
   - [ ] The voice is audible and matches the on-screen scenes.
   - [ ] Captions advance with the speech (proportional per sentence).
   - [ ] No scene cuts narration off; there is a short lead-in and tail.
   - [ ] The total duration matches the plan's timeline within one frame.
   - [ ] No API key appears anywhere in the plan, logs, captions, or video.

## Cost

A short fixture plan is a few thousand characters; the `--dry-run` estimate covers text input
(the dominant audio-output cost is only known after generation). `npm run narrate` caches
clips, so re-running does not re-bill unchanged scenes.

## Failure drills (optional)

- Unset `OPENAI_API_KEY` and run `npm run narrate` → clear setup message, exit code `4`.
- Point `--out` at an existing file and render without `--overwrite` → a non-colliding
  timestamped output (see `resolveOutputPath`).
