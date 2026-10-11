"""The settings stamp: a short code for everything that decides a verdict.

Every tracked token is tagged with the stamp in force when it was judged, so results
from before and after a tuning change are never mixed. The stamp changes when any
decision setting in thresholds.py changes (the hard and soft limits, the pick limits,
the Jev model, the shadow ticket) or when questions.py, judge.py or filter.py is
edited. Budgets, bench times and scorekeeper settings don't affect it.
"""

import hashlib
import json
from pathlib import Path

import thresholds as T

HERE = Path(__file__).parent
DECISION_SETTINGS = ("HARD", "BONDING_DEXES", "MAX_DOSSIERS", "JEV_MODEL", "SHADOW_BANK_USD",
                     "MAX_TICKET_SHARE", "SOFT", "SHAPE_MIN_CROWD", "PICK_MIN_WORTH",
                     "PICK_MIN_CONF", "NO_SOCIAL_CUT")
DECISION_CODE = ("questions.py", "judge.py", "filter.py")
# the slow desk also depends on its own settings and code
SLOW_SETTINGS = ("SLOW", "SLOW_MAX_DOSSIERS", "SLOW_EXCLUDE")
SLOW_CODE = ("slow_scan.py", "slow_judge.py")


def settings(desk: str = "fast") -> dict:
    names = DECISION_SETTINGS + (SLOW_SETTINGS if desk == "slow" else ())
    return {k: getattr(T, k) for k in names if hasattr(T, k)}


def settings_json(desk: str = "fast") -> str:
    return json.dumps(settings(desk), sort_keys=True, default=sorted)   # sets become sorted lists


def current(desk: str = "fast") -> str:
    h = hashlib.sha256(settings_json(desk).encode())
    for name in DECISION_CODE + (SLOW_CODE if desk == "slow" else ()):
        if (HERE / name).exists():
            h.update((HERE / name).read_bytes())
    return h.hexdigest()[:8]


if __name__ == "__main__":
    print(current())
