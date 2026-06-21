"""Loader tests + sanity check that every YAML in strategies/ parses."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from strategies.loader import Strategy, load, load_all, load_path, strategies_dir


def test_load_sofi_pattern_v2_by_name() -> None:
    s = load("sofi-pattern-v2")
    assert s.name == "sofi-pattern-v2"
    assert s.universe == ["SOFI"]
    assert s.timeframe == "1H"
    assert s.entry.source == "tradingview-alert"
    assert s.entry.filters.min_quality == 70
    assert s.entry.filters.min_rr == 1.5
    assert s.risk.per_trade_dollars == 25
    assert s.risk.daily_loss_cap == 50
    assert s.exit.type == "bracket"
    assert s.exit.stop == "signal.stop_price"
    assert s.exit.target == "signal.target_price"
    assert s.enabled is False


def test_load_all_parses_every_yaml() -> None:
    """If this fails, one of the .yaml files in strategies/ has a schema error."""
    strategies = load_all()
    assert len(strategies) >= 1
    names = [s.name for s in strategies]
    assert "sofi-pattern-v2" in names


def test_missing_file_raises() -> None:
    with pytest.raises(FileNotFoundError):
        load("does-not-exist")


def test_universe_uppercased(tmp_path: Path) -> None:
    yaml_text = """
name: test
universe: [sofi, soxl]
timeframe: 1H
entry:
  source: tradingview-alert
risk:
  per_trade_dollars: 10
  daily_loss_cap: 20
exit:
  type: bracket
  stop: signal.stop_price
  target: signal.target_price
"""
    p = tmp_path / "t.yaml"
    p.write_text(yaml_text)
    s = load_path(p)
    assert s.universe == ["SOFI", "SOXL"]


def test_unknown_field_rejected(tmp_path: Path) -> None:
    """extra='forbid' catches typos like `daily_los_cap` early."""
    bad = """
name: test
universe: [SOFI]
timeframe: 1H
entry:
  source: tradingview-alert
risk:
  per_trade_dollars: 10
  daily_los_cap: 20    # typo
exit:
  type: bracket
  stop: 1.0
  target: 2.0
"""
    p = tmp_path / "t.yaml"
    p.write_text(bad)
    with pytest.raises(ValidationError):
        load_path(p)


def test_invalid_quality_score_rejected(tmp_path: Path) -> None:
    bad = """
name: t
universe: [SOFI]
timeframe: 1H
entry:
  source: tradingview-alert
  filters:
    min_quality: 150     # > 100
risk:
  per_trade_dollars: 10
  daily_loss_cap: 20
exit:
  type: bracket
  stop: 1.0
  target: 2.0
"""
    p = tmp_path / "t.yaml"
    p.write_text(bad)
    with pytest.raises(ValidationError):
        load_path(p)


def test_strategy_is_pydantic_model() -> None:
    s = load("sofi-pattern-v2")
    assert isinstance(s, Strategy)
    # Round-trip to dict and back
    d = s.model_dump()
    s2 = Strategy.model_validate(d)
    assert s == s2


def test_yaml_file_matches_pydantic_default_enabled_false() -> None:
    """Safety check: any strategy committed to the repo must default enabled=false."""
    for path in strategies_dir().glob("*.yaml"):
        raw = yaml.safe_load(path.read_text())
        if "enabled" in raw:
            assert raw["enabled"] is False, f"{path}: enabled must be false in repo"
