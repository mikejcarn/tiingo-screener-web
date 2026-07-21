import pandas as pd
import numpy as np
from backend.indicators.indicators import get_indicators


_CENTRELINE_DEFAULTS = {
    'peaks_valleys_avg': {'periods': 20, 'max_aVWAPs': None, 'avg_lookback': 20},
    'OB_avg':            {'periods': 20, 'max_aVWAPs': None, 'avg_lookback': 1},
    'gaps_avg':          {'max_aVWAPs': 10,                  'avg_lookback': 20},
    'SMA':               {'sma_periods': 75},
}

param_options = {
    'centreline': _CENTRELINE_DEFAULTS,
}


def calculate_stdev_bands(df,
                          stdev_lookback=75,
                          show_centreline=True,
                          centreline='peaks_valleys_avg',
                          centreline_params=None):
    if centreline_params is None:
        centreline_params = {}

    cp = {**_CENTRELINE_DEFAULTS.get(centreline, {}), **centreline_params}
    avg_lookback = cp.pop('avg_lookback', 20)

    centreline_config = {
        'peaks_valleys_avg': {
            'indicator': 'aVWAP',
            'params': {
                'peaks_valleys_avg': True,
                'peaks_valleys_params': cp,
                'avg_lookback': avg_lookback,
            },
            'mean_col': 'Peaks_Valleys_avg',
        },
        'OB_avg': {
            'indicator': 'aVWAP',
            'params': {
                'OB_avg': True,
                'OB_params': cp,
                'avg_lookback': avg_lookback,
            },
            'mean_col': 'OB_avg',
        },
        'gaps_avg': {
            'indicator': 'aVWAP',
            'params': {
                'gaps_avg': True,
                'gaps_params': cp,
                'avg_lookback': avg_lookback,
            },
            'mean_col': 'Gaps_avg',
        },
        'SMA': {
            'indicator': 'SMA',
            'params': {'periods': [cp.get('sma_periods', stdev_lookback)]},
            'mean_col': f"SMA_{cp.get('sma_periods', stdev_lookback)}",
        },
    }

    if centreline not in centreline_config:
        raise ValueError(f"Invalid centreline. Valid options: {list(centreline_config.keys())}")

    config = centreline_config[centreline]
    df = get_indicators(df, [config['indicator']], {config['indicator']: config['params']})
    mean_line = df[config['mean_col']]

    price_std = df['Close'].rolling(window=stdev_lookback).std()
    zscore = (df['Close'] - mean_line) / price_std

    result = {
        'StDev':         price_std,
        'StdDev_ZScore': zscore,
    }
    if show_centreline:
        result['StDev_Mean'] = mean_line

    return result


def calculate_indicator(df, **params):
    return calculate_stdev_bands(df, **params)
