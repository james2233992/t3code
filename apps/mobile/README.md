# Fenix Code para iOS y Android

> [!WARNING]
> La app movil esta en validacion interna y todavia no se distribuye en tiendas. Las builds locales y de CI no pueden publicar actualizaciones ni seleccionar cuentas de distribucion sin variables Fenix explicitas.

## Uso

> [!NOTE]
> Usa modulos nativos, por lo que Expo Go no es compatible. Para desarrollo se necesita Expo Dev Client.

La app conserva el control remoto del Companion de Fenix Code: proyectos, carpetas y repositorios del equipo emparejado, threads, turnos, diffs, checkpoints, revert, terminal y revision. El telefono nunca abre una carpeta local del propio movil; controla exclusivamente los recursos del equipo Companion asignado al mismo usuario Fenix.

## Emparejamiento privado con Fenix

1. El usuario inicia sesion en `https://iaonline.io` y abre la landing de Fenix Code.
2. La landing genera un QR de un solo uso mediante la sesion cookie-first del portal.
3. La app movil consume el QR como dispositivo `mobile_controller` y guarda la credencial en SecureStore con proteccion solo para ese dispositivo.
4. El backend reautoriza company, usuario y agente en cada consulta. La app solo descubre equipos `local_runner` del mismo owner.
5. Cada conexion usa un ticket WebSocket temporal. La cookie del navegador y las credenciales BYOS nunca se copian al telefono.

Un dispositivo movil no puede registrarse a la vez como runner local, solicitar credenciales de proveedor ni anunciar carpetas. Si se revoca el owner o deja de estar asignado, el backend revoca el dispositivo y corta sus conexiones.

Hay tres variantes:

- `development`: Expo dev client, installable side-by-side as `Fenix Code Dev`
- `preview`: persistent internal preview build, installable side-by-side as `Fenix Code Preview`
- `production`: store/release build as `Fenix Code`

Ejecuta los comandos desde `apps/mobile`.

Una copia limpia no selecciona relay, cuenta Expo, proyecto EAS, equipo Apple ni OTA. La identidad de publicacion solo puede configurarse mediante variables `FENIX_CODE_*` del proceso o del entorno EAS. No uses un fichero `.env` dentro de `apps/mobile`.

## Development

Start Metro for the dev client:

```bash
vp run dev:client
```

Build and run the local iOS dev client:

```bash
vp run ios:dev
```

Si Xcode solo dispone de un Personal Team, usa un bundle identifier propio. Esta build local omite widgets, share extensions, push y Sign in with Apple nativo.

```bash
FENIX_CODE_IOS_PERSONAL_TEAM=1 \
FENIX_CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=com.aiworks.fenixcode.dev.local \
vp run ios:dev
```

Build and install a self-contained Release app that does not need Metro:

```bash
vp run ios:release
```

The Personal Team equivalent also needs a unique bundle identifier:

```bash
FENIX_CODE_IOS_PERSONAL_TEAM=1 \
FENIX_CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=com.aiworks.fenixcode.local \
vp run ios:release
```

Build and run the local iOS preview app:

```bash
vp run ios:preview
```

Force the review diff highlighter engine:

```bash
EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=javascript vp run ios:dev
```

`javascript` is the default and recommended setting for the review diff screen. Set `EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=native` only when you explicitly want to test the native Shiki engine.

Inspect the resolved Expo config for a variant:

```bash
vp run config:dev
vp run config:preview
```

Run static checks for mobile native code:

```bash
node ../../scripts/mobile-native-static-check.ts
```

The native lint task runs SwiftLint for Swift plus ktlint and detekt for Kotlin. Missing native tools are reported as warnings and skipped locally. CI installs the default toolset from `apps/mobile/Brewfile` before running the native checks.

## Distribucion interna

El perfil `preview:dev` genera una build interna. Para vincular una build a infraestructura de AIWorks hay que declarar, como minimo:

```bash
FENIX_CODE_EXPO_OWNER=aiworks-fenix
FENIX_CODE_EXPO_PROJECT_ID=<uuid-del-proyecto-fenix>
FENIX_CODE_IOS_TEAM_ID=<team-id-aiworks>
```

La autenticacion y el acceso remoto deben usar el pairing Fenix. `FENIX_CODE_RELAY_URL` solo se admite para un relay operado por AIWorks; si no se declara, el relay queda deshabilitado. El gate `scripts/fenix/check-mobile-release-config.mjs` bloquea identidades, dominios o proyectos de distribucion heredados.

Create a PR preview dev-client build manually:

```bash
vp run eas:ios:preview:dev
```

Create a cloud dev-client build:

```bash
vp run eas:ios:dev
```

Create a persistent preview build:

```bash
vp run eas:ios:preview
```

Android equivalents:

```bash
vp run eas:android:dev
vp run eas:android:preview:dev
vp run eas:android:preview
```

Los exports de Hermes validan que el bundle de iOS y Android compila, pero no son paquetes instalables. Un `.ipa`, `.aab` o build interno requiere las credenciales y el proyecto de distribucion Fenix indicados arriba; nunca se reutilizan cuentas o proyectos heredados.
