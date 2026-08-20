from fastapi import APIRouter
from backend.core import database as db

router = APIRouter(prefix="/api")


@router.get("/flags")
def get_flags():
    return {"flags": db.list_flags()}


@router.post("/flags/{ticker}")
def toggle_flag(ticker: str):
    flagged = db.toggle_flag(ticker)
    return {"ticker": ticker.upper(), "flagged": flagged}


@router.delete("/flags/{ticker}")
def delete_flag(ticker: str):
    db.remove_flag(ticker)
    return {"ticker": ticker.upper(), "flagged": False}
