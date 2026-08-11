# A1 Webapp Build Report - Fenix Code

Token: `GO_A1_WEBAPP_BUILD` (owner-relay)
Fecha: 2026-08-11
Repo/base: `james2233992/t3code` main `4643eee1df97c5e6b01e3006b6ef6bdca768b1d5`
Alcance: build local de `apps/web` del fork Fenix Code. Sin deploy, sin cambios visuales.

## Toolchain

- Node observado: `v22.21.1`
- pnpm observado: `11.16.0`
- Repo declara Node: `^24.13.1`
- Repo declara package manager: `pnpm@11.10.0`
- Comando ejecutado: `pnpm --filter @t3tools/web build`
- Resultado: PASS
- Duracion observada: 12.72s

Nota: el build pasa con la toolchain instalada en esta maquina. Para un entorno reproducible limpio conviene alinear Node/pnpm con `package.json`.

## Artefacto

Directorio generado: `apps/web/dist` (ignorado por git; no versionado).

Resumen:

| Metrica      |                              Valor |
| ------------ | ---------------------------------: |
| Tamano total | 58,665,024 bytes (58M en `du -sh`) |
| Ficheros     |                                778 |
| `.map`       |    384 ficheros / 38,933,613 bytes |
| `.js`        |    385 ficheros / 17,111,819 bytes |
| `.woff2`     |        1 fichero / 1,177,576 bytes |
| `.wasm`      |         2 ficheros / 631,044 bytes |
| `.css`       |          1 fichero / 388,212 bytes |
| `.ico`       |          1 fichero / 283,825 bytes |
| `.png`       |         3 ficheros / 121,574 bytes |
| `.html`      |           1 fichero / 17,361 bytes |

Mayores assets:

| Fichero                                             |      Bytes |
| --------------------------------------------------- | ---------: |
| `assets/index-8Zkkqzi0.js.map`                      | 13,747,903 |
| `assets/textarea-BCkHN-Tt.js.map`                   |  7,659,551 |
| `assets/index-8Zkkqzi0.js`                          |  3,682,463 |
| `assets/worker-CIcqvLjo.js.map`                     |  1,445,789 |
| `assets/FilePreviewPanel-CFUFGRVH.js.map`           |  1,330,707 |
| `assets/SymbolsNerdFontMono-Regular-aK5vsLov.woff2` |  1,177,576 |
| `assets/textarea-BCkHN-Tt.js`                       |    970,333 |
| `assets/worker-CIcqvLjo.js`                         |    833,722 |
| `assets/emacs-lisp-B4R74twV.js`                     |    779,921 |
| `assets/ghostty-vt-DdA0Zryv.wasm`                   |    630,932 |

El build emitio un warning de chunks grandes y un warning de plugin lento, sin fallo de compilacion.

## Opcion 1 - Subdominio propio

Ejemplo: `https://code.iaonline.io` o `https://fenix-code.iaonline.io`.

Como se serviria:

- Publicar el contenido de `apps/web/dist` como static site en el subdominio.
- Resolver API y WebSocket del companion por configuracion explicita (`VITE_HTTP_URL`/`VITE_WS_URL` o reverse proxy del subdominio al monorepo local/servidor).
- Mantener el dashboard principal enlazando o embebiendo ese origen tras la decision A2.

Implicaciones:

- Mejor aislamiento de CSP, cache y assets de Fenix Code.
- CORS y `credentials` deben declararse de forma explicita entre `iaonline.io` y el subdominio.
- El pairing debe emitir credenciales con audience/origin exacto del subdominio.
- Si se embebe en el dashboard, `frame-ancestors`/`frame-src` y cookies `SameSite` deben revisarse antes de A2.

## Opcion 2 - Ruta bajo iaonline.io

Ejemplo: `https://iaonline.io/code-lab/`.

Como se serviria:

- Reverse proxy de `/code-lab/` al bundle estatico de `apps/web/dist`.
- Reescritura SPA para servir `index.html` dentro de la ruta.
- Ajustar base path de Vite o configurar el proxy para que assets, workers y WASM resuelvan bajo el prefijo.

Implicaciones:

- Menos CORS y cookies mas simples al compartir origen con el portal.
- Mayor riesgo de colision de rutas, cache headers y CSP con el dashboard existente.
- El prefijo debe cubrir JS, CSS, fuente, WASM, workers y fallback de historial.
- El pairing puede usar el mismo origen, pero debe conservar audience exacta y scope minimo.

## Limites

- No se ha desplegado nada.
- No se ha modificado layout, tipografia, espaciado, colores ni comportamiento de `apps/web`.
- A2/A3/A4/A5 siguen sin GO: embed/ventana, retirada del panel casero, corpus de paridad y guard visual esperan decision del owner.
