import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";

import {
  connectionStorageLayer,
  makeCatalogBackend,
  makeCatalogStore,
  makeInMemoryConnectionDatabase,
} from "./storage";

const emptyCatalog = {
  schemaVersion: 1,
  targets: [],
  profiles: [],
  credentials: [],
  remoteDpopTokens: [],
} as const;
const catalogJson = Schema.fromJsonString(ConnectionCatalogDocument);
const decodeCatalog = Schema.decodeUnknownSync(catalogJson);
const encodeCatalog = Schema.encodeSync(catalogJson);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("makeCatalogStore", () => {
  it.effect("quarantines malformed catalogs and starts from an empty document", () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const quarantined: string[] = [];
      const store = yield* makeCatalogStore({
        read: Effect.succeed("{not-json"),
        write: (raw) => Effect.sync(() => writes.push(raw)),
        quarantine: (raw) => Effect.sync(() => quarantined.push(raw)),
      });

      expect(yield* store.read).toEqual(emptyCatalog);
      expect(quarantined).toEqual(["{not-json"]);
      expect(writes).toHaveLength(1);
      expect(decodeCatalog(writes[0]!)).toEqual(emptyCatalog);
    }),
  );

  it.effect("does not hide catalog read failures", () =>
    Effect.gen(function* () {
      const failure = new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "permission denied",
      });
      const store = yield* makeCatalogStore({
        read: Effect.fail(failure),
        write: () => Effect.void,
      });

      expect(yield* Effect.flip(store.read)).toBe(failure);
    }),
  );
});

describe("makeCatalogBackend", () => {
  it.effect("fails writes when desktop secure storage declines the catalog", () =>
    Effect.gen(function* () {
      const setConnectionCatalog = vi.fn().mockResolvedValue(false);
      vi.stubGlobal("window", {
        desktopBridge: {
          getConnectionCatalog: vi.fn().mockResolvedValue(null),
          setConnectionCatalog,
        },
      });
      const backend = makeCatalogBackend({} as IDBDatabase);

      const error = yield* backend.write("{}").pipe(Effect.flip);

      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error.message).toContain("El almacenamiento seguro del escritorio no está disponible");
      expect(setConnectionCatalog).toHaveBeenCalledWith("{}");
    }),
  );
});

describe("connectionStorageLayer", () => {
  it.effect("uses ephemeral memory in the isolated Fenix portal iframe", () =>
    Effect.gen(function* () {
      const open = vi.fn(() => {
        throw new DOMException("access denied", "SecurityError");
      });
      vi.stubGlobal("indexedDB", { open });
      vi.stubGlobal("window", {
        location: {
          href: `https://iaonline.io/code-lab/?agentId=9#bridgeToken=${"a".repeat(64)}`,
        },
        parent: {},
        history: { state: null, replaceState: vi.fn() },
      });

      yield* Layer.build(connectionStorageLayer).pipe(Effect.scoped);

      expect(open).not.toHaveBeenCalled();
    }),
  );

  it.effect("keeps ephemeral catalog data only for the database lifetime", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {});
      const database = makeInMemoryConnectionDatabase();
      const backend = makeCatalogBackend(database);
      const encoded = encodeCatalog(emptyCatalog);

      yield* backend.write(encoded);
      expect(yield* backend.read).toBe(encoded);

      database.close();
      expect(yield* backend.read).toBeNull();
      expect(yield* makeCatalogBackend(makeInMemoryConnectionDatabase()).read).toBeNull();
    }),
  );
});
