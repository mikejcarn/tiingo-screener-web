"""
Extracts dynamic replay event data from a pre-computed indicator DataFrame.

These events drive the client-side VWAP engine so that at every replay bar N
the chart shows only the anchors that were "active" or "committed" as of bar N,
rather than the final pre-computed state.

Sends two event types:
  peaks / valleys  — integer bar positions (0-based) where a local peak/valley
                     was detected.  The client picks the most-recent N at each step.
  qqemod_events    — list of {committed_bar, anchor_bar, direction} dicts.
                     Each entry is committed when the QQEMOD zone that contained
                     the anchor closes (the opposite zone starts).
"""
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


def extract_events(df: pd.DataFrame, ind_params: dict) -> dict:
    """
    Build the replay_events payload to send over WebSocket.

    Parameters
    ----------
    df         : wide DataFrame from load_indicators (RangeIndex, 0-based)
    ind_params : the timeframe-specific params dict from load_indicator_config
    """
    avwap_p = ind_params.get('aVWAP', {})

    # Number of simultaneous anchors per type
    peaks_cfgs   = avwap_p.get('peaks_params',   [])
    valleys_cfgs = avwap_p.get('valleys_params',  [])
    n_peak_cfgs   = len(peaks_cfgs)   if isinstance(peaks_cfgs,   list) else (1 if peaks_cfgs   else 0)
    n_valley_cfgs = len(valleys_cfgs) if isinstance(valleys_cfgs, list) else (1 if valleys_cfgs else 0)

    qqemod_cfg = avwap_p.get('QQEMOD_params', {})
    max_qqemod = qqemod_cfg.get('max_anchors', 5) if avwap_p.get('QQEMOD', False) else 0

    # Confirmation half-window for centered-rolling peak/valley detection.
    # A peak at bar N can only be confirmed at bar N + periods//2 because the
    # centered rolling(periods, center=True) window requires that many future bars.
    def _half(cfgs, default=25):
        if not cfgs:
            return default // 2
        first = cfgs[0] if isinstance(cfgs, list) else cfgs
        return first.get('periods', default) // 2

    peaks_half   = _half(peaks_cfgs)
    valleys_half = _half(valleys_cfgs)

    # Peak/valley bar indices from pre-computed flag columns
    peaks   = [int(i) for i in df[df['Peaks']   == 1].index.tolist()] if 'Peaks'   in df.columns else []
    valleys = [int(i) for i in df[df['Valleys'] == 1].index.tolist()] if 'Valleys' in df.columns else []

    # QQEMOD anchor commitment events from color column
    # (color is produced by candle_colors with indicator_color='QQEMOD')
    qqemod_events = _extract_qqemod_events(df) if 'color' in df.columns else []

    return {
        'type':          'replay_events',
        'peaks':         peaks,
        'valleys':       valleys,
        'peaks_half':    peaks_half,
        'valleys_half':  valleys_half,
        'max_peaks':     max(1, n_peak_cfgs),
        'max_valleys':   max(1, n_valley_cfgs),
        'qqemod_events': qqemod_events,
        'max_qqemod':    max_qqemod,
    }
