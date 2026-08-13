# Fenix Code Mobile Controller - evidencia 2026-08-13

## Alcance

La app movil original del fork conserva el ciclo de control remoto de Fenix Code y ahora puede emparejarse desde una sesion Fenix autenticada. El telefono controla el Companion instalado en el Mac, Windows o Linux del mismo usuario; no ejecuta proyectos en el propio telefono ni comparte carpetas entre usuarios.

## Frontera de seguridad

- El QR se emite desde el portal cookie-first y caduca tras un solo consumo.
- El QR queda ligado al origen exacto configurado de Fenix; solo se permite HTTP en loopback para QA local.
- El movil se registra exclusivamente con la capacidad `mobile_controller` y no puede reclamar a la vez el rol `local_runner`.
- La credencial se guarda en SecureStore con proteccion `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- El backend reautoriza el owner completo `(companyId, userId, agentId)` antes de listar equipos o emitir tickets.
- La respuesta movil solo contiene nombre, ID opaco y capacidades del Companion. No expone IDs de usuario, fingerprint ni actividad.
- Solo se aceptan destinos con `local_runner`, `rpc` y `workspace.local`.
- Cada WebSocket usa un ticket temporal; la app rechaza tickets vencidos antes de conectar.
- La cookie del navegador, los tokens BYOS y el contenido de los proyectos no se almacenan en el portal ni en el movil.

## Superficies

- Portal: seccion "Control movil privado" y QR dentro de la landing autenticada.
- iOS/Android: el escaner reconoce `fenixcode://mobile-pair`, consume el emparejamiento y reutiliza el runtime remoto original.
- Backend: endpoints de dispositivo para enumerar runners propios y solicitar un ticket corto para uno de ellos.
- Distribucion: las identidades Expo, EAS y Apple heredadas se han eliminado. La publicacion requiere variables `FENIX_CODE_*` de AIWorks.

## Verificacion reproducida

- Mobile: 101 ficheros / 625 tests PASS antes del endurecimiento final; focal posterior 2 ficheros / 11 tests PASS.
- Web: 224 ficheros / 2023 tests PASS; typecheck y build PASS.
- Backend: CodeLab control plane + endpoints 94/94 PASS; suite CodeLab 99 PASS y 4 integration tests omitidos por no disponer de MySQL en el harness.
- iOS export production: 9359 modulos, bundle Hermes generado.
- Android export production: 9359 modulos, bundle Hermes generado.
- Gate release config, lint mobile, guard visual de marca e inventario: PASS.
- QA local de `/setup`: render de la landing, flujo de descarga por SO, instalacion ligada a Fenix y seccion de control movil presentes.

## Limite de entrega

Los exports de iOS y Android prueban el bundle, pero no son instalables. La entrega a Manuel requiere generar un build interno firmado (`.ipa`/TestFlight para macOS+iPhone y `.aab`/APK para Android cuando proceda) con un proyecto EAS y credenciales de distribucion propiedad de AIWorks. Ninguna cuenta, proyecto OTA o identificador de T3 queda como fallback.
