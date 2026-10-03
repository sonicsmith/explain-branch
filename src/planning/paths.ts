import path from "node:path";

/**
 * Returns an error message when `candidate` is not a safe repository-relative path, or
 * `null` when it is acceptable. Used to reject plan references that are absolute or that
 * escape the repository root before they reach the renderer.
 */
export function relativePathError(candidate: string): string | null {
  if (candidate.trim() === "") return "path must be a non-empty string";
  if (candidate.includes("\0")) return "path must not contain NUL bytes";
  if (path.posix.isAbsolute(candidate) || /^[a-zA-Z]:[\\/]/.test(candidate)) {
    return "path must be repository-relative, not absolute";
  }

  const segments = candidate.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => segment === "..")) {
    return 'path must not contain ".." segments';
  }

  return null;
}

export function isSafeRelativePath(candidate: string): boolean {
  return relativePathError(candidate) === null;
}
