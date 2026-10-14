"""
Pane layout for the oscillators indicator's OSC_* columns — which columns
share a pane, how each is drawn, and the pane's reference levels. Sent to the
chart in the WebSocket 'meta' message as 'panes'; chart.js builds one
lightweight-charts pane per entry, below the price pane, in this order.

Colors: each pane's main line (the series divergence compares) is the
neutral 'fg' token — off-white on the dark theme, dark grey on the light one,
resolved by chart.js so it follows theme switches — leaving the teal/red
divergence lines as the only colored strokes; companion lines (signal / %D)
the conventional orange; two-sided
oscillators (MACD histogram, Vortex) use the app's bull teal / bear red.
Reference lines are muted gray dashes, drawn without axis labels.
"""

C_MAIN   = 'fg'   # theme token, see chart.js PANE_FG
C_SECOND = 'rgba(255,152,0,0.9)'
C_BULL   = 'rgba(38,166,154,1)'
C_BEAR   = 'rgba(239,83,80,1)'
C_HIST_UP   = 'rgba(38,166,154,0.5)'
C_HIST_DOWN = 'rgba(239,83,80,0.5)'
C_REF    = 'rgba(128,128,128,0.6)'

# Ordered: panes appear top-to-bottom in this order. 'series' entries are
# (column, kind, color, width); kind 'line' or 'histogram' (a histogram's
# color is per-bar by sign, from up/down below), plus an optional 5th
# element {ref, above, below} that colors a line per bar by which side of
# another line (ref) it's on — the MACD line vs its signal. All lines are 1px — the
# thinnest available — to keep the panes uncluttered; divergence lines drawn
# on top (chart.js, 1.5px) then stand out from them.
PANE_SPECS = [
    ('RSI',        [('OSC_RSI', 'line', C_MAIN, 1)],                                  [30, 50, 70]),
    ('MACD',       [('OSC_MACD_Hist', 'histogram', None, 1),
                    # MACD line teal while above its signal (bullish), red while
                    # below; the signal line neutral (fg). C_MAIN is only the
                    # fallback where the signal doesn't exist yet.
                    ('OSC_MACD', 'line', C_MAIN, 1,
                     {'ref': 'OSC_MACD_Signal', 'above': C_BULL, 'below': C_BEAR}),
                    ('OSC_MACD_Signal', 'line', C_MAIN, 1)],                           [0]),
    ('Stochastic', [('OSC_Stoch_K', 'line', C_MAIN, 1),
                    ('OSC_Stoch_D', 'line', C_SECOND, 1)],                             [20, 50, 80]),
    ('MFI',        [('OSC_MFI', 'line', C_MAIN, 1)],                                  [20, 50, 80]),
    ('Fisher',     [('OSC_Fisher', 'line', C_MAIN, 1),
                    ('OSC_Fisher_Signal', 'line', C_SECOND, 1)],                       [0]),
    ('Momentum',   [('OSC_Momentum', 'line', C_MAIN, 1)],                             [0]),
    ('OBV',        [('OSC_OBV', 'line', C_MAIN, 1)],                                  []),
    ('Vortex',     [('OSC_VI_plus', 'line', C_BULL, 1),
                    ('OSC_VI_minus', 'line', C_BEAR, 1)],                              [1]),
    ('ATR',        [('OSC_ATR', 'line', C_MAIN, 1)],                                  []),
    ('Fractal',    [('OSC_Fractal', 'line', C_MAIN, 1)],                              []),
    ('Volume MA',  [('OSC_Volume_MA', 'line', C_MAIN, 1)],                            []),
]


# Settings shown after each pane's name in its top-left label ("RSI 14",
# "MACD 12 26 9") — param names and defaults as in oscillators.py.
_LABEL_PARAMS = {
    'RSI':        [('rsi_period', 14)],
    'MACD':       [('macd_fast', 12), ('macd_slow', 26), ('macd_signal', 9)],
    'Stochastic': [('stoch_k', 14), ('stoch_d', 3)],
    'MFI':        [('mfi_period', 14)],
    'Fisher':     [('fisher_period', 10)],
    'Momentum':   [('momentum_period', 10), ('smooth_period', 3)],
    'OBV':        [('obv_period', 21)],
    'Vortex':     [('vortex_period', 14)],
    'ATR':        [('atr_period', 14)],
    'Fractal':    [('fractal_period', 12)],
    'Volume MA':  [('volume_period', 14)],
}


# The divergence indicator's own column for each OSC_ column above — its
# show_oscillator_panes draws these same pane layouts from its own data, so
# the panes show exactly what it compared.
DIVERGENCE_COLS = {
    'OSC_RSI': 'RSI',
    'OSC_MACD': 'MACD', 'OSC_MACD_Signal': 'Signal', 'OSC_MACD_Hist': 'Histogram',
    'OSC_Stoch_K': 'Stoch_%K', 'OSC_Stoch_D': 'Stoch_%D',
    'OSC_MFI': 'MFI',
    'OSC_Fisher': 'Fisher', 'OSC_Fisher_Signal': 'Fisher_Signal',
    'OSC_Momentum': 'Momentum_Smoothed',
    'OSC_OBV': 'OBV_Smoothed',
    'OSC_VI_plus': 'VI_plus', 'OSC_VI_minus': 'VI_minus',
    'OSC_ATR': 'ATR',
    'OSC_Fractal': 'Fractal_Energy',
    'OSC_Volume_MA': 'Volume_MA',
}
# Pane key -> the label divergence.py's signal columns carry ('Momo_Regular_Bullish', ...).
DIVERGENCE_LABELS = {
    'RSI': 'RSI', 'MACD': 'MACD', 'Stochastic': 'Stochastic', 'MFI': 'MFI', 'Fisher': 'Fisher',
    'Momentum': 'Momo', 'OBV': 'OBV', 'Vortex': 'VI', 'ATR': 'ATR', 'Fractal': 'Fractal',
    'Volume MA': 'Vol',
}
_KINDS = [('reg_bull', 'Regular_Bullish'), ('reg_bear', 'Regular_Bearish'),
          ('hid_bull', 'Hidden_Bullish'),  ('hid_bear', 'Hidden_Bearish')]

# Show/hide-panel name prefix per source ('oscillators:RSI', 'divergence:RSI').
SOURCES = ('oscillators', 'divergence')


def _col(source, col):
    return DIVERGENCE_COLS[col] if source == 'divergence' else col


def _div_lines(source, key, series, present) -> list:
    """Divergence-line sources for one pane: [{col, sig, kind: bull|bear,
    target}] — col holds the earlier swing's bar index on signal bars, sig
    (divergence source only) is the boolean signal column that gates it
    (divergence stores _prev unfiltered; MFI/Fractal filter the boolean after
    detection), target is the pane line the divergence was measured on (the
    pane's first line; Vortex measures bullish on VI+ and bearish on VI-, the
    same split as divergence_Vortex.py)."""
    main = next(s[0] for s in series if s[1] == 'line')
    out = []
    for kind, suffix in _KINDS:
        bull = kind.endswith('bull')
        target = ('OSC_VI_plus' if bull else 'OSC_VI_minus') if key == 'Vortex' else main
        if source == 'divergence':
            sig = f'{DIVERGENCE_LABELS[key]}_{suffix}'
            col, extra = sig + '_prev', {'sig': sig}
        else:
            col, extra = f'OSC_{key.replace(" ", "_")}_div_{kind}', {}
        if col not in present or extra.get('sig', col) not in present:
            continue
        out.append({'col': col, **extra, 'kind': 'bull' if bull else 'bear',
                    'target': _col(source, target)})
    return out


def panes_for_columns(columns, params=None, source='oscillators') -> list:
    """[{id, key, label, series: [{col, kind, color, width, up, down}], refs,
    div, div_right}] for every pane whose columns are present (a pane appears
    only if all its columns were produced — i.e. that oscillator is on).
    source 'oscillators' reads the oscillators indicator's OSC_ columns;
    'divergence' reads the divergence indicator's own columns (its
    show_oscillator_panes) and labels the panes '· Divergence'."""
    present = set(columns)
    panes = []
    for key, series, refs in PANE_SPECS:
        if not all(_col(source, col) in present for col, *_ in series):
            continue
        settings = ' '.join(str((params or {}).get(name, default)) for name, default in _LABEL_PARAMS.get(key, []))
        label = f'{key} {settings}'.strip() + (' · Divergence' if source == 'divergence' else '')
        panes.append({
            'id': f'{source}:{key}',
            'key': key,
            'label': label,
            'series': [{'col': _col(source, s[0]), 'kind': s[1], 'color': s[2], 'width': s[3],
                        'up': C_HIST_UP, 'down': C_HIST_DOWN,
                        **({'color_vs': {**s[4], 'ref': _col(source, s[4]['ref'])}} if len(s) > 4 else {})}
                       for s in series],
            'refs': refs,
            'ref_color': C_REF,
            'div': _div_lines(source, key, series, present),
            # bars after a swing before it's confirmed — lines appear then in replay
            'div_right': int((params or {}).get('right', 5)),
        })
    return panes


def pane_columns(source='oscillators') -> dict:
    """{pane key: [its columns]} — for the per-pane show/hide entries."""
    return {key: [_col(source, col) for col, *_ in series] for key, series, _ in PANE_SPECS}
