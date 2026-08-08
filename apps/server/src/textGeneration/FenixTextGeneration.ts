import { TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as TextGeneration from "./TextGeneration.ts";

const unsupported = (operation: string) =>
  Effect.fail(
    new TextGenerationError({
      operation,
      detail:
        "Fenix text-generation is disabled until the Code Lab pairing bridge provides a scoped session.",
    }),
  );

export const makeFenixTextGeneration = Effect.succeed(
  TextGeneration.TextGeneration.of({
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
  }),
);
