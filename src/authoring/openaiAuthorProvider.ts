/**
 * OpenAI-backed {@link AuthorProvider}. This is one of only two modules that import the
 * `openai` SDK (the TTS provider is the other), so the rest of the pipeline stays
 * offline-testable.
 *
 * Uses the Chat Completions API with a strict JSON-schema response format
 * (Structured Outputs), so the model returns exactly the shape the merge step expects.
 * Source excerpts sent to the model are run through the same secret redaction as narration.
 */
import OpenAI from "openai";
import { describeCredentialFailure } from "../narration/credentials.ts";
import { redactSecrets } from "../narration/redact.ts";
import type {
  AuthorProvider,
  AuthorRequest,
  AuthoredScene,
} from "./provider.ts";
import { AuthorError } from "./types.ts";

export interface OpenAiAuthorProviderOptions {
  /** Read from the environment by the caller via `readOpenAiApiKey`. */
  apiKey?: string;
  /** Inject a pre-configured client (used by tests). */
  client?: OpenAI;
}

/** Strict JSON schema the model must satisfy: one authored scene per requested scene. */
const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["scenes"],
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "purpose", "narration", "steps"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          purpose: { type: "string" },
          narration: {
            type: "string",
            description:
              "Narration for a scene that has no steps (the closing summary). Empty string for scenes that have steps.",
          },
          steps: {
            type: "array",
            description:
              "One narration string per scaffold step, in order. Empty array for scenes without steps.",
            items: { type: "string" },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = [
  "You write concise, accurate narration for a short technical video that walks a teammate",
  "through the changes on a Git branch.",
  "",
  "You are given a scaffold plan: scenes grouped from the changed files, each with source",
  "locations, the changed files, and a numbered list of walkthrough steps (each covering a",
  "few lines). Fill in the narration. Return, for every scene, its id, a short title, a",
  "one-sentence purpose, and the narration.",
  "",
  "Rules:",
  "- Ground every claim in the provided source. Never invent the author's motivation, intent,",
  "  or product context that the code does not show.",
  "- Explain what the highlighted lines DO and why it matters — behaviour, not a restatement.",
  "- For a scene with steps, return exactly one narration string per step, in the same order,",
  "  each 1-3 sentences, describing that step's highlighted lines.",
  "- For a scene without steps (the summary), put its narration in `narration` and return an",
  "  empty `steps` array. Otherwise leave `narration` as an empty string.",
  "- Be direct and plain. Do not greet the viewer, do not mention line numbers, and do not",
  "  describe this instruction or the fact that you are an AI.",
].join("\n");

/** Serialises the request into the model's user message, redacting secret-looking source. */
function buildUserPrompt(request: AuthorRequest): string {
  const payload = {
    plan: {
      title: request.planTitle,
      repository: request.repositoryName,
      branch: request.branchName,
      base: request.baseRef,
    },
    caveats: request.caveats,
    omissions: request.omissions,
    scenes: request.scenes.map((scene) => ({
      id: scene.id,
      visual: scene.visual,
      title: scene.title,
      purpose: scene.purpose,
      changes: scene.changes.map((change) => ({
        path: change.path,
        changeType: change.changeType,
        addedLines: change.addedLines,
        deletedLines: change.deletedLines,
      })),
      steps: scene.steps.map((step, index) => ({
        index,
        file: step.file,
        startLine: step.startLine,
        endLine: step.endLine,
      })),
      source: scene.excerpts.map((excerpt) => ({
        file: excerpt.file,
        lines: excerpt.lines.map(
          (line, offset) =>
            `${excerpt.startLine + offset}: ${redactSecrets(line).text}`,
        ),
      })),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

function normalizeScenes(raw: unknown): AuthoredScene[] {
  const scenes =
    typeof raw === "object" && raw !== null
      ? (raw as { scenes?: unknown }).scenes
      : undefined;
  if (!Array.isArray(scenes)) {
    throw new AuthorError("the authoring model returned no `scenes` array.");
  }
  return scenes.map((entry): AuthoredScene => {
    const record =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>)
        : {};
    const steps = Array.isArray(record.steps)
      ? record.steps.map((step) => (typeof step === "string" ? step : ""))
      : [];
    return {
      id: typeof record.id === "string" ? record.id : "",
      title: typeof record.title === "string" ? record.title : "",
      purpose: typeof record.purpose === "string" ? record.purpose : "",
      narration: typeof record.narration === "string" ? record.narration : "",
      steps,
    };
  });
}

export function createOpenAiAuthorProvider(
  options: OpenAiAuthorProviderOptions,
): AuthorProvider {
  const client =
    options.client ??
    // Disable SDK retries: the caller owns failure handling, matching the TTS provider.
    new OpenAI({ apiKey: options.apiKey, maxRetries: 0 });

  return {
    async author(request: AuthorRequest): Promise<AuthoredScene[]> {
      let content: string | null;
      try {
        const completion = await client.chat.completions.create({
          model: request.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(request) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "explainer_narration",
              strict: true,
              schema: RESPONSE_SCHEMA,
            },
          },
        });
        content = completion.choices[0]?.message.content ?? null;
      } catch (error) {
        throw describeCredentialFailure(error);
      }

      if (content === null || content.trim() === "") {
        throw new AuthorError(
          "the authoring model returned an empty response.",
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch (error) {
        throw new AuthorError(
          `the authoring model returned invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return normalizeScenes(parsed);
    },
  };
}
