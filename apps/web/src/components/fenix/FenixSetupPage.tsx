import { Link } from "@tanstack/react-router";
import {
  AppleIcon,
  ArrowRightIcon,
  CheckIcon,
  ClipboardIcon,
  DownloadIcon,
  FolderLockIcon,
  LaptopIcon,
  MonitorIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  TerminalSquareIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  buildFenixCompanionInstallCommand,
  buildFenixMobilePairingUrl,
  issueFenixPortalPairing,
  readFenixPortalAgentId,
  type FenixPortalPairing,
} from "~/connection/fenixPortal";
import {
  companionArtifactForPlatform,
  companionDownloadHref,
  detectFenixSetupArchitecture,
  detectFenixSetupArchitectureFromNavigator,
  detectFenixSetupPlatform,
  parseFenixCompanionManifest,
  type FenixSetupArchitecture,
  type FenixCompanionManifest,
  type FenixSetupPlatform,
} from "~/fenixSetup";
import { cn } from "~/lib/utils";
import { QRCodeSvg } from "~/components/ui/qr-code";

const platformDetails: Record<
  FenixSetupPlatform,
  {
    readonly label: string;
    readonly shortLabel: string;
    readonly description: string;
    readonly Icon: LucideIcon;
  }
> = {
  macos: {
    label: "macOS",
    shortLabel: "Mac",
    description: "macOS 13 o posterior",
    Icon: AppleIcon,
  },
  windows: {
    label: "Windows",
    shortLabel: "Windows",
    description: "Windows 11 · paquete nativo en validación",
    Icon: MonitorIcon,
  },
  linux: {
    label: "Linux",
    shortLabel: "Linux",
    description: "Distribuciones con systemd · paquete en validación",
    Icon: TerminalSquareIcon,
  },
};

const privacyItems: ReadonlyArray<{
  readonly Icon: LucideIcon;
  readonly title: string;
  readonly body: string;
}> = [
  {
    Icon: ShieldCheckIcon,
    title: "Sesión Fenix obligatoria",
    body: "La landing y el editor solo responden a usuarios autenticados y asignados al agente.",
  },
  {
    Icon: FolderLockIcon,
    title: "Raíces locales explícitas",
    body: "Cada carpeta se autoriza en el equipo local. Los escapes por enlaces simbólicos se rechazan.",
  },
  {
    Icon: LaptopIcon,
    title: "Un companion por dispositivo",
    body: "Manuel y el administrador emparejan sus propios equipos; no comparten proyectos ni sesiones.",
  },
  {
    Icon: TerminalSquareIcon,
    title: "Herramientas en tu máquina",
    body: "Las credenciales BYOS y los procesos de desarrollo permanecen en el ordenador del usuario.",
  },
];

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function defaultDeviceName(): string {
  if (typeof navigator === "undefined") return "Mi equipo";
  const platform = detectFenixSetupPlatform(navigator.platform);
  if (platform === "macos") return "Mi Mac";
  if (platform === "windows") return "Mi PC";
  if (platform === "linux") return "Mi equipo Linux";
  return "Mi equipo";
}

function useCompanionManifest() {
  const [manifest, setManifest] = useState<FenixCompanionManifest | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const baseUrl = import.meta.env.BASE_URL.endsWith("/")
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;
    void fetch(`${baseUrl}downloads/manifest.json`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parseFenixCompanionManifest(await response.json());
        if (parsed === null) throw new Error("invalid manifest");
        setManifest(parsed);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  return { failed, manifest };
}

export function FenixSetupPage() {
  const [platform, setPlatform] = useState<FenixSetupPlatform | null>(() =>
    typeof navigator === "undefined" ? "macos" : detectFenixSetupPlatform(navigator.platform),
  );
  const [architecture, setArchitecture] = useState<FenixSetupArchitecture | null>(() =>
    typeof navigator === "undefined"
      ? null
      : detectFenixSetupArchitecture(navigator.platform, navigator.userAgent),
  );
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [pairing, setPairing] = useState<FenixPortalPairing | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mobilePairing, setMobilePairing] = useState<FenixPortalPairing | null>(null);
  const [mobilePairingBusy, setMobilePairingBusy] = useState(false);
  const [mobilePairingError, setMobilePairingError] = useState<string | null>(null);
  const { failed: manifestFailed, manifest } = useCompanionManifest();
  const artifact = companionArtifactForPlatform(manifest, platform, architecture);
  const agentId = readFenixPortalAgentId();
  const installCommand = useMemo(
    () =>
      pairing === null || artifact === null
        ? null
        : buildFenixCompanionInstallCommand({
            artifactFileName: artifact.fileName,
            portalOrigin: window.location.origin,
            pairing,
          }),
    [artifact, pairing],
  );
  const baseUrl = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const mobilePairingUrl = useMemo(
    () =>
      mobilePairing === null
        ? null
        : buildFenixMobilePairingUrl({
            portalOrigin: window.location.origin,
            pairing: mobilePairing,
          }),
    [mobilePairing],
  );
  const selectedPlatform =
    platform === null
      ? {
          label: "Dispositivo no compatible",
          shortLabel: "tu equipo",
          description: "Abre esta página desde un ordenador macOS, Windows o Linux",
          Icon: LaptopIcon,
        }
      : platformDetails[platform];

  useEffect(() => {
    let active = true;
    void detectFenixSetupArchitectureFromNavigator(navigator).then((detected) => {
      if (active && detected !== null) {
        setArchitecture((current) => current ?? detected);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const generatePairing = async () => {
    if (agentId === null) {
      setPairingError("Tu acceso no incluye un agente Fenix Code válido.");
      return;
    }
    setPairingBusy(true);
    setPairingError(null);
    setCopied(false);
    try {
      setPairing(
        await issueFenixPortalPairing({
          agentId,
          deviceName,
        }),
      );
    } catch {
      setPairingError(
        "No se pudo generar el emparejamiento. Comprueba que tu sesión Fenix sigue activa.",
      );
    } finally {
      setPairingBusy(false);
    }
  };

  const generateMobilePairing = async () => {
    if (agentId === null) {
      setMobilePairingError("Tu acceso no incluye un agente Fenix Code válido.");
      return;
    }
    setMobilePairingBusy(true);
    setMobilePairingError(null);
    try {
      setMobilePairing(
        await issueFenixPortalPairing({
          agentId,
          deviceName: "Fenix Code Mobile",
        }),
      );
    } catch {
      setMobilePairingError(
        "No se pudo generar el QR. Comprueba que tu sesión Fenix sigue activa.",
      );
    } finally {
      setMobilePairingBusy(false);
    }
  };

  const selectPlatform = (value: FenixSetupPlatform) => {
    setPlatform(value);
    setArchitecture(
      value === "macos"
        ? detectFenixSetupArchitecture(navigator.platform, navigator.userAgent)
        : "x64",
    );
  };

  const copyPairCommand = async () => {
    if (installCommand === null) return;
    await navigator.clipboard.writeText(installCommand);
    setCopied(true);
  };

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#070707] text-white">
      <section className="relative flex min-h-[min(860px,88svh)] flex-col border-b border-white/10">
        <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between px-5 py-5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5 text-sm font-semibold text-white">
            <img src={`${baseUrl}favicon-32x32.png`} alt="" className="size-7" />
            <span>Fenix Code</span>
          </Link>
          <Link
            to="/"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-white/16 px-3 text-sm font-medium text-white transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Abrir Code Lab
            <ArrowRightIcon className="size-4" />
          </Link>
        </header>

        <div className="mx-auto grid w-full max-w-[1240px] flex-1 items-center gap-8 px-5 pb-10 pt-6 sm:gap-12 sm:px-8 sm:pb-12 sm:pt-8 lg:grid-cols-[0.86fr_1.14fr] lg:gap-16 lg:pb-16 lg:pt-10">
          <div className="max-w-xl">
            <div className="mb-6 inline-flex items-center gap-2 border-l-2 border-[#3b82f6] pl-3 text-xs font-semibold uppercase text-white/62">
              <ShieldCheckIcon className="size-4 text-[#60a5fa]" />
              Acceso privado desde Fenix
            </div>
            <h1 className="text-5xl font-semibold leading-[1.02] tracking-[0] text-white sm:text-6xl lg:text-7xl">
              Fenix Code
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-8 text-white/66">
              Tu entorno local de programación, conectado de forma privada a Fenix. Tus carpetas,
              credenciales y herramientas permanecen en tu equipo.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {artifact === null ? (
                <a
                  href="#instalacion"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/88 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <LaptopIcon className="size-4" />
                  {platform === null
                    ? "Ver sistemas compatibles"
                    : `Ver instalación para ${selectedPlatform.shortLabel}`}
                </a>
              ) : (
                <a
                  href={companionDownloadHref(baseUrl, artifact)}
                  download={artifact.fileName}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-white/88 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <DownloadIcon className="size-4" />
                  Descargar para {selectedPlatform.shortLabel}
                  <span className="text-black/54">{formatBytes(artifact.sizeBytes)}</span>
                </a>
              )}
              <a
                href="#privacidad"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/16 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Cómo protege tus proyectos
              </a>
            </div>

            <div className="mt-8 hidden gap-3 text-sm text-white/58 sm:grid sm:grid-cols-3">
              <span className="flex items-center gap-2">
                <CheckIcon className="size-4 text-[#34d399]" /> Solo usuarios asignados
              </span>
              <span className="flex items-center gap-2">
                <CheckIcon className="size-4 text-[#34d399]" /> Carpetas autorizadas
              </span>
              <span className="flex items-center gap-2">
                <CheckIcon className="size-4 text-[#34d399]" /> Sin compartir archivos
              </span>
            </div>
          </div>

          <figure className="relative overflow-hidden rounded-lg border border-white/14 bg-[#101010] p-2 shadow-2xl shadow-black/60">
            <img
              src={`${baseUrl}fenix-code-setup-preview.png`}
              alt="Interfaz real de Fenix Code con un proyecto local preparado para trabajar"
              width="1280"
              height="720"
              className="aspect-video w-full rounded-md object-cover object-left-top"
              loading="eager"
              decoding="async"
            />
            <figcaption className="sr-only">
              La aplicación Fenix Code conserva el flujo completo del editor de escritorio.
            </figcaption>
          </figure>
        </div>
      </section>

      <section id="instalacion" className="border-b border-white/10 bg-[#0b0b0b] py-20">
        <div className="mx-auto w-full max-w-[1080px] px-5 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase text-[#60a5fa]">Instalación guiada</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[0] sm:text-4xl">
              Prepara tu equipo en cinco pasos
            </h2>
            <p className="mt-4 text-base leading-7 text-white/60">
              Cada usuario instala su propio companion. El portal nunca concede acceso a carpetas de
              otro usuario ni a rutas que no hayan sido autorizadas localmente.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Sistema operativo"
            className="mt-10 inline-flex rounded-lg border border-white/12 bg-black p-1"
          >
            {(Object.keys(platformDetails) as FenixSetupPlatform[]).map((value) => {
              const detail = platformDetails[value];
              const Icon = detail.Icon;
              const selected = platform === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => selectPlatform(value)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                    selected ? "bg-white text-black" : "text-white/58 hover:text-white",
                  )}
                >
                  <Icon className="size-4" />
                  {detail.label}
                </button>
              );
            })}
          </div>

          <div className="mt-8 grid gap-10 lg:grid-cols-[0.84fr_1.16fr]">
            <div>
              <p className="text-sm font-medium text-white">{selectedPlatform.description}</p>
              {platform === "macos" ? (
                <div
                  role="group"
                  aria-label="Procesador del Mac"
                  className="mt-4 inline-flex rounded-lg border border-white/12 bg-black p-1"
                >
                  {(
                    [
                      ["arm64", "Apple Silicon"],
                      ["x64", "Intel"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={architecture === value}
                      onClick={() => setArchitecture(value)}
                      className={cn(
                        "h-9 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                        architecture === value
                          ? "bg-white text-black"
                          : "text-white/58 hover:text-white",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
              {artifact === null ? (
                <div className="mt-5 border-l-2 border-[#f59e0b] pl-4 text-sm leading-6 text-white/62">
                  {platform === null
                    ? "Este dispositivo no puede instalar Fenix Code Companion. Usa un ordenador compatible."
                    : platform === "macos" && architecture === null
                      ? "Selecciona Apple Silicon o Intel. Puedes verlo en el menú Apple > Acerca de este Mac."
                      : manifestFailed
                        ? "La información de descarga no está disponible. No instales paquetes externos."
                        : "Este paquete nativo sigue en validación. Usa únicamente una descarga publicada aquí."}
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  <a
                    href={companionDownloadHref(baseUrl, artifact)}
                    download={artifact.fileName}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-[#2563eb] px-4 text-sm font-semibold text-white hover:bg-[#1d4ed8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <DownloadIcon className="size-4" />
                    Descargar companion
                  </a>
                  <p className="break-all font-mono text-xs leading-5 text-white/42">
                    SHA-256: {artifact.sha256}
                  </p>
                  {platform === "macos" && installCommand === null ? (
                    <pre className="overflow-x-auto rounded-md border border-white/10 bg-black p-4 font-mono text-xs leading-6 text-[#bfdbfe]">
                      Inicia sesión y genera abajo el comando seguro. El instalador no funciona sin
                      una autorización Fenix vigente.
                    </pre>
                  ) : null}
                </div>
              )}

              <ol className="mt-9 space-y-6">
                {[
                  [
                    "1",
                    "Descarga el paquete",
                    "Usa solo el paquete de esta página. Una copia no puede instalarse sin tu autorización Fenix.",
                  ],
                  [
                    "2",
                    "Elige tu carpeta",
                    "Abre Terminal en el proyecto o carpeta raíz que quieras autorizar.",
                  ],
                  [
                    "3",
                    "Autoriza e instala",
                    "Genera abajo el comando de un solo uso. Al ejecutarlo te pedirá la ruta local exacta que quieres autorizar.",
                  ],
                  [
                    "4",
                    "Activa el servicio",
                    "Ejecuta fenix-code service install para mantener la conexión local disponible.",
                  ],
                  [
                    "5",
                    "Abre el proyecto",
                    "Vuelve a Code Lab, selecciona tu equipo y añade la carpeta o una URL Git.",
                  ],
                ].map(([number, title, body]) => (
                  <li key={number} className="grid grid-cols-[32px_1fr] gap-3">
                    <span className="flex size-8 items-center justify-center rounded-md border border-white/16 text-xs font-semibold text-white/66">
                      {number}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-white">{title}</h3>
                      <p className="mt-1 text-sm leading-6 text-white/54">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="self-start rounded-lg border border-white/12 bg-black p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#172554] text-[#93c5fd]">
                  <TerminalSquareIcon className="size-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">Autorizar e instalar este equipo</h3>
                  <p className="mt-1 text-sm leading-6 text-white/52">
                    El comando caduca y queda vinculado a tu usuario, empresa, agente y dispositivo.
                    Sin esta autorización la instalación se cancela sin dejar una copia utilizable.
                  </p>
                </div>
              </div>

              <label
                className="mt-6 block text-xs font-semibold uppercase text-white/48"
                htmlFor="fenix-device-name"
              >
                Nombre del equipo
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="fenix-device-name"
                  value={deviceName}
                  maxLength={80}
                  onChange={(event) => setDeviceName(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-md border border-white/14 bg-[#101010] px-3 text-sm text-white outline-none focus:border-[#60a5fa]"
                />
                <button
                  type="button"
                  disabled={agentId === null || pairingBusy || deviceName.trim().length === 0}
                  onClick={() => void generatePairing()}
                  className="h-10 rounded-md bg-white px-4 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pairingBusy ? "Generando…" : "Generar instalación segura"}
                </button>
              </div>

              {agentId === null || pairingError !== null ? (
                <p role="alert" className="mt-3 text-sm text-[#fca5a5]">
                  {agentId === null
                    ? "Tu acceso no incluye un agente Fenix Code válido."
                    : pairingError}
                </p>
              ) : null}

              {installCommand !== null && pairing !== null ? (
                <div className="mt-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-white/44">
                      Válido hasta {new Date(pairing.expiresAt).toLocaleTimeString("es-ES")}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyPairCommand()}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-white/14 px-3 text-xs font-semibold text-white hover:bg-white/8"
                    >
                      {copied ? (
                        <CheckIcon className="size-3.5" />
                      ) : (
                        <ClipboardIcon className="size-3.5" />
                      )}
                      {copied ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/10 bg-[#0b0b0b] p-4 font-mono text-xs leading-6 text-[#bfdbfe]">
                    {installCommand}
                  </pre>
                  <p className="mt-3 text-xs leading-5 text-white/40">
                    No compartas este comando. Contiene una credencial de un solo uso.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-black py-20">
        <div className="mx-auto grid w-full max-w-[1080px] gap-10 px-5 sm:px-8 lg:grid-cols-[1fr_360px] lg:items-center">
          <div className="max-w-2xl">
            <div className="flex size-10 items-center justify-center rounded-md bg-[#172554] text-[#93c5fd]">
              <SmartphoneIcon className="size-5" />
            </div>
            <p className="mt-6 text-xs font-semibold uppercase text-[#60a5fa]">
              Control móvil privado
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[0] sm:text-4xl">
              Continúa desde tu móvil
            </h2>
            <p className="mt-4 text-base leading-7 text-white/60">
              Escanea el QR desde la app móvil de Fenix Code. El teléfono solo verá los equipos
              locales emparejados con tu mismo usuario, empresa y agente. La credencial se guarda en
              el almacén seguro del dispositivo y puede revocarse desde Fenix.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-white/56">
              <li className="flex items-center gap-2">
                <CheckIcon className="size-4 text-[#34d399]" /> Sin copiar la cookie de tu navegador
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon className="size-4 text-[#34d399]" /> Tickets temporales por conexión
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon className="size-4 text-[#34d399]" /> Cero proyectos compartidos entre
                usuarios
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-white/12 bg-[#0b0b0b] p-6 text-center">
            {mobilePairingUrl === null ? (
              <>
                <SmartphoneIcon className="mx-auto size-9 text-white/62" />
                <h3 className="mt-4 text-base font-semibold">Vincular este usuario</h3>
                <p className="mt-2 text-sm leading-6 text-white/48">
                  El QR caduca y solo puede consumirse una vez.
                </p>
                <button
                  type="button"
                  disabled={agentId === null || mobilePairingBusy}
                  onClick={() => void generateMobilePairing()}
                  className="mt-5 h-10 rounded-md bg-white px-4 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mobilePairingBusy ? "Generando…" : "Generar QR móvil"}
                </button>
              </>
            ) : (
              <>
                <QRCodeSvg
                  value={mobilePairingUrl}
                  size={224}
                  level="M"
                  marginSize={3}
                  title="QR de emparejamiento móvil de Fenix Code"
                  className="mx-auto rounded-md"
                />
                <p className="mt-4 text-xs text-white/44">
                  Válido hasta {new Date(mobilePairing!.expiresAt).toLocaleTimeString("es-ES")}
                </p>
                <button
                  type="button"
                  onClick={() => setMobilePairing(null)}
                  className="mt-3 text-xs font-semibold text-white/62 underline underline-offset-4 hover:text-white"
                >
                  Generar otro QR
                </button>
              </>
            )}
            {mobilePairingError !== null ? (
              <p role="alert" className="mt-4 text-sm text-[#fca5a5]">
                {mobilePairingError}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section id="privacidad" className="border-b border-white/10 py-20">
        <div className="mx-auto w-full max-w-[1080px] px-5 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr]">
            <div>
              <p className="text-xs font-semibold uppercase text-[#34d399]">
                Privacidad por diseño
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[0]">
                Tu código no se comparte entre usuarios
              </h2>
            </div>
            <div className="grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-2">
              {privacyItems.map(({ Icon, title, body }) => (
                <div key={title} className="bg-[#0b0b0b] p-6">
                  <Icon className="size-5 text-white/72" />
                  <h3 className="mt-5 text-sm font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/50">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex w-full max-w-[1080px] flex-col gap-4 px-5 py-8 text-xs text-white/42 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span>Fenix Code · AIWorks</span>
        <span>Acceso piloto restringido a usuarios asignados</span>
      </footer>
    </main>
  );
}
