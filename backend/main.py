from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import json

from backend.routers.data import router as data_router
from backend.routers.fetch import router as fetch_router
from backend.routers.indicators_router import router as indicators_router
from backend.routers.jobs import router as jobs_router
from backend.core import data_manager as dm
from backend.core import database as _db
from backend.core.globals import TIMEFRAME_ALIASES
from backend.core.col_styles import col_styles_for_columns
from backend.core.replay_events import extract_events
from backend.indicators.indicators import load_indicator_config

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

app = FastAPI(title="Tiingo Screener")

class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store"
        return response

@app.on_event("startup")
def startup():
    _db.init_db()

app.add_middleware(NoCacheMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(data_router)
app.include_router(fetch_router)
app.include_router(indicators_router)
app.include_router(jobs_router)


# ---------------------------------------------------------------------------
# Replay WebSocket
# ---------------------------------------------------------------------------

@app.websocket("/ws/replay/{ticker}/{timeframe}/{ind_conf}")
async def ws_replay(websocket: WebSocket, ticker: str, timeframe: str, ind_conf: int):
    """
    Stream indicator data bar-by-bar for the replay view.

    Protocol:
      Server → client on connect:  {"type": "meta", "total": N, "columns": [...]}
      Client → server:             {"bar": N}   or   {"action": "ping"}
      Server → client per request: {"type": "bar", "index": N, "data": {...}}
      Server → client on error:    {"type": "error", "detail": "..."}
    """
    await websocket.accept()

    tf = TIMEFRAME_ALIASES.get(timeframe.lower())
    if tf is None:
        await websocket.send_text(json.dumps({"type": "error", "detail": f"Unknown timeframe '{timeframe}'"}))
        await websocket.close()
        return

    df = dm.load_indicator_df(ticker.upper(), tf, ind_conf)
    if df is None:
        # Fall back to raw OHLCV if no indicators computed yet
        df = dm.load_ticker_df(ticker.upper(), tf)
    if df is None:
        await websocket.send_text(json.dumps({"type": "error", "detail": f"{ticker} {tf} not found"}))
        await websocket.close()
        return

    df['Date'] = df['Date'].astype(str)
    # pandas to_json so NaN → null (json.dumps would produce invalid bare NaN)
    import json as _json
    records = _json.loads(df.to_json(orient='records'))
    columns = list(df.columns)
    styles  = col_styles_for_columns(columns)

    await websocket.send_text(json.dumps({
        "type": "meta",
        "ticker": ticker.upper(),
        "timeframe": tf,
        "ind_conf": ind_conf,
        "total": len(records),
        "columns": columns,
        "styles": styles,
    }))

    # Send all bars up-front so the client can load them in one shot
    await websocket.send_text(json.dumps({
        "type": "bars",
        "data": records,
    }))

    # Send dynamic replay events (peak/valley bars, QQEMOD anchor commitments)
    try:
        result = load_indicator_config(ind_conf, tf)
        # load_indicator_config(ind_conf, tf) returns (ind_list, params_for_tf) directly
        params = result[1] if result else {}
        events = extract_events(df, params or {})
        await websocket.send_text(json.dumps(events))
    except Exception:
        pass   # replay events are optional; chart still works without them

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            if msg.get("action") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass


# ---------------------------------------------------------------------------
# Serve frontend
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/")
def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))

@app.get("/dashboard")
def dashboard():
    return FileResponse(str(FRONTEND_DIR / "dashboard.html"))
