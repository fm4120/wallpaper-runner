# -*- coding: utf-8 -*-
"""Final asset extraction: seamless ground tile + cloud sprites + clean layer profiles."""
import os, json
import numpy as np
from PIL import Image

SRC = os.environ.get("WALLPAPER", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "wallpaper.png"))
OUT = os.path.dirname(os.path.abspath(__file__))
im = Image.open(SRC).convert("RGB")
A4 = np.asarray(im.resize((640, 400), Image.BOX)).astype(np.int32)

# ---------------- 1. seamless ground tile: art rows 362..399 (38 px), width 256 ----------------
Y0, Y1, TW = 362, 400, 256
gt = im.crop((0, Y0 * 4, TW * 4, Y1 * 4)).resize((TW, Y1 - Y0), Image.BOX)
gt = gt.transpose(Image.FLIP_LEFT_RIGHT)          # flip horizontally
gt.resize((TW * 3, (Y1 - Y0) * 3), Image.NEAREST).save(os.path.join(OUT, "tile_ground.png"))
print("ground tile", gt.size)

# ---------------- 2. clouds ----------------
def runs_of(mask):
    rows = []
    for y in range(mask.shape[0]):
        xs = np.where(mask[y])[0]
        if len(xs) == 0:
            rows.append([]); continue
        rs = []; s = xs[0]; p = xs[0]
        for x in xs[1:]:
            if x != p + 1:
                rs.append([int(s), int(p - s + 1)]); s = x
            p = x
        rs.append([int(s), int(p - s + 1)])
        rows.append(rs)
    return rows

band = im.crop((0, 0, 2560, 96 * 4)).resize((640, 96), Image.BOX)
B = np.asarray(band).astype(int)
C1 = np.array([134, 98, 134]); C2 = np.array([112, 84, 116])
m = (np.minimum(((B - C1) ** 2).sum(axis=2), ((B - C2) ** 2).sum(axis=2)) < 1500)
# remove stray single cells
keep = m.copy()
for y in range(m.shape[0]):
    xs = np.where(m[y])[0]
    if len(xs) == 0:
        continue
    s = xs[0]; p = xs[0]
    for x in list(xs[1:]) + [10 ** 6]:
        if x != p + 1:
            if p - s + 1 < 3:
                keep[y, s:p + 1] = False
            s = x
        p = x
m = keep
print("cloud cells:", m.sum())
rows = np.where(m.any(axis=1))[0]
print("cloud rows", rows.min(), rows.max())

rC = runs_of(m)
img = Image.new("RGB", (640, 96), (0, 0, 0))
d = img.load()
for y in range(96):
    for x in range(640):
        if m[y, x]:
            d[x, y] = (255, 255, 255)
img.resize((1280, 192), Image.NEAREST).save(os.path.join(OUT, "mask_cloud.png"))
print("cloud runs:", sum(len(r) for r in rC), "rows with data:", sum(1 for r in rC if r))
open(os.path.join(OUT, "cloud_runs.json"), "w").write(json.dumps(rC))

# ---------------- 3. layer profiles ----------------
def near(c, tol):
    return (abs(A4[:, :, 0] - c[0]) < tol) & (abs(A4[:, :, 1] - c[1]) < tol) & (abs(A4[:, :, 2] - c[2]) < tol)

def firstrun(mask, minrun=3):
    out = []
    H, Wd = mask.shape
    for x in range(Wd):
        y = 0; f = None
        while y < H:
            if mask[y, x]:
                s = y
                while y < H and mask[y, x]:
                    y += 1
                if y - s >= minrun:
                    f = s; break
            else:
                y += 1
        out.append(f)
    return out

def fill_clean(p, ycap, win=9, tol=20):
    a = np.array([v if (v is not None and v < ycap) else np.nan for v in p], float)
    good = np.where(~np.isnan(a))[0]
    a = np.interp(np.arange(len(a)), good, a[good])
    out = a.copy()
    for i in range(len(a)):
        lo, hi = max(0, i - win), min(len(a), i + win + 1)
        med = np.median(a[lo:hi])
        if abs(a[i] - med) > tol:
            out[i] = med
    return out

mid = fill_clean(firstrun(near((47, 33, 56), 26), 4), 330)
far = fill_clean(firstrun(near((80, 46, 73), 20) | near((101, 54, 86), 18), 4), 320)
forest = fill_clean(firstrun(near((22, 8, 5), 20), 4), 400, 7, 16)
for x in range(171, 207):        # character + its tree
    forest[x] = np.nan
good = np.where(~np.isnan(forest))[0]
forest = np.interp(np.arange(640), good, forest[good])

def step4(a):
    return [int(round(a[i])) for i in range(0, len(a), 4)]

MID, FAR, FOREST = step4(mid), step4(far), step4(forest)
print("\nMID   ", json.dumps(MID))
print("\nFAR   ", json.dumps(FAR))
print("\nFOREST", json.dumps(FOREST))
print("\nmid range", min(MID), max(MID), " far range", min(FAR), max(FAR), " forest range", min(FOREST), max(FOREST))

# ---------------- 4. moon ----------------
moon = near((255, 252, 243), 26)
sub = moon[40:150, 250:390]
ys, xs = np.where(sub)
print("\nmoon core bbox x=[%d,%d] y=[%d,%d]" % (xs.min() + 250, xs.max() + 250, ys.min() + 40, ys.max() + 40))
print("  cx=%.1f cy=%.1f rx=%.1f ry=%.1f" % ((xs.min() + xs.max()) / 2 + 250, (ys.min() + ys.max()) / 2 + 40,
                                              (xs.max() - xs.min()) / 2, (ys.max() - ys.min()) / 2))
# glow extent: noticeably lighter than the sky
sky = np.array([171, 106, 140])
diff = A4 - sky
glow = (diff[:, :, 0] > 12) & (diff[:, :, 1] > 12) & (diff[:, :, 2] > 12)
g = glow[30:170, 230:410]
gy, gx = np.where(g)
print("  glow bbox x=[%d,%d] y=[%d,%d] r~%.1f" % (gx.min() + 230, gx.max() + 230, gy.min() + 30, gy.max() + 30,
                                                  (gx.max() - gx.min()) / 2))
open(os.path.join(OUT, "layers.json"), "w").write(json.dumps({"MID": MID, "FAR": FAR, "FOREST": FOREST}))
print("\nwrote layers.json")
