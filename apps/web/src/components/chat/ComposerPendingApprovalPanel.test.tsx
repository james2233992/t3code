import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";

describe("ComposerPendingApprovalPanel", () => {
  it("renders complete multiline command details without hover or truncation", () => {
    const detail = `bun run release -- ${"long-argument ".repeat(20)}\nsecond line`;
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-1"),
          requestKind: "command",
          createdAt: "2026-07-18T00:00:00.000Z",
          detail,
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain('data-approval-detail="complete"');
    expect(markup).toContain('aria-label="Comando"');
    expect(markup).toContain(detail);
    expect(markup).not.toContain("truncate");
    expect(markup).not.toContain("line-clamp");
  });

  it("localizes file-change approval details", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-2"),
          requestKind: "file-change",
          createdAt: "2026-07-18T00:00:00.000Z",
          detail: "src/example.ts",
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain("Se solicita aprobación para modificar el archivo");
    expect(markup).toContain('aria-label="Cambio de archivo"');
  });

  it("labels unclassified provider requests without claiming a capability", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingApprovalPanel
        approval={{
          requestId: ApprovalRequestId.make("approval-generic"),
          requestKind: "generic",
          createdAt: "2026-08-18T14:37:26.391Z",
          detail: "**/canary.txt",
        }}
        pendingCount={1}
      />,
    );

    expect(markup).toContain("Se solicita aprobación");
    expect(markup).toContain('aria-label="Solicitud"');
    expect(markup).toContain("**/canary.txt");
  });
});
