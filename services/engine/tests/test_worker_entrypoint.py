"""Regression tests for worker command entrypoints."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]


def test_python_module_entrypoint_invokes_worker_main() -> None:
    env = os.environ.copy()
    env.pop("NEXT_PUBLIC_SUPABASE_URL", None)
    env.pop("SUPABASE_SERVICE_ROLE_KEY", None)
    env["RUN_ONCE"] = "1"

    result = subprocess.run(
        [sys.executable, "-m", "factorlab_engine.worker"],
        cwd=ENGINE_DIR,
        env=env,
        text=True,
        capture_output=True,
        timeout=15,
    )

    combined_output = result.stdout + result.stderr
    assert result.returncode != 0
    assert "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" in combined_output
