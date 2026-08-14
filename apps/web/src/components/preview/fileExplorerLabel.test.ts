import { describe, expect, it } from "vite-plus/test";

import { revealInFileExplorerLabel } from "./fileExplorerLabel";

describe("revealInFileExplorerLabel", () => {
  it.each([
    ["MacIntel", "Mostrar en Finder"],
    ["Win32", "Mostrar en el Explorador de archivos"],
    ["Linux x86_64", "Mostrar en Archivos"],
  ])("maps %s to %s", (platform, expected) => {
    expect(revealInFileExplorerLabel(platform)).toBe(expected);
  });
});
