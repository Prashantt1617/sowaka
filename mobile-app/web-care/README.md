# Care web pages

Move, Breathe, Listen, Sleep and the topics as web pages, built from
`lib/care_web_main.dart` and deployed to the Vercel project `sowaka-care` at
https://care.getsowaka.com. Deploy with:

    web-care/deploy.sh

It builds, serves this build's assets from a path of its own (`/v/<stamp>/`,
so a phone never holds on to an old font list or picture), keeps the offline
cache switched off, and deploys.

The app opens these pages when the backend's `CARE_WEB_BASE` names this host.
The pages are kept out of search engines by the headers in `vercel.json` and
`robots.txt`.
