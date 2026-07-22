"""
Extracts dynamic replay event data from a pre-computed indicator DataFrame.

These events drive the client-side rendering so that at every replay bar N the
chart shows only what would have been visible at that moment in time.

Event types sent:
  peaks / valleys    — bar positions for aVWAP anchoring (centered rolling window
                       confirmation delay applied via peaks_half / valleys_half).
  qqemod_events      — QQEMOD anchor commitment events.
  fvg / ob / bos / liq — horizontal segment events for Fair Value Gaps, Order
                       Blocks, BoS/CHoCH structure levels, and Liquidity levels.
                       Each event: {s, e, p, m, dir} + optional {da, vf}.
"""
import re
import pandas as pd


def _classify_color(color) -> str:
    """Map a candle_colors rgba string to 'bull', 'bear', or 'neutral'."""
    if not color or color == '#000000':
        return 'neutral'
    if 'rgba(38,' in str(color):   # teal family → bull zone
        return 'bull'
    if 'rgba(239,' in str(color):  # red family → bear zone
        return 'bear'
    return 'neutral'


def _extract_qqemod_events(df: pd.DataFrame) -> list:
    """
    Derive QQEMOD anchor commitment events from the color column.

    For each completed zone:
      bear zone → anchor at bar with highest High; direction = 'bear'
      bull zone → anchor at bar with lowest Low;  direction = 'bull'

    committed_bar is the first bar of the next zone (when the anchor is finalized).
    The last (still-open) zone is not committed.
    """
    if 'color' not in df.columns:
        return []

    # Classify each bar's zone, then fill neutrals with the previous zone
    raw = [_classify_color(c) for c in df['color'].values]
    filled = []
    prev = 'neutral'
    for z in raw:
        if z != 'neutral':
            prev = z
        filled.append(prev)

    events = []
    n = len(filled)
    i = 0
    while i < n:
        z = filled[i]
        if z == 'neutral':
            i += 1
            continue
        start = i
        while i < n and filled[i] == z:
            i += 1
        end = i  # exclusive

        if end >= n:   # last (open) zone — anchor not yet committed
            continue

        # Anchor: argmax of High for bear zones, argmin of Low for bull zones
        zone_slice = df.iloc[start:end]
        if z == 'bear':
            anchor_bar = int(zone_slice['High'].idxmax())
        else:
            anchor_bar = int(zone_slice['Low'].idxmin())

        events.append({
            'committed_bar': end,           # integer bar index
            'anchor_bar':    anchor_bar,    # integer bar index
            'direction':     z,             # 'bull' or 'bear'
        })

    return events


def _add_displaced_at(events: list, max_unmitigated, max_mitigated) -> list:
    """
    Compute 'da' (displaced_at bar) for each capped segment event.

    Segments are shown in groups by mitigation status.  The oldest event in each
    group is displaced the moment the (max_N+1)-th newer event of the same type
    starts — exactly matching the rolling-cap semantics the original app used.
    """
    unmitigated = sorted([e for e in events if not e['m']], key=lambda e: e['s'])
    mitigated   = sorted([e for e in events if e['m']],     key=lambda e: e['s'])

    if max_unmitigated is not None:
        for i, ev in enumerate(unmitigated):
            if i + max_unmitigated < len(unmitigated):
                ev['da'] = unmitigated[i + max_unmitigated]['s']

    if max_mitigated is not None:
        if max_mitigated == 0:
            for ev in mitigated:
                ev['da'] = ev['s']   # never visible
        else:
            for i, ev in enumerate(mitigated):
                if i + max_mitigated < len(mitigated):
                    ev['da'] = mitigated[i + max_mitigated]['s']

    return events


def _extract_fvg_segments(df: pd.DataFrame, params: dict = None) -> list:
    """
    Extract FVG horizontal segment events from stored indicator columns.
    Applies rolling-cap displacement (displaced_at) from params so that in
    replay only the correct N most-recent events are visible at each bar.
    """
    if 'FVG' not in df.columns:
        return []
    if params is None:
        params = {}
    n = len(df)
    events = []
    for idx in df[df['FVG'] != 0].index:
        v    = df.at[idx, 'FVG']
        high = df.at[idx, 'FVG_High'] if 'FVG_High' in df.columns else None
        low  = df.at[idx, 'FVG_Low']  if 'FVG_Low'  in df.columns else None
        if high is None or low is None or pd.isna(high) or pd.isna(low):
            continue
        # Bull FVG: line at Top (= low of bar i+1, upper gap edge) — the first
        # level price tests when retracing into the gap.
        # Bear FVG: line at Bottom (= high of bar i+1, lower gap edge).
        price = float(high) if v > 0 else float(low)
        mit   = df.at[idx, 'FVG_Mitigated_Index'] if 'FVG_Mitigated_Index' in df.columns else 0
        if pd.isna(mit) or mit == 0:
            end, is_mit = n - 1, False
        else:
            end, is_mit = int(mit), True
        events.append({
            's': int(idx), 'e': end, 'p': price,
            'm': is_mit, 'dir': 'bull' if v > 0 else 'bear',
        })
    return _add_displaced_at(
        events,
        max_unmitigated=params.get('max_unmitigated'),
        max_mitigated=params.get('max_mitigated'),
    )


def _extract_gap_segments(df: pd.DataFrame, params: dict = None) -> list:
    if 'Gap_Up' not in df.columns and 'Gap_Down' not in df.columns:
        return []
    if params is None:
        params = {}
    n = len(df)
    events = []

    for flag_col, high_col, low_col, mit_col, direction in (
        ('Gap_Up',   'Gap_Up_High',   'Gap_Up_Low',   'Gap_Up_Mitigated',   'bull'),
        ('Gap_Down', 'Gap_Down_High', 'Gap_Down_Low', 'Gap_Down_Mitigated', 'bear'),
    ):
        if flag_col not in df.columns:
            continue
        for idx in df[df[flag_col] != 0].index:
            high = df.at[idx, high_col] if high_col in df.columns else None
            low  = df.at[idx, low_col]  if low_col  in df.columns else None
            if high is None or low is None or pd.isna(high) or pd.isna(low):
                continue
            mit = df.at[idx, mit_col] if mit_col in df.columns else 0
            if pd.isna(mit) or mit == 0:
                end, is_mit = n - 1, False
            else:
                end, is_mit = int(mit), True
            s = int(idx)
            # One representative event carries both price levels; displacement
            # applied once per gap, then expanded to upper+lower edge pair.
            events.append({
                's': s, 'e': end, 'm': is_mit, 'dir': direction,
                'p': float(high), '_low': float(low),
            })

    # Apply rolling cap to representative events (one per gap)
    events = _add_displaced_at(
        events,
        max_unmitigated=params.get('max_unmitigated'),
        max_mitigated=params.get('max_mitigated'),
    )

    # Expand each gap into two line events (upper and lower edge)
    final = []
    for ev in events:
        low = ev.pop('_low')
        final.append(ev)
        lower = {**ev, 'p': low}
        final.append(lower)
    return final


def _extract_ob_segments(df: pd.DataFrame, params: dict = None) -> list:
    """
    Extract Order Block horizontal segment events from stored indicator columns.
    Applies rolling-cap displacement (displaced_at) from params so that in
    replay only the correct N most-recent events are visible at each bar.
    """
    if 'OB' not in df.columns:
        return []
    if params is None:
        params = {}
    n = len(df)
    events = []
    for idx in df[df['OB'] != 0].index:
        v    = df.at[idx, 'OB']
        high = df.at[idx, 'OB_High'] if 'OB_High' in df.columns else None
        low  = df.at[idx, 'OB_Low']  if 'OB_Low'  in df.columns else None
        if high is None or low is None or pd.isna(high) or pd.isna(low):
            continue
        price = float((high + low) / 2)
        mit   = df.at[idx, 'OB_Mitigated_Index'] if 'OB_Mitigated_Index' in df.columns else 0
        if pd.isna(mit) or mit == 0:
            end, is_mit = n - 1, False
        else:
            end, is_mit = int(mit), True
        events.append({
            's': int(idx), 'e': end, 'p': price,
            'm': is_mit, 'dir': 'bull' if v > 0 else 'bear',
        })
    periods = int(params.get('periods', 0))
    for ev in events:
        ev['vf'] = ev['s'] + periods

    return _add_displaced_at(
        events,
        max_unmitigated=params.get('max_unmitigated'),
        max_mitigated=params.get('max_mitigated'),
    )


def _extract_bos_choch_segments(df: pd.DataFrame) -> list:
    """
    Extract BoS/CHoCH horizontal segment events.

    Columns follow the pattern BoS_{sl}, CHoCH_{sl}, BoS_CHoCH_Price_{sl},
    BoS_CHoCH_Break_Index_{sl}.  The segment runs from the structure bar (s)
    to the break bar (e), drawn at the structure price level.
    """
    bos_re   = re.compile(r'^BoS_(\d+)$')
    choch_re = re.compile(r'^CHoCH_(\d+)$')
    swing_lengths = set()
    for c in df.columns:
        m = bos_re.match(c) or choch_re.match(c)
        if m:
            swing_lengths.add(int(m.group(1)))
    if not swing_lengths:
        return []
    n = len(df)
    events = []
    for sl in swing_lengths:
        bos_col   = f'BoS_{sl}'
        choch_col = f'CHoCH_{sl}'
        price_col = f'BoS_CHoCH_Price_{sl}'
        break_col = f'BoS_CHoCH_Break_Index_{sl}'
        if not all(c in df.columns for c in [price_col, break_col]):
            continue
        for col, sig_type in [(bos_col, 'bos'), (choch_col, 'choch')]:
            if col not in df.columns:
                continue
            for idx in df[df[col] != 0].index:
                v     = df.at[idx, col]
                price = df.at[idx, price_col]
                brk   = df.at[idx, break_col]
                if pd.isna(price) or pd.isna(brk):
                    continue
                end = min(int(brk), n - 1) if brk > 0 else n - 1
                events.append({
                    's': int(idx), 'e': end, 'p': float(price),
                    'm': False, 'dir': 'bull' if v > 0 else 'bear',
                    'sig': sig_type,
                })
    return events


def _extract_liquidity_segments(df: pd.DataFrame, params: dict = None) -> list:
    """
    Extract Liquidity level segment events from stored indicator columns.

    A liquidity level is only knowable after swing_length more bars have passed
    since the level formed (the grouped swings need that buffer to be confirmed),
    so vf = s + swing_length.  max_swept=0 means swept levels are never shown.
    """
    if 'Liquidity' not in df.columns:
        return []
    if params is None:
        params = {}
    swing_length = int(params.get('swing_length', 0))
    max_swept    = params.get('max_swept', None)
    extend_lines = bool(params.get('extend_lines', False))
    n = len(df)
    events = []
    for idx in df[df['Liquidity'] != 0].index:
        v     = df.at[idx, 'Liquidity']
        level = df.at[idx, 'Liquidity_Level'] if 'Liquidity_Level' in df.columns else None
        if level is None or pd.isna(level):
            continue
        swept = df.at[idx, 'Liquidity_Swept'] if 'Liquidity_Swept' in df.columns else 0
        if pd.isna(swept) or swept == 0:
            end, is_swept = n - 1, False
        else:
            end, is_swept = int(swept), True
        if is_swept and max_swept == 0:
            continue
        s = int(idx)
        events.append({
            's': s, 'e': end, 'p': float(level),
            'm': is_swept, 'dir': 'bull' if v > 0 else 'bear',
            'vf': s + swing_length,
        })

    if not extend_lines:
        # Cap each unswept event's end at the next same-direction swing start
        for direction in ('bull', 'bear'):
            group = sorted([ev for ev in events if ev['dir'] == direction], key=lambda e: e['s'])
            for i, ev in enumerate(group):
                if not ev['m'] and i + 1 < len(group):
                    ev['e'] = min(ev['e'], group[i + 1]['s'])

    return events


_OB_BULL_RE    = re.compile(r'^aVWAP_OB_bull_c(\d+)_(\d+)$')
_OB_BEAR_RE    = re.compile(r'^aVWAP_OB_bear_c(\d+)_(\d+)$')
_BOS_BULL_RE   = re.compile(r'^aVWAP_BoS_bull_c(\d+)_(\d+)$')
_BOS_BEAR_RE   = re.compile(r'^aVWAP_BoS_bear_c(\d+)_(\d+)$')
_CHOCH_BULL_RE = re.compile(r'^aVWAP_CHoCH_bull_c(\d+)_(\d+)$')
_CHOCH_BEAR_RE = re.compile(r'^aVWAP_CHoCH_bear_c(\d+)_(\d+)$')
_GAP_UP_RE     = re.compile(r'^Gap_Up_aVWAP_c(\d+)_(\d+)$')
_GAP_DN_RE     = re.compile(r'^Gap_Down_aVWAP_c(\d+)_(\d+)$')
_PMM_VALLEY_RE      = re.compile(r'^aVWAP_price_maxima_minima_valley_c(\d+)_(\d+)$')
_PMM_PEAK_RE        = re.compile(r'^aVWAP_price_maxima_minima_peak_c(\d+)_(\d+)$')
_PEAK_RE            = re.compile(r'^aVWAP_peak_c(\d+)_(\d+)$')
_VALLEY_RE          = re.compile(r'^aVWAP_valley_c(\d+)_(\d+)$')
_QQEMOD_BULL_RE     = re.compile(r'^aVWAP_QQEMOD_bull_(\d+)$')
_QQEMOD_BEAR_RE     = re.compile(r'^aVWAP_QQEMOD_bear_(\d+)$')
_QQEMOD_BULL_DOT_RE = re.compile(r'^aVWAP_QQEMOD_bull_dot_(\d+)$')
_QQEMOD_BEAR_DOT_RE = re.compile(r'^aVWAP_QQEMOD_bear_dot_(\d+)$')
_AVWAP_MAX_RE       = re.compile(r'^aVWAP_max_(\d+)$')
_AVWAP_MIN_RE       = re.compile(r'^aVWAP_min_(\d+)$')


def _extract_dynamic_avwap_anchors(df: pd.DataFrame, ind_params: dict) -> dict:
    """
    Extract anchor events for aVWAP types rendered dynamically in the JS engine:
    peaks/valleys, OB, BoS/CHoCH, gaps, and price_maxima_minima.

    Returns a dict of {pool_key: [{anchor_bar, vf}]}, one list per rendered pool.
    The JS engine builds one LineSeries per event and reveals anchors when vf <= n.

    vf rules:
      peaks/valleys — anchor_bar + periods//2  (centered rolling window confirmation delay)
      OB            — anchor_bar + periods  (OB swing confirmation delay)
      BoS/CHoCH     — anchor_bar            (first_valid_index = extreme bar inside the range)
      gaps          — anchor_bar            (gap is visible the moment it forms)
      PMM           — anchor_bar            (greedy extrema is backward-looking; no delay)
    """
    avwap_p   = ind_params.get('aVWAP', {})
    ob_cfgs   = avwap_p.get('OB_params', [])
    ob_cfgs   = ob_cfgs if isinstance(ob_cfgs, list) else [ob_cfgs]

    # Per-config confirmation half-windows for peaks/valleys
    peaks_cfgs   = avwap_p.get('peaks_params',   [])
    valleys_cfgs = avwap_p.get('valleys_params',  [])
    peaks_cfgs   = peaks_cfgs   if isinstance(peaks_cfgs,   list) else [peaks_cfgs]
    valleys_cfgs = valleys_cfgs if isinstance(valleys_cfgs, list) else [valleys_cfgs]
    peaks_half   = {i: (c or {}).get('periods', 25) // 2 for i, c in enumerate(peaks_cfgs)}
    valleys_half = {i: (c or {}).get('periods', 25) // 2 for i, c in enumerate(valleys_cfgs)}

    # OB aVWAP anchors — prefer the raw OB column when available (replay-accurate:
    # all OBs are extracted and caps applied via displaced_at so early replay shows
    # the correct OB rather than the full-dataset cap survivor).  When the standalone
    # OB indicator is not enabled, fall back to the pre-stored aVWAP_OB_* columns.
    # Only activate this path when the user actually has aVWAP_OB (or legacy aVWAP
    # with OB_params) configured — having OB alone should not produce aVWAP lines.
    ob_bull_evts: list = []
    ob_bear_evts: list = []
    _wants_avwap_ob = 'aVWAP_OB' in ind_params or bool(ob_cfgs)
    _use_raw_ob = _wants_avwap_ob and 'OB' in df.columns
    if _use_raw_ob:
        ob_cfg0         = ob_cfgs[0] if ob_cfgs else {}
        ob_periods      = int(ob_cfg0.get('periods',               25))
        max_unmitigated = ob_cfg0.get('max_unmitigated_aVWAPs',    None)
        max_mitigated   = ob_cfg0.get('max_mitigated_aVWAPs',      None)
        for idx in df[df['OB'] != 0].index:
            v   = df.at[idx, 'OB']
            mit = df.at[idx, 'OB_Mitigated_Index'] if 'OB_Mitigated_Index' in df.columns else 0
            is_mit = bool(not (pd.isna(mit) or mit == 0))
            ev = {'anchor_bar': int(idx), 's': int(idx), 'vf': int(idx) + ob_periods, 'm': is_mit}
            (ob_bull_evts if v > 0 else ob_bear_evts).append(ev)
        ob_bull_evts = _add_displaced_at(ob_bull_evts, max_unmitigated, max_mitigated)
        ob_bear_evts = _add_displaced_at(ob_bear_evts, max_unmitigated, max_mitigated)

    pools: dict[str, list] = {
        'ob_bull': ob_bull_evts,
        'ob_bear': ob_bear_evts,
        'bos_bull': [], 'bos_bear': [],
        'choch_bull': [], 'choch_bear': [],
        'gap_up': [], 'gap_dn': [],
    }

    for col in df.columns:
        # OB aVWAP columns: skip if raw OB already handled above; otherwise use
        # the pre-stored columns as the fallback (full-dataset anchors, but at
        # least the confirmation delay is applied via vf).
        m = _OB_BULL_RE.match(col)
        if m:
            if not _use_raw_ob:
                ci, anchor_bar = int(m.group(1)), int(m.group(2))
                periods = ob_cfgs[ci].get('periods', 25) if ci < len(ob_cfgs) else 25
                pools['ob_bull'].append({'anchor_bar': anchor_bar, 'vf': anchor_bar + periods, 'm': False})
            continue
        m = _OB_BEAR_RE.match(col)
        if m:
            if not _use_raw_ob:
                ci, anchor_bar = int(m.group(1)), int(m.group(2))
                periods = ob_cfgs[ci].get('periods', 25) if ci < len(ob_cfgs) else 25
                pools['ob_bear'].append({'anchor_bar': anchor_bar, 'vf': anchor_bar + periods, 'm': False})
            continue

        # BoS aVWAPs — suffix is signal_bar; actual anchor is the extremum in the
        # [signal:break] range, found via first_valid_index of the stored series.
        m = _BOS_BULL_RE.match(col)
        if m:
            fvi = df[col].first_valid_index()
            if fvi is not None:
                pools['bos_bull'].append({'anchor_bar': int(fvi), 'vf': int(fvi)})
            continue
        m = _BOS_BEAR_RE.match(col)
        if m:
            fvi = df[col].first_valid_index()
            if fvi is not None:
                pools['bos_bear'].append({'anchor_bar': int(fvi), 'vf': int(fvi)})
            continue

        # CHoCH aVWAPs
        m = _CHOCH_BULL_RE.match(col)
        if m:
            fvi = df[col].first_valid_index()
            if fvi is not None:
                pools['choch_bull'].append({'anchor_bar': int(fvi), 'vf': int(fvi)})
            continue
        m = _CHOCH_BEAR_RE.match(col)
        if m:
            fvi = df[col].first_valid_index()
            if fvi is not None:
                pools['choch_bear'].append({'anchor_bar': int(fvi), 'vf': int(fvi)})
            continue

        # Gap aVWAPs — anchor_bar from suffix, visible immediately
        m = _GAP_UP_RE.match(col)
        if m:
            anchor_bar = int(m.group(2))
            pools['gap_up'].append({'anchor_bar': anchor_bar, 'vf': anchor_bar})
            continue
        m = _GAP_DN_RE.match(col)
        if m:
            anchor_bar = int(m.group(2))
            pools['gap_dn'].append({'anchor_bar': anchor_bar, 'vf': anchor_bar})
            continue

        # QQEMOD aVWAP columns — anchor from first_valid_index, eb from last_valid_index.
        # eb (end_bar) freezes the line at its natural endpoint rather than hiding it,
        # so all N anchors remain visible simultaneously regardless of extend_to_end.
        for _re, _key in [
            (_QQEMOD_BULL_RE,     'qqemod_bull'),
            (_QQEMOD_BEAR_RE,     'qqemod_bear'),
            (_QQEMOD_BULL_DOT_RE, 'qqemod_bull_dot'),
            (_QQEMOD_BEAR_DOT_RE, 'qqemod_bear_dot'),
        ]:
            m = _re.match(col)
            if m:
                fvi = df[col].first_valid_index()
                lvi = df[col].last_valid_index()
                if fvi is not None and lvi is not None:
                    ev = {'anchor_bar': int(fvi), 'vf': int(fvi)}
                    if int(lvi) < len(df) - 1:
                        ev['eb'] = int(lvi)
                    if _key not in pools:
                        pools[_key] = []
                    pools[_key].append(ev)
                break

        # minmax aVWAP columns — anchor visible from the anchor bar onward
        for _re, _key in [
            (_AVWAP_MAX_RE, 'avwap_max'),
            (_AVWAP_MIN_RE, 'avwap_min'),
        ]:
            m = _re.match(col)
            if m:
                anchor_bar = int(m.group(1))
                if _key not in pools:
                    pools[_key] = []
                pools[_key].append({'anchor_bar': anchor_bar, 'vf': anchor_bar})
                break

        # PMM aVWAP columns are intentionally skipped here — PMM anchors are
        # recomputed dynamically in JS at each replay bar via greedyExtrema,
        # so pre-extracting full-dataset anchors would leak future information.

        # Peaks/valleys — anchor_bar from column suffix, vf delayed by periods//2
        m = _PEAK_RE.match(col)
        if m:
            ci, anchor_bar = int(m.group(1)), int(m.group(2))
            half = peaks_half.get(ci, 12)
            key = f'peak_c{ci}'
            if key not in pools:
                pools[key] = []
            pools[key].append({'anchor_bar': anchor_bar, 'vf': anchor_bar + half})
            continue
        m = _VALLEY_RE.match(col)
        if m:
            ci, anchor_bar = int(m.group(1)), int(m.group(2))
            half = valleys_half.get(ci, 12)
            key = f'valley_c{ci}'
            if key not in pools:
                pools[key] = []
            pools[key].append({'anchor_bar': anchor_bar, 'vf': anchor_bar + half})
            continue

    # Sort each pool ascending by anchor_bar (JS iterates in reverse for "most recent first")
    for key in pools:
        pools[key].sort(key=lambda e: e['anchor_bar'])

    return pools



def _extract_poc_segments(df: pd.DataFrame) -> dict | None:
    """
    Extract POC dynamic segment data.  Each POC_N column holds a rolling price
    value per bar (NaN before the window's start bar).  Returns {starts, prices}
    so the JS engine can render a flat horizontal segment at each replay step
    using only data seen so far — no look-ahead.
    """
    import re as _re
    poc_cols = sorted(
        [c for c in df.columns if _re.fullmatch(r'POC_\d+', c)],
        key=lambda c: int(c.split('_')[1]),
    )
    if not poc_cols:
        return None

    starts = []
    prices = []
    for col in poc_cols:
        vals  = df[col].values
        start = next((int(i) for i, v in enumerate(vals) if v == v), None)
        if start is None:
            continue
        starts.append(start)
        prices.append([None if v != v else float(v) for v in vals])

    return {'starts': starts, 'prices': prices} if starts else None


def _extract_divergence_markers(df: pd.DataFrame, params: dict = None) -> list:
    import re
    right = int((params or {}).get('right', 5))
    pattern = re.compile(r'^(.+?)_(Regular|Hidden)_(Bullish|Bearish)$')
    markers = []
    for col in df.columns:
        m = pattern.match(col)
        if not m:
            continue
        label, regularity, direction = m.group(1), m.group(2), m.group(3)
        kind   = 'bull' if direction == 'Bullish' else 'bear'
        hidden = regularity == 'Hidden'
        true_bars = [int(i) for i, v in enumerate(df[col]) if v]
        for b in true_bars:
            markers.append({'b': b, 'vf': b + right, 'kind': kind, 'hidden': hidden, 'label': label})
    return markers


def extract_events(df: pd.DataFrame, ind_params: dict) -> dict:
    """
    Build the replay_events payload to send over WebSocket.

    Parameters
    ----------
    df         : wide DataFrame from load_indicators (RangeIndex, 0-based)
    ind_params : the timeframe-specific params dict from load_indicator_config
    """
    avwap_p = ind_params.get('aVWAP', {})

    # Peaks/valleys are now handled entirely via _anchorPools (peak_c{N}/valley_c{N}),
    # so the old _pPool/_vPool JS path is disabled by zeroing these counts.
    peaks_cfgs   = avwap_p.get('peaks_params',   [])
    valleys_cfgs = avwap_p.get('valleys_params',  [])

    # Legacy QQEMOD rendering via qqemod_events/_qbPool/_qlPool is disabled —
    # the column-based aVWAP_QQEMOD_* system handles all rendering now.
    max_qqemod = 0

    # PMM configs — sent to JS so greedyExtrema can rerun at each replay bar
    pmm_enabled = avwap_p.get('price_maxima_minima', False)
    pmm_raw = avwap_p.get('price_maxima_minima_params', {}) if pmm_enabled else None
    if pmm_raw is None:
        pmm_configs = []
    else:
        cfgs = pmm_raw if isinstance(pmm_raw, list) else [pmm_raw]
        pmm_configs = [
            {
                'valleys':     bool(c.get('valleys',           True)),
                'peaks':       bool(c.get('peaks',             False)),
                'max_anchors': int(c.get('max_anchors',        5)),
                'spacing':     int(c.get('min_swing_spacing',  30)),
            }
            for c in cfgs
        ]

    # QQEMOD anchor commitment events from color column
    # (color is produced by candle_colors with indicator_color='QQEMOD')
    qqemod_events = _extract_qqemod_events(df) if 'color' in df.columns else []

    return {
        'type':          'replay_events',
        'max_peaks':     0,
        'max_valleys':   0,
        'qqemod_events': qqemod_events,
        'max_qqemod':    max_qqemod,
        'pmm_configs':   pmm_configs,
        # Segment indicators — horizontal line events with start/end bar + price
        'fvg': _extract_fvg_segments(df, ind_params.get('FVG',        {})),
        'ob':  _extract_ob_segments(df,  ind_params.get('OB',         {})),
        'bos': _extract_bos_choch_segments(df),
        'liq': _extract_liquidity_segments(df, ind_params.get('liquidity', {})),
        'gap': _extract_gap_segments(df,  ind_params.get('gaps',       {})),
        'poc': _extract_poc_segments(df),
        # Dynamic aVWAP anchor pools (OB, BoS/CHoCH, gaps, price_maxima_minima)
        'avwap_anchors': _extract_dynamic_avwap_anchors(df, ind_params),
        # Divergence arrow markers
        'divergences': _extract_divergence_markers(df, ind_params.get('divergence', {})),
    }
