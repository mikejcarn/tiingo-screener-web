import pandas as pd
import numpy as np
from backend.indicators.indicators import get_indicators

defaults = {
    'QQEMOD': True,
    'QQEMOD_params': {
        'max_anchors': 5,
        'extend_to_end': True,
    },
}


def calculate_avwap_channel(
    df,
    # Individual flags for peaks and valleys
    peaks=False,              # Show peak-based aVWAPs
    valleys=False,            # Show valley-based aVWAPs
    # Keep original for backward compatibility
    peaks_valleys=False,      # Show both (legacy)
 
    # Average flags
    peaks_valleys_avg=False,
    peaks_avg=False,
    valleys_avg=False,
 
    # Other types
    gaps=False,
    OB=False,
    BoS_CHoCH=False,
    QQEMOD=False,
    price_maxima_minima=False,

    gaps_avg=False,
    OB_avg=False,
    BoS_CHoCH_avg=False,
    QQEMOD_avg=False,
    All_avg=False,

    # Parameters for each type - ALL CAN BE LISTS
    peaks_params=None,           # Configs for peaks only (can be list)
    valleys_params=None,         # Configs for valleys only (can be list)
    peaks_valleys_params=None,   # Configs for combined peaks+valleys (can be list)
    gaps_params=None,
    OB_params=None,
    BoS_CHoCH_params=None,
    QQEMOD_params=None,
    price_maxima_minima_params=None,

    avg_lookback=25,
    aVWAP_channel=False
):
    """
    Calculate anchored VWAP channels from market structure points.
 
    DISPLAY FLAGS:
    - peaks: If True, show peak-based aVWAPs (uses peaks_params)
    - valleys: If True, show valley-based aVWAPs (uses valleys_params)
    - peaks_valleys: Legacy flag - shows both (if True, uses peaks_valleys_params)
 
    PARAMETERS - ALL CAN BE LISTS FOR MULTIPLE CONFIGS:
    - peaks_params: List of config dicts for peak-based aVWAPs
    - valleys_params: List of config dicts for valley-based aVWAPs
    - peaks_valleys_params: List of config dicts for combined peaks+valleys
    - gaps_params: List of config dicts for gap aVWAPs
    - OB_params: List of config dicts for OB aVWAPs
    - BoS_CHoCH_params: List of config dicts for BoS/CHoCH aVWAPs
 
    Each config dict can include:
        - 'periods': int (default 25) - lookback period for detection
        - 'max_aVWAPs': int or None (default None) - maximum number of aVWAPs to keep
        - 'mode': str (default 'combined') - for OB:
            'bullish', 'valleys', 'bull' - bullish/valley OB only
            'bearish', 'peaks', 'bear'   - bearish/peak OB only
            'combined', 'both', 'all'     - both types (default)
            'none', 'off', 'false'        - no OB aVWAPs from this config
        - 'avg_lookback': int (optional) - lookback for averages
    """
 
    # -------------------------
    # Helpers
    # -------------------------
    def ensure_config_list(param, default_dict):
        """Convert param to list of config dicts"""
        if param is None:
            return []  # Return empty list if None
        if isinstance(param, list):
            return param
        return [param]

    def get_lookback(param_dict, key, default):
        if param_dict and key in param_dict:
            return param_dict[key]
        return default

    def add_qqemod_per_config(df_in: pd.DataFrame, qqemod_configs: list) -> pd.DataFrame:
        """For each QQEMOD config, compute QQEMOD signal columns and attach as {col}_c{i}."""
        out = df_in.copy()
        base_cols = ['Open', 'High', 'Low', 'Close', 'Volume', 'date']
        available_cols = [c for c in base_cols if c in df_in.columns]
        base_df = df_in[available_cols].copy()
        for i, cfg in enumerate(qqemod_configs):
            qqe_p = cfg.get('qqe_params', {})
            tmp = get_indicators(base_df.copy(), ['QQEMOD'], {'QQEMOD': qqe_p})
            for col in ['QQE1_Above_Upper', 'QQE1_Below_Lower',
                        'QQE2_Above_Threshold', 'QQE2_Below_Threshold', 'QQE2_Above_TL']:
                if col in tmp.columns:
                    out[f'{col}_c{i}'] = tmp[col]
        return out

    def add_ob_per_config(df_in: pd.DataFrame, ob_configs: list) -> pd.DataFrame:
        """For each OB config, compute OB columns and attach them as OB_c{i}, etc."""
        out = df_in.copy()

        # Strip to OHLCV so pre-existing OB/OB_High/etc. columns don't cause
        # duplicate columns when calculate_ob runs and pd.concat merges results.
        base_cols = ['open', 'high', 'low', 'close', 'volume', 'Open', 'High', 'Low', 'Close', 'Volume', 'date']
        clean_df = out[[c for c in base_cols if c in out.columns]].copy()

        for i, cfg in enumerate(ob_configs):
            periods = cfg.get('periods', 25)

            # Compute OB for this config on clean OHLCV only
            tmp = get_indicators(clean_df.copy(), ['OB'], {'OB': {'periods': periods}})

            # Attach config-specific columns if present
            if 'OB' in tmp.columns:
                out[f'OB_c{i}'] = tmp['OB']
            if 'OB_High' in tmp.columns:
                out[f'OB_High_c{i}'] = tmp['OB_High']
            if 'OB_Low' in tmp.columns:
                out[f'OB_Low_c{i}'] = tmp['OB_Low']
            if 'OB_Mitigated_Index' in tmp.columns:
                out[f'OB_Mitigated_Index_c{i}'] = tmp['OB_Mitigated_Index']

            # If show_OB, also expose as unsuffixed columns for _OB_visualization
            if cfg.get('show_OB', False):
                max_mit   = cfg.get('OB_max_mitigated',   None)
                max_unmit = cfg.get('OB_max_unmitigated', None)
                ob_filtered = tmp.copy()
                if max_mit is not None or max_unmit is not None:
                    per_side = cfg.get('OB_max_per_side', True)
                    def _cap_indices(indices):
                        mit_list, unmit_list = [], []
                        for idx in indices:
                            try:
                                mit_idx = int(ob_filtered.loc[idx, 'OB_Mitigated_Index'])
                            except (ValueError, TypeError):
                                mit_idx = 0
                            if 0 < mit_idx < len(ob_filtered):
                                mit_list.append(idx)
                            else:
                                unmit_list.append(idx)
                        kept = set()
                        kept.update(mit_list[:max_mit] if max_mit is not None else mit_list)
                        kept.update(unmit_list[:max_unmit] if max_unmit is not None else unmit_list)
                        return kept
                    if per_side:
                        show = (_cap_indices(ob_filtered[ob_filtered['OB'] == 1].index[::-1]) |
                                _cap_indices(ob_filtered[ob_filtered['OB'] == -1].index[::-1]))
                    else:
                        show = _cap_indices(ob_filtered[ob_filtered['OB'] != 0].index[::-1])
                    mask = ob_filtered.index.isin(show)
                    ob_filtered.loc[~mask, ['OB', 'OB_High', 'OB_Low', 'OB_Mitigated_Index']] = 0
                for src, dst in [('OB', 'OB'), ('OB_High', 'OB_High'),
                                  ('OB_Low', 'OB_Low'), ('OB_Mitigated_Index', 'OB_Mitigated_Index')]:
                    if src in ob_filtered.columns:
                        out[dst] = ob_filtered[src]

        return out

    # Extract config index from column name
    def _extract_cfg_idx(col_name):
        import re
        match = re.search(r'_c(\d+)_', col_name)
        return int(match.group(1)) if match else 0

    # -------------------------
    # Process ALL params as separate lists
    # -------------------------
    default_config = {'periods': 25, 'max_aVWAPs': None}
 
    # Convert all params to lists - KEEP THEM SEPARATE
    peaks_configs = ensure_config_list(peaks_params, default_config)
    valleys_configs = ensure_config_list(valleys_params, default_config)
    peaks_valleys_configs = ensure_config_list(peaks_valleys_params, default_config)
   
    # Other types
    gaps_configs = ensure_config_list(gaps_params, {'max_aVWAPs': None}) if (gaps or gaps_avg) else []
    
    # OB configs with mode parameter (default to 'combined' for backward compatibility)
    default_ob_config = {
        'periods': 25,
        'max_aVWAPs': None,
        'mode': 'combined'  # 'bullish', 'bearish', 'combined', 'none' (with synonyms)
    }
    OB_configs = ensure_config_list(OB_params, default_ob_config) if (OB or OB_avg) else []
    
    BoS_CHoCH_configs = ensure_config_list(BoS_CHoCH_params, {
        'swing_length': 25,
        'max_aVWAPs': None
    }) if BoS_CHoCH else []

    QQEMOD_configs = ensure_config_list(QQEMOD_params, {
        'mode': 'combined',
        'max_aVWAPs': None
    }) if (QQEMOD or QQEMOD_avg) else []

    price_maxima_minima_configs = ensure_config_list(price_maxima_minima_params, {
        'valleys': True,
        'peaks': False,
        'max_anchors': 5,
        'min_swing_spacing': 30,
    }) if price_maxima_minima else []

    # -------------------------
    # Determine what to display
    # -------------------------
    # Legacy peaks_valleys overrides individual flags
    if peaks_valleys:
        show_peaks = True
        show_valleys = True
        show_peaks_valleys = True
    else:
        show_peaks = peaks
        show_valleys = valleys
        show_peaks_valleys = False  # Separate flag for combined
 
    # Check if we need peaks/valleys for averages
    need_peaks_for_avg = peaks_avg and peaks_configs
    need_valleys_for_avg = valleys_avg and valleys_configs
    need_peaks_valleys_for_avg = peaks_valleys_avg and peaks_valleys_configs
    need_all_avg = All_avg
 
    # If nothing is requested, return empty
    if not (show_peaks or show_valleys or show_peaks_valleys or
            gaps or OB or BoS_CHoCH or QQEMOD or price_maxima_minima or
            need_peaks_for_avg or need_valleys_for_avg or
            need_peaks_valleys_for_avg or
            gaps_avg or OB_avg or BoS_CHoCH_avg or QQEMOD_avg or need_all_avg):
        return {}

    # -------------------------
    # Determine which anchors we need
    # -------------------------
    aVWAP_anchors = []
    if (show_peaks or show_valleys or show_peaks_valleys or
        need_peaks_for_avg or need_valleys_for_avg or 
        need_peaks_valleys_for_avg or need_all_avg):
        aVWAP_anchors.append('peaks_valleys')
    if gaps or gaps_avg or need_all_avg:
        aVWAP_anchors.append('gaps')
    if OB or OB_avg or need_all_avg:
        aVWAP_anchors.append('OB')
    if BoS_CHoCH or BoS_CHoCH_avg or need_all_avg:
        aVWAP_anchors.append('BoS_CHoCH')
    if QQEMOD or QQEMOD_avg or need_all_avg:
        aVWAP_anchors.append('QQEMOD')
    if price_maxima_minima:
        aVWAP_anchors.append('price_maxima_minima')

    if not aVWAP_anchors:
        return {}

    # -------------------------
    # Build params for get_indicators (EXCEPT OB)
    # -------------------------
    base_anchors = [a for a in aVWAP_anchors if a not in ('OB', 'price_maxima_minima', 'BoS_CHoCH')]

    params = {}
    if 'peaks_valleys' in base_anchors:
        # Use max periods from ALL configs (peaks, valleys, peaks_valleys)
        # This is for the base peaks/valleys indicator that other types might need
        all_periods = []
        if peaks_configs:
            all_periods.extend([cfg.get('periods', 25) for cfg in peaks_configs])
        if valleys_configs:
            all_periods.extend([cfg.get('periods', 25) for cfg in valleys_configs])
        if peaks_valleys_configs:
            all_periods.extend([cfg.get('periods', 25) for cfg in peaks_valleys_configs])
        max_periods = max(all_periods) if all_periods else 25
        params['peaks_valleys'] = {'periods': max_periods}
     
    if 'gaps' in base_anchors:
        params['gaps'] = {}

    # Compute base indicators (non-OB, non-BoS_CHoCH)
    if base_anchors:
        df = get_indicators(df, base_anchors, params)

    # Compute OB per config if requested
    if OB and OB_configs:
        df = add_ob_per_config(df, OB_configs)

    # Compute BoS_CHoCH for each unique swing length needed across all configs
    if BoS_CHoCH and BoS_CHoCH_configs:
        _bc_swings = set()
        for _cfg in BoS_CHoCH_configs:
            _sl = _cfg.get('swing_length', 25)
            _bc_swings.add(_cfg.get('BoS_swing_length',   _sl))
            _bc_swings.add(_cfg.get('CHoCH_swing_length', _sl))
        _bc_base  = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]
        _bc_clean = df[_bc_base].copy()
        for _sl in _bc_swings:
            if f'BoS_{_sl}' not in df.columns:
                _tmp = get_indicators(_bc_clean.copy(), ['BoS_CHoCH'], {'BoS_CHoCH': {'swing_length': _sl}})
                for _col in [f'BoS_{_sl}', f'CHoCH_{_sl}',
                             f'BoS_CHoCH_Price_{_sl}', f'BoS_CHoCH_Break_Index_{_sl}']:
                    if _col in _tmp.columns:
                        df[_col] = _tmp[_col]

    # Compute QQEMOD signals per config if requested
    if 'QQEMOD' in aVWAP_anchors and QQEMOD_configs:
        df = add_qqemod_per_config(df, QQEMOD_configs)

    # Standardize structure
    df = df.reset_index()
    df['date'] = pd.to_datetime(df['date'])

    # Initialize storage dictionaries
    all_individual_aVWAPs = {}
    peaks_only_aVWAPs = {}
    valleys_only_aVWAPs = {}
    peaks_valleys_aVWAPs = {}  # For combined
    gaps_aVWAPs = {}
    OB_aVWAPs = {}
    BoS_CHoCH_aVWAPs = {}
    QQEMOD_aVWAPs = {}

    # Track extreme points for channel calculation
    highest_peak_idx = None
    lowest_valley_idx = None

    # Precompute ATR for proximity filtering
    _close = df['Close'].values
    _high  = df['High'].values
    _low   = df['Low'].values
    _prev_close = pd.Series(_close).shift(1).values
    _tr = np.maximum(_high - _low,
                     np.maximum(np.abs(_high - _prev_close), np.abs(_low - _prev_close)))
    _atr_series = pd.Series(_tr).rolling(14).mean().values
    _current_close = float(_close[-1]) if not np.isnan(_close[-1]) else None
    _current_atr   = float(_atr_series[-1]) if not np.isnan(_atr_series[-1]) else None

    def process_anchors(indices, prefix, max_count=None):
        """Process anchors and return dictionary of aVWAP series"""
        if not indices:
            return {}
        sorted_indices = sorted(indices, reverse=True)
        if max_count is not None:
            sorted_indices = sorted_indices[:max_count]
        result = {}
        for i in sorted_indices:
            result[f'{prefix}_{i}'] = calculate_avwap(df, i)
        return result

    # =====================
    # Process PEAKS ONLY (using peaks_configs) - EACH WITH ITS OWN PERIODS
    # =====================
    if (show_peaks or peaks_avg) and peaks_configs:
        # Track unique peak indices to prevent duplicates across configs
        seen_peak_indices = set()
        
        for config_idx, config in enumerate(peaks_configs):
            periods = config.get('periods', 25)
            max_aVWAPs = config.get('max_aVWAPs', None)

            # Create a fresh DataFrame for this config
            base_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
            available_cols = [col for col in base_cols if col in df.columns]
            if 'date' in df.columns:
                available_cols.append('date')

            base_df = df[available_cols].copy() if available_cols else df.copy()

            # Calculate peaks/valleys for THIS SPECIFIC config
            temp_df = get_indicators(base_df, ['peaks_valleys'], {'peaks_valleys': {'periods': periods}})

            # Get peak indices for this config
            peaks_indices = temp_df[temp_df['Peaks'] == 1].index.tolist() if 'Peaks' in temp_df.columns else []

            # Filter out already seen indices (deduplication)
            peaks_indices = [i for i in peaks_indices if i not in seen_peak_indices]
            seen_peak_indices.update(peaks_indices)

            if aVWAP_channel and highest_peak_idx is not None:
                peaks_indices = [i for i in peaks_indices if i >= highest_peak_idx]

            # Calculate aVWAPs for this config
            config_peaks = process_anchors(peaks_indices, f'aVWAP_peak_c{config_idx}', max_aVWAPs)

            if peaks_avg:
                peaks_only_aVWAPs.update(config_peaks)

            if show_peaks:
                all_individual_aVWAPs.update(config_peaks)

    # =====================
    # Process VALLEYS ONLY (using valleys_configs) - EACH WITH ITS OWN PERIODS
    # =====================
    if (show_valleys or valleys_avg) and valleys_configs:
        # Track unique valley indices to prevent duplicates across configs
        seen_valley_indices = set()
        
        for config_idx, config in enumerate(valleys_configs):
            periods = config.get('periods', 25)
            max_aVWAPs = config.get('max_aVWAPs', None)

            # Create a fresh DataFrame for this config
            base_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
            available_cols = [col for col in base_cols if col in df.columns]
            if 'date' in df.columns:
                available_cols.append('date')

            base_df = df[available_cols].copy() if available_cols else df.copy()

            # Calculate peaks/valleys for THIS SPECIFIC config
            temp_df = get_indicators(base_df, ['peaks_valleys'], {'peaks_valleys': {'periods': periods}})

            # Get valley indices for this config
            valleys_indices = temp_df[temp_df['Valleys'] == 1].index.tolist() if 'Valleys' in temp_df.columns else []

            # Filter out already seen indices (deduplication)
            valleys_indices = [i for i in valleys_indices if i not in seen_valley_indices]
            seen_valley_indices.update(valleys_indices)

            if aVWAP_channel and lowest_valley_idx is not None:
                valleys_indices = [i for i in valleys_indices if i >= lowest_valley_idx]

            # Calculate aVWAPs for this config
            config_valleys = process_anchors(valleys_indices, f'aVWAP_valley_c{config_idx}', max_aVWAPs)

            if valleys_avg:
                valleys_only_aVWAPs.update(config_valleys)

            if show_valleys:
                all_individual_aVWAPs.update(config_valleys)

    # =====================
    # Process COMBINED PEAKS+VALLEYS (using peaks_valleys_configs) - EACH WITH ITS OWN PERIODS
    # =====================
    if (show_peaks_valleys or peaks_valleys_avg) and peaks_valleys_configs:
        # For combined, avoid duplicating what's already in individual (automatic deduplication)
        existing_peaks = set()
        existing_valleys = set()
        
        if show_peaks and peaks_configs:
            for key in all_individual_aVWAPs.keys():
                if 'aVWAP_peak_' in key:
                    try:
                        idx = int(key.split('_')[-1])
                        existing_peaks.add(idx)
                    except:
                        pass
        
        if show_valleys and valleys_configs:
            for key in all_individual_aVWAPs.keys():
                if 'aVWAP_valley_' in key:
                    try:
                        idx = int(key.split('_')[-1])
                        existing_valleys.add(idx)
                    except:
                        pass
        
        for config_idx, config in enumerate(peaks_valleys_configs):
            periods = config.get('periods', 25)
            max_aVWAPs = config.get('max_aVWAPs', None)

            # Create a completely fresh DataFrame for each config
            base_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
            available_cols = [col for col in base_cols if col in df.columns]
            if 'date' in df.columns:
                available_cols.append('date')

            base_df = df[available_cols].copy() if available_cols else df.copy()

            # Calculate peaks/valleys for THIS SPECIFIC config
            temp_df = get_indicators(base_df, ['peaks_valleys'], {'peaks_valleys': {'periods': periods}})

            # Get indices for this config
            peaks_indices = temp_df[temp_df['Peaks'] == 1].index.tolist() if 'Peaks' in temp_df.columns else []
            valleys_indices = temp_df[temp_df['Valleys'] == 1].index.tolist() if 'Valleys' in temp_df.columns else []

            # Remove duplicates with individual configs
            peaks_indices = [i for i in peaks_indices if i not in existing_peaks]
            valleys_indices = [i for i in valleys_indices if i not in existing_valleys]

            if aVWAP_channel:
                if highest_peak_idx is not None:
                    peaks_indices = [i for i in peaks_indices if i >= highest_peak_idx]
                if lowest_valley_idx is not None:
                    valleys_indices = [i for i in valleys_indices if i >= lowest_valley_idx]

            # Process peaks and valleys for this combined config
            config_peaks = process_anchors(peaks_indices, f'aVWAP_peak_c{len(peaks_configs)+config_idx}', max_aVWAPs)
            config_valleys = process_anchors(valleys_indices, f'aVWAP_valley_c{len(valleys_configs)+config_idx}', max_aVWAPs)

            # Store for combined averages
            if peaks_valleys_avg:
                combined = {**config_peaks, **config_valleys}
                peaks_valleys_aVWAPs.update(combined)

            if show_peaks_valleys:
                all_individual_aVWAPs.update(config_peaks)
                all_individual_aVWAPs.update(config_valleys)

    # =====================
    # Process GAPS - WITH DEDUP
    # =====================
    if 'gaps' in aVWAP_anchors:
        if 'Gap_Up' not in df.columns or 'Gap_Down' not in df.columns:
            prev_high = df['High'].shift(1)
            prev_low  = df['Low'].shift(1)
            df['Gap_Up']   = (df['Low']  > prev_high).astype(int)
            df['Gap_Down'] = (df['High'] < prev_low).astype(int)
        base_gap_up_indices = df[df['Gap_Up'] == 1].index.tolist()
        base_gap_down_indices = df[df['Gap_Down'] == 1].index.tolist()
       
        # Track unique gap indices to prevent duplicates across configs
        seen_gap_up_indices = set()
        seen_gap_down_indices = set()
      
        for config_idx, config in enumerate(gaps_configs):
            max_aVWAPs = config.get('max_aVWAPs', None)
           
            # Filter gap up indices
            gap_up_indices = [i for i in base_gap_up_indices if i not in seen_gap_up_indices]
            seen_gap_up_indices.update(gap_up_indices)
            config_gap_up = process_anchors(gap_up_indices, f'Gap_Up_aVWAP_c{config_idx}', max_aVWAPs)
           
            # Filter gap down indices
            gap_down_indices = [i for i in base_gap_down_indices if i not in seen_gap_down_indices]
            seen_gap_down_indices.update(gap_down_indices)
            config_gap_down = process_anchors(gap_down_indices, f'Gap_Down_aVWAP_c{config_idx}', max_aVWAPs)
          
            if gaps_avg:
                gaps_aVWAPs.update(config_gap_up)
                gaps_aVWAPs.update(config_gap_down)
          
            if gaps:
                all_individual_aVWAPs.update(config_gap_up)
                all_individual_aVWAPs.update(config_gap_down)

    # =====================
    # Process OB - WITH DEDUP - USING MODE PARAMETER (with synonyms)
    # =====================
    if 'OB' in aVWAP_anchors:
        # Track unique OB indices to prevent duplicates across configs
        seen_OB_bull_indices = set()
        seen_OB_bear_indices = set()
       
        for config_idx, config in enumerate(OB_configs):
            max_aVWAPs      = config.get('max_aVWAPs',      None)
            max_mitigated   = config.get('max_mitigated_aVWAPs',   None)
            max_unmitigated = config.get('max_unmitigated_aVWAPs', None)
            mode = config.get('mode', 'combined').lower()
            
            # Map synonyms to canonical values
            if mode in ['bullish', 'valleys', 'bull', 'valley']:
                canonical_mode = 'bullish'
            elif mode in ['bearish', 'peaks', 'bear', 'peak']:
                canonical_mode = 'bearish'
            elif mode in ['combined', 'both', 'all']:
                canonical_mode = 'combined'
            elif mode in ['none', 'off', 'false']:
                canonical_mode = 'none'
            else:
                canonical_mode = 'combined'  # Default
          
            OB_bull_indices = []
            OB_bear_indices = []
          
            ob_col = f'OB_c{config_idx}'
            if ob_col in df.columns:
                # Determine which signals to include based on canonical mode
                include_bullish = canonical_mode in ['bullish', 'combined']
                include_bearish = canonical_mode in ['bearish', 'combined']
                
                if aVWAP_channel:
                    if lowest_valley_idx is not None and include_bullish:
                        all_bull = df[(df[ob_col] == 1) & (df.index >= lowest_valley_idx)].index.tolist()
                        OB_bull_indices = [i for i in all_bull if i not in seen_OB_bull_indices]
                        seen_OB_bull_indices.update(OB_bull_indices)
                    if highest_peak_idx is not None and include_bearish:
                        all_bear = df[(df[ob_col] == -1) & (df.index >= highest_peak_idx)].index.tolist()
                        OB_bear_indices = [i for i in all_bear if i not in seen_OB_bear_indices]
                        seen_OB_bear_indices.update(OB_bear_indices)
                else:
                    if include_bullish:
                        all_bull = df[df[ob_col] == 1].index.tolist()
                        OB_bull_indices = [i for i in all_bull if i not in seen_OB_bull_indices]
                        seen_OB_bull_indices.update(OB_bull_indices)
                    if include_bearish:
                        all_bear = df[df[ob_col] == -1].index.tolist()
                        OB_bear_indices = [i for i in all_bear if i not in seen_OB_bear_indices]
                        seen_OB_bear_indices.update(OB_bear_indices)
          
            # Apply max_mitigated / max_unmitigated caps to each side independently
            mit_col_name = f'OB_Mitigated_Index_c{config_idx}'
            if max_mitigated is not None or max_unmitigated is not None:
                def _cap_ob_pool(indices):
                    sorted_desc = sorted(indices, reverse=True)
                    if mit_col_name not in df.columns:
                        return sorted_desc[:max_unmitigated] if max_unmitigated is not None else sorted_desc
                    mitigated, unmitigated = [], []
                    for idx in sorted_desc:
                        try:
                            mit_val = int(df.loc[idx, mit_col_name]) if idx in df.index else 0
                        except (ValueError, TypeError):
                            mit_val = 0
                        if 0 < mit_val < len(df):
                            mitigated.append(idx)
                        else:
                            unmitigated.append(idx)
                    show = []
                    show.extend(mitigated[:max_mitigated] if max_mitigated is not None else mitigated)
                    show.extend(unmitigated[:max_unmitigated] if max_unmitigated is not None else unmitigated)
                    return show
                OB_bull_indices = _cap_ob_pool(OB_bull_indices)
                OB_bear_indices = _cap_ob_pool(OB_bear_indices)

            config_OB_bull = process_anchors(OB_bull_indices, f'aVWAP_OB_bull_c{config_idx}', max_aVWAPs)
            config_OB_bear = process_anchors(OB_bear_indices, f'aVWAP_OB_bear_c{config_idx}', max_aVWAPs)

            # Handle mitigated OB aVWAPs: truncate and/or add faded ghost extension
            extend_to_end = config.get('extend_to_end', False)
            faded         = config.get('faded',         False)
            if mit_col_name in df.columns and (not extend_to_end or faded):
                for side_dict, ghost_prefix in (
                    (config_OB_bull, f'aVWAP_OB_bull_ghost_c{config_idx}'),
                    (config_OB_bear, f'aVWAP_OB_bear_ghost_c{config_idx}'),
                ):
                    ghost_additions = {}
                    for avwap_col in list(side_dict.keys()):
                        try:
                            anchor_bar = int(avwap_col.split('_')[-1])
                        except ValueError:
                            continue
                        if anchor_bar not in df.index:
                            continue
                        try:
                            mit_val = int(df.loc[anchor_bar, mit_col_name])
                        except (ValueError, TypeError):
                            mit_val = 0
                        if 0 < mit_val < len(df):
                            s = side_dict[avwap_col].copy()
                            if extend_to_end and faded:
                                ghost = s.copy()
                                ghost[ghost.index < mit_val] = float('nan')
                                ghost_additions[f'{ghost_prefix}_{anchor_bar}'] = ghost
                            s[s.index > mit_val] = float('nan')
                            side_dict[avwap_col] = s
                    side_dict.update(ghost_additions)

            if OB_avg:
                OB_aVWAPs.update(config_OB_bull)
                OB_aVWAPs.update(config_OB_bear)

            if OB:
                all_individual_aVWAPs.update(config_OB_bull)
                all_individual_aVWAPs.update(config_OB_bear)

    # =====================
    # Process BoS/CHoCH - WITH DEDUP
    # =====================
    if 'BoS_CHoCH' in aVWAP_anchors:
        # Track unique BoS indices to prevent duplicates across configs
        seen_BoS_bull_indices   = set()
        seen_BoS_bear_indices   = set()
        seen_CHoCH_bull_indices = set()
        seen_CHoCH_bear_indices = set()

        for config_idx, config in enumerate(BoS_CHoCH_configs):
            _bos_mode = config.get('mode', 'combined').lower()
            if _bos_mode in ['bullish', 'bull', 'valleys', 'valley']:
                include_bull, include_bear = True, False
            elif _bos_mode in ['bearish', 'bear', 'peaks', 'peak']:
                include_bull, include_bear = False, True
            else:
                include_bull, include_bear = True, True

            include_BoS   = config.get('include_BoS',   True)
            include_CHoCH = config.get('include_CHoCH', True)
            max_BoS_aVWAPs   = config.get('max_BoS_aVWAPs',   config.get('max_aVWAPs', None))
            max_CHoCH_aVWAPs = config.get('max_CHoCH_aVWAPs', config.get('max_aVWAPs', None))

            def process_BoS_CHoCH_range(signal_idx, break_idx, signal_type):
                if pd.isna(break_idx) or break_idx <= signal_idx:
                    return None
                range_df = df.iloc[signal_idx:break_idx+1]
                if signal_type == 'bullish':
                    extreme_idx = range_df['Low'].idxmin()
                else:
                    extreme_idx = range_df['High'].idxmax()
                return calculate_avwap(df, extreme_idx)

            config_BoS = {}

            # Resolve per-signal swing lengths; BoS_swing_length / CHoCH_swing_length
            # fall back to the shared swing_length when not specified.
            _sl              = config.get('swing_length', 25)
            _bos_sl          = config.get('BoS_swing_length',   _sl)
            _choch_sl        = config.get('CHoCH_swing_length',  _sl)
            _bos_col         = f'BoS_{_bos_sl}'
            _choch_col       = f'CHoCH_{_choch_sl}'
            _break_bos_col   = f'BoS_CHoCH_Break_Index_{_bos_sl}'
            _break_choch_col = f'BoS_CHoCH_Break_Index_{_choch_sl}'

            if include_BoS and include_bull and _bos_col in df.columns:
                for idx in df[df[_bos_col] == 1].index:
                    if idx in seen_BoS_bull_indices:
                        continue
                    break_idx = int(df.loc[idx, _break_bos_col]) if _break_bos_col in df.columns and not pd.isna(df.loc[idx, _break_bos_col]) else None
                    if break_idx:
                        vwap = process_BoS_CHoCH_range(idx, break_idx, 'bullish')
                        if vwap is not None:
                            config_BoS[f'aVWAP_BoS_bull_c{config_idx}_{idx}'] = vwap
                            seen_BoS_bull_indices.add(idx)

            if include_BoS and include_bear and _bos_col in df.columns:
                for idx in df[df[_bos_col] == -1].index:
                    if idx in seen_BoS_bear_indices:
                        continue
                    break_idx = int(df.loc[idx, _break_bos_col]) if _break_bos_col in df.columns and not pd.isna(df.loc[idx, _break_bos_col]) else None
                    if break_idx:
                        vwap = process_BoS_CHoCH_range(idx, break_idx, 'bearish')
                        if vwap is not None:
                            config_BoS[f'aVWAP_BoS_bear_c{config_idx}_{idx}'] = vwap
                            seen_BoS_bear_indices.add(idx)

            if include_CHoCH and include_bull and _choch_col in df.columns:
                for idx in df[df[_choch_col] == 1].index:
                    if idx in seen_CHoCH_bull_indices:
                        continue
                    break_idx = int(df.loc[idx, _break_choch_col]) if _break_choch_col in df.columns and not pd.isna(df.loc[idx, _break_choch_col]) else None
                    if break_idx:
                        vwap = process_BoS_CHoCH_range(idx, break_idx, 'bullish')
                        if vwap is not None:
                            config_BoS[f'aVWAP_CHoCH_bull_c{config_idx}_{idx}'] = vwap
                            seen_CHoCH_bull_indices.add(idx)

            if include_CHoCH and include_bear and _choch_col in df.columns:
                for idx in df[df[_choch_col] == -1].index:
                    if idx in seen_CHoCH_bear_indices:
                        continue
                    break_idx = int(df.loc[idx, _break_choch_col]) if _break_choch_col in df.columns and not pd.isna(df.loc[idx, _break_choch_col]) else None
                    if break_idx:
                        vwap = process_BoS_CHoCH_range(idx, break_idx, 'bearish')
                        if vwap is not None:
                            config_BoS[f'aVWAP_CHoCH_bear_c{config_idx}_{idx}'] = vwap
                            seen_CHoCH_bear_indices.add(idx)

            # Apply separate caps per signal type (per side)
            def _cap_prefix(prefix, cap):
                if cap is None:
                    return
                keys = sorted([k for k in config_BoS if k.startswith(prefix)],
                              key=lambda x: int(x.split('_')[-1]), reverse=True)
                for k in keys[cap:]:
                    del config_BoS[k]

            _cap_prefix(f'aVWAP_BoS_bull_c{config_idx}_',   max_BoS_aVWAPs)
            _cap_prefix(f'aVWAP_BoS_bear_c{config_idx}_',   max_BoS_aVWAPs)
            _cap_prefix(f'aVWAP_CHoCH_bull_c{config_idx}_', max_CHoCH_aVWAPs)
            _cap_prefix(f'aVWAP_CHoCH_bear_c{config_idx}_', max_CHoCH_aVWAPs)

            if BoS_CHoCH_avg:
                BoS_CHoCH_aVWAPs.update(config_BoS)

            if BoS_CHoCH:
                all_individual_aVWAPs.update(config_BoS)

    # =====================
    # Process QQEMOD - segment-based anchors
    # =====================
    if 'QQEMOD' in aVWAP_anchors:
        vol_mask = df['Volume'].fillna(0) > 0
        _last_valid = int(vol_mask[vol_mask].index[-1]) if vol_mask.any() else len(df) - 1

        def find_qqemod_segments(config_idx):
            bull = (df[f'QQE1_Above_Upper_c{config_idx}'].fillna(False).values &
                    df[f'QQE2_Above_Threshold_c{config_idx}'].fillna(False).values &
                    df[f'QQE2_Above_TL_c{config_idx}'].fillna(False).values)
            bear = (df[f'QQE1_Below_Lower_c{config_idx}'].fillna(False).values &
                    df[f'QQE2_Below_Threshold_c{config_idx}'].fillna(False).values &
                    ~df[f'QQE2_Above_TL_c{config_idx}'].fillna(False).values)
            n = len(df)
            segments = []
            i = 0
            while i < n:
                if bull[i]:
                    start = i
                    j = i + 1
                    while j < n and not bear[j]:
                        j += 1
                    anchor_end = min(j - 1, _last_valid)
                    display_end = min(j, _last_valid)
                    anchor = int(np.argmax(df['High'].values[start:anchor_end + 1])) + start
                    segments.append({'type': 'bull', 'start': start, 'end': display_end,
                                     'anchor': anchor})
                    i = j if j < n else n
                elif bear[i]:
                    start = i
                    j = i + 1
                    while j < n and not bull[j]:
                        j += 1
                    anchor_end = min(j - 1, _last_valid)
                    display_end = min(j, _last_valid)
                    anchor = int(np.argmin(df['Low'].values[start:anchor_end + 1])) + start
                    segments.append({'type': 'bear', 'start': start, 'end': display_end,
                                     'anchor': anchor})
                    i = j if j < n else n
                else:
                    i += 1
            return segments

        for config_idx, config in enumerate(QQEMOD_configs):
            max_anchors      = config.get('max_anchors', config.get('max_aVWAPs', None))
            extend_to_end    = config.get('extend_to_end', False)
            peak_to_valley   = config.get('peak_to_valley',   True)
            valley_to_peak   = config.get('valley_to_peak',   True)
            peak_to_peak     = config.get('peak_to_peak',     True)
            valley_to_valley = config.get('valley_to_valley', True)

            include_bull = peak_to_valley or peak_to_peak or QQEMOD_avg
            include_bear = valley_to_peak or valley_to_valley or QQEMOD_avg

            segments = find_qqemod_segments(config_idx)

            # Limit per direction so bear and bull each keep their own N most recent anchors
            if max_anchors is not None:
                bear_segs = [s for s in segments if s['type'] == 'bear'][-max_anchors:]
                bull_segs = [s for s in segments if s['type'] == 'bull'][-max_anchors:]
                segments = sorted(bear_segs + bull_segs, key=lambda s: s['start'])

            config_QQEMOD = {}

            # Solid lines: peak→valley and valley→peak
            for seg in segments:
                if seg['type'] == 'bull' and not peak_to_valley:
                    continue
                if seg['type'] == 'bear' and not valley_to_peak:
                    continue
                anchor = seg['anchor']
                direction = 'bull' if seg['type'] == 'bull' else 'bear'
                col = f'aVWAP_QQEMOD_{direction}_c{config_idx}_{anchor}'
                avwap = calculate_avwap(df, anchor).copy()
                end_idx = _last_valid if extend_to_end else seg['end']
                avwap.iloc[end_idx - anchor + 1:] = np.nan
                config_QQEMOD[col] = avwap

            # Dotted lines: peak→peak and valley→valley
            # Always computed when QQEMOD_avg is True; only displayed when the flag is True
            for seg_type, direction, display_flag in (
                ('bull', 'bull', peak_to_peak),
                ('bear', 'bear', valley_to_valley),
            ):
                need_dir = include_bull if seg_type == 'bull' else include_bear
                if not need_dir:
                    continue
                same_type = [s for s in segments if s['type'] == seg_type]
                for k in range(len(same_type) - 1):
                    anchor = same_type[k]['anchor']
                    next_anchor = same_type[k + 1]['anchor']
                    col = f'aVWAP_QQEMOD_{direction}_dot_c{config_idx}_{anchor}'
                    avwap = calculate_avwap(df, anchor).copy()
                    end_idx = _last_valid if extend_to_end else next_anchor
                    avwap.iloc[end_idx - anchor + 1:] = np.nan
                    if QQEMOD_avg:
                        QQEMOD_aVWAPs[col] = avwap
                    if display_flag:
                        config_QQEMOD[col] = avwap
                # Most recent anchor — always extends to last real bar
                if same_type:
                    anchor = same_type[-1]['anchor']
                    col = f'aVWAP_QQEMOD_{direction}_dot_c{config_idx}_{anchor}'
                    avwap = calculate_avwap(df, anchor).copy()
                    avwap.iloc[_last_valid - anchor + 1:] = np.nan
                    if QQEMOD_avg:
                        QQEMOD_aVWAPs[col] = avwap
                    if display_flag:
                        config_QQEMOD[col] = avwap

            if QQEMOD:
                all_individual_aVWAPs.update(config_QQEMOD)

    # =====================
    # Process STRUCTURAL - greedy extrema anchors
    # =====================
    if 'price_maxima_minima' in aVWAP_anchors:
        high_vals = df['High'].values
        low_vals = df['Low'].values

        def greedy_extrema(values, mode, n_anchors, spacing):
            mask = np.ones(len(values), dtype=bool)
            selected = []
            for _ in range(n_anchors):
                available = np.where(mask)[0]
                if not len(available):
                    break
                rel = int(np.argmin(values[available])) if mode == 'valley' else int(np.argmax(values[available]))
                idx = int(available[rel])
                selected.append(idx)
                mask[max(0, idx - spacing):min(len(values), idx + spacing + 1)] = False
            return selected

        for config_idx, config in enumerate(price_maxima_minima_configs):
            include_valleys = config.get('valleys', True)
            include_peaks = config.get('peaks', False)
            max_anchors = config.get('max_anchors', 5)
            spacing = config.get('min_swing_spacing', 30)

            config_price_maxima_minima = {}

            if include_valleys:
                for rank, idx in enumerate(greedy_extrema(low_vals, 'valley', max_anchors, spacing), start=1):
                    col = f'aVWAP_price_maxima_minima_valley_c{config_idx}_{rank}'
                    config_price_maxima_minima[col] = calculate_avwap(df, idx)

            if include_peaks:
                for rank, idx in enumerate(greedy_extrema(high_vals, 'peak', max_anchors, spacing), start=1):
                    col = f'aVWAP_price_maxima_minima_peak_c{config_idx}_{rank}'
                    config_price_maxima_minima[col] = calculate_avwap(df, idx)

            all_individual_aVWAPs.update(config_price_maxima_minima)

    # =====================
    # Add individual aVWAPs to dataframe
    # =====================
    for key, value in all_individual_aVWAPs.items():
        df[key] = value

    # =====================
    # Calculate AVERAGES for each type
    # =====================
   
    # Peaks_avg (from peaks_configs)
    if peaks_avg:
        for config_idx in range(len(peaks_configs)):
            config = peaks_configs[config_idx]
            lookback = get_lookback(config, 'avg_lookback', avg_lookback)
          
            config_peaks = {}
            prefix = f'aVWAP_peak_c{config_idx}_'
            for key, value in peaks_only_aVWAPs.items():
                if key.startswith(prefix):
                    config_peaks[key] = value
          
            if config_peaks:
                avg_name = 'Peaks_avg' if config_idx == 0 else f'Peaks_avg_{config_idx}'
                df[avg_name] = calculate_rolling_aVWAP_avg(df, config_peaks, lookback)

    # Valleys_avg (from valleys_configs)
    if valleys_avg:
        for config_idx in range(len(valleys_configs)):
            config = valleys_configs[config_idx]
            lookback = get_lookback(config, 'avg_lookback', avg_lookback)
          
            config_valleys = {}
            prefix = f'aVWAP_valley_c{config_idx}_'
            for key, value in valleys_only_aVWAPs.items():
                if key.startswith(prefix):
                    config_valleys[key] = value
          
            if config_valleys:
                avg_name = 'Valleys_avg' if config_idx == 0 else f'Valleys_avg_{config_idx}'
                df[avg_name] = calculate_rolling_aVWAP_avg(df, config_valleys, lookback)

    # Peaks_Valleys_avg (from peaks_valleys_configs)
    if peaks_valleys_avg:
        for config_idx in range(len(peaks_valleys_configs)):
            config = peaks_valleys_configs[config_idx]
            lookback = get_lookback(config, 'avg_lookback', avg_lookback)
          
            # Collect aVWAPs for this combined config
            config_aVWAPs = {}
            peak_prefix = f'aVWAP_peak_c{len(peaks_configs)+config_idx}_'
            valley_prefix = f'aVWAP_valley_c{len(valleys_configs)+config_idx}_'
          
            for key, value in peaks_valleys_aVWAPs.items():
                if key.startswith(peak_prefix) or key.startswith(valley_prefix):
                    config_aVWAPs[key] = value
          
            if config_aVWAPs:
                avg_name = 'Peaks_Valleys_avg' if config_idx == 0 else f'Peaks_Valleys_avg_{config_idx}'
              
                if aVWAP_channel and highest_peak_idx is not None and lowest_valley_idx is not None:
                    first_valid_idx = max(highest_peak_idx, lowest_valley_idx)
                    temp_avg = calculate_rolling_aVWAP_avg(df, config_aVWAPs, lookback)
                    df[avg_name] = temp_avg.where(df.index >= first_valid_idx)
                else:
                    df[avg_name] = calculate_rolling_aVWAP_avg(df, config_aVWAPs, lookback)

    # Gaps_avg
    if gaps_avg:
        for config_idx in range(len(gaps_configs)):
            config = gaps_configs[config_idx]
            lookback = get_lookback(config, 'avg_lookback', avg_lookback)
          
            config_gaps = {}
            patterns = [f'Gap_Up_aVWAP_c{config_idx}_', f'Gap_Down_aVWAP_c{config_idx}_']
            for key, value in gaps_aVWAPs.items():
                if any(key.startswith(p) for p in patterns):
                    config_gaps[key] = value
          
            if config_gaps:
                avg_name = 'Gaps_avg' if config_idx == 0 else f'Gaps_avg_{config_idx}'
                df[avg_name] = calculate_rolling_aVWAP_avg(df, config_gaps, lookback)

    # OB_avg
    if OB_avg:
        for config_idx in range(len(OB_configs)):
            config = OB_configs[config_idx]
            lookback = get_lookback(config, 'avg_lookback', avg_lookback)
          
            config_OB = {}
            patterns = [f'aVWAP_OB_bull_c{config_idx}_', f'aVWAP_OB_bear_c{config_idx}_']
            for key, value in OB_aVWAPs.items():
                if any(key.startswith(p) for p in patterns):
                    config_OB[key] = value
          
            if config_OB:
                avg_name = 'OB_avg' if config_idx == 0 else f'OB_avg_{config_idx}'
                df[avg_name] = calculate_rolling_aVWAP_avg(df, config_OB, lookback)

    # BoS_CHoCH_avg
    if BoS_CHoCH_avg:
        for config_idx in range(len(BoS_CHoCH_configs)):
            config = BoS_CHoCH_configs[config_idx]
            lookback = get_lookback(config, 'avg_lookback', avg_lookback)

            config_BoS = {}
            patterns = [f'aVWAP_BoS_CHoCH_bull_c{config_idx}_', f'aVWAP_BoS_CHoCH_bear_c{config_idx}_']
            for key, value in BoS_CHoCH_aVWAPs.items():
                if any(key.startswith(p) for p in patterns):
                    config_BoS[key] = value

            if config_BoS:
                avg_name = 'BoS_CHoCH_avg' if config_idx == 0 else f'BoS_CHoCH_avg_{config_idx}'
                df[avg_name] = calculate_rolling_aVWAP_avg(df, config_BoS, lookback)

    # QQEMOD_avg — average of the active peak-to-peak and valley-to-valley dotted lines
    if QQEMOD_avg:
        for config_idx in range(len(QQEMOD_configs)):
            config_q = {k: v for k, v in QQEMOD_aVWAPs.items()
                        if k.startswith(f'aVWAP_QQEMOD_bull_dot_c{config_idx}_')
                        or k.startswith(f'aVWAP_QQEMOD_bear_dot_c{config_idx}_')}

            if config_q:
                avg_name = 'QQEMOD_avg' if config_idx == 0 else f'QQEMOD_avg_{config_idx}'
                df[avg_name] = calculate_rolling_aVWAP_avg(df, config_q, lookback=None)

    # All_avg (combines all aVWAPs)
    if All_avg and all_individual_aVWAPs:
        max_configs = max(len(peaks_configs), len(valleys_configs), len(peaks_valleys_configs),
                         len(gaps_configs), len(OB_configs), len(BoS_CHoCH_configs),
                         len(QQEMOD_configs))
        for config_idx in range(max_configs):
            lookback = avg_lookback
            avg_name = 'All_avg' if config_idx == 0 else f'All_avg_{config_idx}'
            df[avg_name] = calculate_rolling_aVWAP_avg(df, all_individual_aVWAPs, lookback)

    # -------------------------
    # Format output
    # -------------------------
    cols_to_drop = ['Open', 'Close', 'High', 'Low', 'Volume']
  
    if not (show_peaks or show_valleys or show_peaks_valleys):
        cols_to_drop.extend(['Valleys', 'Peaks'])
    if not gaps:
        cols_to_drop.extend(['Gap_Up', 'Gap_Down'])
    show_OB = any(cfg.get('show_OB', False) for cfg in OB_configs)
    if not show_OB:
        cols_to_drop.extend(['OB', 'OB_High', 'OB_Low', 'OB_Mitigated_Index'])
        for i in range(len(OB_configs)):
            cols_to_drop.extend([
                f'OB_c{i}',
                f'OB_High_c{i}',
                f'OB_Low_c{i}',
                f'OB_Mitigated_Index_c{i}',
            ])
    if not BoS_CHoCH:
        cols_to_drop.extend(['BoS', 'CHoCH', 'BoS_CHoCH_Price', 'BoS_CHoCH_Break_Index'])
    for i in range(len(QQEMOD_configs)):
        cols_to_drop.extend([
            f'QQE1_Above_Upper_c{i}', f'QQE1_Below_Lower_c{i}',
            f'QQE2_Above_Threshold_c{i}', f'QQE2_Below_Threshold_c{i}',
            f'QQE2_Above_TL_c{i}',
        ])
    cols_to_drop.extend(['QQEMOD', 'QQE1_Value', 'QQE1_Above_Upper', 'QQE1_Below_Lower',
                         'QQE2_Above_Threshold', 'QQE2_Below_Threshold', 'QQE2_Above_TL'])

    df = df.drop(columns=[col for col in cols_to_drop if col in df.columns])
    df.set_index('date', inplace=True)

    return df


def calculate_indicator(df, **params):
    return calculate_avwap_channel(df, **params)


def calculate_avwap(df, anchor_index):
    """Calculate anchored VWAP from anchor point"""
    df_anchored = df.iloc[anchor_index:].copy()
    df_anchored['cumulative_volume'] = df_anchored['Volume'].cumsum()
    df_anchored['cumulative_volume_price'] = (
        df_anchored['Volume'] *
        (df_anchored['High'] + df_anchored['Low'] + df_anchored['Close']) / 3
    ).cumsum()
    return df_anchored['cumulative_volume_price'] / df_anchored['cumulative_volume']


def calculate_rolling_aVWAP_avg(df, aVWAP_dict, lookback=None):
    """Calculate average of aVWAP values"""
    if not aVWAP_dict:
        return pd.Series(np.nan, index=df.index)
  
    aVWAP_df = pd.DataFrame(aVWAP_dict)
  
    def extract_idx(col_name):
        try:
            parts = col_name.split('_')
            return int(parts[-1])
        except:
            return 0
  
    sorted_cols = sorted(aVWAP_df.columns, key=extract_idx, reverse=True)
    aVWAP_df = aVWAP_df[sorted_cols]
  
    avg_values = pd.Series(np.nan, index=df.index)
    for idx in aVWAP_df.index.intersection(df.index):
        valid_vals = aVWAP_df.loc[idx].dropna()
        if lookback is not None:
            valid_vals = valid_vals[:lookback]
        if len(valid_vals) > 0:
            avg_values.loc[idx] = valid_vals.mean()
    return avg_values
