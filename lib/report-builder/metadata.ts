// ── Metadata ───────────────────────────────────────────────────────────────

export const STRATEGY_LABELS: Record<string, string> = {
  equal_weight: "Equal Weight",
  momentum_12_1: "Momentum 12-1",
  ml_ridge: "ML Ridge",
  ml_lightgbm: "ML LightGBM",
  low_vol: "Low Volatility",
  trend_filter: "Trend Filter",
};

export const ML_STRATEGIES = new Set(["ml_ridge", "ml_lightgbm"]);

export const PERIODS_PER_YEAR: Record<string, number> = {
  Daily: 252,
  Weekly: 52,
  Monthly: 12,
  Quarterly: 4,
};

export type RunMetadataView = {
  modelImpl: string | null;
  modelVersion: string | null;
  featureSet: string | null;
  randomSeed: string | null;
  determinismMode: string | null;
  lightgbmVersion: string | null;
  dataSnapshotMode: string | null;
  dataSnapshotCutoff: string | null;
  dataSnapshotDigest: string | null;
  runtimeDownloadUsed: boolean | null;
  predictionsDigest: string | null;
  positionsDigest: string | null;
  equityDigest: string | null;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringish(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function parseRunMetadata(value: unknown): RunMetadataView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      modelImpl: null,
      modelVersion: null,
      featureSet: null,
      randomSeed: null,
      determinismMode: null,
      lightgbmVersion: null,
      dataSnapshotMode: null,
      dataSnapshotCutoff: null,
      dataSnapshotDigest: null,
      runtimeDownloadUsed: null,
      predictionsDigest: null,
      positionsDigest: null,
      equityDigest: null,
    };
  }
  const v = value as Record<string, unknown>;
  return {
    modelImpl: readString(v.model_impl),
    modelVersion: readString(v.model_version),
    featureSet: readString(v.feature_set),
    randomSeed: readStringish(v.random_seed),
    determinismMode: readString(v.determinism_mode),
    lightgbmVersion: readString(v.lightgbm_version),
    dataSnapshotMode: readString(v.data_snapshot_mode),
    dataSnapshotCutoff: readString(v.data_snapshot_cutoff),
    dataSnapshotDigest: readString(v.data_snapshot_digest),
    runtimeDownloadUsed:
      typeof v.runtime_download_used === "boolean" ? v.runtime_download_used : null,
    predictionsDigest: readString(v.predictions_digest),
    positionsDigest: readString(v.positions_digest),
    equityDigest: readString(v.equity_digest),
  };
}
