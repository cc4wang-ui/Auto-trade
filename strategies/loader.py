"""Strategy DSL loader.

Parses YAML files in this directory into typed Pydantic models. Use in tests
and (later) in Claude-side code that decides whether a signal matches a strategy.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator


class EntryFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min_quality: int | None = Field(default=None, ge=0, le=100)
    min_rr: float | None = Field(default=None, ge=0.0)
    patterns: list[str] | None = None
    claude_prompt_template: str | None = None


class Entry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["tradingview-alert", "claude-analysis"]
    direction: Literal["long", "short", "both"] = "both"
    filters: EntryFilters = Field(default_factory=EntryFilters)


class Risk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    per_trade_dollars: float = Field(gt=0)
    daily_loss_cap: float = Field(gt=0)
    max_concurrent: int = Field(default=1, ge=1)


class Exit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["bracket", "manual"]
    stop: str | float
    target: str | float


class TopLevelFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    macro_score_min: float | None = None
    vix_below: float | None = None
    market_hours_only: bool | None = None


class Strategy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    description: str | None = None
    universe: list[str] = Field(min_length=1)
    timeframe: str
    entry: Entry
    risk: Risk
    exit: Exit
    filters: TopLevelFilters = Field(default_factory=TopLevelFilters)
    enabled: bool = False

    @field_validator("universe")
    @classmethod
    def _upper_universe(cls, v: list[str]) -> list[str]:
        return [s.upper() for s in v]


def strategies_dir() -> Path:
    return Path(__file__).parent


def load(name: str) -> Strategy:
    """Load `<name>.yaml` from this directory."""
    path = strategies_dir() / f"{name}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"No strategy file: {path}")
    return load_path(path)


def load_path(path: Path) -> Strategy:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: top level must be a mapping")
    return Strategy.model_validate(raw)


def load_all() -> list[Strategy]:
    """Load every *.yaml in this directory (skips files starting with _)."""
    strategies: list[Strategy] = []
    for path in sorted(strategies_dir().glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        strategies.append(load_path(path))
    return strategies
