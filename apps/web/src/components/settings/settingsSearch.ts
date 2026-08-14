export type SettingsPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/providers"
  | "/settings/source-control"
  | "/settings/connections"
  | "/settings/archived";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
}

/**
 * Section labels in sidebar order. The sidebar nav and the search-result
 * subtitles both render from this record, so each label exists once.
 */
export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/general": "General",
  "/settings/appearance": "Apariencia",
  "/settings/keybindings": "Atajos de teclado",
  "/settings/providers": "Proveedores",
  "/settings/source-control": "Control de versiones",
  "/settings/connections": "Conexiones",
  "/settings/archived": "Archivo",
};

/**
 * Every searchable setting, in result order. This catalog is the single
 * source of truth for anchor ids and visible titles: panels render both via
 * `searchableSetting`, so a retitle (or, later, a translation pass) happens
 * here once instead of separately in the panel and the index.
 */
export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "color-scheme",
    title: "Esquema de color",
    to: "/settings/appearance",
    // The scheme tiles sit at the top of the Appearance section.
    targetId: "appearance",
  },
  {
    id: "theme",
    title: "Temas",
    to: "/settings/appearance",
    // Theme cards live directly under the scheme tiles; the section is the
    // stable scroll destination for both.
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    title: "Opacidad del cristal",
    to: "/settings/appearance",
  },
  {
    id: "environment-identification",
    title: "Identificación del entorno",
    to: "/settings/appearance",
    // The setting is stage-dependent, so its parent section is the stable destination.
    targetId: "appearance",
  },
  {
    id: "interface-font",
    title: "Fuente de la interfaz",
    to: "/settings/appearance",
  },
  {
    id: "prompt-font",
    title: "Fuente de las instrucciones",
    to: "/settings/appearance",
  },
  {
    id: "code-font",
    title: "Fuente del código",
    to: "/settings/appearance",
  },
  {
    id: "terminal-font",
    title: "Fuente del terminal",
    to: "/settings/appearance",
  },
  {
    id: "font-smoothing",
    title: "Suavizado de fuentes",
    to: "/settings/appearance",
  },
  {
    id: "word-wrap",
    title: "Ajuste de línea",
    to: "/settings/appearance",
  },
  {
    id: "project-grouping",
    title: "Agrupación de proyectos",
    to: "/settings/general",
  },
  {
    id: "auto-settle-inactive-threads",
    title: "Archivar conversaciones inactivas automáticamente",
    to: "/settings/general",
  },
  {
    id: "time-format",
    title: "Formato de hora",
    to: "/settings/general",
  },
  {
    id: "hide-whitespace-changes",
    title: "Ocultar cambios de espacios en blanco",
    to: "/settings/general",
  },
  {
    id: "provider-update-checks",
    title: "Comprobación de actualizaciones de proveedores",
    to: "/settings/general",
  },
  {
    id: "new-threads",
    title: "Conversaciones nuevas",
    to: "/settings/general",
  },
  {
    id: "start-from-origin",
    title: "Empezar desde el origen",
    to: "/settings/general",
    targetId: "new-threads",
  },
  {
    id: "add-project-starts-in",
    title: "Directorio inicial al añadir un proyecto",
    to: "/settings/general",
  },
  {
    id: "archive-confirmation",
    title: "Confirmación al archivar",
    to: "/settings/general",
  },
  {
    id: "delete-confirmation",
    title: "Confirmación al eliminar",
    to: "/settings/general",
  },
  {
    id: "text-generation-model",
    title: "Modelo de generación de texto",
    to: "/settings/general",
  },
  {
    id: "diagnostics",
    title: "Diagnóstico",
    to: "/settings/general",
  },
  {
    id: "legacy-plan-mode",
    title: "Modo de planificación (heredado)",
    to: "/settings/general",
  },
  {
    id: "legacy-token-streaming",
    title: "Transmitir token a token (heredado)",
    to: "/settings/general",
  },
  {
    id: "legacy-sidebar",
    title: "Barra lateral (heredada)",
    to: "/settings/general",
  },
  {
    id: "keybindings",
    title: "Atajos de teclado",
    to: "/settings/keybindings",
  },
  {
    id: "providers",
    title: "Proveedores",
    to: "/settings/providers",
  },
  {
    id: "source-control",
    title: "Control de versiones",
    to: "/settings/source-control",
  },
  {
    id: "remote-environments",
    title: "Entornos remotos",
    to: "/settings/connections",
  },
  {
    id: "archive",
    title: "Conversaciones archivadas",
    to: "/settings/archived",
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = Object.fromEntries(
  SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item]),
) as Readonly<Record<SettingsSearchItemId, SettingsSearchItem>>;

/**
 * `id` and `title` props for the element a search item anchors to. Panels
 * spread (or pick from) this instead of restating the strings, so the catalog
 * and the rendered settings cannot drift apart.
 */
export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID[id];
  return { id: anchorId, title };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];

  return items.filter((item) => normalizeSearchText(item.title).includes(normalizedQuery));
}
