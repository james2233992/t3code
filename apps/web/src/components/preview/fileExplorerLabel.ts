export function revealInFileExplorerLabel(platform: string): string {
  const normalized = platform.toLowerCase();
  if (normalized.includes("mac")) return "Mostrar en Finder";
  if (normalized.includes("win")) return "Mostrar en el Explorador de archivos";
  return "Mostrar en Archivos";
}
