FENIX CODE COMPANION PARA macOS
================================

Este paquete conecta tus carpetas locales con tu sesión privada de Fenix Code.
No contiene tu cookie ni credenciales reutilizables. La instalación consume una
autorización de un solo uso generada tras iniciar sesión en Fenix.

REQUISITOS
- Mac con Apple Silicon.
- macOS 13 o posterior.
- Una sesión activa y autorizada en https://iaonline.io/code-lab/setup

INSTALACIÓN
1. Abre Terminal.
2. Abre https://iaonline.io/code-lab/setup e inicia sesión.
3. Genera el comando seguro de instalación para tu equipo.
4. Ejecuta el comando. Si moviste la descarga, el instalador te pedirá su ruta absoluta.
5. Indica la carpeta local que quieras autorizar cuando se solicite.
6. Ejecuta: fenix-code service install
7. Comprueba: fenix-code service status
8. Comprueba: fenix-code fenix status

CARPETAS ADICIONALES
Ejecuta: fenix-code fenix root add /ruta/a/la/carpeta

PRIVACIDAD
- La credencial queda guardada con permisos 0600 en tu usuario local.
- Fenix Code no instala ni inicia el servidor sin autorizacion vigente de Fenix.
- El instalador detiene el proceso si la firma de un componente nativo no es válida.
- Solo se exponen las raíces que autorizas expresamente.
- Cada usuario y dispositivo mantiene su propia identidad y sus propios proyectos.
- No compartas el comando de emparejamiento: es una credencial de un solo uso.
