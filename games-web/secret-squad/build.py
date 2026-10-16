#!/usr/bin/env python3
# Builds Secret Squad's game page from:
#   src.html    the page shell and its styles (markers: /*FONTS*/, <!--VENDOR-->, <!--LIVE-->, <!--PREVIEW-->, /*GAME*/, <!--SQUAD-TICKET-->)
#   game.js     the game itself: every screen, driven by `squad:state` (docs/secret-squad.md)
#   live.js     the real server's socket (socket.io /squad on /connect/socket) and the in-app policy hop
#   preview.js  a simulated server and office, for clicking through every state without a backend
#   vendor/     pinned third-party code and fonts, checked against the SHA-256 sums below before anything is written
# It writes:
#   backend/game-pages/secret-squad.html     the live build (what the server serves at /play/secret-squad and /squad);
#                                            the server replaces <!--SQUAD-TICKET--> with window.__SQUAD = {...}
#   <out>/secret-squad-preview.html          the simulated build (no socket client, no live.js): open it in a browser
#   <out>/secret-squad-live.html             a copy of the live build, for local tests against a mock server
# <out> is --out DIR, else $SQUAD_OUT, else games-web/secret-squad/build/ (ignored by git).
# Nothing is fetched at build time or at run time: fonts and libraries are inlined.
import base64, hashlib, os, re, sys

D = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(D, '..', '..'))
APP = os.path.join(REPO, 'backend', 'game-pages', 'secret-squad.html')
V = os.path.join(D, 'vendor')

# name: (file, sha256, what it is)
PINNED = {
    'io':     ('socket.io-client-4.8.3.min.js', '7bcff1b4f1442787ff11dfc510dedb8de16502ff5c987c4bbeb477605f76d9a0', 'socket.io-client 4.8.3, dist/socket.io.min.js (MIT)'),
    'qr':     ('qrcode-generator-2.0.4.js',     '79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c', 'qrcode-generator 2.0.4, dist/qrcode.js (MIT, Kazuhiko Arase)'),
    'jsqr':   ('jsQR-1.4.0.js',                 'bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859', 'jsQR 1.4.0, dist/jsQR.js (Apache-2.0, Cosmo Wolfe)'),
    'jsqrl':  ('jsQR-LICENSE.txt',              'c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08', 'jsQR 1.4.0 LICENSE (Apache-2.0)'),
    'lexend': ('Lexend.woff2',                  '3ea892cc191dfa9c14e361d5573bd85fdff5b44de208ed521a600431261e4996', 'Lexend variable 1.007 (wght 100-900), latin subset (OFL)'),
    'lexendl':('Lexend-OFL.txt',                '5da8505887d0fa7fe963445fd58852707fda34adfeb65af25c99d152bab285bd', 'Lexend OFL licence'),
}
# The npm tarballs these came from, as the registry lists them (dist.integrity):
#   jsqr@1.4.0             sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==
#   qrcode-generator@2.0.4 sha512-mZSiP6RnbHl4xL2Ap5HfkjLnmxfKcPWpWe/c+5XxCuetEenqmNFf1FH/ftXPCtFG5/TDobjsjz6sSNL0Sr8Z9g==
# Lexend.woff2 is the app's own font (mobile-app/assets/fonts/lexend/Lexend-Variable.ttf, sha256 3add53e6…832ee6), cut to Latin as Google
# Fonts' latin range and packed as woff2 with fontTools 4.67:
#   pyftsubset Lexend-Variable.ttf --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,
#     U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD" --layout-features='*' --flavor=woff2 --output-file=Lexend.woff2


def pinned(key):
    name, sha, what = PINNED[key]
    data = open(os.path.join(V, name), 'rb').read()
    got = hashlib.sha256(data).hexdigest()
    assert got == sha, '%s changed: %s (expected %s)' % (what, got, sha)
    return data


def script_text(key):
    text = pinned(key).decode('utf-8')
    # Inlined in a <script> element: nothing in it may close the element or open an HTML comment.
    assert '</script' not in text.lower() and '<!--' not in text, PINNED[key][2] + ' cannot be inlined as it is'
    return text.strip()


def read(name):
    return open(os.path.join(D, name), encoding='utf-8').read()


def main(argv):
    out = None
    for i, a in enumerate(argv):
        if a.startswith('--out='):
            out = a.split('=', 1)[1]
        elif a == '--out' and i + 1 < len(argv):
            out = argv[i + 1]
    out = os.path.abspath(out or os.environ.get('SQUAD_OUT') or os.path.join(D, 'build'))
    os.makedirs(out, exist_ok=True)

    b64 = lambda k: base64.b64encode(pinned(k)).decode()
    fonts = ("@font-face{font-family:'Lexend';font-style:normal;font-weight:100 900;font-display:block;src:url(data:font/woff2;base64,%s) format('woff2')}"
             ) % b64('lexend')
    pinned('jsqrl')    # the licences travel with the source; checked like the rest
    pinned('lexendl')
    vendor = ('<script>\n/*! qrcode-generator 2.0.4 | MIT | (c) 2009 Kazuhiko Arase | https://github.com/kazuhikoarase/qrcode-generator */\n' + script_text('qr') + '\n</script>\n'
              '<script>\n/*! jsQR 1.4.0 | Apache-2.0 | (c) Cosmo Wolfe | https://github.com/cozmo/jsQR | licence: games-web/secret-squad/vendor/jsQR-LICENSE.txt */\n' + script_text('jsqr') + '\n</script>')
    io = script_text('io')
    assert 'Socket.IO v4.8.3' in io

    src = read('src.html')
    game, live, preview = read('game.js'), read('live.js'), read('preview.js')
    for marker in ['/*FONTS*/', '<!--VENDOR-->', '<!--LIVE-->', '<!--PREVIEW-->', '/*GAME*/', '<!--SQUAD-TICKET-->']:
        assert src.count(marker) == 1, 'src.html needs exactly one ' + marker
    for name, js in [('game.js', game), ('live.js', live), ('preview.js', preview)]:
        assert '</script' not in js.lower() and '<!--' not in js, name + ' cannot be inlined as it is'

    def page(with_live, with_preview):
        html = src.replace('/*FONTS*/', fonts, 1).replace('<!--VENDOR-->', vendor, 1).replace('/*GAME*/', game.strip(), 1)
        html = html.replace('<!--LIVE-->', ('<script>\n' + io + '\n</script>\n<script>\n' + live.strip() + '\n</script>') if with_live else '', 1)
        html = html.replace('<!--PREVIEW-->', ('<script>\n' + preview.strip() + '\n</script>') if with_preview else '', 1)
        return html

    live_page = page(True, False)
    assert live_page.count('<!--SQUAD-TICKET-->') == 1 and 'window.SquadLive' in live_page and 'SquadPreview={' not in live_page
    assert not re.search(r'(src|href)\s*=\s*["\']?https?:', live_page), 'the page must not load anything from the network'
    preview_page = page(False, True).replace('<!--SQUAD-TICKET-->\n', '', 1)
    assert 'window.SquadPreview' in preview_page and 'Socket.IO v4.8.3' not in preview_page

    open(APP, 'w', encoding='utf-8').write(live_page)
    open(os.path.join(out, 'secret-squad-live.html'), 'w', encoding='utf-8').write(live_page)
    open(os.path.join(out, 'secret-squad-preview.html'), 'w', encoding='utf-8').write(preview_page)
    print('wrote %s (live, %d KB)' % (os.path.relpath(APP, REPO), len(live_page.encode()) // 1024))
    print('wrote %s (preview, %d KB)' % (os.path.join(out, 'secret-squad-preview.html'), len(preview_page.encode()) // 1024))


if __name__ == '__main__':
    main(sys.argv[1:])
