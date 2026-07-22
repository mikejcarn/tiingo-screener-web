import pandas as pd
from backend.indicators.indicators_list._divergence_core import detect_divergences


def calculate_mfi_divergence(df: pd.DataFrame, period: int = 14,
                              volume_threshold: float = 1.2,
                              left: int = 5, right: int = 5, **_):
    typical_price = (df['High'] + df['Low'] + df['Close']) / 3
    money_flow    = typical_price * df['Volume']

    pos_flow = money_flow.where(typical_price > typical_price.shift(1), 0.0)
    neg_flow = money_flow.where(typical_price < typical_price.shift(1), 0.0)
    pos_sum  = pos_flow.rolling(period).sum()
    neg_sum  = neg_flow.rolling(period).sum()
    mfi      = 100 * pos_sum / (pos_sum + neg_sum)

    vol_ema  = df['Volume'].ewm(span=period, adjust=False).mean()
    vol_conf = df['Volume'] > vol_ema * volume_threshold

    reg_bull, reg_bear, hid_bull, hid_bear = detect_divergences(
        df['Close'], mfi, left, right)

    # Keep the oversold/overbought zone filters — they reduce noise meaningfully
    return {
        'MFI':                  mfi,
        'MFI_Regular_Bullish':  reg_bull & (mfi < 40) & vol_conf,
        'MFI_Regular_Bearish':  reg_bear & (mfi > 60) & vol_conf,
        'MFI_Hidden_Bullish':   hid_bull & vol_conf,
        'MFI_Hidden_Bearish':   hid_bear & vol_conf,
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_mfi_divergence(df, **params)
