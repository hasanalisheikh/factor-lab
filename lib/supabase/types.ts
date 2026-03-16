export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      runs: {
        Row: {
          id: string
          name: string
          strategy_id: string
          status: string
          benchmark: string
          benchmark_ticker: string
          universe: string
          universe_symbols: string[] | null
          costs_bps: number
          top_n: number
          run_params: Json
          run_metadata: Json
          start_date: string
          end_date: string
          created_at: string
          user_id: string | null
          executed_with_missing_data: boolean
        }
        Insert: {
          id?: string
          name: string
          strategy_id: string
          status?: string
          benchmark?: string
          benchmark_ticker?: string
          universe?: string
          universe_symbols?: string[] | null
          costs_bps?: number
          top_n?: number
          run_params?: Json
          run_metadata?: Json
          start_date: string
          end_date: string
          created_at?: string
          user_id?: string | null
          executed_with_missing_data?: boolean
        }
        Update: Partial<Database['public']['Tables']['runs']['Insert']>
        Relationships: []
      }
      user_settings: {
        Row: {
          user_id: string
          default_universe: string
          default_benchmark: string
          default_costs_bps: number
          default_top_n: number
          default_initial_capital: number
          default_rebalance_frequency: string
          default_date_range_years: number
          apply_costs_default: boolean
          slippage_bps_default: number
          updated_at: string
        }
        Insert: {
          user_id: string
          default_universe?: string
          default_benchmark?: string
          default_costs_bps?: number
          default_top_n?: number
          default_initial_capital?: number
          default_rebalance_frequency?: string
          default_date_range_years?: number
          apply_costs_default?: boolean
          slippage_bps_default?: number
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['user_settings']['Insert']>
        Relationships: []
      }
      run_metrics: {
        Row: {
          id: string
          run_id: string
          cagr: number
          sharpe: number
          max_drawdown: number
          turnover: number
          volatility: number
          win_rate: number
          profit_factor: number
          calmar: number
        }
        Insert: {
          id?: string
          run_id: string
          cagr: number
          sharpe: number
          max_drawdown: number
          turnover: number
          volatility: number
          win_rate: number
          profit_factor: number
          calmar: number
        }
        Update: Partial<Database['public']['Tables']['run_metrics']['Insert']>
        Relationships: []
      }
      equity_curve: {
        Row: {
          id: string
          run_id: string
          date: string
          portfolio: number
          benchmark: number
        }
        Insert: {
          id?: string
          run_id: string
          date: string
          portfolio: number
          benchmark: number
        }
        Update: Partial<Database['public']['Tables']['equity_curve']['Insert']>
        Relationships: []
      }
      reports: {
        Row: {
          id: string
          run_id: string
          storage_path: string
          url: string
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          storage_path: string
          url: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['reports']['Insert']>
        Relationships: []
      }
      jobs: {
        Row: {
          id: string
          run_id: string | null
          name: string
          status: string
          stage: string
          progress: number
          error_message: string | null
          started_at: string | null
          finished_at: string | null
          duration: number | null
          created_at: string
          job_type: string
          payload: Json | null
          preflight_run_id: string | null
          updated_at: string | null
          attempt_count: number
          next_retry_at: string | null
          locked_at: string | null
        }
        Insert: {
          id?: string
          run_id?: string | null
          name: string
          status?: string
          stage?: string
          progress?: number
          error_message?: string | null
          started_at?: string | null
          finished_at?: string | null
          duration?: number | null
          created_at?: string
          job_type?: string
          payload?: Json | null
          preflight_run_id?: string | null
          updated_at?: string | null
          attempt_count?: number
          next_retry_at?: string | null
          locked_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['jobs']['Insert']>
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          run_id: string | null
          job_id: string | null
          title: string
          body: string | null
          level: "info" | "success" | "warning" | "error"
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          run_id?: string | null
          job_id?: string | null
          title: string
          body?: string | null
          level?: "info" | "success" | "warning" | "error"
          read_at?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>
        Relationships: []
      }
      prices: {
        Row: {
          id: string
          ticker: string
          date: string
          adj_close: number
          created_at: string
        }
        Insert: {
          id?: string
          ticker: string
          date: string
          adj_close: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['prices']['Insert']>
        Relationships: []
      }
      data_last_updated: {
        Row: {
          id: string
          source: string
          tickers_ingested: number
          rows_upserted: number
          start_date: string | null
          end_date: string | null
          last_updated_at: string
        }
        Insert: {
          id?: string
          source: string
          tickers_ingested?: number
          rows_upserted?: number
          start_date?: string | null
          end_date?: string | null
          last_updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['data_last_updated']['Insert']>
        Relationships: []
      }
      data_state: {
        Row: {
          id: number
          data_cutoff_date: string
          last_update_at: string
          update_mode: "monthly" | "daily" | "manual"
          updated_by: string | null
          last_noop_check_at: string | null
        }
        Insert: {
          id?: number
          data_cutoff_date: string
          last_update_at?: string
          update_mode?: "monthly" | "daily" | "manual"
          updated_by?: string | null
          last_noop_check_at?: string | null
        }
        Update: Partial<Database["public"]["Tables"]["data_state"]["Insert"]>
        Relationships: []
      }
      features_monthly: {
        Row: {
          id: string
          ticker: string
          date: string
          momentum: number
          reversal: number
          volatility: number
          beta: number
          momentum_12_1: number | null
          momentum_6_1: number | null
          reversal_1m: number | null
          vol_20d: number | null
          vol_60d: number | null
          beta_60d: number | null
          drawdown_6m: number | null
          drawdown: number
          created_at: string
        }
        Insert: {
          id?: string
          ticker: string
          date: string
          momentum: number
          reversal: number
          volatility: number
          beta: number
          drawdown: number
          momentum_12_1?: number | null
          momentum_6_1?: number | null
          reversal_1m?: number | null
          vol_20d?: number | null
          vol_60d?: number | null
          beta_60d?: number | null
          drawdown_6m?: number | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['features_monthly']['Insert']>
        Relationships: []
      }
      model_metadata: {
        Row: {
          id: string
          run_id: string
          model_name: string
          train_start: string | null
          train_end: string | null
          train_rows: number
          prediction_rows: number
          rebalance_count: number
          top_n: number
          cost_bps: number
          feature_columns: string[]
          feature_importance: Json
          model_params: Json
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          model_name: string
          train_start?: string | null
          train_end?: string | null
          train_rows?: number
          prediction_rows?: number
          rebalance_count?: number
          top_n?: number
          cost_bps?: number
          feature_columns?: string[]
          feature_importance?: Json
          model_params?: Json
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['model_metadata']['Insert']>
        Relationships: []
      }
      model_predictions: {
        Row: {
          id: string
          run_id: string
          model_name: string
          as_of_date: string
          target_date: string
          ticker: string
          predicted_return: number
          realized_return: number | null
          rank: number
          selected: boolean
          weight: number
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          model_name: string
          as_of_date: string
          target_date: string
          ticker: string
          predicted_return: number
          realized_return?: number | null
          rank: number
          selected?: boolean
          weight?: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['model_predictions']['Insert']>
        Relationships: []
      }
      positions: {
        Row: {
          run_id: string
          date: string
          symbol: string
          weight: number
        }
        Insert: {
          run_id: string
          date: string
          symbol: string
          weight: number
        }
        Update: Partial<Database['public']['Tables']['positions']['Insert']>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

// Row type aliases — safe to import from client components (no server-side imports here)
export type RunRow = Database["public"]["Tables"]["runs"]["Row"]
export type RunMetricsRow = Database["public"]["Tables"]["run_metrics"]["Row"]
export type EquityCurveRow = Database["public"]["Tables"]["equity_curve"]["Row"]
export type ReportRow = Database["public"]["Tables"]["reports"]["Row"]
export type JobRow = Database["public"]["Tables"]["jobs"]["Row"]
export type PriceRow = Database["public"]["Tables"]["prices"]["Row"]
export type DataLastUpdatedRow = Database["public"]["Tables"]["data_last_updated"]["Row"]
export type DataStateRow = Database["public"]["Tables"]["data_state"]["Row"]
export type ModelMetadataRow = Database["public"]["Tables"]["model_metadata"]["Row"]
export type ModelPredictionRow = Database["public"]["Tables"]["model_predictions"]["Row"]
export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"]
export type PositionRow = Database["public"]["Tables"]["positions"]["Row"]
export type UserSettings = Database["public"]["Tables"]["user_settings"]["Row"]

// Composite types
export type RunWithMetrics = RunRow & { run_metrics: RunMetricsRow[] | RunMetricsRow | null }
export type CompareRunBundle = { run: RunRow; metrics: RunMetricsRow; equity: EquityCurveRow[] }

// Query-result types — safe to import from client components
export type TickerMissingness = {
  ticker: string
  actualDays: number
  missingDays: number
  coveragePercent: number
}

export type BenchmarkCoverage = {
  ticker: string
  actualDays: number
  expectedDays: number
  missingDays: number
  coveragePercent: number
  trueMissingRate?: number
  windowStart?: string | null
  windowEnd?: string | null
  /** Latest date this ticker has data for (YYYY-MM-DD), null if not ingested */
  latestDate: string | null
  /** Earliest date this ticker has data for (YYYY-MM-DD), null if not ingested */
  earliestDate: string | null
  /** True when earliestDate > COVERAGE_WINDOW_START — ticker needs a historical backfill */
  needsHistoricalBackfill: boolean
  status: "ok" | "partial" | "missing" | "not_ingested"
  /** Dev-only: tickers found via ILIKE when actualDays=0, to detect symbol mismatches */
  debugSimilarTickers?: string[]
}

export type DataIngestJobStatus = {
  id: string
  /** "queued" | "running" | "succeeded" | "failed" | "retrying" | "blocked" */
  status: string
  /** "download" | "transform" | "upsert" | "finalize" */
  stage: string | null
  progress: number
  /** Explicit symbol field from data_ingest_jobs (replaces payload->ticker) */
  symbol?: string | null
  /** Start/end dates explicitly stored (replaces payload->start_date/end_date) */
  start_date?: string | null
  end_date?: string | null
  request_mode?: string | null
  batch_id?: string | null
  target_cutoff_date?: string | null
  requested_by?: string | null
  /** Error message from data_ingest_jobs.error column */
  error?: string | null
  /** Legacy field from jobs.error_message (for backward compat) */
  error_message?: string | null
  created_at: string | null
  started_at: string | null
  updated_at: string | null
  finished_at?: string | null
  last_heartbeat_at?: string | null
  rows_inserted?: number | null
  /** When set, the retry scheduler will requeue this failed job at this time. */
  next_retry_at: string | null
  /** Number of times this job has been attempted (claimed by a worker). */
  attempt_count: number | null
}

/** Helper to read the error text from either new or legacy job row. */
export function getIngestJobError(job: DataIngestJobStatus): string | null {
  return job.error ?? job.error_message ?? null
}

/** Earliest date we expect all benchmark tickers to be fully ingested from */
export const COVERAGE_WINDOW_START = "2015-01-02"

/** Real-world ETF inception dates used to detect incomplete historical ingests. */
export const TICKER_INCEPTION_DATES: Record<string, string> = {
  SPY: "1993-01-22",
  QQQ: "1999-03-10",
  IWM: "2000-05-26",
  VTI: "2001-05-31",
  EFA: "2001-08-27",
  EEM: "2003-04-14",
  TLT: "2002-07-30",
  GLD: "2004-11-18",
  VNQ: "2004-09-29",
}

/** Per-ticker date range from the prices table (from get_ticker_date_ranges RPC) */
export type TickerDateRange = {
  ticker: string
  firstDate: string  // YYYY-MM-DD — first price row for this ticker
  lastDate: string   // YYYY-MM-DD — last price row for this ticker
  actualDays: number // total rows ingested for this ticker
  /** Max calendar-day gap between consecutive price rows within coverage window (> 7 = real gap) */
  maxGapDays?: number
  /** ISO timestamp of last ticker_stats upsert */
  updatedAt?: string
}

/** Inception-aware missingness for a single ticker */
export type TickerMissingnessV2 = {
  ticker: string
  firstDate: string
  lastDate: string
  actualDays: number
  expectedDays: number     // business days in [firstDate, lastDate]
  trueMissingDays: number  // gaps within the ticker's own window (expectedDays - actualDays, ≥0)
  preInceptionDays: number // business days in [globalStart, firstDate) — not counted as missing
  coveragePercent: number  // actualDays / expectedDays × 100 (within own window)
}
