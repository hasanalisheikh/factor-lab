from __future__ import annotations

from typing import Any

from factorlab_engine.worker import (
  DEFAULT_ETF8_UNIVERSE,
  UNIVERSE_PRESETS,
  resolve_and_snapshot_universe_symbols,
  resolve_universe_symbols,
)


class _FakeIO:
  def __init__(self) -> None:
    self.calls: list[tuple[str, list[str]]] = []

  def update_run_universe_symbols(self, run_id: str, symbols: list[str]) -> None:
    self.calls.append((run_id, list(symbols)))


def test_resolve_universe_symbols_precedence(monkeypatch: Any):
  monkeypatch.setenv("FACTORLAB_UNIVERSE", "NASDAQ100")

  run_with_snapshot = {
    "id": "run-1",
    "universe": "ETF8",
    "universe_symbols": ["xly", "xlf"],
  }
  assert resolve_universe_symbols(run_with_snapshot) == ["XLY", "XLF"]

  run_with_preset = {"id": "run-2", "universe": "ETF8", "universe_symbols": None}
  assert resolve_universe_symbols(run_with_preset) == DEFAULT_ETF8_UNIVERSE

  run_with_env_preset = {"id": "run-3", "universe": "UNKNOWN", "universe_symbols": None}
  assert resolve_universe_symbols(run_with_env_preset) == UNIVERSE_PRESETS["NASDAQ100"]

  monkeypatch.setenv("FACTORLAB_UNIVERSE", "spy, qqq, spy")
  run_with_env_csv = {"id": "run-4", "universe": None, "universe_symbols": None}
  assert resolve_universe_symbols(run_with_env_csv) == ["SPY", "QQQ"]

  monkeypatch.delenv("FACTORLAB_UNIVERSE", raising=False)
  run_default = {"id": "run-5", "universe": None, "universe_symbols": None}
  assert resolve_universe_symbols(run_default) == DEFAULT_ETF8_UNIVERSE


def test_resolve_and_snapshot_universe_symbols_writes_once():
  io = _FakeIO()
  run = {"id": "run-123", "universe": "ETF8", "universe_symbols": None}

  symbols = resolve_and_snapshot_universe_symbols(io, run)

  assert symbols == DEFAULT_ETF8_UNIVERSE
  assert run["universe_symbols"] == DEFAULT_ETF8_UNIVERSE
  assert io.calls == [("run-123", DEFAULT_ETF8_UNIVERSE)]

  resolve_and_snapshot_universe_symbols(io, run)
  assert io.calls == [("run-123", DEFAULT_ETF8_UNIVERSE)]
