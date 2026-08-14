import { PRODUCT_BASE_NAME } from "@t3tools/shared/productBranding";

export function SplashScreen() {
  const iconUrl = `${import.meta.env.BASE_URL}fenix-code-touch.png`;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="flex size-24 items-center justify-center"
        aria-label={`Pantalla de inicio de ${PRODUCT_BASE_NAME}`}
      >
        <img alt={PRODUCT_BASE_NAME} className="size-16 object-contain" src={iconUrl} />
      </div>
    </div>
  );
}
