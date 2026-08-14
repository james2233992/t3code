import type { UsageProviderKind } from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { useUsage } from "../../state/usage";
import {
  enumerateDays,
  formatCount,
  formatDayShort,
  formatPercent,
  formatTokens,
  formatUsd,
  makeWindow,
} from "../../usage/usageFormat";
import { ScrollArea } from "../ui/scroll-area";
import { UsageChartLegend, UsageProviderChart, type UsageChartMetric } from "./UsageProviderChart";
import { PROVIDER_COLOR, PROVIDER_LABEL, PROVIDER_MARK, PROVIDER_ORDER } from "./usageProviders";

const WINDOW_OPTIONS = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
] as const;

export function UsagePage() {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [metric, setMetric] = useState<UsageChartMetric>("cost");
  const [breakdown, setBreakdown] = useState<"model" | "day">("model");

  // Recomputed only when the window length changes, so a re-render does not
  // shift the range and refetch every environment.
  const window = useMemo(() => makeWindow(windowDays), [windowDays]);
  const { merged, environments, isPending, isPartial, refresh } = useUsage(window);

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );
  const recentDays = useMemo(() => merged.daily.toReversed().slice(0, 8), [merged.daily]);

  // Ranked by whatever the toggle is showing, so the bars always descend.
  const orderedProviders = useMemo(
    () =>
      merged.providers.toSorted((a, b) =>
        metric === "cost" ? b.costUsd - a.costUsd : b.totalTokens - a.totalTokens,
      ),
    [merged.providers, metric],
  );

  const activeDays = merged.daily.filter((day) => day.totalTokens > 0).length;
  const dailyAverage = activeDays === 0 ? 0 : merged.totalTokens / activeDays;
  const observedInput = merged.uncachedInputTokens + merged.cachedInputTokens;
  const cachedShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-foreground">Uso</h1>
            <p className="text-sm text-muted-foreground">
              {formatDayShort(window.sinceDay)} a {formatDayShort(window.untilDay)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {WINDOW_OPTIONS.map((option) => (
                <button
                  key={option.days}
                  type="button"
                  onClick={() => setWindowDays(option.days)}
                  className={cn(
                    "px-3 py-1.5 text-xs",
                    option.days === windowDays
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={refresh}
              aria-label="Actualizar uso"
              className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground"
            >
              <RefreshCwIcon className="size-3.5" />
            </button>
          </div>
        </header>

        <UsageCoverageNotice
          environments={environments}
          duplicateSources={merged.duplicateSources}
          staleEnvironments={merged.staleEnvironments}
          isPartial={isPartial}
        />

        {isPending ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Analizando las transcripciones de los proveedores…
          </p>
        ) : (
          <>
            {/* Cost first: the financial answer, then the provider split. */}
            <section className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
              {/* The summary follows the chart toggle, so the headline and the
                  series are always reading the same units. */}
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <span className="text-xs tracking-wide text-muted-foreground uppercase">
                    {metric === "cost" ? "Coste bruto de tokens" : "Tokens procesados"}
                  </span>
                  <span className="text-4xl font-semibold text-foreground tabular-nums">
                    {metric === "cost"
                      ? `${formatUsd(merged.costUsd)}*`
                      : formatTokens(merged.totalTokens)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {metric === "cost"
                      ? "* si se factura a la tarifa completa de la API"
                      : `Entrada, lecturas de caché y salida en ${formatCount(merged.sessions)} sesiones.`}
                  </span>
                </div>

                {orderedProviders.map((provider) => {
                  const share = metric === "cost" ? provider.costShare : provider.tokenShare;
                  return (
                    <div key={provider.provider} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between">
                        <span className="flex items-center gap-2 text-sm text-foreground">
                          <ProviderMark provider={provider.provider} className="size-4" />
                          {PROVIDER_LABEL[provider.provider]}
                        </span>
                        <span className="text-sm text-foreground tabular-nums">
                          {metric === "cost"
                            ? formatUsd(provider.costUsd)
                            : formatTokens(provider.totalTokens)}
                        </span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full"
                          style={{
                            width: `${(share * 100).toFixed(1)}%`,
                            backgroundColor: PROVIDER_COLOR[provider.provider],
                          }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {metric === "cost"
                          ? `${formatPercent(share)} del coste · ${formatTokens(provider.totalTokens)} tokens`
                          : `${formatPercent(share)} de los tokens · ${formatUsd(provider.costUsd)}`}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-foreground">
                    {metric === "tokens" ? "Tokens procesados por día" : "Coste diario"}
                  </h2>
                  <div className="flex items-center gap-4">
                    <div className="flex overflow-hidden rounded-md border border-border">
                      {(["cost", "tokens"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setMetric(option)}
                          className={cn(
                            "px-2.5 py-1 text-[10px] tracking-wide uppercase",
                            option === metric
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {option === "cost" ? "coste" : "tokens"}
                        </button>
                      ))}
                    </div>
                    <UsageChartLegend />
                  </div>
                </div>
                <UsageProviderChart days={days} daily={merged.daily} metric={metric} />
              </div>
            </section>

            <section className="grid grid-cols-2 gap-px border-y border-border bg-border md:grid-cols-5">
              <Metric
                label="Tokens procesados"
                value={formatTokens(merged.totalTokens)}
                detail={`${formatTokens(dailyAverage)} por día activo`}
              />
              <Metric
                label="Entrada en caché"
                value={formatTokens(merged.cachedInputTokens)}
                detail={`${formatPercent(cachedShare)} de la entrada observada`}
              />
              <Metric
                label="Entrada sin caché"
                value={formatTokens(merged.uncachedInputTokens)}
                detail={`${formatTokens(merged.cacheCreationTokens)} escrituras en caché`}
              />
              <Metric
                label="Salida"
                value={formatTokens(merged.outputTokens)}
                detail={`incluye ${formatTokens(merged.reasoningTokens)} de razonamiento`}
              />
              <Metric
                label="Ahorro de caché"
                value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                detail={
                  merged.costUsd > 0
                    ? `${(merged.costQuality.cacheSavingsUsd / merged.costUsd).toFixed(1)} veces el coste bruto de tokens`
                    : "frente a las tarifas completas de entrada"
                }
              />
            </section>

            <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium text-foreground">Desglose</h2>
                  <div className="flex overflow-hidden rounded-md border border-border">
                    {(["model", "day"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setBreakdown(option)}
                        className={cn(
                          "px-2.5 py-1 text-[10px] tracking-wide uppercase",
                          option === breakdown
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {option === "model" ? "modelo" : "día"}
                      </button>
                    ))}
                  </div>
                </div>

                {breakdown === "model" ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 font-normal">Modelo</th>
                        <th className="py-2 text-right font-normal">Coste</th>
                        <th className="py-2 text-right font-normal">Proporción</th>
                        <th className="py-2 text-right font-normal">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {merged.models.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-muted-foreground">
                            No hay actividad en este periodo.
                          </td>
                        </tr>
                      ) : (
                        merged.models.map((model) => (
                          <tr
                            key={`${model.provider}:${model.model}`}
                            className="border-b border-border/50"
                          >
                            <td className="py-2 text-foreground">
                              <span className="flex items-center gap-2">
                                <ProviderMark provider={model.provider} className="size-3.5" />
                                {model.model}
                              </span>
                            </td>
                            <td className="py-2 text-right text-foreground tabular-nums">
                              {formatUsd(model.costUsd)}
                            </td>
                            <td className="py-2 text-right text-muted-foreground tabular-nums">
                              {formatPercent(model.costShare)}
                            </td>
                            <td className="py-2 text-right text-muted-foreground tabular-nums">
                              {formatTokens(model.totalTokens)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 font-normal">Día</th>
                        {PROVIDER_ORDER.map((provider) => (
                          <th key={provider} className="py-2 text-right font-normal">
                            {PROVIDER_LABEL[provider]}
                          </th>
                        ))}
                        <th className="py-2 text-right font-normal">Total</th>
                        <th className="py-2 text-right font-normal">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentDays.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-muted-foreground">
                            No hay actividad en este periodo.
                          </td>
                        </tr>
                      ) : (
                        recentDays.map((day) => (
                          <tr key={day.day} className="border-b border-border/50">
                            <td className="py-2 text-foreground">{formatDayShort(day.day)}</td>
                            {PROVIDER_ORDER.map((provider) => (
                              <td
                                key={provider}
                                className="py-2 text-right text-muted-foreground tabular-nums"
                              >
                                {formatUsd(day.byProvider.get(provider)?.costUsd ?? 0)}
                              </td>
                            ))}
                            <td className="py-2 text-right text-foreground tabular-nums">
                              {formatUsd(day.costUsd)}
                            </td>
                            <td className="py-2 text-right text-muted-foreground tabular-nums">
                              {formatTokens(day.totalTokens)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <h2 className="text-sm font-medium text-foreground">Calidad del coste</h2>
                <dl className="flex flex-col">
                  <QualityRow
                    label="Informado por el proveedor"
                    value={formatPercent(merged.costQuality.providerReportedShare)}
                  />
                  <QualityRow
                    label="Modelo con precio"
                    value={formatPercent(merged.costQuality.modelPricedShare)}
                  />
                  <QualityRow
                    label="Sin precio"
                    value={formatPercent(merged.costQuality.unpricedShare)}
                  />
                  <QualityRow
                    label="Ahorro de caché"
                    value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                  />
                </dl>
              </div>
            </section>
          </>
        )}
      </div>
    </ScrollArea>
  );
}

/** Brand mark for the harness a row belongs to. */
function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const Mark = PROVIDER_MARK[provider];
  return <Mark className={cn("shrink-0", className)} aria-hidden />;
}

function Metric({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-background px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg text-foreground tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

function QualityRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Says plainly when the totals are incomplete: an environment still answering,
 * one that failed, or one whose transcripts another environment already
 * reported.
 */
function UsageCoverageNotice({
  environments,
  duplicateSources,
  staleEnvironments,
  isPartial,
}: {
  readonly environments: readonly {
    environmentId: string;
    label: string;
    error: string | null;
    isPending: boolean;
  }[];
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly string[];
  readonly isPartial: boolean;
}) {
  const failed = environments.filter((environment) => environment.error !== null);
  const stale = environments.filter((environment) =>
    staleEnvironments.includes(environment.environmentId),
  );
  if (failed.length === 0 && stale.length === 0 && duplicateSources.length === 0 && !isPartial) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 border border-border px-3 py-2 text-xs text-muted-foreground">
      {isPartial ? (
        <span>Algunos entornos siguen informando. Los totales son parciales.</span>
      ) : null}
      {failed.map((environment) => (
        <span key={environment.label}>{environment.label} no pudo informar del uso.</span>
      ))}
      {stale.map((environment) => (
        <span key={environment.label}>
          {environment.label} usa una versión antigua del servidor y se excluye de los totales.
        </span>
      ))}
      {duplicateSources.length > 0 ? (
        <span>
          Se cuenta una sola vez entre entornos que comparten un directorio de transcripciones:{" "}
          {duplicateSources.join(", ")}
        </span>
      ) : null}
    </div>
  );
}
