import pandas as pd
import numpy as np

def calculate_engulfing_pattern(df, mode='both', engulfing_periods=3, close_threshold=0.25, **params):
    """
    Detects engulfing candle patterns where a single candle's wicks engulf
    the previous N candles' opposing buy/sell ranges.
    
    Parameters:
    -----------
    df : pandas.DataFrame
        DataFrame with 'Open', 'High', 'Low', 'Close' columns
    mode : str
        Pattern mode to detect: 'bullish', 'bearish', or 'both' (default: 'both')
    engulfing_periods : int
        Number of previous candles to check for engulfing (default: 3)
    close_threshold : float
        Required closing position within candle range (0.0-1.0, default: 0.25)
        For bullish: close must be in top (close_threshold * 100)% of range
        For bearish: close must be in bottom (close_threshold * 100)% of range
    
    Returns:
    --------
    dict
        Dictionary containing pattern signals:
        - 'bullish_engulfing_signal': Series with 1 where bullish pattern detected, else 0
        - 'bearish_engulfing_signal': Series with 1 where bearish pattern detected, else 0
        - 'engulfing_pattern_cluster': Series with:
            'bullish_engulfing' for the bullish engulfing candle
            'bearish_engulfing' for the bearish engulfing candle
            'bullish_engulfed' for candles engulfed by a bullish pattern
            'bearish_engulfed' for candles engulfed by a bearish pattern
            '' (empty string) for candles not in any pattern
        - 'engulfing_periods': int, the number of previous candles checked (for reference)
    """
    
    # Validate mode
    valid_modes = ['bullish', 'bearish', 'both']
    if mode.lower() not in valid_modes:
        raise ValueError(f"mode must be one of: {valid_modes}")
    
    mode = mode.lower()
    
    # Ensure we have required columns
    required_cols = ['Open', 'High', 'Low', 'Close']
    if not all(col in df.columns for col in required_cols):
        raise ValueError(f"DataFrame must contain columns: {required_cols}")
    
    # Calculate candle properties
    df = df.copy()
    
    # Body and direction calculations
    df['range'] = df['High'] - df['Low']
    df['is_bullish'] = df['Close'] > df['Open']
    df['is_bearish'] = df['Close'] < df['Open']
    
    # Calculate close position within range (0 to 1, where 1 is top of range)
    # Handle potential division by zero (if range is 0, set close_position to 0.5)
    df['close_position'] = np.where(
        df['range'] > 0,
        (df['Close'] - df['Low']) / df['range'],
        0.5  # Default for doji/zero-range candles
    )
    
    # Initialize signal columns
    df['bullish_engulfing_signal'] = 0
    df['bearish_engulfing_signal'] = 0
    df['engulfing_pattern_cluster'] = ''  # Will store role in pattern
    
    # Need at least engulfing_periods + 1 rows of data
    if len(df) <= engulfing_periods:
        return {
            'bullish_engulfing_signal': pd.Series(0, index=df.index),
            'bearish_engulfing_signal': pd.Series(0, index=df.index),
            'engulfing_pattern_cluster': pd.Series('', index=df.index),
            'engulfing_periods': engulfing_periods
        }
    
    # First pass: detect all signal candles and store their indices with timestamps
    signal_indices = {'bullish': [], 'bearish': []}
    
    for i in range(engulfing_periods, len(df)):
        current = df.iloc[i]
        prev_candles = df.iloc[i-engulfing_periods:i]
        
        # Check for patterns based on mode
        if mode in ['bullish', 'both']:
            if _check_bullish_engulfing(current, prev_candles, close_threshold):
                signal_indices['bullish'].append(i)
        
        if mode in ['bearish', 'both']:
            if _check_bearish_engulfing(current, prev_candles, close_threshold):
                signal_indices['bearish'].append(i)
    
    # Second pass: mark each candle in the pattern with its specific role
    # Process bearish first so bullish can override if patterns overlap
    for signal_type in ['bearish', 'bullish']:
        for idx in signal_indices[signal_type]:
            start_idx = max(0, idx - engulfing_periods)
            
            # Mark the engulfing candle
            df.loc[df.index[idx], 'engulfing_pattern_cluster'] = f'{signal_type}_engulfing'
            df.loc[df.index[idx], f'{signal_type}_engulfing_signal'] = 1
            
            # Mark the engulfed candles (previous N candles)
            for j in range(start_idx, idx):
                if signal_type == 'bullish':
                    # In bullish pattern, engulfed candles are bearish
                    df.loc[df.index[j], 'engulfing_pattern_cluster'] = 'bearish_engulfed'
                else:
                    # In bearish pattern, engulfed candles are bullish
                    df.loc[df.index[j], 'engulfing_pattern_cluster'] = 'bullish_engulfed'
    
    # Return signal columns plus the engulfing_periods for reference
    return {
        'bullish_engulfing_signal': df['bullish_engulfing_signal'],
        'bearish_engulfing_signal': df['bearish_engulfing_signal'],
        'engulfing_pattern_cluster': df['engulfing_pattern_cluster'],
        'engulfing_periods': engulfing_periods
    }


def _check_bullish_engulfing(current_candle, prev_candles, close_threshold):
    """
    Check for bullish engulfing pattern:
    1. Current candle must be bullish (close > open)
    2. ALL previous candles must be bearish (strict opposite requirement)
    3. Current candle's low must be <= all previous candles' lows
    4. Current candle's high must be >= all previous candles' highs
    5. Current candle must close in top (close_threshold * 100)% of its range
    """
    
    # Current candle must be bullish
    if not current_candle['is_bullish']:
        return False
    
    # ALL previous candles must be bearish (strict opposite requirement)
    if not prev_candles['is_bearish'].all():
        return False
    
    # Check engulfing condition for entire wicks
    current_low = current_candle['Low']
    current_high = current_candle['High']
    
    prev_lows = prev_candles['Low']
    prev_highs = prev_candles['High']
    
    # Current candle must engulf ALL previous candles' wicks
    if not (current_low <= prev_lows.min() and current_high >= prev_highs.max()):
        return False
    
    # Check closing position (must be in top close_threshold% of range)
    required_close_pos = 1.0 - close_threshold
    if current_candle['close_position'] < required_close_pos:
        return False
    
    return True


def _check_bearish_engulfing(current_candle, prev_candles, close_threshold):
    """
    Check for bearish engulfing pattern:
    1. Current candle must be bearish (close < open)
    2. ALL previous candles must be bullish (strict opposite requirement)
    3. Current candle's low must be <= all previous candles' lows
    4. Current candle's high must be >= all previous candles' highs
    5. Current candle must close in bottom (close_threshold * 100)% of its range
    """
    
    # Current candle must be bearish
    if not current_candle['is_bearish']:
        return False
    
    # ALL previous candles must be bullish (strict opposite requirement)
    if not prev_candles['is_bullish'].all():
        return False
    
    # Check engulfing condition for entire wicks
    current_low = current_candle['Low']
    current_high = current_candle['High']
    
    prev_lows = prev_candles['Low']
    prev_highs = prev_candles['High']
    
    # Current candle must engulf ALL previous candles' wicks
    if not (current_low <= prev_lows.min() and current_high >= prev_highs.max()):
        return False
    
    # Check closing position (must be in bottom close_threshold% of range)
    if current_candle['close_position'] > close_threshold:
        return False
    
    return True


def calculate_indicator(df, **params):
    """
    Main function to be called by the scanner.
    Follows the same pattern as your example files.
    
    Returns:
    --------
    dict with keys:
        - 'bullish_engulfing_signal'
        - 'bearish_engulfing_signal'
        - 'engulfing_pattern_cluster'
        - 'engulfing_periods'
    """
    return calculate_engulfing_pattern(df, **params)


# Optional: Simplified version that returns a single signal series
def calculate_simple_engulfing(df, mode='both', **params):
    """
    Simplified version that returns just one signal series.
    
    Parameters:
    -----------
    df : pandas.DataFrame
    mode : str
        'bullish', 'bearish', or 'both' (default: 'both')
        If 'both', returns combined signal (1 for bullish, -1 for bearish)
    **params : dict
        Passed to calculate_engulfing_pattern
    
    Returns:
    --------
    pandas.Series
        - If mode='bullish': 1 where bullish pattern, else 0
        - If mode='bearish': 1 where bearish pattern, else 0
        - If mode='both': 1 for bullish, -1 for bearish, 0 for none
    """
    result = calculate_engulfing_pattern(df, mode=mode, **params)
    
    if mode.lower() == 'bullish':
        return result['bullish_engulfing_signal']
    elif mode.lower() == 'bearish':
        return result['bearish_engulfing_signal']
    else:  # 'both'
        # Return combined signal (1 for bullish, -1 for bearish, 0 for none)
        combined = pd.Series(0, index=df.index)
        combined[result['bullish_engulfing_signal'] == 1] = 1
        combined[result['bearish_engulfing_signal'] == 1] = -1
        return combined
