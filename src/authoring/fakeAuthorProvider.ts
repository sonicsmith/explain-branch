/**
 * Deterministic offline {@link AuthorProvider} for tests. It mirrors the request's shape so
 * an authored plan always validates, without any network call or credential.
 */
import type {
  AuthorProvider,
  AuthorRequest,
  AuthoredScene,
} from "./provider.ts";

export function createFakeAuthorProvider(): AuthorProvider {
  return {
    async author(request: AuthorRequest): Promise<AuthoredScene[]> {
      return request.scenes.map((scene) => ({
        id: scene.id,
        title: scene.title,
        purpose: scene.purpose,
        narration:
          scene.steps.length === 0
            ? `Summary of the changes on ${request.branchName}.`
            : "",
        steps: scene.steps.map(
          (step, index) =>
            `Step ${index + 1}: covering ${step.file} lines ${step.startLine} to ${step.endLine}.`,
        ),
      }));
    },
  };
}
