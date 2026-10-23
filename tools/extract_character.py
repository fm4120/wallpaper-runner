# -*- coding: utf-8 -*-
"""Character sprite extraction (clean) + sky palette + parallax layer profiles."""
import os, json, math
from collections import Counter
from PIL import Image

SRC = os.environ.get("WALLPAPER", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "wallpaper.png"))
OUT = os.path.dirname(os.path.abspath(__file__))
im = Image.open(SRC).convert("RGB")
W, H = im.size
px = im.load()
def hx(c): return "#%02x%02x%02x" % (c[0], c[1], c[2])

# ---------------- 1. character sprite ----------------
CX0, CY0, CX1, CY1 = 680, 1336, 824, 1472
# A pixel belongs to the sprite if it is NOT forest-dark. Forest dark ~ (22,9,6).
# Sprite dark outline is much lighter/warmer? check its value:
print("sprite-window darkest / most common colors:")
cnt = Counter()
for y in range(CY0, CY1):
    for x in range(CX0, CX1):
        cnt[hx(px[x, y])] += 1
for c, n in cnt.most_common(12):
    print("   ", c, n)

def is_sprite(c):
    # exclude the near-black forest background (very dark + low saturation)
    return not (c[0] < 46 and c[1] < 30 and c[2] < 30)

xs, ys = [], []
for y in range(CY0, CY1):
    for x in range(CX0, CX1):
        if is_sprite(px[x, y]):
            xs.append(x); ys.append(y)
bb = (min(xs), min(ys), max(xs)+1, max(ys)+1)
print("\nsprite bbox", bb, "size", (bb[2]-bb[0], bb[3]-bb[1]), "-> art px /4:", ((bb[2]-bb[0])/4, (bb[3]-bb[1])/4))

# snap to the 4px wall grid (verified offset ox=3, oy=0 from earlier fit)
GX = bb[0] - ((bb[0] - 3) % 4)
GY = bb[1] - ((bb[1] - 0) % 4)
NX = (bb[2] - GX + 3)//4
NY = (bb[3] - GY + 3)//4
print("grid origin", GX, GY, "cells", NX, NY)

grid = []
for gy in range(NY):
    row = []
    for gx in range(NX):
        x, y = GX + gx*4, GY + gy*4
        cs = [px[min(W-1,x+i), min(H-1,y+j)] for i in range(4) for j in range(4)]
        # representative = pixel closest to the block mean (robust to jpeg ringing)
        mr = sum(c[0] for c in cs)/16; mg = sum(c[1] for c in cs)/16; mb = sum(c[2] for c in cs)/16
        best = min(cs, key=lambda c: (c[0]-mr)**2 + (c[1]-mg)**2 + (c[2]-mb)**2)
        row.append(best)
    grid.append(row)

# classify
def is_bg(c): return c[0] < 46 and c[1] < 30 and c[2] < 30
# palette clustering with radius 26
palette = []
def find_cluster(c):
    for i, (rc, n) in enumerate(palette):
        if abs(rc[0]-c[0]) + abs(rc[1]-c[1]) + abs(rc[2]-c[2]) < 78:
            # running average
            palette[i] = (((rc[0]*n + c[0])//(n+1), (rc[1]*n + c[1])//(n+1), (rc[2]*n + c[2])//(n+1)), n+1)
            return i
    palette.append((c, 1))
    return len(palette)-1

sym_index = {}
rows_idx = []
for gy in range(NY):
    r = []
    for gx in range(NX):
        c = grid[gy][gx]
        if is_bg(c):
            r.append(-1)
        else:
            r.append(find_cluster(c))
    rows_idx.append(r)

# order clusters by frequency for nice letter assignment
freq = Counter(i for r in rows_idx for i in r if i >= 0)
order = [i for i, _ in freq.most_common()]
letters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
remap = {ci: k for k, ci in enumerate(order)}

print("\n=== FINAL SPRITE (%d x %d art px) ===" % (NX, NY))
ART = []
for gy in range(NY):
    line = ""
    arow = []
    for gx in range(NX):
        ci = rows_idx[gy][gx]
        if ci < 0:
            line += "."
            arow.append(-1)
        else:
            line += letters[remap[ci]]
            arow.append(remap[ci])
    print("  " + line)
    ART.append(arow)

print("\n=== SPRITE PALETTE (%d colors) ===" % len(order))
pal_out = []
for k, ci in enumerate(order):
    c, n = palette[ci]
    pal_out.append(hx(c))
    print("  %s  %s   cells=%d" % (letters[k], hx(c), n))
print("  PALETTE_JS =", json.dumps(pal_out))
print("  SPRITE_JS  =", json.dumps([["." if v < 0 else letters[v] for v in row] for row in ART]))

# render check: magnified sprite next to the original crop
SC = 8
chk = Image.new("RGB", ((NX + 4) * SC, NY * SC), (16, 8, 6))
for gy in range(NY):
    for gx in range(NX):
        ci = rows_idx[gy][gx]
        col = (24, 10, 8) if ci < 0 else palette[ci][0]
        for i in range(SC):
            for j in range(SC):
                chk.putpixel((gx*SC+i, gy*SC+j), col)
crop = im.crop((bb[0], bb[1], bb[0] + NX*4, bb[1] + NY*4)).resize((NX*SC, NY*SC), Image.NEAREST)
chk.paste(crop, ((NX + 4) * SC - NX*SC, 0))
chk.save(os.path.join(OUT, "check_sprite.png"))
print("\nsaved check_sprite.png", chk.size)

# ---------------- 2. sky gradient ----------------
print("\n=== sky gradient (average of x=0..40 and x=W-40..W columns) ===")
stops = []
for y in range(0, 1360, 20):
    cols = [px[x, y] for x in list(range(0, 40)) + list(range(W-40, W))]
    n = len(cols)
    m = (sum(c[0] for c in cols)//n, sum(c[1] for c in cols)//n, sum(c[2] for c in cols)//n)
    stops.append((y, m))
for y, m in stops:
    print("   y=%4d pct=%5.1f  %s" % (y, 100.0*y/H, hx(m)))
print("  SKY_JS =", json.dumps([[round(y/H, 4), hx(m)] for y, m in stops]))

# ---------------- 3. silhouette profiles ----------------
def profile(pred, ytop, ybot, n=160):
    """first y (from top) where pred() becomes true, sampled at n positions"""
    out = []
    for i in range(n):
        x = int(W * (i + 0.5) / n)
        x = min(W-1, x)
        v = ybot
        for y in range(ytop, ybot):
            if pred(px[x, y]):
                v = y
                break
        out.append(v)
    return out

DARKISH = lambda c: c[0] < 60 and c[1] < 45 and c[2] < 62
NEARBLACK = lambda c: c[0] < 46 and c[1] < 30 and c[2] < 30
LITPINK = lambda c: c[0] > 190 and 100 < c[1] < 175 and 120 < c[2] < 190
DARKEST = lambda c: c[0] < 56 and c[1] < 45 and c[2] < 66

forest_top = profile(NEARBLACK, 1000, 1470, 160)
print("\n=== near-forest top profile (160 samples, y) ===")
print(" ", forest_top)
print("  FOREST_JS =", json.dumps([round(v/H, 4) for v in forest_top]))

# mid mountains = dark purple #2f2138 (47,33,56)
MID = lambda c: abs(c[0]-47) < 16 and abs(c[1]-33) < 16 and abs(c[2]-56) < 18
mid_top = profile(MID, 700, 1400, 160)
print("\n=== mid mountain (#2f2138) top profile ===")
print(" ", mid_top)
print("  MID_JS =", json.dumps([round(v/H, 4) for v in mid_top]))

# far mountains = #502e49 (80,46,73) and lit #653656
FAR = lambda c: (abs(c[0]-80) < 20 and abs(c[1]-46) < 18 and abs(c[2]-73) < 20) or \
                (abs(c[0]-101) < 18 and abs(c[1]-54) < 16 and abs(c[2]-86) < 18)
far_top = profile(FAR, 620, 1400, 160)
print("\n=== far mountain (#502e49/#653656) top profile ===")
print(" ", far_top)
print("  FAR_JS =", json.dumps([round(v/H, 4) for v in far_top]))

# the pink lit ridge
pink_top = profile(LITPINK, 600, 1400, 160)
print("\n=== lit ridge (pink) top profile ===")
print(" ", pink_top)
print("  PINK_JS =", json.dumps([round(v/H, 4) if v < 1400 else None for v in pink_top]))

# ---------------- 4. moon ----------------
print("\n=== moon geometry ===")
MC = lambda c: c[0] > 240 and c[1] > 235 and c[2] > 215
xs, ys = [], []
for y in range(0, 700):
    for x in range(900, 1700):
        if MC(px[x, y]):
            xs.append(x); ys.append(y)
print("  moon bbox", min(xs), min(ys), max(xs), max(ys), "size", max(xs)-min(xs), max(ys)-min(ys))
print("  center pct: x=%.4f y=%.4f  r=%.4f (w) %.4f (h)" % (
    (min(xs)+max(xs))/2/W, (min(ys)+max(ys))/2/H, (max(xs)-min(xs))/2/W, (max(ys)-min(ys))/2/H))
print("  moon color:", hx(px[(min(xs)+max(xs))//2, (min(ys)+max(ys))//2]))

# ---------------- 5. clouds ----------------
print("\n=== lower cloud color (x=2100..2500, y=600..700) ===")
cnt = Counter()
for y in range(600, 700):
    for x in range(2100, 2500, 3):
        cnt[hx(px[x, y])] += 1
for c, n in cnt.most_common(6): print("   ", c, n)
