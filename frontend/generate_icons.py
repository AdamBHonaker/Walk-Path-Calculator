import zlib
import struct
from pathlib import Path

public_dir = Path(__file__).resolve().parent / "public"
public_dir.mkdir(parents=True, exist_ok=True)


def chunk(data: bytes) -> bytes:
    return struct.pack("!I", len(data)) + data + struct.pack("!I", zlib.crc32(data) & 0xFFFFFFFF)


def make_png(path: Path, width: int, height: int, color: tuple[int, int, int]) -> None:
    raw = b"".join(bytes([0]) + bytes(color) * width for _ in range(height))
    png = bytes([137, 80, 78, 71, 13, 10, 26, 10])
    png += chunk(b"IHDR" + struct.pack("!2I5B", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT" + zlib.compress(raw, 9))
    png += chunk(b"IEND")
    path.write_bytes(png)


make_png(public_dir / "icon-192.png", 192, 192, (45, 122, 62))
make_png(public_dir / "icon-512.png", 512, 512, (45, 122, 62))
print("Created frontend/public/icon-192.png and icon-512.png")
