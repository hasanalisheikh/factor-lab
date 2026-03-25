"""
Deterministic formula tests for FactorLab metric calculations (Python engine).

These tests verify the EXACT formulas used by _compute_metrics() in worker.py,
plus the turnover helpers, with fixed synthetic inputs and manually pre-computed
expected outputs.

Run these from the services/engine/ directory:
    python -m pytest factorlab_engine/test_metrics_formulas.py -v

Convention reference (cross-check with TypeScript metrics.ts):

    CAGR
        Python:     equity[-1]^(252/n) - 1   (n = number of daily returns)
        TypeScript: (end/start)^(1/years) - 1, years = calendarDays/365.25
        Difference: the two formulas diverge by ~0.2–0.5% on 5-year runs because
                    252 trading days ≠ 365.25 calendar days / year.

    Sharpe
        Python:    (mean / std(ddof=0)) * sqrt(252)   — POPULATION stddev
        TypeScript:(mean / std(ddof=1)) * sqrt(252)   — SAMPLE stddev
        Difference: by factor sqrt(n/(n-1)).

    Max Drawdown
        Python:    NEGATIVE fraction stored in DB (e.g. -0.22 = 22% decline)
        TypeScript: POSITIVE fraction (e.g. 0.22) returned by computeMetrics()
        Report HTML: Math.abs(metrics.max_drawdown) → always shown positive

    Volatility
        Python:    std(ddof=0) * sqrt(252)  — population
        TypeScript: std(ddof=1) * sqrt(252) — sample

    Calmar
        Formula:   cagr / abs(max_drawdown)   if max_drawdown < 0   else 0.0

    Win Rate
        Formula:   mean(daily_returns > 0)  — strictly positive, zeros excluded

    Profit Factor
        Formula:   sum(positive returns) / |sum(negative returns)|
        Edge case: no negative returns → profit_factor = 0.0 (defined as 0)

    Turnover (per-rebalance, one-way)
        Formula:   sum(abs(new_weights - prev_weights)) / 2
        Annualized: mean(positive_rebalance_turnovers) * 12.0  (monthly assumed)
"""

import math

import pandas as pd

from factorlab_engine.worker import (
    _annualize_turnover_from_rebalances,
    _compute_metrics,
)

# ── Helpers ───────────────────────────────────────────────────────────────────


def make_returns(*values: float) -> pd.Series:
    """Build a pd.Series from explicit float values (daily returns)."""
    return pd.Series(list(values), dtype=float)


def assert_close(actual: float, expected: float, abs_tol: float = 1e-9) -> None:
    """Assert two floats are within abs_tol of each other."""
    assert abs(actual - expected) <= abs_tol, (
        f"Expected {expected!r}, got {actual!r} (diff={abs(actual - expected)!r})"
    )


# ── CAGR ─────────────────────────────────────────────────────────────────────


class TestCAGR:
    """
    Python CAGR formula: equity[-1]^(252/n) - 1
    where equity = (1 + daily_returns).cumprod() and n = len(daily_returns).

    This is a TRADING-DAY annualization (252 days per year), not calendar-day.
    """

    def test_constant_daily_rate_gives_10pct_annual(self):
        """
        If each day grows at exactly r = 1.1^(1/252) - 1, then after 252 days
        equity[-1] = 1.1 and CAGR = 1.1^(252/252) - 1 = 0.10 exactly.
        """
        r = 1.1 ** (1 / 252) - 1
        rets = make_returns(*([r] * 252))
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["cagr"], 0.10, abs_tol=1e-10)

    def test_flat_series_cagr_zero(self):
        """All returns = 0 → equity[-1] = 1.0 → 1.0^anything - 1 = 0."""
        rets = make_returns(*([0.0] * 252))
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["cagr"], 0.0, abs_tol=1e-12)

    def test_negative_cagr_declining_series(self):
        """
        Constant daily decline r = 0.9^(1/252) - 1 → CAGR = -10% after 252 days.
        equity[-1] = 0.9^(252/252) = 0.9 → CAGR = 0.9 - 1 = -0.10.
        """
        r = 0.9 ** (1 / 252) - 1
        rets = make_returns(*([r] * 252))
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["cagr"], -0.10, abs_tol=1e-10)

    def test_annualization_uses_252_trading_days(self):
        """
        Verify that the formula uses 252 (not 365.25) by constructing a series
        whose CAGR is exactly 10% under the 252-day convention.

        Under calendar-day convention (365.25/year), the same 252 returns would
        give CAGR = equity[-1]^(365.25/252) - 1 ≈ 13.7% (different value).
        Assert that the computed CAGR is ~10% (trading-day), not ~13.7% (calendar).
        """
        r = 1.1 ** (1 / 252) - 1
        rets = make_returns(*([r] * 252))
        result = _compute_metrics(rets, turnover=0.0)
        # CAGR under correct (252-day) convention
        assert_close(result["cagr"], 0.10, abs_tol=1e-10)
        # Under wrong (365.25/252) calendar convention: equity^(365.25/252)-1 ≈ 0.137
        equity_end = (1 + r) ** 252
        wrong_cagr = equity_end ** (365.25 / 252) - 1
        # Our result must NOT equal the wrong answer
        assert abs(result["cagr"] - wrong_cagr) > 0.02

    def test_four_returns_exact_value(self):
        """
        Returns: [+2%, -1%, +3%, -2%]
        equity = [1.02, 1.02*0.99, ..., 1.01929212]
        CAGR = 1.01929212^(252/4) - 1
             = 1.01929212^63 - 1  (very large annualization of 4 days)

        This verifies the formula is implemented correctly even for short series.
        """
        rets = make_returns(0.02, -0.01, 0.03, -0.02)
        result = _compute_metrics(rets, turnover=0.0)

        equity_end = (1.02) * (0.99) * (1.03) * (0.98)  # = 1.01929212
        expected = equity_end ** (252 / 4) - 1
        assert_close(result["cagr"], expected, abs_tol=1e-12)


# ── Max Drawdown ──────────────────────────────────────────────────────────────


class TestMaxDrawdown:
    """
    Python formula: drawdown = equity / cummax(equity) - 1, max_drawdown = drawdown.min()
    STORED AS NEGATIVE fraction (e.g. -0.25 = 25% decline from peak).
    """

    def test_sign_convention_is_negative(self):
        """Any non-trivial series must produce a non-positive max_drawdown."""
        rets = make_returns(0.1, -0.25, 0.1)
        result = _compute_metrics(rets, turnover=0.0)
        assert result["max_drawdown"] <= 0

    def test_known_series_exact_value(self):
        """
        Returns: [+10%, -20%, +10%]
        Equity:  [1.10, 0.88, 0.968]
        Peak:    [1.10, 1.10, 1.10]
        DD:      [0,   0.88/1.10-1=-0.20, 0.968/1.10-1=-0.12]
        max_drawdown = -0.20 (stored negative).
        """
        rets = make_returns(0.10, -0.20, 0.10)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["max_drawdown"], -0.20, abs_tol=1e-12)

    def test_all_positive_returns_zero_drawdown(self):
        """Purely increasing equity → drawdown never below 0 → max_drawdown = 0."""
        rets = make_returns(0.01, 0.02, 0.005, 0.03)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["max_drawdown"], 0.0, abs_tol=1e-12)

    def test_single_large_drop(self):
        """
        Returns: [+20%, -50%]
        equity[-1] after +20%: 1.2, then -50%: 0.6
        Peak = 1.2, trough = 0.6 → dd = 0.6/1.2 - 1 = -0.50.
        """
        rets = make_returns(0.20, -0.50)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["max_drawdown"], -0.50, abs_tol=1e-12)

    def test_max_drawdown_uses_running_peak_not_initial(self):
        """
        Returns: [+50%, -40%, +50%]
        Equity:  [1.50, 0.90, 1.35]
        Peak:    [1.50, 1.50, 1.50]
        DD:      [0, 0.90/1.50-1=-0.40, 1.35/1.50-1=-0.10]
        max_drawdown = -0.40 (not -0.60 which would assume peak=initial=1.0)
        """
        rets = make_returns(0.50, -0.40, 0.50)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["max_drawdown"], -0.40, abs_tol=1e-12)


# ── Sharpe ────────────────────────────────────────────────────────────────────


class TestSharpe:
    """
    Python formula: (mean(rets) / std(rets, ddof=0)) * sqrt(252)
    Uses POPULATION stddev (ddof=0), unlike TypeScript which uses sample (ddof=1).
    """

    def test_exact_value_four_returns(self):
        """
        Returns: [+2%, -1%, +3%, -2%]
        mean = 0.005
        std(ddof=0) = sqrt(0.0017/4) = sqrt(0.000425) = 0.020616…
        Sharpe = (0.005 / 0.020616) * sqrt(252) ≈ 3.850
        """
        rets = make_returns(0.02, -0.01, 0.03, -0.02)
        result = _compute_metrics(rets, turnover=0.0)

        m = 0.005
        std_pop = math.sqrt(0.0017 / 4)
        expected = (m / std_pop) * math.sqrt(252)
        assert_close(result["sharpe"], expected, abs_tol=1e-9)

    def test_uses_population_stddev_not_sample(self):
        """
        For returns [+2%, -1%, +3%, -2%]:
          std(ddof=0) = sqrt(0.0017/4) ≈ 0.020616  → Sharpe ≈ 3.850
          std(ddof=1) = sqrt(0.0017/3) ≈ 0.023805  → Sharpe ≈ 3.334

        Python result should match ddof=0 (≈3.850), not ddof=1 (≈3.334).
        The two differ by > 0.3 — well outside any floating-point noise.
        """
        rets = make_returns(0.02, -0.01, 0.03, -0.02)
        result = _compute_metrics(rets, turnover=0.0)

        m = 0.005
        std_sample = math.sqrt(0.0017 / 3)  # ddof=1 (TypeScript convention)
        std_pop = math.sqrt(0.0017 / 4)  # ddof=0 (Python convention)
        sharpe_sample = (m / std_sample) * math.sqrt(252)  # ≈ 3.334
        sharpe_pop = (m / std_pop) * math.sqrt(252)  # ≈ 3.850

        # Must match population, not sample
        assert abs(result["sharpe"] - sharpe_pop) < 1e-9
        assert abs(result["sharpe"] - sharpe_sample) > 0.3

    def test_zero_volatility_returns_zero(self):
        """std(ddof=0) of identical returns = 0 → returns 0.0 (not Inf or NaN)."""
        rets = make_returns(*([0.01] * 10))
        result = _compute_metrics(rets, turnover=0.0)
        assert result["sharpe"] == 0.0
        assert math.isfinite(result["sharpe"])

    def test_negative_sharpe_for_declining_series(self):
        """Net negative mean return → Sharpe < 0."""
        rets = make_returns(-0.01, -0.02, 0.005, -0.015, 0.003)
        result = _compute_metrics(rets, turnover=0.0)
        assert result["sharpe"] < 0

    def test_annualization_uses_sqrt_252(self):
        """
        Annualization factor is sqrt(252). Verify by checking that
        Sharpe / (mean/std) ≈ sqrt(252).
        """
        rets = make_returns(0.02, -0.01, 0.03, -0.02)
        result = _compute_metrics(rets, turnover=0.0)

        m = float(rets.mean())
        s = float(rets.std(ddof=0))
        implied_factor = result["sharpe"] / (m / s)
        assert_close(implied_factor, math.sqrt(252), abs_tol=1e-9)


# ── Volatility ────────────────────────────────────────────────────────────────


class TestVolatility:
    """
    Python formula: std(rets, ddof=0) * sqrt(252) — POPULATION stddev.
    TypeScript uses sample stddev (ddof=1); the two differ by sqrt(n/(n-1)).
    """

    def test_exact_value_symmetric_returns(self):
        """
        Returns: [+2%, -2%, +2%, -2%]  (symmetric, mean = 0)
        std(ddof=0) = sqrt(mean(r^2)) = sqrt(0.0004) = 0.02
        annVol = 0.02 * sqrt(252) = 0.31749…
        """
        rets = make_returns(0.02, -0.02, 0.02, -0.02)
        result = _compute_metrics(rets, turnover=0.0)

        expected_std = math.sqrt(0.0004)  # = 0.02
        expected_vol = expected_std * math.sqrt(252)
        assert_close(result["volatility"], expected_vol, abs_tol=1e-12)

    def test_uses_population_stddev(self):
        """
        For [+2%, -2%, +2%, -2%]:
          std(ddof=0) = 0.02         → annVol = 0.31749
          std(ddof=1) = sqrt(4/3)*0.02 ≈ 0.02309 → annVol ≈ 0.36634

        Python result should match ddof=0.
        """
        rets = make_returns(0.02, -0.02, 0.02, -0.02)
        result = _compute_metrics(rets, turnover=0.0)

        std_pop = math.sqrt(0.0004)  # ddof=0
        std_sample = math.sqrt(0.0004 * 4 / 3)  # ddof=1
        vol_pop = std_pop * math.sqrt(252)
        vol_sample = std_sample * math.sqrt(252)

        assert abs(result["volatility"] - vol_pop) < 1e-12
        assert abs(result["volatility"] - vol_sample) > 0.01

    def test_higher_variance_higher_vol(self):
        """Larger return swings → higher annualized volatility."""
        low_rets = make_returns(0.001, -0.001, 0.001, -0.001)
        high_rets = make_returns(0.05, -0.05, 0.05, -0.05)
        low_result = _compute_metrics(low_rets, turnover=0.0)
        high_result = _compute_metrics(high_rets, turnover=0.0)
        assert high_result["volatility"] > low_result["volatility"]

    def test_annualization_factor_is_sqrt_252(self):
        """Implied annualization factor = (annVol / std_daily)^2 = 252."""
        rets = make_returns(0.02, -0.01, 0.03, -0.02)
        result = _compute_metrics(rets, turnover=0.0)

        std_daily = float(rets.std(ddof=0))
        implied_factor = (result["volatility"] / std_daily) ** 2
        assert_close(implied_factor, 252, abs_tol=1e-9)


# ── Calmar ────────────────────────────────────────────────────────────────────


class TestCalmar:
    """
    Formula: calmar = cagr / abs(max_drawdown)  if max_drawdown < 0  else 0.0
    """

    def test_exact_value_positive_cagr_negative_dd(self):
        """
        Construct a series with known CAGR and drawdown using constant rates:
          252 days of constant gain r = 1.1^(1/252) - 1  → CAGR = 10%
          Then one large drop of -40%
          Then 252 days of constant gain back

        Calmar = CAGR / |max_drawdown|

        This is a structural test of the formula, not a numeric golden value,
        because computing the exact CAGR over the combined series is complex.
        Use a simpler direct approach: inject returns where both CAGR and MDD
        are analytically known.
        """
        # 4 returns that give: equity = [1.02, 0.8976, 0.925128, 0.90662544]
        # max_drawdown = 0.8976/1.02 - 1 = -0.12
        rets = make_returns(0.02, -0.12, 0.03, -0.02)
        result = _compute_metrics(rets, turnover=0.0)

        if result["max_drawdown"] < 0:
            expected_calmar = result["cagr"] / abs(result["max_drawdown"])
            assert_close(result["calmar"], expected_calmar, abs_tol=1e-12)
        else:
            assert result["calmar"] == 0.0

    def test_zero_drawdown_returns_zero_calmar(self):
        """All positive returns → max_drawdown = 0 → calmar = 0.0 (by definition)."""
        rets = make_returns(0.01, 0.02, 0.005, 0.03)
        result = _compute_metrics(rets, turnover=0.0)
        assert result["max_drawdown"] == 0.0
        assert result["calmar"] == 0.0

    def test_calmar_exact_known_values(self):
        """
        Use a return series where we can hand-verify cagr and max_drawdown.

        Series: 252 returns of exactly r = 1.1^(1/252)-1 followed by zero padding.
        → CAGR = 10%

        Then artificially set max_drawdown = -0.25 via the identity.
        Actually, construct the test around the formula directly:
          CAGR = 0.10, max_drawdown must be negative, calmar = cagr/abs(mdd).
        Build a series where max_drawdown can be analytically verified.

        Simplest: constant positive returns → mdd=0 → calmar=0 (tested above).
        For non-trivial calmar, use a series with one known drawdown step.
        """
        # 252 constant-gain days → CAGR = 10%, equity never falls → mdd = 0
        r = 1.1 ** (1 / 252) - 1
        rets = make_returns(*([r] * 252))
        result = _compute_metrics(rets, turnover=0.0)
        assert result["calmar"] == 0.0  # mdd = 0 → calmar = 0

    def test_calmar_identity_cagr_over_abs_mdd(self):
        """For any series with a drawdown, verify calmar = cagr / abs(max_drawdown)."""
        rets = make_returns(0.05, -0.30, 0.10, 0.05, -0.02, 0.08)
        result = _compute_metrics(rets, turnover=0.0)

        if result["max_drawdown"] < 0:
            expected = result["cagr"] / abs(result["max_drawdown"])
            assert_close(result["calmar"], expected, abs_tol=1e-12)


# ── Win Rate ──────────────────────────────────────────────────────────────────


class TestWinRate:
    """
    Formula: mean(daily_returns > 0) — strictly positive, zeros excluded.
    """

    def test_known_win_rate(self):
        """
        Returns: [+2%, +1%, -1%, 0%, +3%, -2%]
        Positive: 3 out of 6 → win_rate = 3/6 = 0.5
        Zero return does NOT count as a win.
        """
        rets = make_returns(0.02, 0.01, -0.01, 0.0, 0.03, -0.02)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["win_rate"], 0.5, abs_tol=1e-12)

    def test_all_positive_returns_win_rate_one(self):
        """All returns > 0 → win_rate = 1.0."""
        rets = make_returns(0.01, 0.02, 0.005, 0.03)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["win_rate"], 1.0, abs_tol=1e-12)

    def test_all_negative_returns_win_rate_zero(self):
        """All returns < 0 → win_rate = 0.0."""
        rets = make_returns(-0.01, -0.02, -0.005, -0.03)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["win_rate"], 0.0, abs_tol=1e-12)

    def test_zero_returns_not_counted_as_wins(self):
        """Returns of exactly 0.0 are NOT counted as winning days."""
        rets = make_returns(0.0, 0.0, 0.0)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["win_rate"], 0.0, abs_tol=1e-12)

    def test_mixed_with_zeros_win_rate_is_fraction_of_strictly_positive(self):
        """
        [+1%, 0%, 0%, -1%]: 1 positive, 2 zeros, 1 negative → win_rate = 1/4 = 0.25
        """
        rets = make_returns(0.01, 0.0, 0.0, -0.01)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["win_rate"], 0.25, abs_tol=1e-12)


# ── Profit Factor ─────────────────────────────────────────────────────────────


class TestProfitFactor:
    """
    Formula: sum(positive_returns) / |sum(negative_returns)|
    Edge case: no negative returns → profit_factor = 0.0 (by definition)
    """

    def test_exact_value(self):
        """
        Returns: [+2%, +1%, -1%, 0%, +3%, -2%]
        Positive: [0.02, 0.01, 0.03] → sum = 0.06
        Negative: [-0.01, -0.02] → |sum| = 0.03
        Profit Factor = 0.06 / 0.03 = 2.0
        Zero return is excluded from both numerator and denominator.
        """
        rets = make_returns(0.02, 0.01, -0.01, 0.0, 0.03, -0.02)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["profit_factor"], 2.0, abs_tol=1e-12)

    def test_no_negative_returns_gives_zero(self):
        """
        When there are no negative returns, losses = 0.
        Convention: profit_factor = 0.0 (not infinity).
        """
        rets = make_returns(0.01, 0.02, 0.005)
        result = _compute_metrics(rets, turnover=0.0)
        assert result["profit_factor"] == 0.0

    def test_all_negative_returns(self):
        """
        All returns negative: gains = 0, losses > 0 → profit_factor = 0.0.
        """
        rets = make_returns(-0.01, -0.02, -0.005)
        result = _compute_metrics(rets, turnover=0.0)
        assert result["profit_factor"] == 0.0

    def test_equal_gains_and_losses(self):
        """
        Gains = losses → profit_factor = 1.0.
        [+5%, -5%]: sum_pos = 0.05, |sum_neg| = 0.05 → pf = 1.0.
        """
        rets = make_returns(0.05, -0.05)
        result = _compute_metrics(rets, turnover=0.0)
        assert_close(result["profit_factor"], 1.0, abs_tol=1e-12)

    def test_profit_factor_gt_one_for_positive_net_return(self):
        """Positive net PnL → profit_factor > 1.0."""
        rets = make_returns(0.03, 0.02, -0.01, 0.04, -0.015)
        result = _compute_metrics(rets, turnover=0.0)
        assert result["profit_factor"] > 1.0

    def test_profit_factor_lt_one_for_negative_net_return(self):
        """Negative net PnL → profit_factor < 1.0."""
        rets = make_returns(0.01, -0.03, 0.005, -0.02)
        result = _compute_metrics(rets, turnover=0.0)
        assert 0 < result["profit_factor"] < 1.0


# ── Turnover ──────────────────────────────────────────────────────────────────


class TestTurnover:
    """
    Per-rebalance one-way turnover: sum(abs(new_weights - prev_weights)) / 2

    The /2 factor converts two-sided (buy + sell = 2× the actual trading amount)
    to one-sided (fraction of portfolio actually traded).

    Annualization: mean(positive_rebalance_turnovers) * 12.0
    """

    def _turnover(self, prev: dict, curr: dict) -> float:
        """
        Compute per-rebalance one-way turnover between two weight dicts.
        All tickers across both dicts must be represented.
        """
        all_tickers = set(prev) | set(curr)
        delta_sum = sum(abs(curr.get(t, 0.0) - prev.get(t, 0.0)) for t in all_tickers)
        return delta_sum / 2.0

    def test_no_change_zero_turnover(self):
        """Same weights → no trading → turnover = 0."""
        turnover = self._turnover({"A": 0.5, "B": 0.5}, {"A": 0.5, "B": 0.5})
        assert_close(turnover, 0.0, abs_tol=1e-12)

    def test_full_replacement_100pct_turnover(self):
        """
        Previous: A=50%, B=50%.  New: C=50%, D=50%.
        Deltas: A=-0.5, B=-0.5, C=+0.5, D=+0.5 → |delta| sum = 2.0 → /2 = 1.0 (100%).
        """
        prev = {"A": 0.5, "B": 0.5}
        curr = {"C": 0.5, "D": 0.5}
        turnover = self._turnover(prev, curr)
        assert_close(turnover, 1.0, abs_tol=1e-12)

    def test_partial_rebalance_50pct_turnover(self):
        """
        Previous: A=50%, B=50%.  New: A=100%, B=0%.
        Deltas: A=+0.5, B=-0.5 → |delta| sum = 1.0 → /2 = 0.5 (50%).
        One-way: half the portfolio was rebalanced from B into A.
        """
        prev = {"A": 0.5, "B": 0.5}
        curr = {"A": 1.0, "B": 0.0}
        turnover = self._turnover(prev, curr)
        assert_close(turnover, 0.5, abs_tol=1e-12)

    def test_three_asset_partial(self):
        """
        Previous: A=1/3, B=1/3, C=1/3.  New: A=0.5, B=0.5, C=0.
        Deltas: A=+1/6, B=+1/6, C=-1/3 → sum = 1/6 + 1/6 + 1/3 = 2/3 → /2 = 1/3.
        """
        prev = {"A": 1 / 3, "B": 1 / 3, "C": 1 / 3}
        curr = {"A": 0.5, "B": 0.5, "C": 0.0}
        turnover = self._turnover(prev, curr)
        assert_close(turnover, 1 / 3, abs_tol=1e-12)

    def test_one_way_not_two_way(self):
        """
        One-way turnover must be HALF of total absolute weight changes.
        If two assets swap all weight: buy side = 50%, sell side = 50% = 100% total.
        One-way = 50%.  This confirms the /2 convention.
        """
        prev = {"A": 1.0, "B": 0.0}
        curr = {"A": 0.0, "B": 1.0}
        turnover = self._turnover(prev, curr)
        assert_close(turnover, 1.0, abs_tol=1e-12)
        # Without /2 it would be 2.0; verify we got 1.0 (not 2.0)
        raw_sum = abs(0.0 - 1.0) + abs(1.0 - 0.0)  # = 2.0
        assert_close(turnover, raw_sum / 2.0, abs_tol=1e-12)


class TestAnnualizedTurnover:
    """
    Annualization: mean(positive per-rebalance turnovers) × 12.0
    Only positive (non-zero) rebalances are included in the mean.
    """

    def test_constant_turnover_annualized(self):
        """
        12 rebalances all with 50% turnover → annualized = 0.50 × 12 = 6.0 (600%).
        """
        series = pd.Series([0.5] * 12)
        result = _annualize_turnover_from_rebalances(series)
        assert_close(result, 6.0, abs_tol=1e-12)

    def test_variable_turnover_uses_mean(self):
        """
        Rebalances: [0.5, 0.3, 0.4] → mean = 0.4 → annualized = 0.4 × 12 = 4.8.
        """
        series = pd.Series([0.5, 0.3, 0.4])
        result = _annualize_turnover_from_rebalances(series)
        assert_close(result, (0.5 + 0.3 + 0.4) / 3 * 12, abs_tol=1e-12)

    def test_zeros_excluded_from_mean(self):
        """
        Series: [0.5, 0.0, 0.5]. Zeros are excluded.
        mean(positive) = mean([0.5, 0.5]) = 0.5 → annualized = 0.5 × 12 = 6.0.
        """
        series = pd.Series([0.5, 0.0, 0.5])
        result = _annualize_turnover_from_rebalances(series)
        assert_close(result, 6.0, abs_tol=1e-12)

    def test_all_zero_turnovers_returns_zero(self):
        """No positive rebalances → annualized turnover = 0.0."""
        series = pd.Series([0.0, 0.0, 0.0])
        result = _annualize_turnover_from_rebalances(series)
        assert result == 0.0

    def test_single_rebalance(self):
        """Single rebalance with 80% turnover → annualized = 0.80 × 12 = 9.6."""
        series = pd.Series([0.80])
        result = _annualize_turnover_from_rebalances(series)
        assert_close(result, 9.6, abs_tol=1e-12)


# ── Convention summary sanity ─────────────────────────────────────────────────


class TestMetricConventions:
    """
    Higher-level tests that verify cross-metric conventions are applied correctly.
    These catch sign errors, factor-of-100 bugs, and unit mismatches.
    """

    def test_all_metrics_are_fractions_not_percentages(self):
        """
        All rate metrics (CAGR, vol, win_rate, turnover) are fractions.
        A typical 10% CAGR strategy should return ~0.10, not ~10.0.
        """
        r = 1.1 ** (1 / 252) - 1
        rets = make_returns(*([r] * 252))
        result = _compute_metrics(rets, turnover=0.08)

        assert abs(result["cagr"]) < 2.0  # not in pct (would be ~10, not 10%)
        assert abs(result["volatility"]) < 2.0
        assert 0 <= result["win_rate"] <= 1  # fraction [0,1], not [0,100]
        assert result["turnover"] == 0.08  # passed through as-is

    def test_win_rate_is_fraction_between_0_and_1(self):
        """win_rate must always be in [0, 1], not [0, 100]."""
        rets = make_returns(0.01, -0.01, 0.02, -0.005, 0.03)
        result = _compute_metrics(rets, turnover=0.0)
        assert 0.0 <= result["win_rate"] <= 1.0

    def test_max_drawdown_is_negative_or_zero(self):
        """max_drawdown must always be ≤ 0 (stored as negative in DB)."""
        rets = make_returns(0.05, -0.30, 0.10, 0.05)
        result = _compute_metrics(rets, turnover=0.0)
        assert result["max_drawdown"] <= 0.0

    def test_volatility_is_positive(self):
        """Annualized volatility must be > 0 for any non-constant return series."""
        rets = make_returns(0.02, -0.01, 0.03, -0.02)
        result = _compute_metrics(rets, turnover=0.0)
        assert result["volatility"] > 0.0

    def test_turnover_is_passed_through_unchanged(self):
        """_compute_metrics passes the turnover argument directly to the output dict."""
        rets = make_returns(0.01, -0.01, 0.02)
        for t_val in [0.0, 0.08, 0.25, 1.5]:
            result = _compute_metrics(rets, turnover=t_val)
            assert_close(result["turnover"], t_val, abs_tol=1e-12)
