"""Local development API. Bind to 127.0.0.1; not a production server."""
from fastapi import FastAPI
from .router import router

app = FastAPI(title="AskData Finance local development")
app.state.finance_local = True
app.include_router(router)
