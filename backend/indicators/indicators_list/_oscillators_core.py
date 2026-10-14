"""
Shared oscillator math — the single source for every oscillator line used by
the divergence_*.py indicators (compared against price at swing points) and
the oscillators.py indicator (drawn in their own chart panes). Keeping one
implementation means what the panes show is exactly what divergence compares.

Each function takes the OHLCV DataFrame and returns pd.Series (or a tuple of
them), aligned to df.index.
"""
import numpy as np
import pandas as pd


def rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """RSI with Wilder's smoothing (EMA, alpha = 1/period)."""
    close = df['Close']
    delta = close.diff()
    gain  = delta.where(delta > 0, 0.0)
    loss  = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    return 100 - (100 / (1 + avg_gain / avg_loss))


def macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9):
    """(macd, signal, histogram) — EMA(fast) - EMA(slow) of Close."""
    close = df['Close']
    line  = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
    sig   = line.ewm(span=signal, adjust=False).mean()
    return line, sig, line - sig


def obv(df: pd.DataFrame, period: int = 21):
    """(obv, obv_smoothed) — on-balance volume and its EMA(period)."""
    close  = df['Close'].values
    volume = df['Volume'].values
    direction = np.sign(np.diff(close, prepend=close[0]))
    raw = pd.Series(np.cumsum(direction * volume), index=df.index)
    return raw, raw.ewm(span=period, adjust=False).mean()


def true_range(df: pd.DataFrame) -> pd.Series:
    return pd.concat([df['High'] - df['Low'],
                      (df['High'] - df['Close'].shift(1)).abs(),
                      (df['Low']  - df['Close'].shift(1)).abs()], axis=1).max(axis=1)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """ATR as a simple rolling mean of true range (NaN until period bars)."""
    return true_range(df).rolling(period).mean()


def fisher(df: pd.DataFrame, period: int = 10):
    """(fisher, signal) — Fisher Transform of the normalized HL2, signal = EMA(3)."""
    hl2     = (df['High'] + df['Low']) / 2
    max_hl2 = hl2.rolling(period).max()
    min_hl2 = hl2.rolling(period).min()
    val = (0.33 * 2 * ((hl2 - min_hl2) / (max_hl2 - min_hl2 + 1e-7) - 0.5)).clip(-0.999, 0.999)
    fish = 0.5 * np.log((1 + val) / (1 - val))
    return fish, fish.ewm(span=3, adjust=False).mean()


def fractal_energy(df: pd.DataFrame, period: int = 12) -> pd.Series:
    """Net close move over period / average high-low range — high = trending,
    low = exhaustion."""
    hl_range    = (df['High'] - df['Low']).rolling(period).mean()
    close_range = df['Close'].diff(period).abs()
    return (close_range / hl_range).replace([np.inf, -np.inf], np.nan).fillna(0)


def mfi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Money Flow Index (0-100)."""
    typical_price = (df['High'] + df['Low'] + df['Close']) / 3
    money_flow    = typical_price * df['Volume']
    pos_flow = money_flow.where(typical_price > typical_price.shift(1), 0.0)
    neg_flow = money_flow.where(typical_price < typical_price.shift(1), 0.0)
    pos_sum  = pos_flow.rolling(period).sum()
    neg_sum  = neg_flow.rolling(period).sum()
    return 100 * pos_sum / (pos_sum + neg_sum)


def momentum(df: pd.DataFrame, period: int = 10, smooth: int = 3):
    """(momentum, smoothed) — close minus close period bars ago, and its EMA(smooth)."""
    close = df['Close']
    mom   = close - close.shift(period)
    return mom, mom.ewm(span=smooth, adjust=False).mean()


def stochastic(df: pd.DataFrame, k_period: int = 14, d_period: int = 3):
    """(%K, %D) — 0-100."""
    low_min  = df['Low'].rolling(k_period).min()
    high_max = df['High'].rolling(k_period).max()
    k = 100 * ((df['Close'] - low_min) / (high_max - low_min))
    return k, k.rolling(d_period).mean()


def volume_ma(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """EMA(period) of volume."""
    return df['Volume'].ewm(span=period, adjust=False).mean()


def vortex(df: pd.DataFrame, period: int = 14):
    """(VI+, VI-) — Vortex Indicator."""
    tr       = true_range(df)
    vm_plus  = (df['High'] - df['Low'].shift(1)).abs()
    vm_minus = (df['Low']  - df['High'].shift(1)).abs()
    tr_sum   = tr.rolling(period).sum()
    return vm_plus.rolling(period).sum() / tr_sum, vm_minus.rolling(period).sum() / tr_sum
