import { logger } from '../utils/logger';

export interface LinkPreview {
  imageUrl: string;
  title: string;
  siteName: string;
}

const FETCH_TIMEOUT_MS = 6000;
// Big sites bury OG tags deep in a very large <head> — YouTube's og:image sits
// around 700KB in. Reading stops at `</head>` anyway, so this cap only bounds
// the pathological case; the 6s timeout is the real guard.
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Reads a link's own preview metadata (OpenGraph / Twitter card) so a
 * recommendation shows the source's artwork instead of asking the author to
 * attach one.
 *
 * Best-effort by design: anything unreachable, slow, or not HTML resolves to
 * empty fields rather than failing the post.
 */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const empty: LinkPreview = { imageUrl: '', title: '', siteName: '' };
  const url = normalizeUrl(rawUrl);
  if (!url) return empty;

  // YouTube serves its OG tags inconsistently to unknown agents, and youtu.be
  // links redirect before any of them are reached — but every video's poster
  // is derivable from its id, so there is nothing to fetch.
  const youTube = youTubeThumbnail(url);
  if (youTube) return youTube;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Sites commonly withhold OG tags from unknown agents.
        'User-Agent': 'Mozilla/5.0 (compatible; SowakaConnect/1.0; +link-preview)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) return empty;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('html')) return empty;

    const html = await readCapped(response);
    return {
      imageUrl: absolutize(
        firstMeta(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']),
        url,
      ),
      title: firstMeta(html, ['og:title', 'twitter:title']) || titleTag(html),
      siteName: firstMeta(html, ['og:site_name']) || hostOf(url),
    };
  } catch (error) {
    logger.warn('Link preview lookup failed', {
      url,
      reason: error instanceof Error ? error.message : String(error),
    });
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A YouTube link's poster, straight from the video id. `hqdefault` exists for
 * every video, including ones with no custom thumbnail, which the higher
 * resolutions do not.
 */
function youTubeThumbnail(url: string): LinkPreview | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.replace(/^www\./, '');
  let id = '';
  if (host === 'youtu.be') {
    id = parsed.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (parsed.pathname === '/watch') id = parsed.searchParams.get('v') ?? '';
    else {
      const match = /^\/(?:shorts|embed|v|live)\/([^/?#]+)/.exec(parsed.pathname);
      id = match?.[1] ?? '';
    }
  }
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
  return {
    imageUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    // The title still needs the page, which is often withheld; the card falls
    // back to the URL, which is what it did before.
    title: '',
    siteName: 'YouTube',
  };
}

/** Stops a huge or streaming page from being buffered in full. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const decoder = new TextDecoder();
  let html = '';
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    html += decoder.decode(value, { stream: true });
    // The metadata lives in <head>, so the first chunk is enough.
    if (read >= MAX_BYTES || html.includes('</head>')) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return html;
}

function firstMeta(html: string, properties: string[]): string {
  for (const property of properties) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*>`,
      'i',
    );
    const tag = pattern.exec(html)?.[0];
    if (!tag) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return decodeEntities(content.trim());
  }
  return '';
}

function titleTag(html: string): string {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1].trim()) : '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeUrl(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    // Only public web links; never let this reach internal hosts.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (isPrivateHost(parsed.hostname)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * Blocks loopback/link-local/private ranges: this fetches a URL supplied by a
 * user, so it must not be usable to probe the internal network.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return true;
  }
  if (host === '::1' || host === '0.0.0.0') return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
}

function absolutize(candidate: string, pageUrl: string): string {
  if (!candidate) return '';
  try {
    return new URL(candidate, pageUrl).toString();
  } catch {
    return '';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
