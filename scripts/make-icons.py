#!/usr/bin/env python3
"""Draw the app icons (terracotta tile, cream arched doorway, cypress) as PNGs, no dependencies."""
import os, struct, zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
TERRA, CREAM, OCHRE, CYPRESS, DARK = (184, 83, 47), (244, 233, 212), (217, 164, 65), (63, 82, 51), (143, 59, 30)

def render(size, pad):
    """pad = fraction of the tile left empty around the art (bigger for maskable)."""
    s = size
    u = s * (1 - 2 * pad) / 512          # scale from the 512 design grid
    ox = oy = s * pad
    px = bytearray()
    for y in range(s):
        px.append(0)  # PNG filter byte
        for x in range(s):
            gx, gy = (x - ox) / u, (y - oy) / u   # design coords
            c = TERRA
            def arch(cx, top, half, base):
                if gy > base or abs(gx - cx) > half: return False
                if gy >= top + half: return True
                return (gx - cx) ** 2 + (gy - (top + half)) ** 2 <= half ** 2
            def cypress(cx):
                if not (230 <= gy <= 400): return False
                t = (gy - 230) / 170
                return abs(gx - cx) <= 20 * (0.2 + 0.8 * min(1, t * 1.6)) * (1 if t < .9 else 1)
            if arch(256, 140, 110, 400): c = CREAM
            if arch(256, 172, 80, 400): c = OCHRE
            if cypress(116) or cypress(396): c = CYPRESS
            if 400 < gy <= 414 and 70 <= gx <= 442: c = DARK
            px += bytes(c)
    return bytes(px)

def png(size, pad):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xffffffff)
    raw = render(size, pad)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

os.makedirs(OUT, exist_ok=True)
for name, size, pad in [("icon-192.png", 192, 0.0), ("icon-512.png", 512, 0.0),
                        ("icon-maskable-512.png", 512, 0.12), ("apple-touch-icon.png", 180, 0.0)]:
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(png(size, pad))
    print("wrote", name)
