from __future__ import annotations

from typing import Any

import pandas as pd

from .client import _SUPABASE_SELECT_PAGE_SIZE


class PricesRepositoryMixin:
    def fetch_prices_frame(
        self, tickers: list[str], start_date: str, end_date: str
    ) -> pd.DataFrame:
        if not tickers:
            return pd.DataFrame()

        rows: list[dict[str, Any]] = []
        # Fetch one ticker at a time so every query is a tight single-column
        # index scan on idx_prices_ticker_date with no large OFFSET.  The
        # multi-ticker IN(…)+ORDER BY approach requires Postgres to merge N
        # sorted streams and skip potentially 10 000–20 000 rows on later pages,
        # which reliably hits Supabase's statement timeout for long date windows
        # (ML warmup = 5 years → ~2 500 rows per ticker → 5+ pages multi-ticker).
        page_size = _SUPABASE_SELECT_PAGE_SIZE
        for ticker in tickers:
            offset = 0
            while True:
                result = self._execute_with_retry(
                    lambda: (
                        self.client.table("prices")
                        .select("ticker,date,adj_close")
                        .eq("ticker", ticker)
                        .gte("date", start_date)
                        .lte("date", end_date)
                        .order("date")
                        .range(offset, offset + page_size - 1)
                        .execute()
                    ),
                    context=(
                        f"fetch_prices_frame ticker={ticker} "
                        f"range={start_date}..{end_date} offset={offset}"
                    ),
                )
                chunk = result.data or []
                if not chunk:
                    break
                rows.extend(chunk)
                if len(chunk) < page_size:
                    break
                offset += page_size

        if not rows:
            return pd.DataFrame()

        frame = pd.DataFrame(rows)
        frame["date"] = pd.to_datetime(frame["date"], utc=False)
        pivot = frame.pivot(index="date", columns="ticker", values="adj_close")
        return pivot.sort_index().ffill().dropna(how="all")
