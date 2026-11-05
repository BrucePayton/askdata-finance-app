"""Read-only stdio MCP adapter using the same validated finance engine."""
from mcp.server.fastmcp import FastMCP
from .engine import analyze, catalog, report_markdown
from .models import AnalysisRequest
from .source import load_dataset
from .preflight import assess, scope_options

mcp = FastMCP("askdata-finance")


@mcp.tool()
def finance_preflight(period: str | None = None, entity: str = "all") -> dict:
    """Assess actual full-source coverage, cash quality and permitted analyses before reasoning."""
    dataset = load_dataset()
    return {**assess(dataset, period, entity), "scopes": scope_options(dataset)}


@mcp.tool()
def finance_load_dataset() -> dict:
    """Read the configured finance database using its SELECT-only account."""
    return load_dataset().model_dump(mode="json")


@mcp.tool()
def finance_analyze(request: dict) -> dict:
    """Compute monthly finance KPIs, budget bridge, cash checks and due-date aging.

    Model inputs select period/entity/app_id only. Dataset is always read from the
    installation-bound database; a model-supplied dataset is ignored. No writes.
    """
    return analyze(_authoritative_request(request))


@mcp.tool()
def finance_report(request: dict) -> str:
    """Generate an auditable draft with fingerprint, formulas and limitations."""
    return report_markdown(analyze(_authoritative_request(request)))


def _authoritative_request(request: dict) -> AnalysisRequest:
    return AnalysisRequest.model_validate({**request, "dataset": load_dataset().model_dump(mode="json")})


@mcp.resource("finance://catalog")
def finance_catalog() -> dict:
    """Finance application, metric, skill and report-template catalog."""
    return catalog()


if __name__ == "__main__":
    mcp.run(transport="stdio")
