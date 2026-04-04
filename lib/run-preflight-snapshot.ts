type BenchmarkCoverageHealth = {
  status: string;
  reason: string | null;
};

export type RunPreflightSnapshotView = {
  dataCutoffUsed: string | null;
  universeEarliestStart: string | null;
  benchmarkCoverageHealth: BenchmarkCoverageHealth | null;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readIsoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function resolveEffectiveDataCutoff(params: {
  dataCutoffDate: string | null;
  requiredEnd: string | null;
}): string | null {
  const { dataCutoffDate, requiredEnd } = params;
  if (dataCutoffDate && requiredEnd) {
    return requiredEnd < dataCutoffDate ? requiredEnd : dataCutoffDate;
  }
  return requiredEnd ?? dataCutoffDate;
}

export function getRunPreflightSnapshot(run: { run_params?: unknown }): RunPreflightSnapshotView {
  const params = readRecord(run.run_params);
  const preflight = readRecord(params?.preflight);
  const benchmarkHealth = readRecord(preflight?.benchmark_coverage_health);
  const dataCutoffDate = readIsoDate(preflight?.data_cutoff_date);
  const requiredEnd = readIsoDate(preflight?.required_end);

  return {
    dataCutoffUsed: resolveEffectiveDataCutoff({
      dataCutoffDate,
      requiredEnd,
    }),
    universeEarliestStart: readIsoDate(preflight?.universe_earliest_start),
    benchmarkCoverageHealth: benchmarkHealth
      ? {
          status:
            typeof benchmarkHealth.status === "string"
              ? benchmarkHealth.status.charAt(0).toUpperCase() + benchmarkHealth.status.slice(1)
              : "—",
          reason: typeof benchmarkHealth.reason === "string" ? benchmarkHealth.reason : null,
        }
      : null,
  };
}
