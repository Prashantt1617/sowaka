const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://d3lwup4rvo6csf.cloudfront.net';

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

/**
 * A media reference from the API as something an <img> can load.
 *
 * Photos held in the server's fallback store come back root-relative
 * (`/media/...`), because clients reach the API on different hosts; those are
 * resolved against this one's base. Absolute URLs pass through untouched.
 */
export function mediaUrl(url: string | undefined): string {
  if (!url) return '';
  return url.startsWith('/') ? `${API_BASE_URL}${url}` : url;
}
