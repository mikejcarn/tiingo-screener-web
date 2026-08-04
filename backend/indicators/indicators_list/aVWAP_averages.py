import re
from backend.indicators.indicators import get_indicators

_AVG_COL_RE = re.compile(r'_avg(_\d+)?$')

display_name = "aVWAP Averages"

param_separators = ['Peaks_avg', 'Valleys_avg', 'Peaks_Valleys_avg', 'Gaps_avg',
                     'OB_avg', 'BoS_CHoCH_avg', 'QQEMOD_avg', 'All_avg']

param_labels = {
    'Peaks_avg':            'Peaks Average',
    'peaks_params':         'Peaks Params',
    'Valleys_avg':          'Valleys Average',
    'valleys_params':       'Valleys Params',
    'Peaks_Valleys_avg':    'Peaks + Valleys Average',
    'peaks_valleys_params': 'Peaks + Valleys Params',
    'Gaps_avg':             'Gaps Average',
    'gaps_params':          'Gaps Params',
    'OB_avg':               'Order Block Average',
    'OB_params':            'Order Block Params',
    'BoS_CHoCH_avg':        'BoS / CHoCH Average',
    'BoS_CHoCH_params':     'BoS / CHoCH Params',
    'QQEMOD_avg':           'QQEMOD Average',
    'QQEMOD_params':        'QQEMOD Params',
    'All_avg':              'All Combined Average',
    'avg_lookback':         'Avg Lookback (# of most-recent anchors averaged together)',
    # Nested sub-keys, shared label across every type's params group
    'periods':              'Pivot Window (periods)',
    'swing_length':         'Swing Length',
    'max_aVWAPs':           'Max Anchors (blank = unlimited)',
    'mode':                 'Mode',
}

param_descriptions = {
    'avg_lookback': "How many of the most-recently-anchored aVWAP lines (of each enabled type) to average "
                     "together at each bar. Lower = tracks the newest anchors more tightly; higher = smoother, "
                     "slower-moving average line. Override per type by adding an 'avg_lookback' key to that "
                     "type's own params dict.",
    'All_avg':      "Averages together every aVWAP line from every OTHER type enabled below — enable this "
                     "alongside whichever individual types you want combined, not on its own.",
}

def calculate_aVWAP_averages(df,
    # Same per-type default configs used by the underlying aVWAP module, so behavior
    # matches the individual aVWAP_peaks / aVWAP_valleys / aVWAP_OB / etc. indicators
    # exactly. Given as literal dicts (not None) so the UI can expose each field
    # individually instead of falling back to a raw JSON editor.
    Peaks_avg=False,         peaks_params={'periods': 25, 'max_aVWAPs': None},
    Valleys_avg=False,       valleys_params={'periods': 25, 'max_aVWAPs': None},
    Peaks_Valleys_avg=False, peaks_valleys_params={'periods': 25, 'max_aVWAPs': None},
    Gaps_avg=False,          gaps_params={'max_aVWAPs': None},
    OB_avg=False,            OB_params={'periods': 25, 'max_aVWAPs': None, 'mode': 'combined'},
    BoS_CHoCH_avg=False,     BoS_CHoCH_params={'swing_length': 25, 'max_aVWAPs': None, 'mode': 'combined'},
    QQEMOD_avg=False,        QQEMOD_params={'mode': 'combined', 'max_aVWAPs': None},
    All_avg=False,
    avg_lookback=25,
    **_
):
    """
    Standalone "aVWAP Averages" indicator — pick any combination of aVWAP anchor
    types and get a rolling average of their currently-active lines, without
    also having to plot the individual raw anchor lines themselves.

    Each enabled type outputs its own {Type}_avg column (e.g. Peaks_avg,
    Valleys_avg). Multiple configs per type (pass a list to that type's
    *_params) produce suffixed columns: {Type}_avg, {Type}_avg_1, ...
    """
    if not (Peaks_avg or Valleys_avg or Peaks_Valleys_avg or Gaps_avg
            or OB_avg or BoS_CHoCH_avg or QQEMOD_avg or All_avg):
        return {}

    base_cols = [c for c in ['Open', 'High', 'Low', 'Close', 'Volume', 'date'] if c in df.columns]
    base_df   = df[base_cols].copy()

    out = {}

    def _run_and_collect(**extra):
        p = {'avg_lookback': avg_lookback, **extra}
        result = get_indicators(base_df, ['aVWAP'], {'aVWAP': p})
        for c in result.columns:
            if _AVG_COL_RE.search(c):
                out[c] = result[c]

    # Peaks / Valleys / Gaps / OB / BoS_CHoCH / QQEMOD have no cross-type interaction — bundle
    # them into a single call. Averaging a type requires computing its underlying anchor
    # lines too, so each *_avg flag is paired with its corresponding "show" flag internally.
    bundle = {}
    if Peaks_avg:
        bundle.update(peaks=True, peaks_avg=True, peaks_params=peaks_params)
    if Valleys_avg:
        bundle.update(valleys=True, valleys_avg=True, valleys_params=valleys_params)
    if Gaps_avg:
        bundle.update(gaps=True, gaps_avg=True, gaps_params=gaps_params)
    if OB_avg:
        bundle.update(OB=True, OB_avg=True, OB_params=OB_params)
    if BoS_CHoCH_avg:
        bundle.update(BoS_CHoCH=True, BoS_CHoCH_avg=True, BoS_CHoCH_params=BoS_CHoCH_params)
    if QQEMOD_avg:
        bundle.update(QQEMOD=True, QQEMOD_avg=True, QQEMOD_params=QQEMOD_params)
    if bundle:
        _run_and_collect(**bundle)

    # Isolated on its own call: the combined peaks+valleys average dedupes its anchors against
    # any individual peaks/valleys anchors detected with the same periods (by design, to avoid
    # double-plotting the same point) — bundling it with Peaks_avg/Valleys_avg above can wipe
    # it out entirely when periods match, so it always runs separately.
    if Peaks_Valleys_avg:
        _run_and_collect(peaks_valleys=True, peaks_valleys_avg=True,
                          peaks_valleys_params=peaks_valleys_params)

    # All_avg combines whichever of the above types are also enabled — mirror the same
    # selections (plus peaks_valleys, if requested) in its own call.
    if All_avg:
        all_bundle = dict(bundle)
        all_bundle['All_avg'] = True
        if Peaks_Valleys_avg:
            all_bundle.update(peaks_valleys=True, peaks_valleys_params=peaks_valleys_params)
        _run_and_collect(**all_bundle)

    return out


def calculate_indicator(df, **params):
    return calculate_aVWAP_averages(df, **params)
