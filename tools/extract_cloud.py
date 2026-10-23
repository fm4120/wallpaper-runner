import os, json
import numpy as np
from PIL import Image
SRC = os.environ.get("WALLPAPER", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "wallpaper.png"))
OUT = os.path.dirname(os.path.abspath(__file__))
im = Image.open(SRC).convert("RGB")
band = im.crop((0, 0, 2560, 84 * 4)).resize((640, 84), Image.BOX)
B = np.asarray(band).astype(int)
m = (np.abs(B - np.array([134, 98, 134])).sum(axis=2) < 34)
m[78:, :] = False                 # kill the dither band
m[:, 508:] = False                # kill the HUD glyphs
# despeckle: drop runs < 3
for y in range(84):
    xs = np.where(m[y])[0]
    if len(xs) == 0: continue
    s = xs[0]; p = xs[0]
    for x in list(xs[1:]) + [10**6]:
        if x != p + 1:
            if p - s + 1 < 3: m[y, s:p+1] = False
            s = x
        p = x
print("cloud cells", m.sum())
rows = np.where(m.any(axis=1))[0]
print("rows", rows.min(), rows.max())
img = Image.new("RGB", (640, 84), (0,0,0)); d = img.load()
for y in range(84):
    for x in range(640):
        if m[y,x]: d[x,y] = (255,255,255)
img.resize((1280,168), Image.NEAREST).save(os.path.join(OUT, "mask_cloud_final.png"))
rs = []
for y in range(84):
    xs = np.where(m[y])[0]
    if len(xs)==0: rs.append([]); continue
    out=[]; s=xs[0]; p=xs[0]
    for x in list(xs[1:])+[10**6]:
        if x != p+1: out.append([int(s), int(p-s+1)]); s=x
        p=x
    rs.append(out)
open(os.path.join(OUT,"cloud_runs.json"),"w").write(json.dumps(rs))
print("runs total", sum(len(r) for r in rs), "rows with data", sum(1 for r in rs if r))
print("saved mask_cloud_final.png + cloud_runs.json")
