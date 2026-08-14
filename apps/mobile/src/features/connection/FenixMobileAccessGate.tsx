import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, AppState, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  authorizeFenixMobileController,
  isFenixMobilePairingUrl,
  pairFenixMobileController,
} from "../../connection/fenixMobile";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useThemeColor } from "../../lib/useThemeColor";
import { ConnectionSheetButton } from "./ConnectionSheetButton";

const ACCESS_REVALIDATION_MS = 60_000;

type AccessState = "checking" | "authorized" | "locked" | "unavailable";

export function FenixMobileAccessGate(props: { readonly children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const iconColor = useThemeColor("--color-icon");
  const spinnerColor = useThemeColor("--color-primary");
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [showScanner, setShowScanner] = useState(false);
  const [scannerLocked, setScannerLocked] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const mountedRef = useRef(true);
  const validationInFlightRef = useRef(false);
  const scannerLockedRef = useRef(false);
  const scannerUnlockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetScannerLock = useCallback(() => {
    if (scannerUnlockTimeoutRef.current !== null) {
      clearTimeout(scannerUnlockTimeoutRef.current);
      scannerUnlockTimeoutRef.current = null;
    }
    scannerLockedRef.current = false;
    setScannerLocked(false);
  }, []);

  const validateAccess = useCallback(async () => {
    if (validationInFlightRef.current) return;
    validationInFlightRef.current = true;
    try {
      const authorization = await authorizeFenixMobileController();
      if (!mountedRef.current) return;
      setAccessState(authorization === null ? "locked" : "authorized");
    } catch {
      if (!mountedRef.current) return;
      setAccessState("unavailable");
    } finally {
      validationInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void validateAccess();
    const interval = setInterval(() => void validateAccess(), ACCESS_REVALIDATION_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void validateAccess();
    });
    return () => {
      mountedRef.current = false;
      if (scannerUnlockTimeoutRef.current !== null) {
        clearTimeout(scannerUnlockTimeoutRef.current);
        scannerUnlockTimeoutRef.current = null;
      }
      clearInterval(interval);
      subscription.remove();
    };
  }, [validateAccess]);

  const openScanner = useCallback(async () => {
    if (cameraPermission?.granted) {
      resetScannerLock();
      setShowScanner(true);
      return;
    }
    const permission = await requestCameraPermission();
    if (permission.granted) {
      resetScannerLock();
      setShowScanner(true);
      return;
    }
    Alert.alert(
      "Acceso a la camara necesario",
      "Permite el acceso a la camara para escanear el QR emitido por Fenix.",
    );
  }, [cameraPermission?.granted, requestCameraPermission, resetScannerLock]);

  const handleQrScan = useCallback(async ({ data }: { readonly data: string }) => {
    if (scannerLockedRef.current) return;
    scannerLockedRef.current = true;
    setScannerLocked(true);
    try {
      if (!isFenixMobilePairingUrl(data)) {
        throw new Error("Este QR no es una autorizacion movil emitida por Fenix.");
      }
      await pairFenixMobileController({ pairingUrl: data });
      const authorization = await authorizeFenixMobileController();
      if (authorization === null) {
        throw new Error("Fenix no ha autorizado este dispositivo.");
      }
      setShowScanner(false);
      setAccessState("authorized");
    } catch (error) {
      setAccessState("locked");
      Alert.alert(
        "No se pudo autorizar el dispositivo",
        error instanceof Error ? error.message : "Vuelve a generar el QR desde Fenix.",
      );
    } finally {
      scannerUnlockTimeoutRef.current = setTimeout(() => {
        scannerUnlockTimeoutRef.current = null;
        scannerLockedRef.current = false;
        if (mountedRef.current) setScannerLocked(false);
      }, 600);
    }
  }, []);

  if (accessState === "authorized") return props.children;

  return (
    <View className="flex-1 bg-sheet">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingTop: Math.max(insets.top, 24),
          paddingBottom: Math.max(insets.bottom, 24),
          paddingHorizontal: 24,
        }}
      >
        <View className="mx-auto w-full max-w-[520px] gap-5">
          <View className="items-center gap-3">
            <SymbolView name="lock.shield" size={38} tintColor={iconColor} type="monochrome" />
            <Text className="text-center text-2xl font-t3-bold">Acceso Fenix obligatorio</Text>
            <Text className="text-center text-sm leading-normal text-foreground-muted">
              Inicia sesion en iaonline.io, abre Code Lab y genera el QR movil para este
              dispositivo. La autorizacion queda vinculada a tu empresa, usuario y equipo.
            </Text>
          </View>

          {accessState === "checking" ? (
            <View className="items-center gap-3 py-5">
              <ActivityIndicator color={String(spinnerColor)} />
              <Text className="text-sm text-foreground-muted">Verificando acceso...</Text>
            </View>
          ) : showScanner ? (
            cameraPermission?.granted ? (
              <View className="gap-3">
                <View className="overflow-hidden rounded-[24px] border-continuous">
                  <CameraView
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={scannerLocked ? undefined : handleQrScan}
                    style={{ aspectRatio: 1, width: "100%" }}
                  />
                </View>
                <ConnectionSheetButton
                  icon="xmark"
                  label="Cerrar escaner"
                  onPress={() => {
                    resetScannerLock();
                    setShowScanner(false);
                  }}
                />
              </View>
            ) : null
          ) : (
            <View className="gap-3">
              {accessState === "unavailable" ? (
                <Text className="text-center text-sm text-danger-foreground">
                  No se pudo confirmar la sesion con Fenix. La app permanece bloqueada.
                </Text>
              ) : null}
              <ConnectionSheetButton
                icon="qrcode.viewfinder"
                label="Escanear QR de Fenix"
                tone="primary"
                onPress={() => void openScanner()}
              />
              <ConnectionSheetButton
                icon="arrow.clockwise"
                label="Reintentar acceso"
                onPress={() => {
                  setAccessState("checking");
                  void validateAccess();
                }}
              />
            </View>
          )}

          <Text className="text-center text-xs leading-normal text-foreground-muted">
            Sin una credencial valida no se montan proyectos, terminales, carpetas ni conexiones
            locales. La revocacion en Fenix bloquea este dispositivo.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
