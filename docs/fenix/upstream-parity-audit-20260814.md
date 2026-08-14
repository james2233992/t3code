# Fenix Code: auditoria de paridad con upstream

Fecha: 2026-08-14

## Objetivo

Fenix Code debe conservar la experiencia y las funciones del proyecto oficial, con cambios visibles limitados a la marca Fenix y extensiones aditivas de autenticacion, aislamiento por tenant, pairing y driver Fenix. Este informe fija el estado verificable y evita declarar una paridad que todavia no existe.

Fuentes primarias:

- Repositorio oficial: <https://github.com/pingdotgg/t3code>
- README oficial: <https://github.com/pingdotgg/t3code/blob/main/README.md>
- Arquitectura oficial: <https://github.com/pingdotgg/t3code/blob/main/docs/architecture/overview.md>
- Referencia funcional oficial: <https://github.com/pingdotgg/t3code/blob/main/docs/reference/encyclopedia.md>
- Sitio oficial: <https://t3.codes/>

## Ground truth de Git

| Linea                   | Commit verificado                          |
| ----------------------- | ------------------------------------------ |
| Fenix `origin/main`     | `6fda62a3ee09de84cf20bc2ea9081e0f57a3f851` |
| Oficial `upstream/main` | `5304f3e9d4c912bfa0eb2f5f41fa109b3646236b` |

`git rev-list --left-right --count origin/main...upstream/main` devuelve `74 127`: Fenix tiene 74 commits propios y upstream tiene 127 commits que todavia no estan en Fenix. El diff bruto afecta 715 archivos (`+67,410/-18,338`), incluidos 270 de web, 195 de server, 120 de mobile y 40 de desktop. No es un cambio apto para merge ciego.

## Paridad ya presente en Fenix

Estas superficies existen en el fork y se mantienen como gates de regresion:

- Aplicaciones web, desktop Electron, iOS y Android dentro del mismo monorepo.
- Providers BYOS originales: Claude Code, Codex, Cursor, Grok Build y OpenCode.
- Proyectos desde carpeta local, URL Git, GitHub, GitLab, Bitbucket y Azure DevOps.
- Hilos, turnos, streaming, tool calls, diffs, checkpoints, revert y modos de permiso.
- Flujo de source control y trabajo con checkout/worktree.
- Settings y Usage dentro de la experiencia original.
- Marca visible Fenix y guard que rechaza marca o dominios visibles del proyecto original.
- Extensiones aditivas Fenix: login obligatorio, pairing de companion, tenancy company+user, driver Fenix, rate limits, auditoria y custom CLI agents locales.
- Gate movil Fenix implementado; la distribucion firmada en App Store/TestFlight y Google Play sigue pendiente de credenciales y QA fisica.

## Cambios oficiales pendientes de portar

La siguiente matriz resume los 127 commits oficiales por capacidad. Cada fila requiere una comprobacion de ausencia/presencia en el tree Fenix antes de portar; el commit upstream es la unidad de evidencia, no una orden de cherry-pick.

| Lote                 | Funciones oficiales detectadas                                                                                                                  | Riesgo Fenix                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| PR y revisiones      | Vista multi-provider, filtros y qualifiers, listado de todos los servers, update branch, reacciones, edicion inline y diffs mas precisos        | Alto: toca web, server y autorizacion de repositorios                  |
| Proyectos            | Seleccion checkout/worktree, nueva pagina de settings de proyecto, favicons/iconos y deteccion Azure DevOps SSH                                 | Alto: validar roots reales y ownership antes de registrar              |
| Hilos                | Snooze de 3 horas, copiar thread ID, shift+click para hilo nuevo, drafts accesibles, regeneracion de titulo movil, contador de subagentes       | Medio: preservar scope company+user en eventos y listados              |
| Diffs y composer     | Persistencia del modo diff, listas largas estables, minimap estable, imagenes pegadas accesibles a agentes, borrador preservado al cambiar repo | Alto: imagenes y rutas pasan por la barrera local                      |
| Usage                | Vista horaria de 24 horas, dashboard mobile y correcciones de agregacion de costes                                                              | Alto: no heredar telemetria/cloud upstream ni romper facturacion Fenix |
| Temas y UI           | Busqueda Open VSX, OKLCH, contraste, appearance persistente, sidebar y settings refinados                                                       | Medio: revalidar marca y no reintroducir Clerk/T3 visible              |
| Desktop/server       | Terminal Windows 256-color, resolucion de CLIs, shell probe concurrente, aislamiento de procesos, unborn HEAD y SVG sandbox                     | Alto: procesos locales y sandbox                                       |
| Mobile               | Settings anidados, estabilidad del composer, markdown, rotacion tablet, navegacion y release 1.0.4                                              | Alto: mantener login Fenix y secure storage obligatorios               |
| Merge/source control | Opcion para desactivar auto-settle y apertura de PR sin rebase obligatorio                                                                      | Medio: no degradar checkpoints/revert                                  |

## Cambios upstream que no se copian literalmente

- Clerk, T3 Connect, telemetria, endpoints cloud y cualquier dominio del proveedor original se sustituyen por autenticacion y servicios Fenix.
- La marca, iconos y textos visibles se mantienen Fenix.
- Los tokens BYOS permanecen en la maquina del usuario.
- Ningun flujo nuevo puede evitar `fenixCodeTenantScope`, el registro realpath de roots ni el gate de usuario asignado.
- Los identificadores internos compatibles con upstream se conservan cuando no son visibles, para reducir el coste de futuros ports.

## Plan de sincronizacion por contenido

1. Congelar SHAs de Fenix y upstream y generar inventario de commits/archivos por lote.
2. Portar primero contratos y utilidades compartidas sin UI ni runtime; ejecutar typecheck y tests de contratos.
3. Portar server/desktop por capacidad con negativos de path traversal, proceso, credencial y cross-tenant.
4. Portar web manteniendo el layout oficial y reaplicando solo branding y gates Fenix.
5. Portar mobile manteniendo el arranque bloqueado sin sesion Fenix valida y secure storage.
6. Ejecutar suite completa, Fork CI 4/4, branding selftest/check e inventarios regenerados.
7. Ejecutar corpus visual 1440 px y 390 px para empty state, proyecto+hilo, turno, diff/checkpoint, permission modes, Settings, Appearance y Usage.
8. Registrar por commit oficial uno de tres estados: `PORTADO`, `YA_EQUIVALENTE` o `RECHAZADO_CON_JUSTIFICACION`.

## Criterio de cierre de paridad

No se declara paridad total hasta que los 127 commits hayan sido clasificados, los lotes aceptados esten integrados y el corpus visual/funcional sea verde. La landing puede describir las funciones verificadas del tree Fenix, pero no debe presentar como disponibles los paquetes Windows/Linux, la distribucion movil firmada ni funciones upstream aun no portadas.
