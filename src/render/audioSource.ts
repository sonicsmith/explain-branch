/**
 * Resolves a scene's `narrationAudioPath` into a URL the Remotion `<Audio>` tag can load
 * (Phase 4 §4).
 *
 * Remotion runs in the browser and cannot read arbitrary files off disk, so clips inside the
 * run directory are served through the public directory:
 *
 * - Default: `staticFile(narrationAudioPath)` with the **repository root** passed as
 *   `--public-dir`. Because §2 records the path repository-relative
 *   (`artifacts/<run-id>/audio/<scene-id>.wav`), that path is exactly the `staticFile()`
 *   argument.
 * - Override: when `audioBaseUrl` is set (for a hosted/SSR render), clips are referenced as
 *   `<audioBaseUrl>/<narrationAudioPath>` instead.
 */
import { staticFile } from "remotion";

export interface AudioSourceOptions {
  /** Optional URL prefix that replaces `staticFile()` when rendering remotely. */
  audioBaseUrl?: string;
}

/** Returns a loadable audio URL for a repository-relative clip path, or `null` when empty. */
export function resolveAudioSrc(
  audioPath: string,
  options: AudioSourceOptions = {},
): string | null {
  const clean = audioPath.replace(/^\/+/, "").trim();
  if (clean === "") return null;

  if (options.audioBaseUrl !== undefined) {
    const base = options.audioBaseUrl.replace(/\/+$/, "");
    return `${base}/${clean}`;
  }

  return staticFile(clean);
}
