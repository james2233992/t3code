import type {
  CustomCliSettings,
  ProviderInstanceEnvironment,
  ProviderInstanceEnvironmentVariable,
} from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";

export const CUSTOM_CLI_DRIVER_KIND = ProviderDriverKind.make("customCli");

export const CUSTOM_CLI_DEFAULT_ALLOWED_BINARIES: ReadonlySet<string> = new Set([
  "codex",
  "claude",
  "cursor-agent",
  "grok",
  "opencode",
]);

const TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const SHELL_METACHARS_PATTERN = /[;&|`$<>]/;
const DANGEROUS_FLAG_PATTERNS: ReadonlyArray<RegExp> = [
  /^--force(?:=|$)/,
  /^--yolo(?:=|$)/,
  /^--dangerously-/,
  /^--allow-all(?:=|$)/,
  /^--full-access(?:=|$)/,
  /^--approval-policy=(?:never|on-failure)$/,
  /^--sandbox=(?:danger-full-access|workspace-write)$/,
];

export interface CustomCliTemplate {
  readonly name: string;
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly env: ProviderInstanceEnvironment;
  readonly modelSlug: string;
}

export interface CustomCliTemplateValidation {
  readonly ok: boolean;
  readonly issue?: string;
  readonly template?: CustomCliTemplate;
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function hasUnsafeTokenCharacter(value: string): boolean {
  return hasControlCharacter(value) || SHELL_METACHARS_PATTERN.test(value);
}

function hasWildcardCharacter(value: string): boolean {
  for (const char of value) {
    if (char === "*" || char === "?" || char === "[" || char === "]") {
      return true;
    }
  }
  return value.includes("{") || value.includes("}");
}

function validateAllowedBinaryEntry(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (hasUnsafeTokenCharacter(trimmed) || hasWildcardCharacter(trimmed)) return null;
  return trimmed;
}

function validateBinaryPath(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (hasUnsafeTokenCharacter(trimmed) || hasWildcardCharacter(trimmed)) return null;
  return trimmed;
}

function validateArg(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (hasUnsafeTokenCharacter(trimmed)) return null;
  return trimmed;
}

function isDangerousFlag(arg: string): boolean {
  return DANGEROUS_FLAG_PATTERNS.some((pattern) => pattern.test(arg));
}

function validateEnvironment(env: ProviderInstanceEnvironment): ProviderInstanceEnvironment | null {
  const next: ProviderInstanceEnvironmentVariable[] = [];
  for (const variable of env) {
    if (hasControlCharacter(variable.value)) return null;
    next.push(variable);
  }
  return next;
}

export function validateCustomCliTemplate(
  settings: CustomCliSettings,
): CustomCliTemplateValidation {
  const name = settings.name.trim() || "Custom CLI";
  if (!TEMPLATE_NAME_PATTERN.test(name)) {
    return { ok: false, issue: "Template name contains unsupported characters." };
  }

  const binaryPath = validateBinaryPath(settings.binaryPath);
  if (!binaryPath) {
    return { ok: false, issue: "Template binaryPath must be a non-empty exact binary." };
  }

  const allowedBinaries = new Set(CUSTOM_CLI_DEFAULT_ALLOWED_BINARIES);
  for (const allowed of settings.allowedBinaries) {
    const entry = validateAllowedBinaryEntry(allowed);
    if (!entry) {
      return {
        ok: false,
        issue: "Allowed binaries must be exact entries without shell metacharacters or wildcards.",
      };
    }
    allowedBinaries.add(entry);
  }
  if (!allowedBinaries.has(binaryPath)) {
    return { ok: false, issue: `Template binary '${binaryPath}' is not allowlisted.` };
  }

  const args: string[] = [];
  for (const rawArg of settings.args) {
    const arg = validateArg(rawArg);
    if (arg === null) {
      return { ok: false, issue: "Template args contain unsupported control or shell characters." };
    }
    if (!settings.allowDangerousFlags && isDangerousFlag(arg)) {
      return { ok: false, issue: `Dangerous flag '${arg}' requires explicit template opt-in.` };
    }
    if (arg.length > 0) args.push(arg);
  }

  const env = validateEnvironment(settings.env);
  if (!env) {
    return { ok: false, issue: "Template env values must be single-line strings." };
  }

  const modelSlug = settings.modelSlug.trim() || "custom-cli/local";
  if (hasUnsafeTokenCharacter(modelSlug)) {
    return { ok: false, issue: "Template modelSlug contains unsupported characters." };
  }

  return {
    ok: true,
    template: {
      name,
      binaryPath,
      args,
      env,
      modelSlug,
    },
  };
}
