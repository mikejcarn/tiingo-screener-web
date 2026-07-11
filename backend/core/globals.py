from pathlib import Path
from datetime import datetime

DATE_STAMP = datetime.now().strftime('%d%m%y')

PROJECT_ROOT   = Path(__file__).parent.parent.parent
BACKEND_ROOT   = Path(__file__).parent.parent

DATA_DIR        = PROJECT_ROOT / "data"

IND_CONF_DIR    = BACKEND_ROOT / "indicators" / "ind_configs"
SCAN_CONF_DIR   = BACKEND_ROOT / "scans" / "scan_configs"

TICKERS_LIST    = BACKEND_ROOT / "tickers" / "ticker_lists" / "TSX.csv"

API_KEY = '9807b06bf5b97a8b26f5ff14bff18ee992dfaa13'

TIMEFRAME_ALIASES = {
    'd':     'daily',
    'daily': 'daily',
    'w':     'weekly',
    'weekly':'weekly',
    '4h':    '4hour',
    '4hour': '4hour',
    'h':     '1hour',
    '1hour': '1hour',
    '5min':  '5min',
}
