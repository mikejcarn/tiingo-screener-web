import contextlib
import sqlite3
import json
from datetime import datetime
from pathlib import Path
from typing import Optional
import pandas as pd

DB_PATH = Path(__file__).parent.parent.parent / "data" / "screener.db"

# Max pages reclaimed per PRAGMA incremental_vacuum call (see delete_indicators)
# — keeps that call fast and bounded regardless of how many rows were deleted.
_VACUUM_PAGE_LIMIT = 20000

# A list counts as downloaded (used_list_names) once this share of its tickers is in the database.
LIST_IN_USE_SHARE = 0.5

SCHEMA = """
CREATE TABLE IF NOT EXISTS ohlcv (
    ticker    TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    date      TEXT NOT NULL,
    open      REAL,
    high      REAL,
    low       REAL,
    close     REAL,
    volume    REAL,
    PRIMARY KEY (ticker, timeframe, date)
);

-- win: the bar window the row was computed in ('' = full history, else
-- 'last:N' / 'range:start:end' — see datasets.py), so windowed test runs of a
-- config never overwrite its full-history results.
CREATE TABLE IF NOT EXISTS indicators (
    ticker    TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    ind_conf  INTEGER NOT NULL,
    win       TEXT NOT NULL DEFAULT '',
    date      TEXT NOT NULL,
    data      TEXT NOT NULL,
    PRIMARY KEY (ticker, timeframe, ind_conf, win, date)
);

CREATE TABLE IF NOT EXISTS fetch_log (
    ticker      TEXT NOT NULL,
    timeframe   TEXT NOT NULL,
    fetched_at  TEXT NOT NULL,
    last_date   TEXT,
    ticker_list TEXT,
    PRIMARY KEY (ticker, timeframe)
);

CREATE INDEX IF NOT EXISTS idx_ohlcv_ticker_tf   ON ohlcv      (ticker, timeframe);
CREATE INDEX IF NOT EXISTS idx_ind_ticker_tf_conf ON indicators (ticker, timeframe, ind_conf);
-- Covers /api/indicators/summary's GROUP BY (ind_conf, ticker, timeframe) +
-- MIN/MAX(date) entirely from the index — idx_ind_ticker_tf_conf above has
-- a different leading column and doesn't include date, so that query still
-- had to fetch each full row (including its multi-KB indicator `data` blob)
-- just to read date. This one lets the scan skip the table entirely.
CREATE INDEX IF NOT EXISTS idx_ind_summary_covering ON indicators (ind_conf, ticker, timeframe, win, date);

CREATE TABLE IF NOT EXISTS ind_configs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ind_config_indicators (
    config_id  INTEGER NOT NULL,
    timeframe  TEXT NOT NULL,
    indicator  TEXT NOT NULL,
    params     TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (config_id, timeframe, indicator)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ind_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    config_id   INTEGER NOT NULL,
    config_name TEXT NOT NULL DEFAULT '',
    timeframes  TEXT NOT NULL DEFAULT '[]',
    tickers     INTEGER NOT NULL DEFAULT 0,
    errors      INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'done',
    ran_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_configs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    logic       TEXT NOT NULL DEFAULT 'AND',
    ind_conf_id INTEGER,
    created_at  TEXT NOT NULL,
    updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS scan_criteria (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    config_id     INTEGER NOT NULL,
    criteria_name TEXT NOT NULL,
    timeframe     TEXT NOT NULL,
    params_json   TEXT NOT NULL DEFAULT '{}',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (config_id) REFERENCES scan_configs(id)
);

CREATE TABLE IF NOT EXISTS scan_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    config_id   INTEGER NOT NULL,
    config_name TEXT NOT NULL DEFAULT '',
    matched     INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    ran_at      TEXT NOT NULL,
    ind_conf_id INTEGER,
    timeframes  TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS scan_results (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  INTEGER NOT NULL,
    ticker  TEXT NOT NULL,
    date    TEXT,
    signals TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (run_id) REFERENCES scan_log(id)
);

-- A ticker config is also a dataset (datasets.py): list + timeframes + a bar
-- window (window_mode 'full' | 'last' (window_bars) | 'range' (window_start /
-- window_end)) and warm-up bars (NULL = auto from the indicator config).
CREATE TABLE IF NOT EXISTS ticker_configs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    ticker_list  TEXT,
    timeframes   TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT NOT NULL,
    updated_at   TEXT,
    window_mode  TEXT NOT NULL DEFAULT 'full',
    window_bars  INTEGER,
    window_start TEXT,
    window_end   TEXT,
    warmup       INTEGER
);

CREATE TABLE IF NOT EXISTS pipeline_configs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,
    ticker_list        TEXT,
    timeframes         TEXT NOT NULL DEFAULT '[]',
    ind_conf_id        INTEGER,
    scan_config_id     INTEGER,
    ticker_conf_id     INTEGER,
    queued_for_run     INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    updated_at         TEXT
);

-- Singleton (id=1) — one schedule governs whatever pipelines are queued
-- (queued_for_run=1), rather than each pipeline having its own schedule.
CREATE TABLE IF NOT EXISTS pipeline_schedule (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    enabled   INTEGER NOT NULL DEFAULT 0,
    days      TEXT NOT NULL DEFAULT '[]',
    time      TEXT,
    last_run  TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    config_id     INTEGER NOT NULL,
    config_name   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'done',
    fetch_tickers INTEGER NOT NULL DEFAULT 0,
    fetch_errors  INTEGER NOT NULL DEFAULT 0,
    ind_tickers   INTEGER NOT NULL DEFAULT 0,
    ind_errors    INTEGER NOT NULL DEFAULT 0,
    scan_run_id   INTEGER,
    ran_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flagged_tickers (
    ticker     TEXT PRIMARY KEY,
    note       TEXT,
    flagged_at TEXT NOT NULL
);

-- get_scan_run_tickers/delete_scan_run/clear_scan_history all filter scan_results
-- by run_id with no index backing it — a full table scan on what's likely the
-- fastest-growing table in the app (one row per ticker per scan run).
CREATE INDEX IF NOT EXISTS idx_scan_results_run ON scan_results (run_id);
-- ind_log/scan_log/pipeline_log's own history views all do
-- ORDER BY ran_at DESC LIMIT n with no index backing the sort.
CREATE INDEX IF NOT EXISTS idx_ind_log_ran_at      ON ind_log      (ran_at);
CREATE INDEX IF NOT EXISTS idx_scan_log_ran_at     ON scan_log     (ran_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_log_ran_at ON pipeline_log (ran_at);
"""


@contextlib.contextmanager
def _conn():
    """
    Every call site uses `with _conn() as con: ...` — but sqlite3.Connection's
    own context manager protocol only commits/rolls back the transaction on
    exit, it never closes the connection. With ~90 call sites across the
    codebase and none of them calling .close(), every single db operation the
    app ever made was leaking an open connection. In WAL mode that's what let
    the WAL file grow to 6+GB (bigger than the main db) instead of being
    checkpointed back down — a pile of never-closed connections holds old
    snapshots open indefinitely, which blocks WAL checkpointing, which is what
    was actually behind the "database is locked" errors. Wrapping this as a
    real generator-based context manager fixes every call site at once — none
    of them need to change, since they already all use the `with` form.
    """
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # 120s, not 30s — delete_indicators' incremental_vacuum pass (see its own
    # docstring) can legitimately hold the write lock for a while on a
    # multi-GB table; a short timeout turns that into a spurious "database is
    # locked" for anything else that touches the db while it's running,
    # rather than just waiting its turn. Single-user local app, so waiting
    # longer costs nothing a user would notice; erroring out does.
    con = sqlite3.connect(DB_PATH, timeout=120)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=120000")
    # NORMAL (not the sqlite3 default FULL) — SQLite's own recommended pairing
    # for WAL mode: WAL already guarantees the database file itself can never
    # be corrupted by a crash, so FULL's extra fsync-every-commit only buys
    # protection against losing the last few not-yet-checkpointed commits in
    # an actual power-loss/OS-crash — a non-issue for a local single-user app,
    # and a real cost given how many small writes this app does.
    con.execute("PRAGMA synchronous=NORMAL")
    try:
        yield con
        con.commit()
    except BaseException:
        con.rollback()
        raise
    finally:
        con.close()


def init_db() -> None:
    # One-time bootstrap into incremental auto_vacuum — without it, deleted/
    # replaced pages (indicator re-runs, config clears) are freed internally
    # but never handed back to the OS, so the file only ever grows. Setting
    # the pragma alone is enough for a brand-new (table-less) database; an
    # existing one needs a VACUUM afterward to actually restructure into the
    # new mode — runs at most once (this check reports mode 2 forever after).
    # The pragma-set and that VACUUM must happen in the SAME connection/
    # session — auto_vacuum mode only takes effect for a VACUUM run where it
    # was set; a fresh connection just re-vacuums under the file's existing
    # (still-unchanged) mode.
    needs_vacuum = False
    with _conn() as con:
        mode = con.execute("PRAGMA auto_vacuum").fetchone()[0]
        if mode != 2:  # 0 = none, 1 = full, 2 = incremental
            had_tables = con.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
            ).fetchone()[0] > 0
            con.execute("PRAGMA auto_vacuum = INCREMENTAL")
            needs_vacuum = had_tables
        # indicators gained the 'win' key column — SQLite can't change a
        # primary key in place, so rebuild the table once (existing rows are
        # full-history results, win ''). Must run before SCHEMA, whose
        # indexes reference win. DROP TABLE takes the old indexes with it.
        ind_cols = [r[1] for r in con.execute("PRAGMA table_info(indicators)").fetchall()]
        if ind_cols and 'win' not in ind_cols:
            print("[database] adding window key to indicators (one-time table rebuild)...")
            con.executescript("""
                CREATE TABLE indicators_new (
                    ticker    TEXT NOT NULL,
                    timeframe TEXT NOT NULL,
                    ind_conf  INTEGER NOT NULL,
                    win       TEXT NOT NULL DEFAULT '',
                    date      TEXT NOT NULL,
                    data      TEXT NOT NULL,
                    PRIMARY KEY (ticker, timeframe, ind_conf, win, date)
                );
                INSERT INTO indicators_new (ticker, timeframe, ind_conf, win, date, data)
                    SELECT ticker, timeframe, ind_conf, '', date, data FROM indicators;
                DROP TABLE indicators;
                ALTER TABLE indicators_new RENAME TO indicators;
            """)
            print("[database] indicators rebuild done")
        con.executescript(SCHEMA)
        # Migrations
        try:
            con.execute("ALTER TABLE fetch_log ADD COLUMN ticker_list TEXT")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE pipeline_configs ADD COLUMN ind_conf_id INTEGER")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE pipeline_configs ADD COLUMN ticker_conf_id INTEGER")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE pipeline_configs ADD COLUMN queued_for_run INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass
        # Superseded by the single pipeline_schedule row below — drop the
        # short-lived per-pipeline schedule columns if an earlier run added them.
        for _col in ("schedule_enabled", "schedule_days", "schedule_time", "schedule_last_run"):
            try:
                con.execute(f"ALTER TABLE pipeline_configs DROP COLUMN {_col}")
            except Exception:
                pass
        con.execute("INSERT OR IGNORE INTO pipeline_schedule (id, enabled, days, time, last_run) VALUES (1,0,'[]',NULL,NULL)")
        # Migrate old scan schema (scan_conditions) to new (scan_criteria)
        tables = {r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()}
        if 'scan_conditions' in tables:
            con.executescript("""
                DROP TABLE IF EXISTS scan_conditions;
                DROP TABLE IF EXISTS scan_configs;
                CREATE TABLE IF NOT EXISTS scan_configs (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT NOT NULL,
                    logic       TEXT NOT NULL DEFAULT 'AND',
                    ind_conf_id INTEGER,
                    created_at  TEXT NOT NULL,
                    updated_at  TEXT
                );
                CREATE TABLE IF NOT EXISTS scan_criteria (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    config_id     INTEGER NOT NULL,
                    criteria_name TEXT NOT NULL,
                    timeframe     TEXT NOT NULL,
                    params_json   TEXT NOT NULL DEFAULT '{}',
                    sort_order    INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (config_id) REFERENCES scan_configs(id)
                );
            """)
        try:
            con.execute("ALTER TABLE ind_configs ADD COLUMN updated_at TEXT")
        except Exception:
            pass
        # Datasets (ticker_configs as datasets — see datasets.py)
        for _col, _def in (("window_mode", "TEXT NOT NULL DEFAULT 'full'"), ("window_bars", "INTEGER"),
                           ("window_start", "TEXT"), ("window_end", "TEXT"), ("warmup", "INTEGER")):
            try:
                con.execute(f"ALTER TABLE ticker_configs ADD COLUMN {_col} {_def}")
            except Exception:
                pass
        for _tbl, _col, _def in (("scan_log", "dataset_id", "INTEGER"), ("scan_log", "win", "TEXT NOT NULL DEFAULT ''"),
                                 ("ind_log", "dataset", "TEXT")):
            try:
                con.execute(f"ALTER TABLE {_tbl} ADD COLUMN {_col} {_def}")
            except Exception:
                pass
        try:
            con.execute("ALTER TABLE scan_criteria ADD COLUMN logic TEXT NOT NULL DEFAULT 'AND'")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE scan_log ADD COLUMN ind_conf_id INTEGER")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE scan_log ADD COLUMN timeframes TEXT NOT NULL DEFAULT '[]'")
        except Exception:
            pass
        try:
            con.execute("ALTER TABLE scan_configs ADD COLUMN ticker_list TEXT")
        except Exception:
            pass
        try:
            con.executescript("""
                CREATE TABLE IF NOT EXISTS scan_results (
                    id      INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id  INTEGER NOT NULL,
                    ticker  TEXT NOT NULL,
                    date    TEXT,
                    signals TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (run_id) REFERENCES scan_log(id)
                );
            """)
        except Exception:
            pass

        if needs_vacuum:
            print("[database] migrating to incremental auto_vacuum (one-time VACUUM)...")
            con.execute("VACUUM")
            print("[database] auto_vacuum migration done")


# ── OHLCV ────────────────────────────────────────────────────

def upsert_ohlcv(ticker: str, timeframe: str, df: pd.DataFrame) -> int:
    """Insert or replace OHLCV rows. df must have Date, Open, High, Low, Close, Volume columns."""
    rows = [
        (ticker, timeframe, str(row['Date'])[:10],
         row['Open'], row['High'], row['Low'], row['Close'], row['Volume'])
        for _, row in df.iterrows()
    ]
    with _conn() as con:
        # Same reasoning as upsert_indicators: ON CONFLICT DO UPDATE instead
        # of INSERT OR REPLACE, so refetching overlapping dates updates rows
        # in place rather than deleting + re-inserting them.
        con.executemany(
            """INSERT INTO ohlcv (ticker, timeframe, date, open, high, low, close, volume)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT (ticker, timeframe, date)
               DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low,
                             close=excluded.close, volume=excluded.volume""",
            rows
        )
    return len(rows)


def load_ohlcv(ticker: str, timeframe: str, end_date: Optional[str] = None) -> Optional[pd.DataFrame]:
    query = "SELECT date, open, high, low, close, volume FROM ohlcv WHERE ticker=? AND timeframe=?"
    params: list = [ticker, timeframe]
    if end_date:
        query += " AND date <= ?"
        params.append(end_date)
    query += " ORDER BY date"
    with _conn() as con:
        df = pd.read_sql_query(query, con, params=params, parse_dates=['date'])
    if df.empty:
        return None
    df = df.rename(columns={
        'date': 'Date', 'open': 'Open', 'high': 'High',
        'low': 'Low', 'close': 'Close', 'volume': 'Volume'
    })
    return df


# ── Indicators ───────────────────────────────────────────────

def upsert_indicators(ticker: str, timeframe: str, ind_conf: int, df: pd.DataFrame,
                      win: str = '') -> int:
    """Serialize each row's non-OHLCV columns to JSON and store, under window
    key `win` ('' = full history). A windowed result replaces that window's
    previous rows outright — 'last:N' slides as new bars arrive, so stale
    dates would otherwise linger at its start."""
    ohlcv_cols = {'Date', 'date', 'Open', 'High', 'Low', 'Close', 'Volume',
                  'open', 'high', 'low', 'close', 'volume'}
    rows = []
    for _, row in df.iterrows():
        date = str(row.get('Date') or row.get('date') or row.name)[:10]
        data = {k: (None if pd.isna(v) else v)
                for k, v in row.items()
                if k not in ohlcv_cols and k != 'Date'}
        rows.append((ticker, timeframe, ind_conf, win, date, json.dumps(data)))
    with _conn() as con:
        if win:
            con.execute("DELETE FROM indicators WHERE ticker=? AND timeframe=? AND ind_conf=? AND win=?",
                        (ticker, timeframe, ind_conf, win))
        # ON CONFLICT DO UPDATE, not INSERT OR REPLACE — the latter deletes
        # then re-inserts the whole row on a PK conflict (re-running a config
        # on already-computed data, i.e. almost every run), which is exactly
        # the churn that caused the recurring file-bloat problem. A real
        # UPDATE lets SQLite reuse the existing row's space in place instead
        # of freeing it and allocating fresh.
        con.executemany(
            """INSERT INTO indicators (ticker, timeframe, ind_conf, win, date, data)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT (ticker, timeframe, ind_conf, win, date)
               DO UPDATE SET data = excluded.data""",
            rows
        )
    return len(rows)


def load_indicators(ticker: str, timeframe: str, ind_conf: int,
                    end_date: Optional[str] = None, win: str = '') -> Optional[pd.DataFrame]:
    """Return wide DataFrame: Date + OHLCV + all indicator columns, for window
    key `win` ('' = full history). A windowed result covers only its window's
    bars, so only those are returned."""
    ohlcv_df = load_ohlcv(ticker, timeframe, end_date)
    if ohlcv_df is None:
        return None

    query = "SELECT date, data FROM indicators WHERE ticker=? AND timeframe=? AND ind_conf=? AND win=?"
    params: list = [ticker, timeframe, ind_conf, win or '']
    if end_date:
        query += " AND date <= ?"
        params.append(end_date)
    query += " ORDER BY date"

    with _conn() as con:
        rows = con.execute(query, params).fetchall()

    if not rows:
        return None

    ind_records = [{'Date': r[0], **json.loads(r[1])} for r in rows]
    ind_df = pd.DataFrame(ind_records)
    ind_df['Date'] = pd.to_datetime(ind_df['Date'])

    merged = pd.merge(ohlcv_df, ind_df, on='Date', how='inner' if win else 'left')
    return merged


# ── Metadata ─────────────────────────────────────────────────

def _ohlcv_tickers(timeframe: Optional[str], min_bars: Optional[int]) -> list[str]:
    query, params = "SELECT ticker FROM ohlcv", []
    if timeframe:
        query += " WHERE timeframe=?"
        params.append(timeframe)
    query += " GROUP BY ticker"
    if min_bars:
        query += " HAVING COUNT(*) >= ?"
        params.append(min_bars)
    with _conn() as con:
        return [r[0] for r in con.execute(query + " ORDER BY 1", params).fetchall()]


def _list_members(ticker_list: str) -> Optional[set]:
    """A named list's tickers: its CSV (datasets.read_list), or — for a list
    name with no CSV (deleted file, legacy tag) — the tickers last fetched
    under that name."""
    from backend.core import datasets
    members = datasets.read_list(ticker_list)
    if members is not None:
        return set(members)
    with _conn() as con:
        return {r[0] for r in con.execute(
            "SELECT DISTINCT ticker FROM fetch_log WHERE ticker_list=?", (ticker_list,)).fetchall()}


def list_tickers(timeframe: Optional[str] = None, ticker_list: Optional[str] = None,
                 ind_conf: Optional[int] = None, min_bars: Optional[int] = None,
                 win: Optional[str] = None) -> list[str]:
    """Tickers with data, sorted. ticker_list: a list name (members from its
    CSV — see _list_members), '__all__' / None (everything), or '__single__'
    (tickers fetched one-off, outside any list). ind_conf: only tickers with
    computed results for that config (in window `win`, if given; min_bars not
    applied there)."""
    if ind_conf:
        query, params = "SELECT DISTINCT ticker FROM indicators WHERE ind_conf=?", [ind_conf]
        if timeframe:
            query += " AND timeframe=?"
            params.append(timeframe)
        if win is not None:
            query += " AND win=?"
            params.append(win)
        with _conn() as con:
            found = [r[0] for r in con.execute(query + " ORDER BY 1", params).fetchall()]
    else:
        found = _ohlcv_tickers(timeframe, min_bars)
    if ticker_list and ticker_list != '__all__':
        if ticker_list == '__single__':
            with _conn() as con:
                members = {r[0] for r in con.execute(
                    "SELECT DISTINCT ticker FROM fetch_log WHERE ticker_list IS NULL").fetchall()}
        else:
            members = _list_members(ticker_list)
        found = [t for t in found if t in members]
    return found


def filter_tickers_min_bars(tickers: list[str], timeframe: str, min_bars: int) -> list[str]:
    """Given an arbitrary ticker list (e.g. a scan run held client-side), return the
    subset with at least min_bars rows of OHLCV data for timeframe."""
    if not tickers:
        return []
    placeholders = ','.join('?' * len(tickers))
    with _conn() as con:
        rows = con.execute(
            f"SELECT ticker FROM ohlcv WHERE timeframe=? AND ticker IN ({placeholders}) "
            "GROUP BY ticker HAVING COUNT(*) >= ?",
            [timeframe] + tickers + [min_bars]
        ).fetchall()
    return [r[0] for r in rows]


def used_list_names() -> list[str]:
    """The ticker lists you've actually downloaded: tagged in fetch_log
    (fetched under), or with at least LIST_IN_USE_SHARE of the CSV's tickers
    in the database. A big CSV that merely shares a few symbols with what you
    downloaded (NASDAQ, or TSX's cross-listed AAPL / MSFT …) doesn't count —
    otherwise those tickers would appear to belong to it."""
    from backend.core import datasets
    with _conn() as con:
        names = {r[0] for r in con.execute(
            "SELECT DISTINCT ticker_list FROM fetch_log WHERE ticker_list IS NOT NULL").fetchall() if r[0]}
    have = set(_ohlcv_tickers(None, None))
    for n in datasets.list_names():
        members = datasets.read_list(n) or []
        if members and len(have.intersection(members)) >= LIST_IN_USE_SHARE * len(members):
            names.add(n)
    return sorted(names)


def list_ticker_lists() -> list[str]:
    """Names of the lists in use (used_list_names) with at least one downloaded ticker."""
    have = set(_ohlcv_tickers(None, None))
    return [n for n in used_list_names() if have.intersection(_list_members(n))]


def delete_indicators(ind_conf_id: Optional[int] = None,
                      ticker: Optional[str] = None,
                      timeframe: Optional[str] = None,
                      win: Optional[str] = None) -> int:
    """Delete matching results; win (if given) narrows to one bar window — it
    never counts as a filter on its own."""
    conditions, params = [], []
    if ind_conf_id is not None: conditions.append("ind_conf=?");  params.append(ind_conf_id)
    if ticker      is not None: conditions.append("ticker=?");    params.append(ticker)
    if timeframe   is not None: conditions.append("timeframe=?"); params.append(timeframe)
    if not conditions:
        return 0
    if win is not None: conditions.append("win=?"); params.append(win)
    with _conn() as con:
        cur = con.execute(f"DELETE FROM indicators WHERE {' AND '.join(conditions)}", params)
        deleted = cur.rowcount
    if deleted:
        # Hand the freed pages back to the OS now, while we know exactly how
        # much was just freed, rather than letting them sit on the freelist
        # (incremental_vacuum is a no-op unless auto_vacuum=incremental —
        # see init_db's one-time migration).
        #
        # PRAGMA incremental_vacuum yields one result ROW PER PAGE freed —
        # it only actually frees a page each time the statement is stepped.
        # execute() alone steps it once (reclaiming a single page); fetchall()
        # is what drains steps and reclaims pages, the same way the sqlite3
        # CLI does it automatically.
        #
        # Bounded to _VACUUM_PAGE_LIMIT pages per call, not unlimited — an
        # unbounded fetchall() here was the actual cause of a real "database
        # is locked" + fully-unresponsive-server incident: sqlite3's PRAGMA
        # incremental_vacuum doesn't release the GIL between steps, so
        # draining hundreds of thousands of freed pages (a large delete's
        # worth) in one fetchall() call blocked the ENTIRE process — not just
        # this request — for minutes, which is what made a second, unrelated
        # write (clearing indicator run history, in that incident) time out
        # waiting for the lock. A capped call finishes in well under a
        # second; any pages left on the freelist beyond the cap get reclaimed
        # by the next delete's own call (or a future manual VACUUM) instead —
        # nothing is lost, just deferred.
        with _conn() as con:
            con.execute(f"PRAGMA incremental_vacuum({_VACUUM_PAGE_LIMIT})").fetchall()
    return deleted


def has_single_tickers() -> bool:
    with _conn() as con:
        row = con.execute(
            "SELECT COUNT(*) FROM fetch_log WHERE ticker_list IS NULL"
        ).fetchone()
    return row[0] > 0


def list_timeframes(ticker: Optional[str] = None) -> list[str]:
    query = "SELECT DISTINCT timeframe FROM ohlcv"
    params: list = []
    if ticker:
        query += " WHERE ticker=?"
        params.append(ticker)
    query += " ORDER BY timeframe"
    with _conn() as con:
        return [r[0] for r in con.execute(query, params).fetchall()]


def list_ind_confs() -> list[int]:
    with _conn() as con:
        return [r[0] for r in con.execute(
            "SELECT DISTINCT ind_conf FROM indicators ORDER BY ind_conf"
        ).fetchall()]


def list_ind_confs_named() -> list[dict]:
    """Return distinct ind_conf values that have data and a matching ind_configs entry."""
    with _conn() as con:
        rows = con.execute("""
            SELECT DISTINCT i.ind_conf, c.name
            FROM indicators i
            JOIN ind_configs c ON c.id = i.ind_conf
            ORDER BY i.ind_conf
        """).fetchall()
    return [{"id": r[0], "name": r[1]} for r in rows]


# ── Settings ─────────────────────────────────────────────────

def get_setting(key: str) -> Optional[str]:
    with _conn() as con:
        row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def set_setting(key: str, value: str) -> None:
    # ON CONFLICT DO UPDATE, not INSERT OR REPLACE — same reasoning as
    # upsert_indicators/upsert_ohlcv, for consistency even though this
    # table's write volume is negligible.
    with _conn() as con:
        con.execute(
            """INSERT INTO settings (key, value) VALUES (?,?)
               ON CONFLICT (key) DO UPDATE SET value = excluded.value""",
            (key, value)
        )


# ── Fetch log ────────────────────────────────────────────────

def log_fetch(ticker: str, timeframe: str, last_date: Optional[str],
              ticker_list: Optional[str] = None) -> None:
    from datetime import datetime
    # ON CONFLICT DO UPDATE, not INSERT OR REPLACE — same reasoning as
    # upsert_indicators/upsert_ohlcv. Called on every ticker fetch; the table
    # is capped at one row per (ticker, timeframe) so this was never a major
    # bloat source, but it's the same bug pattern.
    with _conn() as con:
        con.execute(
            """INSERT INTO fetch_log (ticker, timeframe, fetched_at, last_date, ticker_list)
               VALUES (?,?,?,?,?)
               ON CONFLICT (ticker, timeframe)
               DO UPDATE SET fetched_at  = excluded.fetched_at,
                             last_date   = excluded.last_date,
                             ticker_list = excluded.ticker_list""",
            (ticker, timeframe, datetime.utcnow().isoformat(), last_date, ticker_list)
        )


def log_indicator_run(config_id: int, config_name: str, timeframes: list,
                      tickers: int, errors: int, status: str = 'done',
                      dataset: Optional[str] = None) -> None:
    from datetime import datetime
    with _conn() as con:
        con.execute(
            "INSERT INTO ind_log (config_id, config_name, timeframes, tickers, errors, status, ran_at, dataset) VALUES (?,?,?,?,?,?,?,?)",
            (config_id, config_name, json.dumps(timeframes), tickers, errors, status, datetime.utcnow().isoformat(), dataset)
        )


def get_indicator_history(limit: int = 30) -> list:
    with _conn() as con:
        rows = con.execute(
            "SELECT id, config_id, config_name, timeframes, tickers, errors, status, ran_at, dataset FROM ind_log ORDER BY ran_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
    return [
        {'id': r[0], 'config_id': r[1], 'config_name': r[2], 'timeframes': json.loads(r[3]),
         'tickers': r[4], 'errors': r[5], 'status': r[6], 'ran_at': r[7][:10], 'dataset': r[8] or ''}
        for r in rows
    ]


def delete_indicator_run(run_id: int) -> None:
    with _conn() as con:
        con.execute("DELETE FROM ind_log WHERE id = ?", (run_id,))


def clear_indicator_history() -> None:
    with _conn() as con:
        con.execute("DELETE FROM ind_log")


def log_scan_run(config_id: int, config_name: str, matched: int, total: int,
                 ind_conf_id: Optional[int] = None, timeframes: list = None,
                 dataset_id: Optional[int] = None, win: str = '') -> int:
    from datetime import datetime
    with _conn() as con:
        cur = con.execute(
            "INSERT INTO scan_log (config_id, config_name, matched, total, ran_at, ind_conf_id, timeframes, dataset_id, win) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (config_id, config_name, matched, total, datetime.utcnow().isoformat(),
             ind_conf_id, json.dumps(timeframes or []), dataset_id, win or '')
        )
        return cur.lastrowid


def save_scan_results(run_id: int, results: list) -> None:
    rows = [(run_id, r['ticker'], r.get('date', ''), json.dumps(r.get('signals', {})))
            for r in results]
    with _conn() as con:
        con.executemany(
            "INSERT INTO scan_results (run_id, ticker, date, signals) VALUES (?,?,?,?)", rows
        )


def get_scan_runs(limit: int = 50) -> list:
    with _conn() as con:
        rows = con.execute(
            "SELECT s.id, s.config_id, s.config_name, s.matched, s.total, s.ran_at, s.ind_conf_id, s.timeframes, "
            "s.dataset_id, s.win, t.name FROM scan_log s LEFT JOIN ticker_configs t ON t.id = s.dataset_id "
            "ORDER BY s.ran_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [{'id': r[0], 'config_id': r[1], 'config_name': r[2], 'matched': r[3],
             'total': r[4], 'ran_at': r[5][:16].replace('T', ' '),
             'ind_conf_id': r[6], 'timeframes': json.loads(r[7] or '[]'),
             'dataset_id': r[8], 'win': r[9] or '', 'dataset': r[10] or ''} for r in rows]


def get_scan_run_tickers(run_id: int, timeframe: Optional[str] = None,
                         min_bars: Optional[int] = None) -> list:
    with _conn() as con:
        if timeframe and min_bars:
            rows = con.execute(
                "SELECT sr.ticker FROM scan_results sr "
                "INNER JOIN (SELECT ticker FROM ohlcv WHERE timeframe=? "
                "GROUP BY ticker HAVING COUNT(*) >= ?) o ON sr.ticker = o.ticker "
                "WHERE sr.run_id=? ORDER BY sr.ticker",
                (timeframe, min_bars, run_id)
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT ticker FROM scan_results WHERE run_id=? ORDER BY ticker", (run_id,)
            ).fetchall()
    return [r[0] for r in rows]


def delete_scan_run(run_id: int) -> None:
    with _conn() as con:
        con.execute("DELETE FROM scan_results WHERE run_id=?", (run_id,))
        con.execute("DELETE FROM scan_log WHERE id=?", (run_id,))


def clear_scan_history() -> None:
    with _conn() as con:
        con.execute("DELETE FROM scan_results")
        con.execute("DELETE FROM scan_log")


def get_scan_history(limit: int = 30) -> list:
    with _conn() as con:
        rows = con.execute(
            "SELECT id, config_id, config_name, matched, total, ran_at FROM scan_log ORDER BY ran_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
    return [
        {'id': r[0], 'config_id': r[1], 'config_name': r[2], 'matched': r[3],
         'total': r[4], 'ran_at': r[5][:10]}
        for r in rows
    ]


def log_pipeline_run(config_id: int, config_name: str, status: str,
                     fetch_tickers: int = 0, fetch_errors: int = 0,
                     ind_tickers: int = 0, ind_errors: int = 0,
                     scan_run_id: Optional[int] = None) -> int:
    from datetime import datetime
    with _conn() as con:
        cur = con.execute(
            "INSERT INTO pipeline_log (config_id, config_name, status, fetch_tickers, fetch_errors, "
            "ind_tickers, ind_errors, scan_run_id, ran_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (config_id, config_name, status, fetch_tickers, fetch_errors,
             ind_tickers, ind_errors, scan_run_id, datetime.utcnow().isoformat())
        )
        return cur.lastrowid


def get_pipeline_history(limit: int = 30) -> list:
    # LEFT JOIN scan_log so matched/total are read live from the existing scan run
    # rather than duplicated into pipeline_log.
    with _conn() as con:
        rows = con.execute(
            "SELECT p.id, p.config_id, p.config_name, p.status, p.fetch_tickers, p.fetch_errors, "
            "p.ind_tickers, p.ind_errors, p.scan_run_id, p.ran_at, s.matched, s.total "
            "FROM pipeline_log p LEFT JOIN scan_log s ON s.id = p.scan_run_id "
            "ORDER BY p.ran_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [
        {'id': r[0], 'config_id': r[1], 'config_name': r[2], 'status': r[3],
         'fetch_tickers': r[4], 'fetch_errors': r[5], 'ind_tickers': r[6], 'ind_errors': r[7],
         'scan_run_id': r[8], 'ran_at': r[9][:16].replace('T', ' '),
         'scan_matched': r[10], 'scan_total': r[11]}
        for r in rows
    ]


def delete_pipeline_run(run_id: int) -> None:
    with _conn() as con:
        con.execute("DELETE FROM pipeline_log WHERE id=?", (run_id,))


def clear_pipeline_history() -> None:
    with _conn() as con:
        con.execute("DELETE FROM pipeline_log")


def get_fetch_log(ticker: str, timeframe: str) -> Optional[dict]:
    with _conn() as con:
        row = con.execute(
            "SELECT fetched_at, last_date FROM fetch_log WHERE ticker=? AND timeframe=?",
            (ticker, timeframe)
        ).fetchone()
    if row is None:
        return None
    return {"fetched_at": row[0], "last_date": row[1]}


# ── Flagged tickers ──────────────────────────────────────────

def toggle_flag(ticker: str, note: Optional[str] = None) -> bool:
    """Flag the ticker if unflagged, unflag it otherwise. Returns the new flagged state."""
    ticker = ticker.upper()
    with _conn() as con:
        row = con.execute("SELECT 1 FROM flagged_tickers WHERE ticker=?", (ticker,)).fetchone()
        if row:
            con.execute("DELETE FROM flagged_tickers WHERE ticker=?", (ticker,))
            return False
        con.execute(
            "INSERT INTO flagged_tickers (ticker, note, flagged_at) VALUES (?, ?, ?)",
            (ticker, note, datetime.utcnow().isoformat())
        )
        return True


def list_flags() -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT ticker, note, flagged_at FROM flagged_tickers ORDER BY flagged_at DESC"
        ).fetchall()
    return [{"ticker": r[0], "note": r[1], "flagged_at": r[2]} for r in rows]


def remove_flag(ticker: str) -> None:
    with _conn() as con:
        con.execute("DELETE FROM flagged_tickers WHERE ticker=?", (ticker.upper(),))
