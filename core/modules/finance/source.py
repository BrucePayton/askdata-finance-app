"""Read-only local database adapter. Identifiers come from validated mappings.

No arbitrary SQL is accepted from HTTP clients, and no credentials are returned.
"""
import json
import os
import re
from contextlib import contextmanager
from pathlib import Path

from dotenv import dotenv_values

from .models import Dataset, Period, Receivable


def settings():
    local = dotenv_values(Path(__file__).resolve().parents[3] / "deployments/deployment_finance/.env")
    return {**local, **{k: v for k, v in os.environ.items() if k.startswith("FINANCE_")}}


def configured():
    config = settings()
    return all(config.get(key) for key in ("FINANCE_DB_TYPE", "FINANCE_DB_NAME", "FINANCE_DB_USER"))


@contextmanager
def connection():
    config = settings()
    if not configured():
        raise ValueError("尚未配置业务数据库，请填写 deployments/deployment_finance/.env")
    kwargs = dict(host=config.get("FINANCE_DB_HOST", "127.0.0.1"), user=config["FINANCE_DB_USER"], password=config.get("FINANCE_DB_PASSWORD", ""), database=config["FINANCE_DB_NAME"], connect_timeout=5)
    kind = config["FINANCE_DB_TYPE"]
    if kind == "mysql":
        import pymysql
        conn = pymysql.connect(**kwargs, port=int(config.get("FINANCE_DB_PORT", "3306")), read_timeout=15, charset="utf8mb4")
        with conn.cursor() as cursor:
            cursor.execute("SET SESSION TRANSACTION READ ONLY")
            cursor.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT")
    elif kind == "postgresql":
        import psycopg
        conn = psycopg.connect(**kwargs, port=int(config.get("FINANCE_DB_PORT", "5432")))
        conn.read_only = True
        with conn.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '15s'")
    else:
        raise ValueError("当前支持 mysql 或 postgresql")
    try:
        yield conn, kind
    finally:
        conn.rollback()
        conn.close()


def inspect_source():
    if not configured():
        return {"connected": False, "configured": False, "message": "等待本地数据库连接配置", "tables": []}
    with connection() as (conn, kind):
        with conn.cursor() as cursor:
            if kind == "mysql":
                cursor.execute("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema=DATABASE() ORDER BY table_name, ordinal_position")
            else:
                cursor.execute("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position")
            tables = {}
            for table, column, dtype in cursor.fetchall():
                tables.setdefault(table, []).append({"name": column, "type": dtype})
    return {"connected": True, "configured": True, "database": settings()["FINANCE_DB_NAME"], "type": kind, "message": "数据库已连接 · 只读", "mapping_ready": bool(settings().get("FINANCE_MAPPING_PATH")), "tables": [{"name": name, "columns": cols} for name, cols in tables.items()]}


def identifier(value, kind):
    if not isinstance(value, str) or not re.fullmatch(r"[\w\u4e00-\u9fff]+", value):
        raise ValueError("映射标识符只能包含字母、数字、下划线和中文")
    quote = "`" if kind == "mysql" else '"'
    return quote + value + quote


def load_dataset():
    config = settings()
    path = config.get("FINANCE_MAPPING_PATH")
    if not path:
        raise ValueError("数据库字段映射尚未完成；不会自动推定财务口径")
    mapping_path = Path(path).expanduser()
    if not mapping_path.is_absolute():
        mapping_path = Path(__file__).resolve().parents[3] / mapping_path
    mapping = json.loads(mapping_path.read_text(encoding="utf-8"))
    result = {"name": mapping["name"], "source": "database", "currency": mapping.get("currency", "CNY"), "as_of": mapping["as_of"]}
    with connection() as (conn, kind):
        for key, model, limit in [("periods", Period, 2400), ("receivables", Receivable, 10000)]:
            item = mapping.get(key)
            if not item and key == "receivables":
                result[key] = []
                continue
            if not item:
                raise ValueError("缺少主体/月汇总数据映射")
            fields = item["columns"]
            if set(fields) != set(model.model_fields):
                raise ValueError(f"{key} 字段必须完整映射，缺失字段不能用零填补")
            columns = ", ".join(identifier(fields[name], kind) for name in model.model_fields)
            table = identifier(item["table"], kind)
            with conn.cursor() as cursor:
                cursor.execute(f"SELECT {columns} FROM {table} LIMIT {limit + 1}")
                records = cursor.fetchall()
            if len(records) > limit:
                raise ValueError(f"{key} 超过 {limit} 行，请配置业务汇总视图，禁止截断计算")
            result[key] = [dict(zip(model.model_fields, row)) for row in records]
    return Dataset.model_validate(result)
