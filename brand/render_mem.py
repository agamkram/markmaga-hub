#!/usr/bin/env python3
"""
MEM monogram v2 for markmaga.com hub icons.

- First M: outer leg 45°, inner leg vertical (= left of E)
- E: three bars between two verticals (boxed, 8-like)
- Last M: inner leg vertical (= right of E), outer leg 45°

Usage:
  python3 brand/render_mem.py
"""
from __future__ import annotations

import io
import math
import struct
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent


def draw_mem(size=1024, bg=(8, 12, 18), fg=(232, 237, 244), sw_ratio=0.168):
    im = Image.new("RGB", (size, size), bg)
    d = ImageDraw.Draw(im)

    PAD = 100
    H = 420
    TOP = (1000 - H) / 2
    BOT = TOP + H
    DX = H  # 45°
    SW = max(52, H * sw_ratio)
    peak_gap = H * 0.38
    e_box = H * 0.55
    crotch_drop = H * 0.50

    total_w = DX + peak_gap + e_box + peak_gap + DX
    avail = 1000 - 2 * PAD
    if total_w > avail:
        sc = avail / total_w
        H *= sc
        DX *= sc
        peak_gap *= sc
        e_box *= sc
        crotch_drop *= sc
        SW *= sc
        TOP = (1000 - H) / 2
        BOT = TOP + H
        total_w = DX + peak_gap + e_box + peak_gap + DX

    x0 = PAD + (avail - total_w) / 2
    baseL = x0
    p1 = baseL + DX
    v1 = p1 + peak_gap
    v2 = v1 + e_box
    p3 = v2 + peak_gap
    baseR = p3 + DX

    c1x = (p1 + v1) / 2
    c2x = (v2 + p3) / 2
    c1y = TOP + crotch_drop
    c2y = TOP + crotch_drop

    def stroke_poly(pts):
        sp = [(x * size / 1000.0, y * size / 1000.0) for x, y in pts]
        w = max(2, int(round(SW * size / 1000.0)))
        d.line(sp, fill=fg, width=w, joint="curve")
        r = w / 2.0
        for x, y in sp:
            d.ellipse([x - r, y - r, x + r, y + r], fill=fg)

    def stroke_seg(a, b):
        stroke_poly([a, b])

    # M1
    stroke_poly([(baseL, BOT), (p1, TOP), (c1x, c1y), (v1, TOP)])
    stroke_seg((v1, TOP), (v1, BOT))

    # E bars
    inset = SW * 0.12
    y_top = TOP + inset
    y_bot = BOT - inset
    y_mid = (y_top + y_bot) / 2
    for y in (y_top, y_mid, y_bot):
        stroke_seg((v1, y), (v2, y))

    # M2
    stroke_seg((v2, BOT), (v2, TOP))
    stroke_poly([(v2, TOP), (c2x, c2y), (p3, TOP), (baseR, BOT)])

    assert abs(math.degrees(math.atan2(H, DX)) - 45.0) < 0.01
    return im


def save_favicon_ico(path: Path) -> None:
    """Multi-size ICO for /favicon.ico probes (Google, Vercel, old browsers)."""
    frames = [
        draw_mem(16, fg=(255, 255, 255), sw_ratio=0.28),
        draw_mem(32, fg=(255, 255, 255), sw_ratio=0.22),
        draw_mem(48, fg=(255, 255, 255), sw_ratio=0.20),
    ]
    payloads = []
    for im in frames:
        buf = io.BytesIO()
        im.convert("RGBA").save(buf, format="PNG")
        payloads.append(buf.getvalue())
    offset = 6 + 16 * len(frames)
    out = bytearray(struct.pack("<HHH", 0, 1, len(frames)))
    for im, payload in zip(frames, payloads):
        w, h = im.size
        out += struct.pack(
            "<BBBBHHII",
            w if w < 256 else 0,
            h if h < 256 else 0,
            0,
            0,
            1,
            32,
            len(payload),
            offset,
        )
        offset += len(payload)
    for payload in payloads:
        out += payload
    path.write_bytes(bytes(out))


def main():
    suite = [
        (1024, "mem-review-1024.png", 0.168),
        (512, "icon-512.png", 0.175),
        (192, "icon-192.png", 0.185),
        (180, "apple-touch-icon.png", 0.185),
        (64, "favicon-64.png", 0.20),
        (32, "favicon-32.png", 0.22),
    ]
    for sz, name, swr in suite:
        fg = (255, 255, 255) if sz <= 32 else (232, 237, 244)
        draw_mem(sz, fg=fg, sw_ratio=swr).save(OUT / name)
        print("saved", name)

    ico = OUT / "favicon.ico"
    save_favicon_ico(ico)
    print("saved", ico.name)
    root_ico = OUT.parent / "favicon.ico"
    root_ico.write_bytes(ico.read_bytes())
    print("copied", root_ico.name, "to site root")


if __name__ == "__main__":
    main()
