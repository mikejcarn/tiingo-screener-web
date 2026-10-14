import pandas as pd
from backend.indicators.indicators_list import _oscillators_core as osc
from backend.indicators.indicators_list._divergence_core import detect_divergences, prev_columns


def calculate_fractal_divergence(df: pd.DataFrame, period: int = 12,
                                  vol_filter: bool = True,
                                  left: int = 5, right: int = 5, **div_opts):
    """
    Fractal Energy: measures the ratio of directional close movement to the
    average high-low range. High energy = trending move; low energy = exhaustion.
    Divergence: price makes a new extreme but energy is fading (or surging at a
    lower extreme), suggesting the move lacks conviction.
    """
    energy = osc.fractal_energy(df, period)

    if vol_filter:
        vol_ema       = df['Volume'].ewm(span=20, adjust=False).mean()
        vol_confirmed = df['Volume'] > vol_ema * 1.2
    else:
        vol_confirmed = pd.Series(True, index=df.index)

    reg_bull, reg_bear, hid_bull, hid_bear, prev = detect_divergences(
        df['High'], df['Low'], energy, left, right, **div_opts)

    return {
        'Fractal_Energy':          energy,
        'Fractal_Regular_Bullish': reg_bull & vol_confirmed,
        'Fractal_Regular_Bearish': reg_bear & vol_confirmed,
        'Fractal_Hidden_Bullish':  hid_bull & vol_confirmed,
        'Fractal_Hidden_Bearish':  hid_bear & vol_confirmed,
        **prev_columns('Fractal', prev),
    }


def calculate_indicator(df: pd.DataFrame, **params):
    return calculate_fractal_divergence(df, **params)
