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
          start_date: string
          end_date: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          strategy_id: string
          status?: string
          start_date: string
          end_date: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['runs']['Insert']>
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
          progress: number
          started_at: string | null
          duration: number | null
          created_at: string
        }
        Insert: {
          id?: string
          run_id?: string | null
          name: string
          status?: string
          progress?: number
          started_at?: string | null
          duration?: number | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['jobs']['Insert']>
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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
