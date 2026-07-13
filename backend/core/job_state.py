import threading

_lock = threading.Lock()
_jobs: dict = {
    'fetch':      {'status': 'idle', 'done': 0, 'total': 0, 'current': '', 'errors': 0, 'failed': []},
    'indicators': {'status': 'idle', 'done': 0, 'total': 0, 'current': '', 'errors': 0, 'failed': []},
}
_cancel_flags: dict = {'fetch': False, 'indicators': False}

def update(job: str, **kwargs) -> None:
    with _lock:
        if kwargs.get('status') == 'running':
            _cancel_flags[job] = False
            _jobs[job]['failed'] = []   # clear failure list on new run
        _jobs[job].update(kwargs)

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
