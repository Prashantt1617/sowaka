#!/usr/bin/env python3
"""Builds Speed Poker's page: src.html with the Socket.IO client that Tile Up's
page already carries (4.8.3, inlined: the game page may load nothing from
anywhere), written to backend/game-pages/speed-poker.html for the catalog.

    python3 games-web/speed-poker/build.py
"""
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parent.parent
src = (here / 'src.html').read_text()
tile = (root / 'backend/game-pages/tile-up.html').read_text()

start = tile.index('<script>\n/*!\n * Socket.IO')
end = tile.index('</script>', start) + len('</script>')
client = tile[start:end]
assert 'Socket.IO v4.8.3' in client, 'expected the Socket.IO 4.8.3 client in tile-up.html'

out = src.replace('<!--SOCKET-IO-->', client, 1)
assert '<!--POKER-TICKET-->' in out
target = root / 'backend/game-pages/speed-poker.html'
target.write_text(out)
print(f'{target.relative_to(root)}: {len(out.encode()) / 1024:.0f} KB')
