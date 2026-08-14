import type { RelayClientDeviceRecord } from "@t3tools/contracts/relay";

const mobileClientUpdatedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const NOTIFICATION_PREFERENCES = [
  ["notifyOnApproval", "aprobaciones"],
  ["notifyOnInput", "solicitudes de información"],
  ["notifyOnCompletion", "finalizaciones"],
  ["notifyOnFailure", "fallos"],
] as const satisfies ReadonlyArray<
  readonly [keyof RelayClientDeviceRecord["notifications"], string]
>;

export function mobileClientPlatformLabel(device: RelayClientDeviceRecord): string {
  return `iOS ${device.iosMajorVersion}${device.appVersion ? ` · Fenix Code ${device.appVersion}` : ""}`;
}

export function mobileClientNotificationDetail(device: RelayClientDeviceRecord): string {
  if (!device.notifications.enabled) {
    return "Las notificaciones push están desactivadas en este dispositivo.";
  }

  const enabledPreferences = NOTIFICATION_PREFERENCES.flatMap(([preference, label]) =>
    device.notifications[preference] ? [label] : [],
  );
  return enabledPreferences.length > 0
    ? `Avisos activados para ${enabledPreferences.join(", ")}.`
    : "Las notificaciones push están activadas, pero no hay ningún tipo de aviso seleccionado.";
}

export function mobileClientUpdatedAtLabel(updatedAt: string): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime())
    ? "Hora de actualización no disponible"
    : `Actualizado ${mobileClientUpdatedAtFormatter.format(date)}`;
}
