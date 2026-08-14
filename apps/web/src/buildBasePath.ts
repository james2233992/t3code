export function normalizeWebBasePath(value: string | undefined): string {
  const candidate = value?.trim() || "/";
  if (
    !candidate.startsWith("/") ||
    !candidate.endsWith("/") ||
    candidate.includes("\\") ||
    candidate.includes("//") ||
    candidate.includes("?") ||
    candidate.includes("#") ||
    candidate.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(
      "FENIX_CODE_WEB_BASE_PATH debe ser una ruta absoluta normalizada que termine en /.",
    );
  }
  return candidate;
}

export function routerBasePath(value: string): string {
  return value === "/" ? "/" : value.slice(0, -1);
}
