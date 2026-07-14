import threading

_lock = threading.Lock()
_LOG_MAX = 200

_jobs: dict = {
    'fetch':      {'status': 'idle', 'done': 0, 'total': 0, 'current': '', 'errors': 0, 'failed': [], 'log': []},
    'indicators': {'status': 'idle', 'done': 0, 'total': 0, 'current': '', 'errors': 0, 'failed': [], 'log': []},
}
_cancel_flags: dict = {'fetch': False, 'indicators': False}

def update(job: str, **kwargs) -> None:
    with _lock:
        if kwargs.get('status') == 'running':
            _cancel_flags[job] = False
            _jobs[job]['failed'] = []
            _jobs[job]['log']    = []
        _jobs[job].update(kwargs)


def add_log(job: str, ticker: str, detail: str, ok: bool) -> None:
    with _lock:
        entry = {'ticker': ticker, 'detail': detail, 'ok': ok}
        log = _jobs[job]['log']
        log.append(entry)
        if len(log) > _LOG_MAX:
            del log[0]

def add_failure(job: str, ticker: str, reason: str = '') -> None:
    with _lock:
        _jobs[job]['failed'].append({'ticker': ticker, 'reason': reason})
        _jobs[job]['errors'] = len(_jobs[job]['failed'])

def cancel(job: str) -> None:
    with _lock:
        _cancel_flags[job] = True

def is_cancelled(job: str) -> bool:
    with _lock:
        return _cancel_flags[job]

def get_all() -> dict:
    with _lock:
        return {k: dict(v) for k, v in _jobs.items()}
