# Care web pages

Move, Breathe, Listen and the topics as web pages, built from `lib/care_web_main.dart`
and deployed to the Vercel project `sowaka-care` at https://care.getsowaka.com.

    flutter build web --target lib/care_web_main.dart --release \
      --dart-define=API_BASE_URL=https://d3lwup4rvo6csf.cloudfront.net -o build/care-web
    cp web-care/vercel.json web-care/robots.txt build/care-web/
    cd build/care-web && vercel deploy --prod --yes --scope sowaka2

The app opens these pages when the backend's `CARE_WEB_BASE` names this host;
Sleep stays in the app so it keeps playing with the screen off. The pages are
kept out of search engines by the headers in `vercel.json` and `robots.txt`.
