import { useAuth, useClerk, useUser } from "@clerk/react";
import { encodeConnectAuthCode, readConnectAuthorizeRequest } from "@t3tools/shared/connectAuth";
import { useEffect, useRef, useState } from "react";

import {
  buildConnectCliClerkAuthorizeUrl,
  readConnectCliAuthState,
  readConnectCliCallbackResult,
  rememberConnectCliAuthState,
} from "../../cloud/connectCliAuth";
import { isElectron } from "../../env";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { AuthSurfaceShell } from "../auth/AuthSurfaceShell";
import { resolveClerkSignInProps } from "../clerk/authRedirect";
import { Button } from "../ui/button";

function ConnectCliAuthMessage({
  eyebrow,
  title,
  description,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <>
      {eyebrow ? (
        <p className="text-[10px] font-semibold tracking-[0.18em] text-blue-600 uppercase dark:text-blue-400">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </>
  );
}

const invalidLinkMessage = {
  eyebrow: "Solicitud de autorización",
  title: "Este enlace de conexión está incompleto",
  description:
    "Al enlace le falta la solicitud de autorización. Ejecuta de nuevo `fenix-code connect` en el terminal y abre la URL recién generada.",
} as const;

/**
 * /connect: the URL a headless CLI prints. Waits for a Clerk session, then
 * forwards the CLI's PKCE request to Clerk's authorize endpoint.
 */
export function ConnectCliAuthorizeSurface() {
  const [request] = useState(() => readConnectAuthorizeRequest(new URL(window.location.href)));
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const signInOpened = useRef(false);
  const redirecting = useRef(false);

  useEffect(() => {
    if (!request || !isLoaded || redirecting.current) {
      return;
    }
    if (!isSignedIn) {
      if (!signInOpened.current) {
        signInOpened.current = true;
        clerk.openSignIn(resolveClerkSignInProps(window.location.href, isElectron));
      }
      return;
    }
    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(request);
    if (!authorizeUrl) {
      return;
    }
    redirecting.current = true;
    rememberConnectCliAuthState(request.state);
    window.location.assign(authorizeUrl);
  }, [clerk, isLoaded, isSignedIn, request]);

  if (!request) {
    return (
      <AuthSurfaceShell>
        <ConnectCliAuthMessage {...invalidLinkMessage} />
      </AuthSurfaceShell>
    );
  }

  return (
    <AuthSurfaceShell>
      <ConnectCliAuthMessage
        eyebrow="Paso 1 de 2 · Autorización en el navegador"
        title="Conectando tu terminal"
        description={
          isSignedIn
            ? "Redirigiendo para autorizar Fenix Connect en tu CLI…"
            : "Inicia sesión para seguir autorizando Fenix Connect en tu CLI."
        }
      />
      {isLoaded && !isSignedIn ? (
        <div className="mt-6">
          <Button
            type="button"
            onClick={() =>
              clerk.openSignIn(resolveClerkSignInProps(window.location.href, isElectron))
            }
          >
            Iniciar sesión
          </Button>
        </div>
      ) : null}
    </AuthSurfaceShell>
  );
}

/**
 * /connect/callback: Clerk's redirect target. Shows the one-time code the
 * user enters in the waiting terminal.
 */
export function ConnectCliCallbackSurface() {
  const [result] = useState(readConnectCliCallbackResult);
  const [expectedState] = useState(readConnectCliAuthState);
  const { user } = useUser();
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "código de autenticación" });

  if (!result) {
    return (
      <AuthSurfaceShell>
        <ConnectCliAuthMessage
          eyebrow="Paso 2 de 2 · Transferencia al terminal"
          title="La autorización no se completó"
          description="No se devolvió ningún código de autorización. Ejecuta de nuevo `fenix-code connect` en tu terminal y vuelve a intentarlo."
        />
      </AuthSurfaceShell>
    );
  }

  // Fail closed: the legitimate callback always lands in the same browser
  // that visited /connect (which recorded the state), so a missing or
  // mismatched state means this page was reached some other way — the CSRF
  // shape the state parameter exists to stop. Refuse to display a code.
  if (expectedState === null || expectedState !== result.state) {
    return (
      <AuthSurfaceShell>
        <ConnectCliAuthMessage
          eyebrow="Paso 2 de 2 · Entrega al terminal"
          title="Este código pertenece a otra solicitud"
          description="Esta respuesta de autorización no coincide con una solicitud de conexión iniciada en este navegador. Ejecuta de nuevo `fenix-code connect` en tu terminal y abre en este navegador la nueva URL mostrada."
        />
      </AuthSurfaceShell>
    );
  }

  const accountLabel = user?.primaryEmailAddress?.emailAddress ?? user?.username ?? null;
  const authCode = encodeConnectAuthCode(result);

  return (
    <AuthSurfaceShell>
      <ConnectCliAuthMessage
        eyebrow="Paso 2 de 2 · Entrega al terminal"
        title="Conexión casi terminada"
        description={
          accountLabel
            ? `Introduce este código en el terminal en espera para conectarlo como ${accountLabel}.`
            : "Introduce este código en el terminal en espera para completar la conexión."
        }
      />

      <div className="mt-6 overflow-hidden rounded-xl border border-border/80 bg-background/65">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-2.5">
          <span className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Código de autorización de un solo uso
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">caduca pronto</span>
        </div>
        <code
          className="block p-4 font-mono text-sm leading-relaxed break-all select-all"
          data-testid="connect-auth-code"
        >
          {authCode}
        </code>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" onClick={() => copyToClipboard(authCode)}>
          {isCopied ? "¡Copiado!" : "Copiar código de autorización"}
        </Button>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Introduce este código únicamente en una sesión de terminal que hayas iniciado tú. Mientras
        sea válido, cualquiera que lo tenga podría vincular su equipo a tu cuenta de Fenix Connect.
      </p>
    </AuthSurfaceShell>
  );
}
