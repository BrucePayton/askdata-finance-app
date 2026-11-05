"""Single authorized data provider shared by financial HTTP and report execution."""
from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace

from fastapi import HTTPException

from .models import AnalysisRequest, Dataset
from .semantic_profile import FinancialSemanticProfile, resolve_semantic_profile


@dataclass
class WorkspaceFinanceData:
    dataset: Dataset
    runtime: dict
    binding: dict
    profile: FinancialSemanticProfile
    legacy_profile: bool

    def source_context(self):
        return {
            "workspace_id": self.runtime["workspace_id"],
            "datasource_id": self.binding["id"],
            "resource_snapshot_digest": self.runtime["resource_snapshot_digest"],
            "semantic_profile_version": self.profile.version,
            "semantic_profile_digest": self.profile.digest(),
            "data_as_of": str(self.dataset.as_of),
            "legacy_profile": self.legacy_profile,
        }


async def load_workspace_finance_data(db, *, workspace_id, user, requested=None,
                                      expected_profile_digest=None):
    # Reauthorize on every call, before resolving a connection or reading rows.
    from core.modules.application_center.runtime_context import resolve_application_runtime_context
    from core.modules.datasource.helper import DataSourceHelper
    from core.modules.datasource.views import _build_connection_config_from_datasource
    from core.modules.datasource.dsc_gateway import get_dsc_datasource_gateway
    from core.helpers.graph_helpers.content_support.finance_report_context import read_canonical_dataset

    runtime = await resolve_application_runtime_context(db, workspace_id=workspace_id,
        requested=requested or SimpleNamespace(application_id="finance", installation_id=None, package_version=None), user=user)
    bindings = [r for r in runtime["resources"] if r["key"] == "finance_database" and r["kind"] == "database"]
    if len(bindings) != 1:
        raise HTTPException(409, "当前空间没有唯一已绑定的财务数据产品，请由底座维护者确认")
    binding = bindings[0]
    datasource = await DataSourceHelper.get_datasource_by_id(db, int(binding["id"]))
    if datasource is None or datasource.gmt_deleted is not None or not datasource.is_active:
        raise HTTPException(409, "当前空间财务数据产品已停用，请刷新空间")
    profile, legacy = resolve_semantic_profile(datasource.config)
    if expected_profile_digest is not None and expected_profile_digest != profile.digest():
        raise HTTPException(409, "财务口径已更新，请刷新范围后重新分析")
    config = _build_connection_config_from_datasource(datasource)
    dataset = await read_canonical_dataset(get_dsc_datasource_gateway(), config,
        user_id=str(user["user_id"]), mapping=profile.mapping.model_dump(mode="json"))
    return WorkspaceFinanceData(dataset, runtime, binding, profile, legacy)


def analyze_workspace_data(source: WorkspaceFinanceData, *, period, entity="all", app_id="overview"):
    from .engine import analyze
    result = analyze(AnalysisRequest(dataset=source.dataset, period=period, entity=entity, app_id=app_id))
    result["source_binding"] = source.source_context()
    result["warnings"].append("数据经DSC全量有界读取并核对行数；跨表读取非单事务快照，发布前须确认月结数据稳定。")
    if source.legacy_profile:
        result["warnings"].append("当前空间仍使用已安装财务包的兼容映射；数据截止日与企业口径需由底座维护者复核。")
    return result
