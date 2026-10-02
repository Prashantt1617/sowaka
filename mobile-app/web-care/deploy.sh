#!/bin/zsh
# Builds the Care web pages and deploys them to care.getsowaka.com.
#
# Every deploy serves its assets from a path of its own, /v/<stamp>/assets/,
# so a phone never keeps an old font list or picture from an earlier deploy:
# the app's web view caches /assets/ files hard, and a new font or image
# added under the same name would otherwise never be seen.
set -euo pipefail
cd "$(dirname "$0")/.."

flutter build web --target lib/care_web_main.dart --release \
  --dart-define=API_BASE_URL=https://d3lwup4rvo6csf.cloudfront.net -o build/care-web
cp web-care/vercel.json web-care/robots.txt web-care/README.md build/care-web/

STAMP=$(date +%Y%m%d%H%M%S) python3 - <<'PY'
import os, re
stamp = os.environ['STAMP']
p = 'build/care-web/flutter_bootstrap.js'
s = open(p).read()
s, n = re.subn(
    r'_flutter\.loader\.load\(\{.*?\}\);\s*$',
    "_flutter.loader.load({ serviceWorker: null, config: { assetBase: '/v/%s/' } });\n" % stamp,
    s, flags=re.S)
assert n == 1, 'could not find the loader call in flutter_bootstrap.js'
open(p, 'w').write(s)
# An old offline cache from before it was switched off removes itself.
open('build/care-web/flutter_service_worker.js', 'w').write("""// Retired: this worker removes itself and any cache it left, then reloads open pages.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
""")
print('assets at /v/%s/' % stamp)
PY

cd build/care-web && vercel deploy --prod --yes --scope sowaka2
