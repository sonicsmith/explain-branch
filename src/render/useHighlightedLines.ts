import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import type { ThemedToken } from "shiki";
import { tokenizeFile } from "./highlight.ts";

/**
 * Tokenises a file and holds the render until Shiki is ready. Returns `null` while loading
 * (callers should render a plain-text fallback) or if highlighting fails.
 */
export function useHighlightedLines(
  content: string,
  language: string,
): ThemedToken[][] | null {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [handle] = useState(() => delayRender(`Highlighting ${language}`));

  useEffect(() => {
    let active = true;
    tokenizeFile(content, language)
      .then((result) => {
        if (active) setTokens(result);
      })
      .catch(() => {
        if (active) setTokens(null);
      })
      .finally(() => {
        continueRender(handle);
      });

    return () => {
      active = false;
    };
  }, [content, language, handle]);

  return tokens;
}
