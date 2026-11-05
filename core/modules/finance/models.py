"""Canonical management-accounting input contract; amounts are CNY yuan."""
from decimal import Decimal
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Period(StrictModel):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    entity: str = Field(min_length=1, max_length=100)
    revenue: Decimal = Field(ge=0)
    cost: Decimal = Field(ge=0)
    opex: Decimal = Field(ge=0)
    net_profit: Decimal
    budget_revenue: Decimal = Field(ge=0)
    budget_cost: Decimal = Field(ge=0)
    budget_opex: Decimal = Field(ge=0)
    operating_cash: Decimal
    investing_cash: Decimal
    financing_cash: Decimal
    opening_cash: Decimal = Field(ge=0)
    closing_cash: Decimal = Field(ge=0)
    assets_open: Decimal = Field(gt=0)
    assets_close: Decimal = Field(gt=0)
    equity_open: Decimal
    equity_close: Decimal


class Receivable(StrictModel):
    invoice: str = Field(min_length=1, max_length=100)
    entity: str = Field(min_length=1, max_length=100)
    customer: str = Field(min_length=1, max_length=100)
    due_date: date
    outstanding: Decimal = Field(ge=0)


class Dataset(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    currency: Literal["CNY"] = "CNY"
    source: Literal["database", "import"] = "database"
    as_of: date
    periods: list[Period] = Field(min_length=1, max_length=2400)
    receivables: list[Receivable] = Field(default_factory=list, max_length=10000)

    @model_validator(mode="after")
    def unique_keys(self):
        keys = [(p.entity, p.period) for p in self.periods]
        if len(keys) != len(set(keys)):
            raise ValueError("主体与月份不得重复；请先汇总到主体/月粒度")
        invoices = [(r.entity, r.invoice) for r in self.receivables]
        if len(invoices) != len(set(invoices)):
            raise ValueError("同一主体的应收单据号不得重复")
        if any(p.period > self.as_of.strftime("%Y-%m") for p in self.periods):
            raise ValueError("数据月份不得晚于数据截止日")
        if any(r.entity not in {p.entity for p in self.periods} for r in self.receivables):
            raise ValueError("应收主体必须存在于月度数据中")
        return self


class AnalysisRequest(StrictModel):
    dataset: Dataset
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    entity: str = Field(default="all", max_length=100)
    app_id: Literal["overview", "profit", "budget", "cash", "receivables", "dupont", "quality"] = "overview"
