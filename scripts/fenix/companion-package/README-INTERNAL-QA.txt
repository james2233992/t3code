FENIX CODE COMPANION 0.0.33 - QA INTERNO TEMPORAL
=================================================

Este paquete es exclusivamente para la validación de Manuel antes de disponer
de la licencia Apple Developer. No es una versión oficial ni está notarizado.
No debe publicarse, redistribuirse ni usarse con clientes.

ARCHIVOS NECESARIOS
- Fenix-Code-Companion-0.0.33-internal-qa-macos-arm64.tar.gz
- Fenix-Code-Companion-0.0.33-internal-qa-macos-arm64.tar.gz.sha256

VERIFICACIÓN OBLIGATORIA
Coloca ambos archivos en la misma carpeta y ejecuta:

  shasum -a 256 -c Fenix-Code-Companion-0.0.33-internal-qa-macos-arm64.tar.gz.sha256

Continúa únicamente si Terminal muestra "OK". No uses comandos manuales como
"xattr -cr" sobre la descarga.

INSTALACIÓN
1. Extrae el archivo .tar.gz y abre su carpeta en Terminal.
2. Abre https://iaonline.io/code-lab/setup e inicia sesión.
3. Genera el comando de instalación de un solo uso.
4. Añade esta opción inmediatamente después de ./install.sh:

  --accept-unnotarized-internal-qa

5. Ejecuta el comando una sola vez.
6. Ejecuta: fenix-code service install
7. Comprueba: fenix-code service status
8. Comprueba: fenix-code fenix status

VALIDACIÓN DE MANUEL
- Iniciar sesión y completar el emparejamiento.
- Abrir un proyecto real dentro de la carpeta autorizada.
- Ejecutar un turno y revisar el diff/checkpoint.
- Probar revert y la reconexión del servicio.

SEGURIDAD
- El instalador verifica el SHA interno, las firmas ad hoc y el inventario de
  enlaces antes de retirar cuarentena de los componentes verificados.
- La credencial queda con permisos 0600 y el emparejamiento sigue siendo de un
  solo uso. Este canal no evita ni debilita la autorización de Fenix.
- El lunes debe sustituirse por el paquete oficial Developer ID/notarizado.
