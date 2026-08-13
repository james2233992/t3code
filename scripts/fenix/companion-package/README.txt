FENIX CODE COMPANION PARA macOS
================================

Este paquete conecta tus carpetas locales con tu sesion privada de Fenix Code.
No contiene tu cookie ni credenciales reutilizables. La instalacion consume una
autorizacion de un solo uso generada tras iniciar sesion en Fenix.

REQUISITOS
- Mac con Apple Silicon.
- macOS 13 o posterior.
- Una sesion activa y autorizada en https://iaonline.io/code-lab/setup

INSTALACION
1. Abre Terminal.
2. Entra en esta carpeta extraida.
3. Abre https://iaonline.io/code-lab/setup e inicia sesion.
4. Genera el comando seguro de instalacion para tu equipo.
5. En Terminal, entra en la carpeta local que quieras autorizar y ejecuta el comando.
6. Ejecuta: fenix-code service install
7. Comprueba: fenix-code service status
8. Comprueba: fenix-code fenix status

CARPETAS ADICIONALES
Ejecuta: fenix-code fenix root add /ruta/a/la/carpeta

PRIVACIDAD
- La credencial queda guardada con permisos 0600 en tu usuario local.
- Fenix Code no instala ni inicia el servidor sin autorizacion vigente de Fenix.
- Solo se exponen las raices que autorizas expresamente.
- Cada usuario y dispositivo mantiene su propia identidad y sus propios proyectos.
- No compartas el comando de emparejamiento: es una credencial de un solo uso.
