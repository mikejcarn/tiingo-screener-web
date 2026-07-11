from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json

from backend.routers.data import router as data_router
from backend.core import data_manager as dm
from backend.core.globals import TIMEFRAME_ALIASES

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

app = FastAPI(title="Tiingo Screener")
app.include_router(data_router)


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
    records = df.to_dict(orient='records')
    columns = list(df.columns)

    await websocket.send_text(json.dumps({
        "type": "meta",
        "ticker": ticker.upper(),
        "timeframe": tf,
        "ind_conf": ind_conf,
        "total": len(records),
        "columns": columns,
    }))

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            if msg.get("action") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
                continue
            n = msg.get("bar")
            if n is None:
                continue
            n = max(0, min(len(records) - 1, int(n)))
            await websocket.send_text(json.dumps({
                "type": "bar",
                "index": n,
                "data": records[n],
            }))
    except WebSocketDisconnect:
        pass


# ---------------------------------------------------------------------------
# Serve frontend
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

@app.get("/")
def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))
