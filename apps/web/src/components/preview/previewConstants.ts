/** Cap for the per-thread "recently seen" URL list shown in the empty state. */
export const PREVIEW_RECENT_URL_LIMIT = 10;

/**
 * Common Chromium error codes mapped to a short human label. Used by the
 * unreachable view to drop the raw `ERR_*` code in favour of friendlier copy.
 */
export const PREVIEW_ERROR_CODE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  ERR_NAME_NOT_RESOLVED: "No se pudo encontrar la dirección DNS",
  ERR_NAME_RESOLUTION_FAILED: "No se pudo encontrar la dirección DNS",
  ERR_CONNECTION_REFUSED: "Conexión rechazada",
  ERR_CONNECTION_RESET: "La conexión se restableció",
  ERR_CONNECTION_CLOSED: "La conexión se cerró",
  ERR_CONNECTION_TIMED_OUT: "La conexión agotó el tiempo de espera",
  ERR_INTERNET_DISCONNECTED: "Sin conexión a Internet",
  ERR_TIMED_OUT: "La conexión agotó el tiempo de espera",
  ERR_CERT_AUTHORITY_INVALID: "La autoridad del certificado no es de confianza",
  ERR_CERT_COMMON_NAME_INVALID: "Certificate hostname mismatch",
  ERR_CERT_DATE_INVALID: "El certificado ha caducado o aún no es válido",
  ERR_TOO_MANY_REDIRECTS: "Too many redirects",
});
