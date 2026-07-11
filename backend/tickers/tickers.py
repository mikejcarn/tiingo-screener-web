from datetime import datetime, timedelta
import pandas as pd
import requests
import time
from typing import Optional
from tiingo import TiingoClient
import os
from pathlib import Path
from src.core.globals import TICKERS_DIR, TICKERS_LIST, DATE_STAMP


'''
- Tickers Functions:
    - fetch_ticker()
        - create_df()
        - robust_api_call()
        - robust_tiingo_call()
    - fetch_tickers()
        - process_ticker()
        - load_tickers()
'''


# ===========================================================
# ===========================================================

# === FETCH TICKER: Fetch Single Ticker from Tiingo API =====

# ===========================================================
# ===========================================================


def fetch_ticker(timeframe='daily', ticker='BTCUSD', start_date=None, end_date=None, api_key='Tiingo-API-Key'):
    """
    Fetch historical price data for a given ticker and time period.
    """
    # Set default end_date to today if not provided
    if not end_date:
        end_date = datetime.now().date()
    elif isinstance(end_date, str):
        end_date = datetime.strptime(end_date, '%Y-%m-%d').date()

    # Initialize Tiingo client
    client = TiingoClient({'api_key': api_key, 'session': True})
    headers = {'Content-Type': 'application/json'}

    # Define time period configurations
    timeframe_config = {

        '1week':     {   'frequency': 'weekly', 'default_timedelta': None},
        'weekly':    {   'frequency': 'weekly', 'default_timedelta': None},
        'week':      {   'frequency': 'weekly', 'default_timedelta': None},
        'w':         {   'frequency': 'weekly', 'default_timedelta': None},

        '1day':      {   'frequency':  'daily', 'default_timedelta': None},
        'daily':     {   'frequency':  'daily', 'default_timedelta': None},
        'day':       {   'frequency':  'daily', 'default_timedelta': None},
        'd':         {   'frequency':  'daily', 'default_timedelta': None},

        '4hour':     {'resampleFreq':  '4hour', 'default_timedelta': timedelta(hours=15000)},
        '4h':        {'resampleFreq':  '4hour', 'default_timedelta': timedelta(hours=15000)},

        '1hour':     {'resampleFreq':  '1hour', 'default_timedelta': timedelta(hours=5000)},
        'hourly':    {'resampleFreq':  '1hour', 'default_timedelta': timedelta(hours=5000)},
        'hour':      {'resampleFreq':  '1hour', 'default_timedelta': timedelta(hours=5000)},
        '1h':        {'resampleFreq':  '1hour', 'default_timedelta': timedelta(hours=5000)},
        'h':         {'resampleFreq':  '1hour', 'default_timedelta': timedelta(hours=5000)},

        '1min':      {'resampleFreq':   '1min', 'default_timedelta': timedelta(hours=100)},
        'minute':    {'resampleFreq':   '1min', 'default_timedelta': timedelta(hours=100)},
        'min':       {'resampleFreq':   '1min', 'default_timedelta': timedelta(hours=100)},
        '1m':        {'resampleFreq':   '1min', 'default_timedelta': timedelta(hours=100)},
        'm':         {'resampleFreq':   '1min', 'default_timedelta': timedelta(hours=100)},

        '5min':      {'resampleFreq':   '5min', 'default_timedelta': timedelta(hours=100)},
        '5minutes':  {'resampleFreq':   '5min', 'default_timedelta': timedelta(hours=100)},
        '5m':        {'resampleFreq':   '5min', 'default_timedelta': timedelta(hours=100)},

        '15min':     {'resampleFreq':  '15min', 'default_timedelta': timedelta(hours=3000)},
        '15minutes': {'resampleFreq':  '15min', 'default_timedelta': timedelta(hours=3000)},
        '15m':       {'resampleFreq':  '15min', 'default_timedelta': timedelta(hours=3000)},

        '30min':     {'resampleFreq':  '30min', 'default_timedelta': timedelta(hours=3000)},
        '30minutes': {'resampleFreq':  '30min', 'default_timedelta': timedelta(hours=3000)},
        '30m':       {'resampleFreq':  '30min', 'default_timedelta': timedelta(hours=3000)},

    }

    # Get the configuration for the specified time period
    config = timeframe_config.get(timeframe.lower())
    if not config:
        raise ValueError(f"Unsupported time period: {timeframe}")

    # Calculate start_date if not provided
    end_dt = datetime(end_date.year, end_date.month, end_date.day)
    if start_date is None and config['default_timedelta']:
        start_date = (end_dt - config['default_timedelta']).strftime('%Y-%m-%d')
    elif start_date is None:
        start_date = (end_dt - timedelta(days=1825)).strftime('%Y-%m-%d')  # 5-year lookback

    # Fetch data (Tiingo API) -------------------------------------------------

    # fetch daily/weekly data
    if 'frequency' in config:
        # MODIFIED: Using robust_tiingo_call instead of direct client call
        data = robust_tiingo_call(client, ticker, start_date, end_date, config['frequency'])
        df = create_df(data, config['frequency'])
        df.attrs['timeframe'] = config['frequency']

    else:
        # fetch intraday stock data
        try:
            api_url = f"https://api.tiingo.com/iex/{ticker}/prices"
            params = {
                'startDate': start_date,
                'endDate': end_date,
                'resampleFreq': config['resampleFreq'],
                'columns': 'open,high,low,close,volume',
                'token': api_key
            }
            # MODIFIED: Using robust_api_call instead of direct requests.get
            data = robust_api_call(api_url, headers, params)
            df = create_df(data, config['resampleFreq'])
            df.attrs['timeframe'] = config['resampleFreq']

        # fetch intraday crypto data
        except ValueError:
            api_url = f"https://api.tiingo.com/tiingo/crypto/prices"
            params = {
                'tickers': {ticker},
                'startDate': start_date,
                'endDate': end_date,
                'resampleFreq': config['resampleFreq'],
                'columns': 'open,high,low,close,volume',
                'token': api_key
            }
            # MODIFIED: Using robust_api_call instead of direct requests.get
            data = robust_api_call(api_url, headers, params)
            data = data[0]['priceData']
            df = create_df(data, config['resampleFreq'])
            df = df.drop(columns=['volumeNotional', 'tradesDone'])
            df.attrs['timeframe'] = config['resampleFreq']

    return df

def create_df(data, timeframe='daily'):

    df = pd.DataFrame(data)

    match timeframe:

        case 'daily'|'1day'|'d'|'weekly'|'1week'|'w':

            df.rename(columns={
                'adjLow': 'Low',
                'adjHigh': 'High',
                'adjClose': 'Close',
                'adjOpen': 'Open',
                'adjVolume': 'Volume'
            }, inplace=True)

            columns_to_drop = ['close', 'high', 'low', 'open', 'volume', 'splitFactor', 'divCash']
            df = df.drop(columns=columns_to_drop)

        case 'hourly'|'1hour'|'h'|'4hour'|'4h'|'30minutes'|'30min'|'30m'|'15minutes'|'15min'|'15m'|'5minutes'|'5min'|'5m'|'min'|'m'|'minute'|'1min'|'1m':

            df.rename(columns={
                'low': 'Low',
                'high': 'High',
                'close': 'Close',
                'open': 'Open',
                'volume': 'Volume',
            }, inplace=True)

    df['date'] = pd.to_datetime(df['date'])
    df.set_index('date', inplace=True) 

    return df

# Functions to manage Network instability -----------------

def robust_api_call(url: str, headers: dict, params: dict = None, max_retries: int = 5) -> dict:
    """
    Wrapper around requests.get with exponential backoff retry logic
    - Retries on network errors and timeouts
    - Does NOT retry on HTTP errors (404, 403, 400, etc.)
    """
    for attempt in range(max_retries):
        try:
            response = requests.get(url, headers=headers, params=params, timeout=30)
            
            # Check for HTTP errors that shouldn't be retried
            if response.status_code >= 400:
                response.raise_for_status()  # This will raise an HTTPError immediately
            
            return response.json()
            
        except requests.exceptions.HTTPError as e:
            # HTTP errors (404, 403, 400, etc.) - don't retry, just re-raise
            raise e
            
        except requests.exceptions.RequestException as e:
            # Network errors, timeouts, etc. - retry with exponential backoff
            if attempt == max_retries - 1:
                raise e
            wait_time = 2 ** attempt
            print(f"Network error (attempt {attempt+1}/{max_retries}), retrying in {wait_time}s... Error: {e}")
            time.sleep(wait_time)
    
    raise requests.exceptions.RequestException("All retries failed")

def robust_tiingo_call(client, ticker: str, start_date: str, end_date: str, frequency: str, max_retries: int = 5):
    """
    Wrapper around TiingoClient.get_ticker_price with exponential backoff retry logic
    """
    for attempt in range(max_retries):
        try:
            data = client.get_ticker_price(ticker, startDate=start_date, endDate=end_date, frequency=frequency)
            return data
        except Exception as e:
            # Check if it's a network-related error
            if any(network_error in str(e).lower() for network_error in ['connection', 'network', 'timeout', 'unreachable']):
                if attempt == max_retries - 1:
                    raise e
                wait_time = 2 ** attempt
                print(f"TiingoClient network error (attempt {attempt+1}/{max_retries}), retrying in {wait_time}s... Error: {e}")
                time.sleep(wait_time)
            else:
                # For non-network errors, re-raise immediately
                raise e
    raise Exception("All retries failed for TiingoClient call")


# ===========================================================
# ===========================================================

# === FETCH TICKERS: Fetch Batch of Tickers by Timeframes ===

# ===========================================================
# ===========================================================


def fetch_tickers(
                  timeframes=['weekly', 'daily', 'hourly', '5min'], 
                  start_date=None,
                  end_date=None,
                  api_key='Tiingo_API_Key'
                 ):

    """Fetch raw ticker data for given timeframes without indicators."""

    print('\n=== FETCH TICKERS ===\n')
    print(f"Today's Date: {DATE_STAMP} (Format: DDMMYY)")
    print(f"Input Tickers: {TICKERS_LIST}")
    print(f"Output directory: {TICKERS_DIR}")
    
    # Load ticker list
    df_stock_list = load_tickers(TICKERS_LIST)
    total_tickers = len(df_stock_list['Ticker'].unique())
    print(f"\nLoaded {total_tickers} Tickers: {DATE_STAMP}")
    
    # Process each ticker
    processed_count = 0
    for ticker in df_stock_list['Ticker'].unique():
        processed_count += 1
        print(f"\rFetching {processed_count}/{total_tickers}: {str(ticker).strip().ljust(6)}", end="")
        process_ticker(ticker, timeframes, api_key, end_date=end_date)
    
    print("\n\nData fetch complete!")
    print(f"Raw data saved with date format: {DATE_STAMP}")
    print(f"Files formatted as: TICKER_TIMEFRAME_{DATE_STAMP}.csv")

# Ticker Handling -------------------------------------------------------------

def process_ticker(ticker, timeframes, api_key, end_date=None, save_to_disk=True):
    """Fetch and save raw ticker data for all specified timeframes."""
    results = {}

    if end_date:
        date_stamp = datetime.strptime(end_date, '%Y-%m-%d').strftime('%d%m%y') if isinstance(end_date, str) else end_date.strftime('%d%m%y')
    else:
        date_stamp = DATE_STAMP

    for timeframe in timeframes:
        try:
            df = fetch_ticker(timeframe, ticker, end_date=end_date, api_key=api_key)
            results[timeframe] = df

            if save_to_disk:
                os.makedirs(TICKERS_DIR, exist_ok=True)
                filename = os.path.join(TICKERS_DIR, f"{ticker}_{timeframe}_{date_stamp}.csv")
                df.to_csv(filename, index=True)

        except Exception as e:
            print(f"\nError fetching {ticker} ({timeframe}): {str(e)}")
            continue

    return results

def load_tickers(csv_path):

    df = pd.read_csv(csv_path)

    # Clean data - convert numeric columns and handle missing values
    numeric_cols = ['Last Sale', 'Net Change', '% Change', 'Market Cap', 'Volume']
    for col in numeric_cols:
        try: df[col] = df[col].replace('[\$,%]', '', regex=True).astype(float)
        except Exception as e:
            # print(f"\nError fetching csv: {str(e)}")
            continue

    return df
