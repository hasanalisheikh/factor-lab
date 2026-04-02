from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd
import yfinance as yf

from .supabase_io import SupabaseIO

SP100_TICKERS = [
    "AAPL",
    "ABBV",
    "ABT",
    "ACN",
    "ADBE",
    "AIG",
    "AMD",
    "AMGN",
    "AMT",
    "AMZN",
    "AVGO",
    "AXP",
    "BA",
    "BAC",
    "BK",
    "BKNG",
    "BLK",
    "BMY",
    "C",
    "CAT",
    "CHTR",
    "CL",
    "CMCSA",
    "COF",
    "COP",
    "COST",
    "CRM",
    "CSCO",
    "CVS",
    "CVX",
    "DE",
    "DHR",
    "DIS",
    "DUK",
    "EMR",
    "F",
    "GD",
    "GE",
    "GILD",
    "GM",
    "GOOG",
    "GOOGL",
    "GS",
    "HD",
    "HON",
    "IBM",
    "INTC",
    "INTU",
    "JNJ",
    "JPM",
    "KHC",
    "KO",
    "LIN",
    "LLY",
    "LMT",
    "LOW",
    "MA",
    "MCD",
    "MDLZ",
    "MDT",
    "MET",
    "META",
    "MMM",
    "MO",
    "MRK",
    "MS",
    "MSFT",
    "NEE",
    "NFLX",
    "NKE",
    "NVDA",
    "ORCL",
    "PEP",
    "PFE",
    "PG",
    "PM",
    "QCOM",
    "RTX",
    "SBUX",
    "SCHW",
    "SO",
    "SPG",
    "T",
    "TGT",
    "TMO",
    "TMUS",
    "TSLA",
    "TXN",
    "UNH",
    "UNP",
    "UPS",
    "USB",
    "V",
    "VZ",
    "WFC",
    "WMT",
    "XOM",
]

# All benchmarks available in the app (mirrors BENCHMARK_OPTIONS in lib/benchmark.ts).
# Must be ingested so the /data page benchmark coverage section always shows real data.
BENCHMARK_TICKERS = ["SPY", "QQQ", "IWM", "VTI", "EFA", "EEM", "TLT", "GLD", "VNQ"]

# Singleton row ID in data_state table
_DATA_STATE_ID = 1


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_last_complete_trading_day_utc() -> str:
    """Return the most recent complete weekday at least 1 calendar day in the past (UTC).

    Mirrors getLastCompleteTradingDayUtc() in lib/data-cutoff.ts.
    """
    cursor = _utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    cursor -= timedelta(days=1)
    while cursor.weekday() >= 5:  # 5=Saturday, 6=Sunday
        cursor -= timedelta(days=1)
    return cursor.strftime("%Y-%m-%d")


def _get_current_data_state_cutoff(io: SupabaseIO) -> str | None:
    """Read current data_state.data_cutoff_date from DB; returns None on error or missing row."""
    try:
        result = (
            io.client.table("data_state")
            .select("data_cutoff_date")
            .eq("id", _DATA_STATE_ID)
            .execute()
        )
        rows = result.data or []
        if rows:
            return rows[0].get("data_cutoff_date")
    except Exception as exc:
        print(f"[ingest] warning: could not read data_state: {exc}")
    return None


def _update_data_state(io: SupabaseIO, cutoff_date: str, mode: str, tickers: list[str]) -> None:
    """Upsert data_state.data_cutoff_date and refresh ticker_stats for all ingested tickers.

    Raises on data_state write failure so the caller can surface the error.
    ticker_stats failures are non-fatal (best-effort).
    """
    now = _utcnow().isoformat()
    io.client.table("data_state").upsert(
        {
            "id": _DATA_STATE_ID,
            "data_cutoff_date": cutoff_date,
            "last_update_at": now,
            "update_mode": mode,
            "updated_by": f"github-actions:ingest:{mode}",
        }
    ).execute()

    for ticker in tickers:
        try:
            io.client.rpc("upsert_ticker_stats", {"p_ticker": ticker}).execute()
        except Exception as exc:
            print(f"[ingest] warning: could not upsert ticker_stats for {ticker}: {exc}")


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
            rows.append({"ticker": str(ticker).upper(), "date": date, "adj_close": float(value)})
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
        "last_updated_at": _utcnow().isoformat(),
    }
    io.client.table("data_last_updated").upsert(payload, on_conflict="source").execute()


def _insert_ingestion_log(
    io: SupabaseIO,
    tickers_updated: int,
    rows_upserted: int,
    start_date: str,
    end_date: str,
    status: str = "success",
    note: str | None = None,
) -> None:
    payload: dict[str, Any] = {
        "status": status,
        "tickers_updated": tickers_updated,
        "rows_upserted": rows_upserted,
        "note": note or f"yfinance pull {start_date} to {end_date}",
        "source": "yfinance",
    }
    try:
        io.client.table("data_ingestion_log").insert(payload).execute()
    except Exception as exc:
        # Non-fatal: table may not exist if migration hasn't been applied yet
        print(f"[ingest] warning: could not write to data_ingestion_log: {exc}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest adjusted close prices into Supabase")
    parser.add_argument(
        "--start-date",
        default=(_utcnow() - timedelta(days=3650)).strftime("%Y-%m-%d"),
        help="Start date (YYYY-MM-DD). Defaults to ~10 years ago.",
    )
    parser.add_argument(
        "--end-date",
        default=_utcnow().strftime("%Y-%m-%d"),
        help="End date (YYYY-MM-DD). Defaults to today (UTC).",
    )
    parser.add_argument(
        "--tickers",
        default=",".join(SP100_TICKERS),
        help="Comma-separated tickers list.",
    )
    parser.add_argument(
        "--mode",
        default="daily",
        choices=["daily", "monthly", "manual"],
        help="Update mode recorded in data_state (daily|monthly|manual).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    tickers = [x.strip().upper() for x in args.tickers.split(",") if x.strip()]
    if not tickers:
        raise RuntimeError("No tickers provided for ingestion")

    # Always include all benchmark tickers so /data benchmark coverage is populated
    tickers = list(dict.fromkeys(tickers + BENCHMARK_TICKERS))

    last_complete_day = _get_last_complete_trading_day_utc()
    io = SupabaseIO()
    current_cutoff = _get_current_data_state_cutoff(io)

    print(
        f"[ingest] scheduler fired mode={args.mode} "
        f"last_complete_day(conservative)={last_complete_day} current_cutoff={current_cutoff or 'none'}"
    )

    print(f"[ingest] downloading {len(tickers)} tickers from {args.start_date} to {args.end_date}")
    close = _download_prices(tickers, args.start_date, args.end_date)
    if close.empty:
        raise RuntimeError("No price data returned")

    rows = _to_price_rows(close)
    rows_upserted = _upsert_prices(io, rows)
    start_date = close.index.min().strftime("%Y-%m-%d")
    end_date = close.index.max().strftime("%Y-%m-%d")

    # The ingest script is scheduled to run after market close (21:00 UTC).
    # Trust the last date actually returned by yfinance — it only returns
    # complete sessions, so this is already conservative.  Capping at
    # last_complete_day (= yesterday) would permanently keep the cutoff one
    # trading day behind, because by run-time today's session IS complete.
    # We still cap at today (UTC) to guard against yfinance returning a
    # future date due to timezone quirks.
    today_utc = _utcnow().strftime("%Y-%m-%d")
    effective_cutoff = min(end_date, today_utc)

    _upsert_data_log(
        io=io,
        tickers_ingested=len(close.columns),
        rows_upserted=rows_upserted,
        start_date=start_date,
        end_date=end_date,
    )
    _insert_ingestion_log(
        io=io,
        tickers_updated=len(close.columns),
        rows_upserted=rows_upserted,
        start_date=start_date,
        end_date=end_date,
    )

    print(
        f"[ingest] upserted {rows_upserted} rows for {len(close.columns)} tickers "
        f"({start_date} to {end_date})"
    )

    # Advance data_state and refresh ticker_stats only when there is genuinely new data.
    # Prices are always upserted above (idempotent gap repair), but the bookkeeping
    # cutoff must only move forward, never backward.
    if not current_cutoff or effective_cutoff > current_cutoff:
        try:
            _update_data_state(io, effective_cutoff, args.mode, list(close.columns))
            print(f"[ingest] cutoff advanced: {current_cutoff or 'none'} -> {effective_cutoff}")
        except Exception as exc:
            print(f"[ingest] ERROR: could not update data_state: {exc}")
            raise
    else:
        print(f"[ingest] cutoff unchanged at {current_cutoff} (target={effective_cutoff})")


if __name__ == "__main__":
    main()
