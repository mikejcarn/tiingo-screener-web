# ind_conf_0

indicators = {  # List of available indicator configurations

    'Example_list': [
        # 'aVWAP',
        # 'candle_colors',
        # 'StDev',
        # 'SMA',
        # 'gaps',
        # 'FVG',
        # 'BoS_CHoCH',
        # 'QQEMOD',
        # 'banker_RSI',
        # 'liquidity',
        # 'OB',
        # 'RSI',
        # 'WAE',
        # 'supertrend',
        # 'TTM_squeeze',
        # 'divergence_Vortex', 
        # 'divergence_Fisher', 
        # 'divergence_OBV'
    ],

    'weekly': [
        # 'aVWAP',
        # 'candle_colors',
        # 'SMA',
        # 'liquidity',
    ],

    'daily': [
        'aVWAP',
        'candle_colors',
        # 'SMA',
        # 'supertrend',
        # 'BoS_CHoCH',
        # 'FVG',
        # 'OB',
        # 'liquidity',
    ],

    '1hour': [
        'aVWAP',
        'candle_colors',
        # 'aVWAP_pinch',
        # 'SMA',
        # 'liquidity',
    ],

    '4hour': [
        # 'aVWAP',
        # 'candle_colors',
        # 'SMA',
        # 'liquidity',
    ],

    '30min': [
        'aVWAP',
        'candle_colors',
        'aVWAP_anchor_score',
        # 'SMA',
        # 'liquidity',
    ],

    '15min': [
        # 'aVWAP',
        # 'candle_colors',
        # 'SMA',
        # 'liquidity',
    ],

    '5min': [
        # 'aVWAP',
        # 'candle_colors',
        # 'SMA',
        # 'liquidity',
    ]
}

params = {

        'weekly': {
            'candle_colors': {
                'indicator_color': 'StDev',
                'custom_params': {
                    'StDev': {
                        'std_lookback': 20, 'avg_lookback': 20,
                        'centreline': 'peaks_valleys_avg',
                        'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': 20}
                    },
                    'QQEMOD': {
                        'rsi_period': 8, 'rsi_period2': 8, 'sf': 6, 'sf2': 6,
                        'qqe_factor': 3.5, 'qqe_factor2': 2.0, 'threshold': 4,
                        'bb_length': 60, 'bb_multi': 0.4
                    },
                }
            },
            'aVWAP': {
                'peaks_valleys': True,
                'peaks_valleys_avg': False,
                'peaks_avg': False,
                'valleys_avg': False,
                'peaks_valleys_params': {'periods': 8, 'max_aVWAPs': 1},
                'OB': False,
                'OB_avg': False,
                'OB_params': {
                              'periods': 8,
                              'max_aVWAPs': None,
                              'include_bullish': True,
                              'include_bearish': True
                             },
                'gaps': False,
                'gaps_avg': False,
                'gaps_params': {'max_aVWAPs': 8},
                'All_avg': False,
                'avg_lookback': 10,
                'aVWAP_channel': False,
            },
            'OB': {'periods': 8},
            'FVG': {
                'max_mitigated': 10, 
                'max_unmitigated': 10, 
                'join_consecutive': False
            },
            'RSI': {'periods': 14},
            'BoS_CHoCH': {'swing_length': 8},
            'StDev': {
                'centreline': 'peaks_valleys_avg',
                'peaks_valleys_params': {'periods': 8, 'max_aVWAPs': None},
                'std_lookback': 4, 'avg_lookback': 4
            },
            'QQEMOD': {
                'rsi_period': 8, 'rsi_period2': 8, 'sf': 6, 'sf2': 6,
                'qqe_factor': 3.5, 'qqe_factor2': 2.0, 'threshold': 4,
                'bb_length': 50, 'bb_multi': 0.4
            },
            'SMA': {'periods': [200, 100, 50, 20]},
            'WAE': {
                'fast_period': 20, 'slow_period': 40, 
                'atr_period': 20, 'explosion_multiplier': 2.0
            },
            'liquidity': {'swing_length': 4, 'range_percent': 0.1},
            'supertrend': {'periods': 20, 'multiplier': 3},
            'TTM_squeeze': {
                'bb_length': 20, 'bb_std_dev': 2.0,
                'kc_length': 20, 'kc_mult': 2.0, 'use_true_range': True
            },
            'divergence_OBV':    {'period': 26, 'lookback': 26},
            'divergence_Volume': {'period': 26, 'lookback': 26},
            'divergence_Fisher': {'period': 26, 'lookback': 26},
            'divergence_Vortex': {'period': 26, 'lookback': 26}
        },

        'daily': {
            'aVWAP': {
                'peaks': False,
                'valleys': False,
                'peaks_avg': False,
                'valleys_avg': False,
                'peaks_valleys': False,
                'peaks_valleys_avg': False,
                'price_maxima_minima': False,
                'QQEMOD': False,
                'QQEMOD_avg': False,
                'OB': False,
                'OB_avg': False,
                'gaps': False,
                'gaps_avg': False,
                'BoS_CHoCH': True,
                'BoS_CHoCH_avg': False,
                'All_avg': False,
                'aVWAP_channel': False,
                'peaks_params': [
                    { 'periods': 20, 'max_aVWAPs': 3, 'avg_lookback': 20, },
                    { 'periods': 100, 'max_aVWAPs': 1, 'avg_lookback': 20, },
                ],
                'valleys_params': [
                    { 'periods': 20, 'max_aVWAPs': 3, 'avg_lookback': 20, },
                    { 'periods': 100, 'max_aVWAPs': 1, 'avg_lookback': 20, },
                ],
                'peaks_valleys_params': [
                    { 'periods': 20, 'max_aVWAPs': None, 'avg_lookback': 20, },
                ],
                'QQEMOD_params': {
                    'peak_to_valley':   False,   # solid red:    peak anchor → next teal candle
                    'valley_to_peak':   False,   # solid teal:   valley anchor → next red candle
                    'peak_to_peak':     True,    # dotted red:   peak anchor → next peak anchor
                    'valley_to_valley': False,    # dotted teal:  valley anchor → next valley anchor
                    'max_anchors':      5,       # keep N most recent bear + N most recent bull anchors
                    'extend_to_end':    False,   # run each aVWAP to the last bar
                    'qqe_params': {
                        'rsi_period': 6, 'rsi_period2': 5, 'sf': 5, 'sf2': 5,
                        'qqe_factor': 3.0, 'qqe_factor2': 1.61, 'threshold': 3,
                        'bb_length': 50, 'bb_multi': 0.35
                    }
                },
                'price_maxima_minima_params': {
                    'valleys': True,
                    'peaks': True,
                    'max_anchors': 1,
                    'min_swing_spacing': 1,
                },
                'BoS_CHoCH_params': [
                    {
                        'swing_length':     15,  # fallback for both when specific keys absent
                        'BoS_swing_length':   20, # shorter = more frequent BoS signals
                        'CHoCH_swing_length': 20, # longer  = only significant structure shifts
                        'mode': 'both',
                        'include_BoS':   True,
                        'include_CHoCH': True,
                        'max_BoS_aVWAPs':   3,
                        'max_CHoCH_aVWAPs': 3,
                        'avg_lookback': 7,
                    },
                ],
                'OB_params': [
                    {
                        'mode': 'combined',       # 'combined'/'bullish'/'bearish'/'none'
                        'periods': 5,            # swing lookback for OB detection
                        'max_aVWAPs': None,       # cap on aVWAPs per side (None = no cap)
                        'max_mitigated_aVWAPs': None,    # keep last N mitigated OB aVWAPs (None = no cap)
                        'max_unmitigated_aVWAPs': 3,  # keep last N unmitigated OB aVWAPs (None = no cap)
                        'extend_to_end': True,    # extend mitigated aVWAPs to current bar
                        'faded': True,            # render the post-mitigation extension at low opacity
                        'show_OB': False,               # also render horizontal OB boxes
                        'OB_max_mitigated': None, # cap OB boxes independently (None = no cap)
                        'OB_max_unmitigated': 1,
                        'OB_max_per_side': True,  # True = cap applies per bull/bear side; False = combined pool
                    },
                ],
                'gaps_params': [ {'max_aVWAPs': 5, 'avg_lookback': 8}, ],
            },
            'aVWAP_pinch': {
                'anchor_type': 'peak',
                'anchor_periods': 200,
                'anchor_max_aVWAPs': 1,
                'counterpart_periods': 100,
                'counterpart_max_aVWAPs': 1,
                'beyond_max_aVWAPs': 0,
            },
            'aVWAP_anchor_score': {
                'valleys': True,
                'peaks': False,
                'max_anchors': None,
                'min_score_pct': 0.5,
                'min_swing_spacing': 50,
                'isolation_max_bars': 300,
                'atr_period': 14,
                'sharpness_bars_before': 5,
                'sharpness_bars_after': 5,
                'w_prominence': 1.5,
                'w_isolation': 1.0,
                'w_sharpness': 0.5,
                'keep_scores': False,
            },
            'liquidity': {
                'swing_length': 10,
                'range_percent': 0.1,
                'max_swept': 0,
                'max_unswept': None,
                'extend_lines': True,
            },
            'candle_colors': {
                'indicator_color': 'QQEMOD',
                'custom_params': {
                    'StDev': {
                        'std_lookback': 20, 'avg_lookback': 20,
                        'centreline': 'peaks_valleys_avg',
                        'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None}
                    },
                    'QQEMOD': {
                        'rsi_period': 6, 'rsi_period2': 5, 'sf': 5, 'sf2': 5,
                        'qqe_factor': 3.0, 'qqe_factor2': 1.61, 'threshold': 3,
                        'bb_length': 50, 'bb_multi': 0.35
                    },
                    'banker_RSI': {
                        'rsi_period': 50, 'rsi_base': 50, 'sensitivity': 1.5
                    },
                    'WAE': {
                        'fast_period': 20, 'slow_period': 40, 
                        'atr_period': 20, 'explosion_multiplier': 2.0
                    },
                }
            },
            'OB': {
                'periods': 10,
                'max_mitigated': 1,
                'max_unmitigated': 1,
            },
            'FVG': {
                'max_mitigated': 10,
                'max_unmitigated': 10,
                'join_consecutive': False,
            },
            'BoS_CHoCH': {
                'BoS_swing_lengths':   [10],  # shorter lookback → more frequent BoS signals
                'CHoCH_swing_lengths': [10],  # longer lookback  → only major structure shifts
                'show_bos':   True,
                'show_choch': True,
            },
            'QQEMOD': {
                'rsi_period': 6, 'rsi_period2': 5, 'sf': 5, 'sf2': 5,
                'qqe_factor': 3.0, 'qqe_factor2': 1.61, 'threshold': 3,
                'bb_length': 50, 'bb_multi': 0.35
            },
            'SMA': {'periods': [50, 200]},
            'supertrend': {'periods': 20, 'multiplier': 3},
            'liquidity': {
                'swing_length': 10,
                'range_percent': 0.1,
                'max_swept': 0,
                'max_unswept': None,
                'extend_lines': True,
            },
            'TTM_squeeze': {
                'bb_length': 18, 'bb_std_dev': 1.9,
                'kc_length': 18, 'kc_mult': 1.7, 'use_true_range': True
            },
        },

        # '4hour': {
        #     'candle_colors': {
        #         'indicator_color': 'StDev',
        #         'custom_params': {
        #             'StDev': {
        #                 'centreline': 'peaks_valleys_avg',
        #                 'peaks_valleys_params': {'periods': 16, 'max_aVWAPs': None},
        #                 'std_lookback': 16, 'avg_lookback': 16
        #             },
        #             'QQEMOD': {
        #                 'rsi_period': 5, 'rsi_period2': 5, 'sf': 5, 'sf2': 4,
        #                 'qqe_factor': 2.5, 'qqe_factor2': 1.3, 'threshold': 2,
        #                 'bb_length': 40, 'bb_multi': 0.3
        #             }
        #         }
        #     },
        #     'aVWAP': {
        #         'peaks_valleys': True,
        #         'peaks_valleys_avg': False,
        #         'peaks_avg': False,
        #         'valleys_avg': False,
        #         'peaks_valleys_params': {'periods': 30, 'max_aVWAPs': 1},
        #         'OB': False,
        #         'OB_avg': False,
        #         'OB_params': {
        #                       'periods': 30, 
        #                       'max_aVWAPs': None,
        #                       'include_bullish': True,
        #                       'include_bearish': True
        #                      },
        #         'gaps': False,
        #         'gaps_avg': False,
        #         'gaps_params': {'max_aVWAPs': 10},
        #         'All_avg': False,
        #         'avg_lookback': 20,
        #         'aVWAP_channel': False,
        #     },
        #     'OB': {'periods': 30},
        #     'FVG': {
        #         'max_mitigated': 10, 
        #         'max_unmitigated': 10, 
        #         'join_consecutive': False
        #     },
        #     'RSI': {'periods': 14},
        #     'BoS_CHoCH': {'swing_length': 25},
        #     'StDev': {
        #         'centreline': 'peaks_valleys_avg',
        #         'peaks_valleys_params': {'periods': 16, 'max_aVWAPs': None},
        #         'std_lookback': 16, 'avg_lookback': 16
        #     },
        #     'QQEMOD': {
        #         'rsi_period': 5, 'rsi_period2': 5, 'sf': 5, 'sf2': 4,
        #         'qqe_factor': 2.5, 'qqe_factor2': 1.3, 'threshold': 2,
        #         'bb_length': 40, 'bb_multi': 0.3
        #     },
        #     'SMA': {'periods': [200, 100, 50, 20]},
        #     'WAE': {
        #         'fast_period': 20, 'slow_period': 40, 
        #         'atr_period': 20, 'explosion_multiplier': 2.0
        #     },
        #     'liquidity': {'swing_length': 64, 'range_percent': 0.1},
        #     'supertrend': {'periods': 12, 'multiplier': 2.5},
        #     'TTM_squeeze': {
        #         'bb_length': 14, 'bb_std_dev': 1.8,
        #         'kc_length': 14, 'kc_mult': 1.3, 'use_true_range': True
        #     },
        #     'divergence_OBV':    {'period': 128, 'lookback': 64},
        #     'divergence_Volume': {'period': 128, 'lookback': 64},
        #     'divergence_Fisher': {'period': 128, 'lookback': 64},
        #     'divergence_Vortex': {'period': 128, 'lookback': 64}
        # },


        '1hour': {
            'candle_colors': {
                'indicator_color': 'QQEMOD',
                'custom_params': {
                    'StDev': {
                        'std_lookback': 20, 'avg_lookback': 20,
                        'centreline': 'peaks_valleys_avg',
                        'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None}
                    },
                    'QQEMOD': {
                        'rsi_period': 6, 'rsi_period2': 5, 'sf': 5, 'sf2': 5,
                        'qqe_factor': 3.0, 'qqe_factor2': 1.61, 'threshold': 3,
                        'bb_length': 50, 'bb_multi': 0.35
                    },
                }
            },
            'aVWAP': {
                'peaks': False,
                'valleys': False,
                'peaks_avg': False,
                'valleys_avg': False,
                'peaks_valleys': False,
                'peaks_valleys_avg': False,
                'QQEMOD': True,
                'QQEMOD_avg': False,
                'OB': False,
                'OB_avg': False,
                'gaps': False,
                'gaps_avg': False,
                'BoS_CHoCH': False,
                'BoS_CHoCH_avg': False,
                'All_avg': False,
                'aVWAP_channel': False,
                'peaks_params': [
                    {
                        'periods': 200,
                        'max_aVWAPs': 1,
                        'avg_lookback': 50,
                    },
                ],
                'valleys_params': [
                    {
                        'periods': 150,
                        'max_aVWAPs': 5,
                        'avg_lookback': 50,
                    },
                ],
                'peaks_valleys_params': [
                    {
                        'periods': 10,
                        'max_aVWAPs': None,
                        'avg_lookback': 50,
                    },
                ],
                'QQEMOD_params': {
                    'peak_to_valley':   False,  # solid red:    peak anchor → next teal candle
                    'valley_to_peak':   False,   # solid teal:   valley anchor → next red candle
                    'peak_to_peak':     False,  # dotted red:   peak anchor → next peak anchor
                    'valley_to_valley': True,   # dotted teal:  valley anchor → next valley anchor
                    'max_aVWAPs': None,
                    'qqe_params': {
                        'rsi_period': 6, 'rsi_period2': 5, 'sf': 5, 'sf2': 5,
                        'qqe_factor': 3.0, 'qqe_factor2': 1.61, 'threshold': 3,
                        'bb_length': 50, 'bb_multi': 0.35
                    }
                },
                'OB_params': [
                    {
                        'mode': 'combined',       # 'combined'/'bullish'/'bearish'/'none'
                        'periods': 50,            # swing lookback for OB detection
                        'max_aVWAPs': None,       # cap on aVWAPs per side (None = no cap)
                    },
                ],
                'gaps_params': [ {'max_aVWAPs': 5, 'avg_lookback': 8}, ],
                'BoS_CHoCH_params': [ {'swing_length': 15, 'max_aVWAPs': 4, 'avg_lookback': 7}, ],
            },
            'aVWAP_pinch': {
                'anchor_type': 'peak',
                'anchor_periods': 200,
                'anchor_max_aVWAPs': 1,
                'counterpart_periods': 25,
                'counterpart_max_aVWAPs': 5,
                'beyond_max_aVWAPs': 5,
            },
            'OB': {'periods': 20},
            'FVG': {
                'max_mitigated': 10,
                'max_unmitigated': 10,
                'join_consecutive': False
            },
            'RSI': {'periods': 14},
            'BoS_CHoCH': {'swing_length': 10},
            'StDev': {
                'centreline': 'peaks_valleys_avg',
                'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None},
                'std_lookback': 20, 'avg_lookback': 20
            },
            'QQEMOD': {
                'rsi_period': 6, 'rsi_period2': 5, 'sf': 5, 'sf2': 5,
                'qqe_factor': 3.0, 'qqe_factor2': 1.61, 'threshold': 3,
                'bb_length': 50, 'bb_multi': 0.35
            },
            'SMA': {'periods': [50]},
            'WAE': {
                'fast_period': 20, 'slow_period': 40, 
                'atr_period': 20, 'explosion_multiplier': 2.0
            },
            'liquidity': {'swing_length': 20, 'range_percent': 0.1},
            'POC': {'num_levels': 4, 'lookback_bars': None},
            'supertrend': {'periods': 14, 'multiplier': 3},
            'TTM_squeeze': {
                'bb_length': 18, 'bb_std_dev': 1.9,
                'kc_length': 18, 'kc_mult': 1.7, 'use_true_range': True
            },
            'divergence_OBV': {'period': 50, 'lookback': 50},
            'divergence_Volume': {'period': 50, 'lookback': 50},
            'divergence_Fisher': {'period': 50, 'lookback': 50},
            'divergence_Vortex': {'period': 50, 'lookback': 50},
        },


        '30min': {
            'candle_colors': {
                'indicator_color': 'QQEMOD',
                'custom_params': {
                    'StDev': {
                        'centreline': 'peaks_valleys_avg',
                        'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None},
                        'std_lookback': 20, 'avg_lookback': 20
                    },
                    'QQEMOD': {
                        'rsi_period': 4, 'rsi_period2': 4, 'sf': 3, 'sf2': 3,
                        'qqe_factor': 2.0, 'qqe_factor2': 1.0, 'threshold': 1.5,
                        'bb_length': 30, 'bb_multi': 0.25
                    }
                }
            },
            'aVWAP': {
                'peaks': False,
                'valleys': True,
                'peaks_avg': False,
                'valleys_avg': False,
                'peaks_valleys': False,
                'peaks_valleys_avg': False,
                'QQEMOD': True,
                'QQEMOD_avg': False,
                'OB': False,
                'OB_avg': False,
                'gaps': False,
                'gaps_avg': False,
                'BoS_CHoCH': False,
                'BoS_CHoCH_avg': False,
                'All_avg': False,
                'aVWAP_channel': False,
                'peaks_params': [ 
                    { 'periods': 1, 'max_aVWAPs': None, 'avg_lookback': 100, }, 
                ],
                'valleys_params': [ 
                    { 'periods': 1, 'max_aVWAPs': None, 'avg_lookback': 100, }, 
                ],
                'peaks_valleys_params': [ 
                    { 'periods': 20, 'max_aVWAPs': None, 'avg_lookback': 20, }, 
                ],
                'QQEMOD_params': {
                    'peak_to_valley':   False,  # solid red:    peak anchor → next teal candle
                    'valley_to_peak':   False,  # solid teal:   valley anchor → next red candle
                    'peak_to_peak':     True,   # dotted red:   peak anchor → next peak anchor
                    'valley_to_valley': False,  # dotted teal:  valley anchor → next valley anchor
                    'max_anchors':      5,      # keep N most recent bear + N most recent bull anchors
                    'extend_to_end':    True,   # run each aVWAP to the last bar
                    'qqe_params': {
                        'rsi_period': 6, 'rsi_period2': 5, 'sf': 5, 'sf2': 5,
                        'qqe_factor': 3.0, 'qqe_factor2': 1.61, 'threshold': 3,
                        'bb_length': 50, 'bb_multi': 0.35
                    }
                },
                'OB_params': [
                    {
                        'mode': 'none',           # 'combined'/'bullish'/'bearish'/'none'
                        'periods': 20,            # swing lookback for OB detection
                        'max_aVWAPs': None,       # cap on aVWAPs per side (None = no cap)
                    },
                ],
                'gaps_params': [ {'max_aVWAPs': 5, 'avg_lookback': 8}, ],
                'BoS_CHoCH_params': [ {'swing_length': 15, 'max_aVWAPs': 4, 'avg_lookback': 7}, ],
            },
            'aVWAP_anchor_score': {
                'valleys': True,
                'peaks': False,
                'max_anchors': 5,
                'min_score_pct': 0.5,
                'min_swing_spacing': 10,
                'isolation_max_bars': 600,
                'atr_period': 14,
                'sharpness_bars_before': 5,
                'sharpness_bars_after': 5,
                'w_prominence': 1.0,
                'w_isolation': 3.0,
                'w_sharpness': 0.3,
                'keep_scores': False,
            },
            'OB': {'periods': 20},
            'FVG': {
                'max_mitigated': 10, 
                'max_unmitigated': 10, 
                'join_consecutive': False
            },
            'RSI': {'periods': 14},
            'BoS_CHoCH': {'swing_length': 25},
            'StDev': {
                'centreline': 'peaks_valleys_avg',
                'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None},
                'std_lookback': 20, 'avg_lookback': 20
            },
            'QQEMOD': {
                'rsi_period': 4, 'rsi_period2': 4, 'sf': 3, 'sf2': 3,
                'qqe_factor': 2.0, 'qqe_factor2': 1.0, 'threshold': 1.5,
                'bb_length': 30, 'bb_multi': 0.25
            },
            'SMA': {'periods': [200, 100, 50, 20]},
            'WAE': {
                'fast_period': 20, 'slow_period': 40, 
                'atr_period': 20, 'explosion_multiplier': 2.0
            },
            'liquidity': {'swing_length': 40, 'range_percent': 0.1},
            'supertrend': {'periods': 10, 'multiplier': 2.5},
            'TTM_squeeze': {
                'bb_length': 12, 'bb_std_dev': 1.6,
                'kc_length': 12, 'kc_mult': 1.2, 'use_true_range': True
            },
            'divergence_OBV':    {'period': 128, 'lookback': 80},
            'divergence_Volume': {'period': 128, 'lookback': 80},
            'divergence_Fisher': {'period': 128, 'lookback': 80},
            'divergence_Vortex': {'period': 128, 'lookback': 80}
        },

        '15min': {
            'candle_colors': {
                'indicator_color': 'StDev',
                'custom_params': {
                    'StDev': {
                        'centreline': 'peaks_valleys_avg',
                        'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None},
                        'std_lookback': 20, 'avg_lookback': 20
                    },
                    'QQEMOD': {
                        'rsi_period': 4, 'rsi_period2': 4, 'sf': 3, 'sf2': 3,
                        'qqe_factor': 2.0, 'qqe_factor2': 1.0, 'threshold': 1.5,
                        'bb_length': 30, 'bb_multi': 0.25
                    }
                }
            },
            'aVWAP': {
                'peaks_valleys': False,
                'peaks_valleys_avg': False,
                'peaks_avg': False,
                'valleys_avg': False,
                'peaks_valleys_params': {'periods': 30, 'max_aVWAPs': 1},
                'OB': True,
                'OB_avg': False,
                'OB_params': [
                    {
                        'mode': 'combined',       # 'combined'/'bullish'/'bearish'/'none'
                        'periods': 20,            # swing lookback for OB detection
                        'max_aVWAPs': None,       # cap on aVWAPs per side (None = no cap)
                    },
                ],
                'gaps': False,
                'gaps_avg': False,
                'gaps_params': {'max_aVWAPs': 20},
                'All_avg': False,
                'avg_lookback': 20,
                'aVWAP_channel': False,
            },
            'OB': {'periods': 20},
            'FVG': {
                'max_mitigated': 10, 
                'max_unmitigated': 10, 
                'join_consecutive': False
            },
            'RSI': {'periods': 14},
            'BoS_CHoCH': {'swing_length': 25},
            'StDev': {
                'centreline': 'peaks_valleys_avg',
                'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None},
                'std_lookback': 20, 'avg_lookback': 20
            },
            'QQEMOD': {
                'rsi_period': 4, 'rsi_period2': 4, 'sf': 3, 'sf2': 3,
                'qqe_factor': 2.0, 'qqe_factor2': 1.0, 'threshold': 1.5,
                'bb_length': 30, 'bb_multi': 0.25
            },
            'SMA': {'periods': [200, 100, 50, 20]},
            'WAE': {
                'fast_period': 20, 'slow_period': 40, 
                'atr_period': 20, 'explosion_multiplier': 2.0
            },
            'liquidity': {'swing_length': 40, 'range_percent': 0.1},
            'supertrend': {'periods': 10, 'multiplier': 2.5},
            'TTM_squeeze': {
                'bb_length': 12, 'bb_std_dev': 1.6,
                'kc_length': 12, 'kc_mult': 1.2, 'use_true_range': True
            },
            'divergence_OBV':    {'period': 128, 'lookback': 80},
            'divergence_Volume': {'period': 128, 'lookback': 80},
            'divergence_Fisher': {'period': 128, 'lookback': 80},
            'divergence_Vortex': {'period': 128, 'lookback': 80}
        },

        '5min': {
            'candle_colors': {
                'indicator_color': 'StDev',
                'custom_params': {
                    'StDev': {
                        'centreline': 'peaks_valleys_avg',
                        'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None},
                        'std_lookback': 20, 'avg_lookback': 20
                    },
                    'QQEMOD': {
                        'rsi_period': 4, 'rsi_period2': 4, 'sf': 3, 'sf2': 3,
                        'qqe_factor': 2.0, 'qqe_factor2': 1.0, 'threshold': 1.5,
                        'bb_length': 30, 'bb_multi': 0.25
                    }
                }
            },
            'aVWAP': {
                'peaks_valleys': True,
                'peaks_valleys_avg': False,
                'peaks_avg': False,
                'valleys_avg': False,
                'peaks_valleys_params': {'periods': 30, 'max_aVWAPs': 1},
                'OB': False,
                'OB_avg': False,
                'OB_params': [
                    {
                        'mode': 'combined',       # 'combined'/'bullish'/'bearish'/'none'
                        'periods': 10,            # swing lookback for OB detection
                        'max_aVWAPs': None,       # cap on aVWAPs per side (None = no cap)
                    },
                ],
                'gaps': False,
                'gaps_avg': False,
                'gaps_params': {'max_aVWAPs': 20},
                'All_avg': False,
                'avg_lookback': 20,
                'aVWAP_channel': False,
            },
            'OB': {'periods': 30},
            'FVG': {
                'max_mitigated': 10, 
                'max_unmitigated': 10, 
                'join_consecutive': False
            },
            'RSI': {'periods': 14},
            'BoS_CHoCH': {'swing_length': 25},
            'StDev': {
                'centreline': 'peaks_valleys_avg',
                'peaks_valleys_params': {'periods': 20, 'max_aVWAPs': None},
                'std_lookback': 20, 'avg_lookback': 20
            },
            'QQEMOD': {
                'rsi_period': 4, 'rsi_period2': 4, 'sf': 3, 'sf2': 3,
                'qqe_factor': 2.0, 'qqe_factor2': 1.0, 'threshold': 1.5,
                'bb_length': 30, 'bb_multi': 0.25
            },
            'SMA': {'periods': [200, 100, 50, 20]},
            'WAE': {
                'fast_period': 20, 'slow_period': 40, 
                'atr_period': 20, 'explosion_multiplier': 2.0
            },
            'liquidity': {'swing_length': 40, 'range_percent': 0.1},
            'supertrend': {'periods': 10, 'multiplier': 2.5},
            'TTM_squeeze': {
                'bb_length': 12, 'bb_std_dev': 1.6,
                'kc_length': 12, 'kc_mult': 1.2, 'use_true_range': True
            },
            'divergence_OBV':    {'period': 128, 'lookback': 80},
            'divergence_Volume': {'period': 128, 'lookback': 80},
            'divergence_Fisher': {'period': 128, 'lookback': 80},
            'divergence_Vortex': {'period': 128, 'lookback': 80}
        }
}
