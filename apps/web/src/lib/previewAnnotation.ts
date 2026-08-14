import type { PreviewAnnotationPayload } from "@t3tools/contracts";
import { buildElementContextBlock, normalizeElementContextSelection } from "./elementContext";

const TRAILING_PREVIEW_ANNOTATION_BLOCK_PATTERN =
  /\n*<preview_annotation>\n((?:(?!<preview_annotation>)[\s\S])*)\n<\/preview_annotation>\s*$/;

export interface ParsedPreviewAnnotation {
  id: string;
  title: string;
  comment: string;
  targetSummary: string;
  styleChanges: string[];
  hasScreenshot: boolean;
}

export interface ExtractedPreviewAnnotation {
  promptText: string;
  annotation: ParsedPreviewAnnotation | null;
}

export function buildPreviewAnnotationPrompt(annotation: PreviewAnnotationPayload): string {
  const lines = ["Anotación de previsualización:"];
  lines.push(`Id: ${annotation.id}`);
  const title = annotation.pageTitle?.trim() || annotation.pageUrl.trim() || "Previsualización";
  lines.push(`Página: ${title}`);
  if (annotation.comment.trim()) lines.push(`Comentario: ${annotation.comment.trim()}`);
  const targets: string[] = [];
  if (annotation.elements.length > 0) {
    targets.push(
      `${annotation.elements.length} ${annotation.elements.length === 1 ? "elemento seleccionado" : "elementos seleccionados"}`,
    );
  }
  if (annotation.regions.length > 0) {
    targets.push(
      `${annotation.regions.length} ${annotation.regions.length === 1 ? "región marcada" : "regiones marcadas"}`,
    );
  }
  if (annotation.strokes.length > 0) {
    targets.push(
      `${annotation.strokes.length} ${annotation.strokes.length === 1 ? "dibujo" : "dibujos"}`,
    );
  }
  if (targets.length > 0) lines.push(`Objetivos: ${targets.join(", ")}.`);
  if (annotation.styleChanges.length > 0) {
    lines.push("Cambios visuales solicitados:");
    for (const change of annotation.styleChanges) {
      lines.push(
        `- ${change.property}: ${change.previousValue || "(sin definir)"} → ${change.value}`,
      );
    }
  }
  if (annotation.screenshot) {
    lines.push("La captura adjunta es el recorte anotado de la previsualización.");
  }
  const elementContexts = annotation.elements
    .map((target) => normalizeElementContextSelection(target.element))
    .filter((context) => context !== null);
  const elementBlock = buildElementContextBlock(elementContexts);
  if (elementBlock) lines.push(elementBlock);
  return ["<preview_annotation>", ...lines, "</preview_annotation>"].join("\n");
}

export function appendPreviewAnnotationPrompt(
  prompt: string,
  annotation: PreviewAnnotationPayload,
): string {
  const annotationText = buildPreviewAnnotationPrompt(annotation);
  const trimmed = prompt.trim();
  return trimmed ? `${trimmed}\n\n${annotationText}` : annotationText;
}

export function extractTrailingPreviewAnnotation(prompt: string): ExtractedPreviewAnnotation {
  const match = TRAILING_PREVIEW_ANNOTATION_BLOCK_PATTERN.exec(prompt);
  if (!match) return { promptText: prompt, annotation: null };
  const body = match[1] ?? "";
  const lines = body.split("\n");
  const pageLine = lines.find((line) => line.startsWith("Página: ") || line.startsWith("Page: "));
  const idLine = lines.find((line) => line.startsWith("Id: "));
  const commentLine = lines.find(
    (line) => line.startsWith("Comentario: ") || line.startsWith("Comment: "),
  );
  const targetsLine = lines.find(
    (line) => line.startsWith("Objetivos: ") || line.startsWith("Targets: "),
  );
  const styleHeadingIndex = Math.max(
    lines.indexOf("Cambios visuales solicitados:"),
    lines.indexOf("Requested visual changes:"),
  );
  const linesAfterStyleHeading = lines.slice(styleHeadingIndex + 1);
  const elementContextIndex = linesAfterStyleHeading.indexOf("<element_context>");
  const styleChanges =
    styleHeadingIndex < 0
      ? []
      : linesAfterStyleHeading
          .slice(0, elementContextIndex < 0 ? undefined : elementContextIndex)
          .filter((line) => line.startsWith("- "))
          .map((line) => line.slice(2));
  return {
    promptText: prompt.slice(0, match.index).replace(/\n+$/, ""),
    annotation: {
      id: idLine?.slice("Id: ".length).trim() || `${match.index}`,
      title: pageLine?.replace(/^(?:Página|Page): /, "").trim() || "Anotación de previsualización",
      comment: commentLine?.replace(/^(?:Comentario|Comment): /, "").trim() || "",
      targetSummary: targetsLine?.replace(/^(?:Objetivos|Targets): /, "").trim() || "",
      styleChanges,
      hasScreenshot:
        body.includes("La captura adjunta es el recorte anotado de la previsualización.") ||
        body.includes("The attached screenshot is the annotated preview crop."),
    },
  };
}

export async function previewAnnotationScreenshotFile(
  annotation: PreviewAnnotationPayload,
): Promise<File | null> {
  if (!annotation.screenshot) return null;
  const response = await fetch(annotation.screenshot.dataUrl);
  const blob = await response.blob();
  return new File([blob], `preview-annotation-${annotation.id}.png`, {
    type: blob.type || "image/png",
  });
}
