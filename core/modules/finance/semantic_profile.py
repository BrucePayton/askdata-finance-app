"""Validated, server-owned financial mappings; never accepted from an analysis body."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator

from .models import Period, Receivable, StrictModel


class TableMapping(StrictModel):
    table: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    columns: dict[str, str]

    @model_validator(mode="after")
    def safe_identifiers(self):
        if not all(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value) for value in self.columns.values()):
            raise ValueError("Only plain column identifiers are supported")
        if len(set(self.columns.values())) != len(self.columns):
            raise ValueError("Different financial fields must not alias the same source column")
        return self


class FinancialMapping(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    as_of: date
    currency: Literal["CNY"] = "CNY"
    periods: TableMapping
    receivables: TableMapping

    @model_validator(mode="after")
    def exact_fields(self):
        for key, model in (("periods", Period), ("receivables", Receivable)):
            if set(getattr(self, key).columns) != set(model.model_fields):
                raise ValueError(f"Incomplete or unknown financial fields: {key}")
        return self


class FinancialSemanticProfile(StrictModel):
    schema_version: Literal["finance-semantic-profile/v1"] = "finance-semantic-profile/v1"
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    grain: Literal["entity/month"] = "entity/month"
    unit: Literal["yuan"] = "yuan"
    aggregation: Literal["simple_sum_not_consolidated"] = "simple_sum_not_consolidated"
    mapping: FinancialMapping

    def digest(self) -> str:
        return hashlib.sha256(json.dumps(self.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()


def resolve_semantic_profile(datasource_config) -> tuple[FinancialSemanticProfile, bool]:
    """Use bound datasource metadata, or explicit legacy installed-package compatibility.

    Datasource configuration is maintained in the base platform. The compatibility
    profile contains only a mapping, NEVER a global connection or credentials.
    Invalid explicit metadata fails closed rather than falling back to legacy.
    """
    config = json.loads(datasource_config) if isinstance(datasource_config, str) else datasource_config
    if config is not None and not isinstance(config, dict):
        raise ValueError("Invalid datasource configuration")
    if config is not None and "finance_semantic_profile" in config:
        return FinancialSemanticProfile.model_validate(config["finance_semantic_profile"]), False
    mapping = json.loads((Path(__file__).resolve().parents[3] / "assets/finance/mysql-mapping.json").read_text())
    return FinancialSemanticProfile(version="1.0.0", mapping=FinancialMapping.model_validate(mapping)), True
