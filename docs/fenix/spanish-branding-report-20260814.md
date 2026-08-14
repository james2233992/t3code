# Fenix Code: interfaz en espanol y aislamiento de marca

Fecha: 2026-08-14

## Objetivo

Eliminar cualquier rastro visible de T3 Code en la aplicacion web de Fenix Code y
presentar la interfaz en espanol sin alterar los contratos internos necesarios para
mantener compatibilidad con el fork y facilitar futuras integraciones del upstream.

## Resultado

- El documento raiz declara `lang="es"` y el titulo de la pestana es `Fenix Code`.
- Los cuatro iconos del navegador son activos propios de Fenix Code y se sirven bajo
  el `base path` configurado (`/code-lab/` en el despliegue previsto).
- Los flujos visibles de proyectos, sesiones, chat, diffs, Git, terminal, vista
  previa, ajustes, conexiones, diagnostico, uso, autenticacion, pairing, errores y
  actualizaciones estan traducidos al espanol.
- El terminal de ejemplo muestra `fenix-code`, no el nombre de la aplicacion de
  origen.
- El CI del fork ejecuta un guard nuevo de interfaz espanola y conserva el guard de
  marca visible.

## Identificadores internos conservados

Los siguientes nombres no se muestran al usuario y se conservan deliberadamente por
compatibilidad tecnica y facilidad de rebase:

- paquetes e imports `@t3tools/*`;
- tipos, nombres de fichero y simbolos internos heredados;
- variables de entorno como `T3CODE_HOME`;
- claves de almacenamiento `t3code:*`, necesarias para no perder preferencias ni
  migraciones existentes;
- patrones de deteccion dentro de los propios guards e inventarios.

El guard `scripts/fenix/check-visible-branding.sh` distingue estos identificadores
internos de la marca que puede ver un usuario.

## Verificacion automatizada

- `pnpm exec vp check --fix`: PASS, 2412 ficheros comprobados, sin avisos ni errores.
- `pnpm --filter @t3tools/web typecheck`: PASS.
- Suite web completa: 224/224 ficheros y 2025/2025 tests PASS.
- Suite focal de localizacion y branding: 11 ficheros y 209 tests PASS.
- Suite focal adicional: 3 ficheros y 126 tests PASS.
- Inventario de branding `generate`, `selftest` y `check`: PASS.
- Guard de marca visible `selftest` y `check`: PASS.
- Guard de interfaz espanola `selftest` y `check`: PASS.
- Build con `FENIX_CODE_WEB_BASE_PATH=/code-lab/`: PASS.

Artefactos principales del build:

- `dist/index.html`: 17.59 kB (4.29 kB gzip).
- CSS principal: 396.62 kB (52.45 kB gzip).
- JavaScript principal: 3732.60 kB (1138.19 kB gzip).

La advertencia de Vite sobre el tamano de chunks permanece informativa; no es un
error de compilacion ni se introdujo como parte de este cambio.

## QA visual local

Origen verificado: `http://127.0.0.1:4176/code-lab/`.

| Vista               | Resultado                                                                       |
| ------------------- | ------------------------------------------------------------------------------- |
| Movil 390x844       | Titulo `Fenix Code`, `lang=es`, sin texto visible T3 y sin overflow horizontal. |
| Escritorio 1280x720 | Titulo `Fenix Code`, `lang=es`, sin texto visible T3 y composicion estable.     |

Evidencias:

- `docs/fenix/spanish-branding-mobile-390x844.png`
- `docs/fenix/spanish-branding-desktop-1280x720.png`

La previsualizacion estatica muestra correctamente en espanol el estado de error
HTTP 404 porque no tiene un backend local conectado. Este resultado es esperado y
permite verificar tambien la superficie de recuperacion de errores; no representa
un fallo del build.

## Limite de este candidato

Este candidato no modifica produccion ni despliega la aplicacion. La sustitucion de
marca y la traduccion quedan listas para una ventana de publicacion con su QA
autenticada y postflights propios.
