"""
Datasets — named selections over the shared OHLCV cache.

A dataset is a ticker config (ticker_configs row): a ticker list (a CSV in
backend/tickers/ticker_lists), timeframes, and a bar window. Downloads always
land in the one ohlcv table; a dataset only decides which of those tickers and
which stretch of their bars a computation, scan or chart works on.

Membership comes from the list's CSV, not from fetch_log's last-fetched tag,
so one ticker can belong to any number of lists (Test_10 and NASDAQ) without
being re-downloaded or moved between them.

Window keys — stored with every indicator row ('win' column), so results for
different windows of the same config live side by side:
    ''                      full history (the default; every pre-dataset row)
    'last:300'              the last 300 bars
    'range:2024-01-01:'     from a date (open-ended)
    'range::2025-06-30'     up to a date
    'range:2024-01-01:2025-06-30'
Results only depend on config + window, not on which list a ticker came from,
so overlapping lists share each other's results.

Warm-up: a windowed run computes from the window start minus `warmup` extra
bars, so lookback indicators (SMA 200, RSI, ATR …) are formed by the window's
first bar. The warm-up rows are stored (and charted) with the window: many
indicators store bar positions counted from the first computed bar, which
trimming would shift. Auto warm-up (warmup NULL) is derived from
the config's period-like parameters. Swing-anchored indicators (aVWAP anchors,
zones) only see swings from the warm-up start on — a windowed run is "what
this looks like from there", not a copy of the full-history run.
"""
import json
import re
from pathlib import Path
from typing import Optional

import pandas as pd

LISTS_DIR = Path(__file__).parent.parent / "tickers" / "ticker_lists"
# The full Tiingo universe — powers ticker search, not a list to browse/compute.
EXCLUDED_LISTS = {'tiingo-tickers'}

WARMUP_MIN = 100
WARMUP_MULT = 5      # × the longest period-like parameter (EMA/RSI settle over several periods)
_PERIOD_KEY = re.compile(r'period|length|window|lookback|span|slow|fast|signal|smooth|bars', re.I)

_list_cache: dict[str, tuple[float, list[str]]] = {}


# ── Ticker lists ─────────────────────────────────────────────

def read_list(name: str) -> Optional[list[str]]:
    """Tickers in list `name` (its CSV), or None if there's no such file.
    Finds a 'ticker' or 'symbol' column (case-insensitive), else the first
    column. Cached by file mtime."""
    if not name or '/' in name or '\\' in name:
        return None
    path = LISTS_DIR / f"{name}.csv"
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    hit = _list_cache.get(name)
    if hit and hit[0] == mtime:
        return hit[1]
    df = pd.read_csv(path)
    cols_lower = {c.lower(): c for c in df.columns}
    col = cols_lower.get('ticker') or cols_lower.get('symbol') or df.columns[0]
    tickers = df[col].dropna().astype(str).str.strip().str.upper().unique().tolist()
    _list_cache[name] = (mtime, tickers)
    return tickers


def list_names() -> list[str]:
    """Every ticker list CSV, by name."""
    return sorted(p.stem for p in LISTS_DIR.glob("*.csv") if p.stem not in EXCLUDED_LISTS)


# ── Windows ──────────────────────────────────────────────────

def window_key(ds: Optional[dict]) -> str:
    """The stored window key for a dataset (see module doc)."""
    if not ds:
        return ''
    mode = ds.get('window_mode') or 'full'
    if mode == 'last' and ds.get('window_bars'):
        return f"last:{int(ds['window_bars'])}"
    if mode == 'range' and (ds.get('window_start') or ds.get('window_end')):
        return f"range:{ds.get('window_start') or ''}:{ds.get('window_end') or ''}"
    return ''


def window_label(win: str) -> str:
    """Human label for a window key: 'full history', 'last 300 bars', '2024-01-01 → 2025-06-30'."""
    if not win:
        return 'full history'
    kind, _, rest = win.partition(':')
    if kind == 'last':
        return f"last {rest} bars"
    if kind == 'range':
        start, _, end = rest.partition(':')
        return f"{start or 'start'} → {end or 'now'}"
    return win


def auto_warmup(params: Optional[dict]) -> int:
    """Warm-up bars for a config: WARMUP_MULT × its longest period-like
    parameter (any int, or list of ints, under a key like *period*, *length*,
    *window* …), at least WARMUP_MIN."""
    longest = 0

    def walk(obj, key=''):
        nonlocal longest
        if isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, str(k))
        elif isinstance(obj, (list, tuple)):
            for v in obj:
                walk(v, key)
        elif isinstance(obj, (int, float)) and not isinstance(obj, bool) and _PERIOD_KEY.search(key):
            if float(obj).is_integer():
                longest = max(longest, int(obj))

    walk(params or {})
    return max(WARMUP_MIN, WARMUP_MULT * longest)


def window_slice(df: pd.DataFrame, win: str, warmup: int) -> tuple[pd.DataFrame, Optional[pd.Timestamp], Optional[pd.Timestamp]]:
    """For a window key: (bars to compute on — the window plus up to `warmup`
    bars before it, nothing after it — and the window's first / last date to
    keep). df is load_ohlcv's frame (Date column, ascending). Full history
    returns df unchanged with (None, None)."""
    if not win or df is None or df.empty:
        return df, None, None
    dates = pd.to_datetime(df['Date'])
    kind, _, rest = win.partition(':')
    if kind == 'last':
        n = max(1, int(rest))
        keep_from = max(0, len(df) - n)
        keep_to = len(df) - 1
    elif kind == 'range':
        start, _, end = rest.partition(':')
        keep_from = int((dates < pd.Timestamp(start)).sum()) if start else 0
        keep_to = (int((dates <= pd.Timestamp(end)).sum()) - 1) if end else len(df) - 1
    else:
        return df, None, None
    if keep_to < keep_from:
        return df.iloc[0:0], None, None
    begin = max(0, keep_from - max(0, int(warmup)))
    sub = df.iloc[begin:keep_to + 1].reset_index(drop=True)
    return sub, dates.iloc[keep_from], dates.iloc[keep_to]


# ── Datasets (ticker_configs rows) ───────────────────────────

DATASET_COLS = ('id', 'name', 'ticker_list', 'timeframes', 'window_mode', 'window_bars',
                'window_start', 'window_end', 'warmup', 'created_at', 'updated_at')


def row_to_dataset(row) -> dict:
    ds = dict(zip(DATASET_COLS, row))
    ds['timeframes'] = json.loads(ds['timeframes'] or '[]')
    ds['window_mode'] = ds['window_mode'] or 'full'
    ds['win'] = window_key(ds)
    ds['window_label'] = window_label(ds['win'])
    return ds


def get_dataset(con, dataset_id: Optional[int]) -> Optional[dict]:
    if not dataset_id:
        return None
    row = con.execute(f"SELECT {', '.join(DATASET_COLS)} FROM ticker_configs WHERE id=?",
                      (dataset_id,)).fetchone()
    return row_to_dataset(row) if row else None


def all_datasets(con) -> list[dict]:
    """Every dataset, each with 'downloaded': whether its list has actually
    been downloaded (database.used_list_names) — the run / chart pickers only
    offer those; the fetch page shows them all, since that's where you fetch."""
    from backend.core import database as db
    used = set(db.used_list_names())
    rows = con.execute(f"SELECT {', '.join(DATASET_COLS)} FROM ticker_configs ORDER BY id").fetchall()
    out = [row_to_dataset(r) for r in rows]
    for ds in out:
        ds['downloaded'] = bool(ds['ticker_list']) and ds['ticker_list'] in used
    return out
