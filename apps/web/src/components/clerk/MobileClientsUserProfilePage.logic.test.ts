import type { RelayClientDeviceRecord } from "@t3tools/contracts/relay";
import { describe, expect, it } from "vite-plus/test";

import {
  mobileClientNotificationDetail,
  mobileClientPlatformLabel,
  mobileClientUpdatedAtLabel,
} from "./MobileClientsUserProfilePage.logic";

function device(overrides: Partial<RelayClientDeviceRecord> = {}): RelayClientDeviceRecord {
  return {
    deviceId: "device-1",
    label: "Julius’s iPhone",
    platform: "ios",
    iosMajorVersion: 18,
    appVersion: "1.2.3",
    notifications: {
      enabled: true,
      notifyOnApproval: true,
      notifyOnInput: false,
      notifyOnCompletion: true,
      notifyOnFailure: false,
    },
    liveActivities: { enabled: true },
    updatedAt: "2026-06-21T12:00:00.000Z",
    ...overrides,
  };
}

describe("mobile client presentation", () => {
  it("describes the client platform and enabled notification events", () => {
    const client = device();

    expect(mobileClientPlatformLabel(client)).toBe("iOS 18 · Fenix Code 1.2.3");
    expect(mobileClientNotificationDetail(client)).toBe(
      "Avisos activados para aprobaciones, finalizaciones.",
    );
  });

  it("distinguishes disabled notifications from an empty event selection", () => {
    expect(
      mobileClientNotificationDetail(
        device({ notifications: { ...device().notifications, enabled: false } }),
      ),
    ).toBe("Las notificaciones push están desactivadas en este dispositivo.");
    expect(
      mobileClientNotificationDetail(
        device({
          notifications: {
            enabled: true,
            notifyOnApproval: false,
            notifyOnInput: false,
            notifyOnCompletion: false,
            notifyOnFailure: false,
          },
        }),
      ),
    ).toBe(
      "Las notificaciones push están activadas, pero no hay ningún tipo de aviso seleccionado.",
    );
  });

  it("handles missing app versions and invalid update timestamps", () => {
    expect(mobileClientPlatformLabel(device({ appVersion: null }))).toBe("iOS 18");
    expect(mobileClientUpdatedAtLabel("not-a-date")).toBe("Hora de actualización no disponible");
  });
});
