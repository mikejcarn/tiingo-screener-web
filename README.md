# tiingo-screener-web

A personal stock screening and charting tool built on FastAPI + vanilla JS. Fetches OHLCV data from the [Tiingo API](https://www.tiingo.com/), runs a configurable indicator pipeline, and renders interactive charts with a bar-by-bar replay engine.

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3, FastAPI, Uvicorn |
| Database | SQLite (`data/screener.db`) |
| Frontend | Vanilla JS (ES modules), [lightweight-charts v4](https://tradingview.github.io/lightweight-charts/) |
| Data source | Tiingo REST API |

---

## Setup

```bash
# Clone and enter the repo
git clone https://github.com/mikejcarn/tiingo-screener-web.git
cd tiingo-screener-web

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

**API key** — set your Tiingo API key in `backend/core/globals.py`:
```python
API_KEY = 'your_tiingo_api_key_here'
```

---

## Running

```bash
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.

---

## Usage

### 1. Fetch ticker data

Use the **Fetch** API to pull OHLCV data from Tiingo into the local SQLite database:

```bash
# Single ticker + timeframe
curl -X POST "http://localhost:8000/api/fetch/AAPL/daily"

# Batch fetch (JSON body with lists)
curl -X POST "http://localhost:8000/api/fetch/batch" \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["AAPL", "MSFT", "GOOGL"], "timeframes": ["daily", "weekly"]}'
```

Supported timeframes: `daily`, `weekly`, `4hour`, `1hour`, `5min`  
Shorthand aliases: `d`, `w`, `4h`, `h`, `5min`

### 2. Run indicators

Once data is fetched, compute indicators and store them in the database:

```bash
# Single ticker
curl -X POST "http://localhost:8000/api/indicators/AAPL/daily/0"

# Batch — all available tickers for a timeframe
curl -X POST "http://localhost:8000/api/indicators/batch" \
  -H "Content-Type: application/json" \
  -d '{"timeframe": "daily", "ind_conf": 0}'
```

The `ind_conf` integer (0–9) selects which indicator configuration to use. Configs live in `backend/indicators/ind_configs/ind_conf_N.py`.

### 3. Browse charts

Open the app in your browser. Use the ticker input or arrow buttons to navigate between tickers. Select a timeframe and indicator config from the dropdowns.

---

## Replay Mode

The chart supports a bar-by-bar replay engine that simulates how indicators would have appeared in real time — including a dynamic VWAP engine that applies the correct confirmation delays for peak/valley detection.

### Controls

| Input | Action |
|---|---|
| `←` / `→` | Step one bar backward / forward |
| `Space` | Toggle play / pause |
| `⏮` / `⏭` | Jump to first / last bar |
| Bar input | Jump to a specific bar index |
| Date input | Jump to a specific date (`YYYY-MM-DD`) |
| FPS input | Set playback speed (1–60 fps) |

---

## API Reference

### Data

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/tickers` | List all tickers in the database |
| `GET` | `/api/data/{ticker}/{timeframe}` | Raw OHLCV data |
| `GET` | `/api/indicators/{ticker}/{timeframe}/{ind_conf}` | Computed indicator data |

### Fetch

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/fetch/{ticker}/{timeframe}` | Fetch one ticker from Tiingo |
| `POST` | `/api/fetch/batch` | Fetch multiple tickers |
| `GET` | `/api/fetch/status/{ticker}/{timeframe}` | Last fetch timestamp and date |

### Indicators

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/indicators/{ticker}/{timeframe}/{ind_conf}` | Run indicator pipeline for one ticker |
| `POST` | `/api/indicators/batch` | Run for all available tickers |

### WebSocket

| Endpoint | Description |
|---|---|
| `WS /ws/replay/{ticker}/{timeframe}/{ind_conf}` | Streams bars + indicator styles + dynamic replay events |

The WebSocket sends three messages on connect:
1. `{"type": "meta", ...}` — column styles for static indicator lines
2. `{"type": "bars", "data": [...]}` — all OHLCV + indicator rows
3. `{"type": "replay_events", ...}` — peak/valley bar indices and QQEMOD anchor events for the dynamic VWAP engine

---

## Indicator Configs

Configs are defined in `backend/indicators/ind_configs/ind_conf_N.py`. Each file exports two dicts:

```python
indicators = {
    'daily': ['aVWAP', 'candle_colors', 'SMA'],
    'weekly': ['aVWAP'],
    # ...
}

params = {
    'daily': {
        'aVWAP': {
            'peaks': True,
            'peaks_params': [{'periods': 100, 'max_aVWAPs': None}],
            # ...
        },
        'SMA': {'periods': [20, 50, 200]},
    },
    # ...
}
```

Multiple configs can coexist — `ind_conf_0` and `ind_conf_1` are stored separately and can be compared side by side.

### Available Indicators

| Indicator | Description |
|---|---|
| `aVWAP` | Anchored VWAPs from peaks, valleys, QQEMOD zones, OB, BoS/CHoCH, gaps |
| `aVWAP_anchor_score` | Scores swing points by prominence, isolation, and reversal sharpness |
| `aVWAP_pinch` | Detects aVWAP convergence/pinch patterns |
| `candle_colors` | Per-bar candle coloring based on QQEMOD, StDev, banker RSI, or WAE |
| `QQEMOD` | Qualitative Quantitative Estimation (modified) zone indicator |
| `peaks_valleys` | Local price maxima/minima detection via centered rolling window |
| `SMA` | Simple moving averages (multiple periods) |
| `supertrend` | Supertrend trend-following indicator |
| `BoS_CHoCH` | Break of Structure / Change of Character detection |
| `OB` | Order Block detection |
| `FVG` | Fair Value Gap detection |
| `liquidity` | Swing high/low liquidity levels |
| `RSI` | Relative Strength Index |
| `divergence_*` | RSI, MACD, OBV, MFI, Stochastic, and other divergences |

---

## Project Structure

```
tiingo-screener-web/
├── backend/
│   ├── main.py                   # FastAPI app, WebSocket endpoint
│   ├── core/
│   │   ├── database.py           # SQLite schema + CRUD
│   │   ├── data_manager.py       # Load/save OHLCV and indicator DataFrames
│   │   ├── globals.py            # API key, paths, timeframe aliases
│   │   ├── col_styles.py         # Maps indicator columns to chart render styles
│   │   └── replay_events.py      # Extracts dynamic replay event data
│   ├── indicators/
│   │   ├── indicators.py         # Pipeline runner + config loader
│   │   ├── ind_configs/          # ind_conf_0.py … ind_conf_9.py
│   │   └── indicators_list/      # One file per indicator
│   ├── routers/
│   │   ├── data.py               # GET data endpoints
│   │   ├── fetch.py              # POST fetch endpoints
│   │   └── indicators_router.py  # POST indicator endpoints
│   └── tickers/
│       └── tickers.py            # Tiingo API fetch logic
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── browse.js             # Top-level controller (ticker/tf/conf nav)
│       ├── replay.js             # Bar-by-bar replay controller
│       ├── chart.js              # lightweight-charts wrapper
│       └── avwap_replay.js       # Dynamic VWAP engine (cumulative sum O(1))
└── data/
    └── screener.db               # SQLite database
```

---

## Database Schema

```sql
-- Raw OHLCV from Tiingo
CREATE TABLE ohlcv (
    ticker TEXT, timeframe TEXT, date TEXT,
    open REAL, high REAL, low REAL, close REAL, volume REAL,
    PRIMARY KEY (ticker, timeframe, date)
);

-- Computed indicator rows — JSON blob per bar, flexible per ind_conf
CREATE TABLE indicators (
    ticker TEXT, timeframe TEXT, ind_conf INTEGER, date TEXT,
    data TEXT,  -- JSON: {"SMA_200": 123.4, "color": "rgba(...)", ...}
    PRIMARY KEY (ticker, timeframe, ind_conf, date)
);

-- Fetch history for incremental updates
CREATE TABLE fetch_log (
    ticker TEXT, timeframe TEXT,
    fetched_at TEXT, last_date TEXT,
    PRIMARY KEY (ticker, timeframe)
);
```
