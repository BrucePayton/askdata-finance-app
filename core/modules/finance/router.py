from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import PlainTextResponse

from .engine import ASSET_ROOT, analyze, catalog, report_markdown
from .models import AnalysisRequest, Dataset
from .source import inspect_source, load_dataset, settings
from .preflight import assess, scope_options


def authorize(request: Request):
    if getattr(request.app.state, "finance_local", False):
        return
    from core.modules.user.request_context import get_user_info_safe
    uid = str(get_user_info_safe(request).get("user_id") or "")
    if not uid:
        raise HTTPException(status_code=401, detail="请先登录平台")
    allowed = {item.strip() for item in settings().get("FINANCE_ALLOWED_USER_IDS", "").split(",") if item.strip()}
    if uid not in allowed:
        raise HTTPException(status_code=403, detail="当前用户未获财务数据访问授权")


router = APIRouter(prefix="/api/finance", tags=["Finance"], dependencies=[Depends(authorize)])


@router.get("/source")
def get_source():
    try:
        return inspect_source()
    except Exception:
        raise HTTPException(status_code=503, detail="数据库连接失败，请检查服务端连接配置及数据库权限")


@router.get("/dataset")
def get_dataset():
    try:
        return load_dataset().model_dump(mode="json")
    except ValueError:
        raise HTTPException(status_code=422, detail="字段映射未完成或数据不满足财务口径，请检查映射文件与 /schema")
    except Exception:
        raise HTTPException(status_code=503, detail="财务数据读取失败，请检查映射文件、数据库与读取权限")


@router.get("/catalog")
def get_catalog():
    return catalog()


@router.get("/scopes")
def get_scopes():
    try:
        return scope_options(load_dataset())
    except ValueError:
        raise HTTPException(status_code=422, detail="数据口径或字段映射未通过校验")
    except Exception:
        raise HTTPException(status_code=503, detail="财务数据源暂不可用")


@router.get("/preflight")
def get_preflight(period: str | None = None, entity: str = "all"):
    try:
        return assess(load_dataset(), period, entity)
    except ValueError:
        raise HTTPException(status_code=422, detail="数据口径或字段映射未通过校验，禁止执行分析")
    except Exception:
        raise HTTPException(status_code=503, detail="财务数据源暂不可用")


@router.post("/preflight")
def check_preflight(body: dict):
    return assess(body.get("dataset", {}), body.get("period"), body.get("entity", "all"))


@router.get("/skills/{skill_id}", response_class=PlainTextResponse)
def get_skill(skill_id: str):
    entry = next((s for s in catalog()["skills"] if s["id"] == skill_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="分析资产不存在")
    return (ASSET_ROOT.parents[1] / entry["path"]).read_text(encoding="utf-8")


@router.get("/schema")
def get_schema():
    return Dataset.model_json_schema()


@router.post("/analyze")
def run_analysis(body: AnalysisRequest):
    try:
        return analyze(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/report", response_class=PlainTextResponse)
def create_report(body: AnalysisRequest):
    return report_markdown(run_analysis(body))
