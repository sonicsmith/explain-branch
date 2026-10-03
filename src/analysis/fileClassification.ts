/**
 * Lightweight, dependency-free classification of changed paths: the language (for syntax
 * highlighting later) and whether a file looks generated or non-source (so the walkthrough
 * can de-emphasise it).
 */

export interface GeneratedClassification {
  isGenerated: boolean;
  reason: string | null;
}

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  py: "python",
  pyi: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  scala: "scala",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  md: "markdown",
  mdx: "markdown",
  txt: "text",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  vue: "vue",
  svelte: "svelte",
  dart: "dart",
  lua: "lua",
  r: "r",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  clj: "clojure",
  tf: "terraform",
  tfvars: "terraform",
};

const SPECIAL_FILENAMES: Readonly<Record<string, string>> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "cmakelists.txt": "cmake",
  gemfile: "ruby",
  rakefile: "ruby",
  "go.mod": "go",
};

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "cargo.lock",
  "gemfile.lock",
  "poetry.lock",
  "pipfile.lock",
  "go.sum",
]);

const GENERATED_DIR_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  "__generated__",
  "generated",
]);

const GENERATED_SUFFIXES = [
  ".min.js",
  ".min.css",
  ".map",
  ".g.dart",
  ".freezed.dart",
  ".pb.go",
  ".pb.cc",
  ".pb.h",
  ".designer.cs",
];

const GENERATED_SUBSTRINGS = ["_pb2.py", "_pb2_grpc.py", ".generated."];

/** Best-effort language identifier from the file name; `unknown` when unrecognised. */
export function detectLanguage(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const base = (
    normalized.slice(normalized.lastIndexOf("/") + 1) || normalized
  ).toLowerCase();

  const special = SPECIAL_FILENAMES[base];
  if (special !== undefined) return special;

  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "unknown";

  return LANGUAGE_BY_EXTENSION[base.slice(dot + 1)] ?? "unknown";
}

/** Heuristic: does this path look like generated output, a lockfile, or a vendored file? */
export function classifyGenerated(filePath: string): GeneratedClassification {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const base = (segments[segments.length - 1] ?? "").toLowerCase();

  if (LOCKFILES.has(base)) {
    return { isGenerated: true, reason: "lockfile" };
  }

  for (const segment of segments.slice(0, -1)) {
    if (GENERATED_DIR_SEGMENTS.has(segment.toLowerCase())) {
      return { isGenerated: true, reason: `inside "${segment}" directory` };
    }
  }

  for (const suffix of GENERATED_SUFFIXES) {
    if (base.endsWith(suffix)) {
      return { isGenerated: true, reason: `generated "${suffix}" file` };
    }
  }

  for (const needle of GENERATED_SUBSTRINGS) {
    if (base.includes(needle)) {
      return { isGenerated: true, reason: `generated file (${needle})` };
    }
  }

  return { isGenerated: false, reason: null };
}
