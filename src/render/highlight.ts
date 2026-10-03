/**
 * Shiki integration using the fine-grained bundle: grammars and the theme are imported
 * statically and tokenised with the JavaScript regex engine, so nothing is fetched or
 * compiled from wasm at render time. This keeps rendering deterministic and works inside
 * Remotion's bundled output.
 */
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "@shikijs/themes/github-dark";
import type { ThemedToken } from "shiki";

import c from "@shikijs/langs/c";
import clojure from "@shikijs/langs/clojure";
import cmake from "@shikijs/langs/cmake";
import cpp from "@shikijs/langs/cpp";
import csharp from "@shikijs/langs/csharp";
import css from "@shikijs/langs/css";
import dart from "@shikijs/langs/dart";
import diff from "@shikijs/langs/diff";
import dockerfile from "@shikijs/langs/dockerfile";
import elixir from "@shikijs/langs/elixir";
import erlang from "@shikijs/langs/erlang";
import go from "@shikijs/langs/go";
import graphql from "@shikijs/langs/graphql";
import haskell from "@shikijs/langs/haskell";
import hcl from "@shikijs/langs/hcl";
import html from "@shikijs/langs/html";
import ini from "@shikijs/langs/ini";
import java from "@shikijs/langs/java";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import kotlin from "@shikijs/langs/kotlin";
import less from "@shikijs/langs/less";
import lua from "@shikijs/langs/lua";
import makefile from "@shikijs/langs/makefile";
import markdown from "@shikijs/langs/markdown";
import php from "@shikijs/langs/php";
import protobuf from "@shikijs/langs/protobuf";
import python from "@shikijs/langs/python";
import r from "@shikijs/langs/r";
import ruby from "@shikijs/langs/ruby";
import rust from "@shikijs/langs/rust";
import scala from "@shikijs/langs/scala";
import scss from "@shikijs/langs/scss";
import shellscript from "@shikijs/langs/shellscript";
import sql from "@shikijs/langs/sql";
import svelte from "@shikijs/langs/svelte";
import swift from "@shikijs/langs/swift";
import toml from "@shikijs/langs/toml";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import vue from "@shikijs/langs/vue";
import yaml from "@shikijs/langs/yaml";

export const SHIKI_THEME = "github-dark";

const LOADED_LANGUAGES = [
  c,
  clojure,
  cmake,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  elixir,
  erlang,
  go,
  graphql,
  haskell,
  hcl,
  html,
  ini,
  java,
  javascript,
  json,
  jsx,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  php,
  protobuf,
  python,
  r,
  ruby,
  rust,
  scala,
  scss,
  shellscript,
  sql,
  svelte,
  swift,
  toml,
  tsx,
  typescript,
  vue,
  yaml,
];

/** Maps our internal language ids onto Shiki grammar ids. */
const LANGUAGE_ALIASES: Record<string, string> = {
  shell: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  terraform: "hcl",
  make: "makefile",
  docker: "dockerfile",
};

type Highlighter = Awaited<ReturnType<typeof createHighlighterCore>>;

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighterCore({
    themes: [githubDark],
    langs: LOADED_LANGUAGES,
    engine: createJavaScriptRegexEngine(),
  });
  return highlighterPromise;
}

export function toShikiLanguage(language: string): string {
  return LANGUAGE_ALIASES[language] ?? language;
}

/**
 * Tokenises a whole file so per-line slicing stays accurate (multi-line constructs are
 * highlighted correctly). Falls back to plain text when a grammar is unavailable.
 */
export async function tokenizeFile(
  content: string,
  language: string,
): Promise<ThemedToken[][]> {
  const highlighter = await getHighlighter();
  const requested = toShikiLanguage(language);
  const loaded = highlighter.getLoadedLanguages() as readonly string[];
  const lang = loaded.includes(requested) ? requested : "text";

  const result = highlighter.codeToTokens(content, {
    lang,
    theme: SHIKI_THEME,
  });
  return result.tokens;
}
