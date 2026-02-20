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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
