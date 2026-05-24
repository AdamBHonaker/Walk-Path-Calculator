"""Atomic-write helper for ingest scripts (TD-058 / B-26).

The ingest scripts under `backend/scripts/build_*.py` write large JSON
artifacts (places, residential polygons, parks, etc.) by opening the
target path in write-truncate mode and streaming content into it. A
keyboard interrupt mid-write — or any uncaught exception inside the
writer — leaves the artifact in a torn state: partial JSON, unparseable
on the next runtime load, and the prior good copy gone.

This module provides `atomic_write_json` and `atomic_write_text` helpers
that write to a sibling `*.tmp` file then `os.replace` into place. The
replace is atomic on every supported filesystem (POSIX `rename`, Windows
`MoveFileExW(MOVEFILE_REPLACE_EXISTING)`), so either the new bytes are
fully visible or the old file is untouched — never a partial-write
visible to the runtime.

Scripts adopt this incrementally; not every ingest script has been
refactored yet (catalog deferred the full `_ingest_runner.py` shared
module). Use these helpers in new scripts and when touching existing
ones for other reasons.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def atomic_write_text(path: Path | str, text: str, *, encoding: str = "utf-8") -> None:
    """Write `text` to `path` atomically. Intermediate file is `path + .tmp`.

    On success the prior file at `path` is replaced; on failure (write
    error, unclean interrupt before `os.replace`) the `.tmp` file may be
    left behind, but the original `path` is untouched.
    """
    target = Path(path)
    tmp = target.with_name(target.name + ".tmp")
    # Use binary mode to bypass the platform's text-mode newline translation
    # (we control the bytes ourselves; otherwise a Windows write might add
    # an extra CR that subsequent UTF-8 reads choke on).
    with open(tmp, "wb") as f:
        f.write(text.encode(encoding))
        f.flush()
        try:
            os.fsync(f.fileno())
        except (AttributeError, OSError):
            # fsync isn't available on every filesystem (network shares,
            # some sandboxed environments). The os.replace below is still
            # atomic from the OS's perspective; fsync just hardens against
            # a crash-between-write-and-replace data loss.
            pass
    os.replace(tmp, target)


def atomic_write_json(path: Path | str, payload: Any, *, indent: int | None = None) -> None:
    """Write a JSON-serializable object to `path` atomically.

    `indent=None` (default) produces compact output; pass `indent=2` for
    pretty-printed artifacts (use sparingly — pretty-print roughly
    doubles file size on the typical places.json shape).
    """
    text = json.dumps(payload, indent=indent, ensure_ascii=False)
    atomic_write_text(path, text)
