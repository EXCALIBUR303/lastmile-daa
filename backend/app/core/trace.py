"""Step-event tracer.

Every algorithm takes `tracer` as its last optional argument and behaves
identically when it is None -- that is what keeps the benchmark path
allocation-free while the dashboard path is fully instrumented, from the same
source.  There is no "demo version" of any algorithm.

Guardrail: the buffer can never grow without bound.  When it hits MAX it is
decimated in place and the sampling stride doubles, so an arbitrarily long run
still produces a bounded, replayable trace.
"""
from __future__ import annotations

from typing import Any

from app.models import Step


class Tracer:
    MAX = 50_000

    def __init__(self, enabled: bool = True, max_steps: int | None = None) -> None:
        self.enabled = enabled
        self.max = max_steps or self.MAX
        self.steps: list[Step] = []
        self.ops = 0
        self.stride = 1
        self.truncated = False
        self._seen = 0
        self._counts: dict[str, int] = {}

    # -- emitting ---------------------------------------------------------- #

    def emit(self, stage: str, kind: str, **payload: Any) -> None:
        self.ops += 1
        self._counts[stage] = self._counts.get(stage, 0) + 1
        if not self.enabled:
            return
        self._seen += 1
        if self._seen % self.stride:
            return
        if len(self.steps) >= self.max:
            # decimate: keep every other step, halve the future sampling rate
            self.steps = self.steps[::2]
            self.stride *= 2
            self.truncated = True
        self.steps.append(Step(stage=stage, kind=kind, payload=payload, ops=self.ops))

    def count(self, stage: str, n: int = 1) -> None:
        """Bump the op counter without recording a step (for inner loops that
        would drown the trace but still belong in the complexity numbers)."""
        self.ops += n
        self._counts[stage] = self._counts.get(stage, 0) + n

    # -- reporting --------------------------------------------------------- #

    @property
    def op_counts(self) -> dict[str, int]:
        return dict(self._counts)

    def __len__(self) -> int:
        return len(self.steps)


NULL_TRACER = Tracer(enabled=False)
