"""TD-058 / B-26 — atomic-write helper for ingest scripts."""

import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import pytest

from _atomic_write import atomic_write_json, atomic_write_text


class TestAtomicWriteText:
    def test_writes_text_to_new_file(self, tmp_path):
        target = tmp_path / "out.txt"
        atomic_write_text(target, "hello\n")
        assert target.read_text() == "hello\n"

    def test_replaces_existing_file(self, tmp_path):
        target = tmp_path / "out.txt"
        target.write_text("old\n")
        atomic_write_text(target, "new\n")
        assert target.read_text() == "new\n"

    def test_does_not_leave_tmp_file_on_success(self, tmp_path):
        target = tmp_path / "out.txt"
        atomic_write_text(target, "ok\n")
        # The intermediate .tmp file must be gone after a successful replace.
        assert not (tmp_path / "out.txt.tmp").exists()


class TestAtomicWriteJson:
    def test_writes_compact_json_by_default(self, tmp_path):
        target = tmp_path / "out.json"
        atomic_write_json(target, {"a": 1, "b": [2, 3]})
        # Compact: no whitespace between separators.
        assert target.read_text() == '{"a": 1, "b": [2, 3]}'

    def test_writes_pretty_json_with_indent(self, tmp_path):
        target = tmp_path / "out.json"
        atomic_write_json(target, {"a": 1}, indent=2)
        data = json.loads(target.read_text())
        assert data == {"a": 1}
        # Pretty: contains newlines.
        assert "\n" in target.read_text()

    def test_replace_is_atomic_against_uncaught_exception(self, tmp_path, monkeypatch):
        """If the write fails mid-stream, the prior good file must remain.
        The helper writes to *.tmp then os.replace; an exception before
        replace leaves the original untouched."""
        target = tmp_path / "out.json"
        target.write_text('{"existing": true}')

        # Force the JSON encoder to raise mid-encode by passing an
        # unserializable object. The exception propagates out of
        # atomic_write_json before any os.replace, so the original file
        # must be unchanged.
        with pytest.raises(TypeError):
            atomic_write_json(target, {"bad": object()})

        assert target.read_text() == '{"existing": true}'
