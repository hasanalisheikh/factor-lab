from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from typing import Any

import pandas as pd
import yfinance as yf

from .supabase_io import SupabaseIO


SP100_TICKERS = [
  "AAPL", "ABBV", "ABT", "ACN", "ADBE", "AIG", "AMD", "AMGN", "AMT", "AMZN",
  "AVGO", "AXP", "BA", "BAC", "BK", "BKNG", "BLK", "BMY", "C", "CAT",
  "CHTR", "CL", "CMCSA", "COF", "COP", "COST", "CRM", "CSCO", "CVS", "CVX",
  "DE", "DHR", "DIS", "DUK", "EMR", "F", "GD", "GE", "GILD", "GM",
  "GOOG", "GOOGL", "GS", "HD", "HON", "IBM", "INTC", "INTU", "JNJ", "JPM",
  "KHC", "KO", "LIN", "LLY", "LMT", "LOW", "MA", "MCD", "MDLZ", "MDT",
  "MET", "META", "MMM", "MO", "MRK", "MS", "MSFT", "NEE", "NFLX", "NKE",
  "NVDA", "ORCL", "PEP", "PFE", "PG", "PM", "QCOM", "RTX", "SBUX", "SCHW",
  "SO", "SPG", "T", "TGT", "TMO", "TMUS", "TSLA", "TXN", "UNH", "UNP",
  "UPS", "USB", "V", "VZ", "WFC", "WMT", "XOM",
]


def _normalize_close_frame(raw: pd.DataFrame, tickers: list[str]) -> pd.DataFrame:
  if raw.empty:
    return pd.DataFrame()

  if isinstance(raw.columns, pd.MultiIndex):
    level0 = raw.columns.get_level_values(0)
    key = "Close" if "Close" in level0 else "Adj Close"
    close = raw[key] if key in level0 else pd.DataFrame()
  else:
    close = raw.to_frame(name=tickers[0])

  if isinstance(close, pd.Series):
    close = close.to_frame(name=tickers[0])

  close = close.sort_index().ffill()
  close = close.dropna(how="all")
  return close


def _download_prices(tickers: list[str], start: str, end: str) -> pd.DataFrame:
  raw = yf.download(
    tickers=tickers,
    start=start,
    end=(pd.to_datetime(end) + pd.Timedelta(days=1)).strftime("%Y-%m-%d"),
    auto_adjust=True,
    progress=False,
    threads=True,
  )
  return _normalize_close_frame(raw, tickers)


def _to_price_rows(close: pd.DataFrame) -> list[dict[str, Any]]:
  rows: list[dict[str, Any]] = []
  for dt, row in close.iterrows():
    date = pd.Timestamp(dt).strftime("%Y-%m-%d")
    for ticker, value in row.items():
      if pd.isna(value):
        continue
      rows.append(
        {"ticker": str(ticker).upper(), "date": date, "adj_close": float(value)}
      )
  return rows


def _upsert_prices(io: SupabaseIO, rows: list[dict[str, Any]], chunk_size: int = 1000) -> int:
  total = 0
  for start in range(0, len(rows), chunk_size):
    chunk = rows[start : start + chunk_size]
    io.client.table("prices").upsert(chunk, on_conflict="ticker,date").execute()
    total += len(chunk)
  return total


def _upsert_data_log(
  io: SupabaseIO,
  tickers_ingested: int,
  rows_upserted: int,
  start_date: str,
  end_date: str,
) -> None:
  payload = {
    "source": "yfinance_sp100",
    "tickers_ingested": tickers_ingested,
    "rows_upserted": rows_upserted,
    "start_date": start_date,
    "end_date": end_date,
    "last_updated_at": datetime.utcnow().isoformat(),
  }
  io.client.table("data_last_updated").upsert(payload, on_conflict="source").execute()


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Ingest adjusted close prices into Supabase")
  parser.add_argument(
    "--start-date",
    default=(datetime.utcnow() - timedelta(days=3650)).strftime("%Y-%m-%d"),
    help="Start date (YYYY-MM-DD). Defaults to ~10 years ago.",
  )
  parser.add_argument(
    "--end-date",
    default=datetime.utcnow().strftime("%Y-%m-%d"),
    help="End date (YYYY-MM-DD). Defaults to today (UTC).",
  )
  parser.add_argument(
    "--tickers",
    default=",".join(SP100_TICKERS),
    help="Comma-separated tickers list.",
  )
  return parser.parse_args()


def main() -> None:
  args = parse_args()
  tickers = [x.strip().upper() for x in args.tickers.split(",") if x.strip()]
  if not tickers:
    raise RuntimeError("No tickers provided for ingestion")

  print(
    f"[ingest] downloading {len(tickers)} tickers from {args.start_date} to {args.end_date}"
  )
  close = _download_prices(tickers, args.start_date, args.end_date)
  if close.empty:
    raise RuntimeError("No price data returned")

  rows = _to_price_rows(close)
  io = SupabaseIO()
  rows_upserted = _upsert_prices(io, rows)
  _upsert_data_log(
    io=io,
    tickers_ingested=len(close.columns),
    rows_upserted=rows_upserted,
    start_date=close.index.min().strftime("%Y-%m-%d"),
    end_date=close.index.max().strftime("%Y-%m-%d"),
  )
  print(
    f"[ingest] upserted {rows_upserted} rows for {len(close.columns)} tickers "
    f"({close.index.min().date()} to {close.index.max().date()})"
  )


if __name__ == "__main__":
  main()

