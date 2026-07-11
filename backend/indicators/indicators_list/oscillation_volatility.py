import pandas as pd
import numpy as np
from src.indicators.indicators import get_indicators

def calculate_oscillation_volatility(
    df,
    lookback=100,
    peaks_valleys_params={'periods': 20, 'max_aVWAPs': None},
    avg_lookback=20,
    include_ma_output=True,
    min_cross_std=0.1,
    **params
):
    """
    Robust oscillation volatility indicator with:
    - Automatic handling of insufficient data
    - Fallback calculations when peaks/valleys can't be determined
    - Clean error handling without additional parameters
    """
    
    # Initialize default results
    results = {
        'MA_Cross_Count': pd.Series(0, index=df.index),
        'MA_Avg_Deviation_Z': pd.Series(np.nan, index=df.index),
        'MA_Oscillation_Score': pd.Series(np.nan, index=df.index)
    }
    
    # Early return if insufficient data
    if len(df) < 2:
        return results

    try:
        # Attempt to get MA with peaks/valleys
        aVWAP_results = get_indicators(
            df[['Open', 'High', 'Low', 'Close', 'Volume']].copy(),
            ['aVWAP'],
            {'aVWAP': {
                'peaks_valleys': True,
                'peaks_valleys_avg': True,
                'peaks_valleys_params': peaks_valleys_params,
                'avg_lookback': avg_lookback
            }}
        )
        
        # Use peaks/valleys avg if available, otherwise fallback to simple aVWAP
        if 'Peaks_Valleys_avg' in aVWAP_results and not aVWAP_results['Peaks_Valleys_avg'].isna().all():
            ma = aVWAP_results['Peaks_Valleys_avg']
        else:
            ma = aVWAP_results['aVWAP']
            
        if include_ma_output:
            results['Peaks_Valleys_avg'] = ma
            
    except Exception as e:
        # If MA calculation fails completely, return default results
        return results

    # Calculate price std with robust handling
    price_std = df['Close'].rolling(lookback, min_periods=1).std()
    price_std = price_std.replace(0, np.nan).ffill().bfill()

    if price_std.isna().all():
        return results

    # Per-bar cross detection
    prev_close = df['Close'].shift(1)
    prev_ma = ma.shift(1)
    crosses = (
        ((prev_close < prev_ma) & (df['Close'] > ma)) |
        ((prev_close > ma) & (df['Close'] < ma))
    )

    # Per-bar deviation (normalized by rolling std at each bar)
    deviation = (df['Close'] - ma).abs() / price_std
    valid_crosses = crosses & (deviation >= min_cross_std)

    # Rolling aggregation over lookback window
    cross_count = valid_crosses.rolling(lookback, min_periods=1).sum()
    deviation_sum = deviation.where(valid_crosses, 0).rolling(lookback, min_periods=1).sum()
    avg_deviation = deviation_sum / cross_count.replace(0, np.nan)

    results['MA_Cross_Count'] = cross_count
    results['MA_Avg_Deviation_Z'] = avg_deviation
    results['MA_Oscillation_Score'] = cross_count * avg_deviation

    return results

def calculate_indicator(df, **params):
    return calculate_oscillation_volatility(df, **params)
