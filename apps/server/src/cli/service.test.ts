import { assert, it } from "@effect/vitest";

import { formatServiceStatus } from "./service.ts";

const status = {
  supported: true,
  installed: true,
  current: true,
  unitPath: "/home/me/.config/systemd/user/t3code.service",
  logPath: "/home/me/.t3/userdata/logs/boot-service.log",
} as const;

it("reports the installed service version and host paths", () => {
  assert.equal(
    formatServiceStatus(status, "0.0.29"),
    [
      "Servicio Fenix Code",
      "  Estado: instalado · Fenix Code v0.0.29",
      "  Unidad: /home/me/.config/systemd/user/t3code.service",
      "  Registros: /home/me/.t3/userdata/logs/boot-service.log",
    ].join("\n"),
  );
});

it("gives a direct repair command for a stale service", () => {
  assert.include(
    formatServiceStatus({ ...status, current: false }, "0.0.29"),
    "Siguiente paso: ejecuta `fenix-code service update`.",
  );
});

it("explains service availability without a supported service manager", () => {
  assert.include(
    formatServiceStatus({ ...status, supported: false, installed: false }, "0.0.29"),
    "Compatible con: Linux con systemd o macOS con launchd",
  );
});
