#!/usr/bin/env python3
"""Builds Sowaka Pool's page: src.html with (1) the Socket.IO client that Tile Up's
page already carries (4.8.3, inlined: the game page may load nothing from anywhere),
(2) the shared engine, backend/src/shared/pool/engine.ts, bundled with esbuild as
window.PoolEngine (the page's physics and 8-ball rules are the server's), and (3) the
ticket marker the server replaces with window.__POOL, written to
backend/game-pages/pool.html for the catalog.

    python3 games-web/pool/build.py
"""
import shutil
import subprocess
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parent.parent
src = (here / 'src.html').read_text()
tile = (root / 'backend/game-pages/tile-up.html').read_text()

start = tile.index('<script>\n/*!\n * Socket.IO')
end = tile.index('</script>', start) + len('</script>')
client = tile[start:end]
assert 'Socket.IO v4.8.3' in client, 'expected the Socket.IO 4.8.3 client in tile-up.html'

esbuild = root / 'node_modules/.bin/esbuild'
cmd = [str(esbuild)] if esbuild.exists() else ([shutil.which('esbuild')] if shutil.which('esbuild') else ['npx', '--no-install', 'esbuild'])
engine = subprocess.run(
    cmd + ['backend/src/shared/pool/engine.ts', '--bundle', '--format=iife', '--global-name=PoolEngine', '--minify'],
    cwd=root, check=True, capture_output=True, text=True).stdout.strip()
assert 'PoolEngine' in engine and 'simulateShot' in engine, 'the engine bundle looks wrong'
engine_tag = '<script>\n/* the shared engine: backend/src/shared/pool/engine.ts, as window.PoolEngine */\n' + engine + '\n</script>'

assert src.count('<!--SOCKET-IO-->') == 1 and src.count('<!--POOL-ENGINE-->') == 1
out = src.replace('<!--SOCKET-IO-->', client, 1).replace('<!--POOL-ENGINE-->', engine_tag, 1)
head = out[:out.index('</head>')]
assert '<!--POOL-TICKET-->' in head, 'the ticket marker must be in <head>'
target = root / 'backend/game-pages/pool.html'
target.write_text(out)
print(f'{target.relative_to(root)}: {len(out.encode()) / 1024:.0f} KB')
