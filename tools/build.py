# -*- coding: utf-8 -*-
"""Assemble src/ + extracted data -> single self-contained HTML file."""
import os, json, io, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'src')
TOOLS = HERE

art = json.load(open(os.path.join(TOOLS, 'art.json'), encoding='utf-8'))
cloud = json.load(open(os.path.join(TOOLS, 'cloud_runs.json'), encoding='utf-8'))

def js(o):
    return json.dumps(o, separators=(',', ':'))

art_js = (
    "/* ---- generated from the wallpaper by tools/mksprites.py ---- */\n"
    "var APAL = " + js(art['pal']) + ";\n"
    "var ART = " + js(art['art']) + ";\n"
    "var CLOUD_RUNS = " + js(cloud) + ";\n"
)

core = open(os.path.join(SRC, 'game_core.js'), encoding='utf-8').read()
world = open(os.path.join(SRC, 'game_world.js'), encoding='utf-8').read()
render = open(os.path.join(SRC, 'game_render.js'), encoding='utf-8').read()
shell = open(os.path.join(SRC, 'shell.html'), encoding='utf-8').read()

core = core.replace('/*__CLOUD_RUNS__*/[]', '[]')
payload = art_js + "\n" + core + "\n" + world + "\n" + render
html = shell.replace('/*__GAME__*/', payload)

out = os.path.join(ROOT, 'wallpaper-runner.html')
open(out, 'w', encoding='utf-8').write(html)
print('wrote %s  (%d bytes, %d lines)' % (out, len(html.encode('utf-8')), html.count('\n') + 1))
