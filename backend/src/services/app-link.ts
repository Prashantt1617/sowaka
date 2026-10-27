import { env } from '../config/env';

/**
 * The link an email carries to open the app on the thing it is about.
 *
 * It is an https link on the app's own domain (`APP_WEB_URL`, go.getsowaka.com),
 * which iOS and Android hand to the app when it is installed (universal links
 * and app links; the domain serves the two association files from the
 * dashboard's bucket) and which otherwise lands on the dashboard's /open page,
 * with the store buttons. The path is always `/open`; the query carries the
 * same fields a push's `data` does, so the app routes both the same way.
 */
export function appLink(data: Record<string, unknown> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value == null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return `${env.appWebUrl.replace(/\/+$/, '')}/open${query ? `?${query}` : ''}`;
}

/** What email copy writes where the link goes; the sender fills it from the notification's data. */
export const APP_LINK = '{{APP_LINK}}';

export const withAppLink = (body: string, data: Record<string, unknown> = {}) => body.replaceAll(APP_LINK, appLink(data));
