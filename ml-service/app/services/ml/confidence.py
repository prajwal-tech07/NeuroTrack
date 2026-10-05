from typing import Any, Dict, Iterable


def coverage_confidence(modules: Dict[str, Any], relevant: Iterable[str]) -> float:
    """
    Confidence of a rule-based condition score, derived from the evidence it
    actually had: how many of the relevant tests were completed, and how good
    their recordings were. 1.0 only when every relevant test ran at full quality.

    This replaces fixed constants (0.86, 0.92 ...) that implied a measured
    accuracy the rules have never been validated against.
    """
    relevant = list(relevant)
    if not relevant:
        return 0.0
    total = 0.0
    for key in relevant:
        m = modules.get(key)
        if m and m.get("completed", True):
            total += max(0.0, min(1.0, float(m.get("quality", 1.0))))
    return round(total / len(relevant), 3)
