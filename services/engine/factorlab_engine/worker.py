from __future__ import annotations

import os as _os
import sys as _sys

__path__ = [_os.path.join(_os.path.dirname(__file__), "worker")]

from .worker import claiming as _claiming
from .worker import execution as _execution
from .worker import http_server as _http_server
from .worker import ingest_legacy as _ingest_legacy
from .worker import ingest_repair as _ingest_repair
from .worker import pricing as _pricing
from .worker import progress as _progress
from .worker import settings as _settings
from .worker import strategies as _strategies

for _module in (
    _claiming,
    _execution,
    _http_server,
    _ingest_legacy,
    _ingest_repair,
    _pricing,
    _progress,
    _settings,
    _strategies,
):
    for _name in dir(_module):
        if _name.startswith("__"):
            continue
        globals().setdefault(_name, getattr(_module, _name))


def _sync_compat_patches() -> None:
    _pricing._download_prices = _sys.modules[__name__]._download_prices
    _execution._download_prices = _sys.modules[__name__]._download_prices


def _build_baseline_result(*args, **kwargs):
    _sync_compat_patches()
    return _execution._build_baseline_result(*args, **kwargs)


def _build_ml_result(*args, **kwargs):
    _sync_compat_patches()
    return _execution._build_ml_result(*args, **kwargs)


def _run_backtest(*args, **kwargs):
    _sync_compat_patches()
    return _execution._run_backtest(*args, **kwargs)


def _process_job(*args, **kwargs):
    _sync_compat_patches()
    _claiming._run_backtest = _run_backtest
    return _claiming._process_job(*args, **kwargs)


def main() -> None:
    return _claiming.main()


if __name__ == "__main__":
    main()
