// Thin fetch wrapper: base URL, bearer-token injection, JSON parsing, typed errors.
// Hosted backend. Override for local dev via VITE_API_BASE_URL in .env.
export const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://d3lwup4rvo6csf.cloudfront.net';

const TOKEN_KEY = 'sowaka.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  invalidateApiCache();
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type Options = Omit<RequestInit, 'body'> & { body?: unknown };

// —— Reads shared for a moment ————————————————————————————————————————————
// Several parts of a page often ask for the same list at once (the start-up
// lists, a view and its drawer). Identical GETs in flight share one request,
// and a GET answered in the last 20 seconds is answered again from memory.
// Any write forgets everything read so far — a decision on a leave changes
// the calendar and the reports too — as does the server saying something
// changed (see live.ts) and signing in or out.
const GET_TTL_MS = 20_000;
const recent = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
let generation = 0;

/** Forgets every cached read, so the next GET goes to the server. */
export function invalidateApiCache(): void {
  generation += 1;
  recent.clear();
  inflight.clear();
}

function isRead(opts: Options): boolean {
  return (opts.method ?? 'GET').toUpperCase() === 'GET' && opts.body === undefined && !opts.signal;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  if (!isRead(opts)) {
    // A write: what was read before it may no longer be true, whether it
    // succeeds or not (a failure can still have changed something).
    invalidateApiCache();
    try {
      return await request<T>(path, opts);
    } finally {
      invalidateApiCache();
    }
  }
  const key = `${getToken() ?? ''} ${JSON.stringify(opts.headers ?? null)} ${path}`;
  // Who is signed in comes fresh each time; it is shared only while in flight.
  const cacheable = !path.startsWith('/auth/');
  const hit = cacheable ? recent.get(key) : undefined;
  if (hit && Date.now() - hit.at < GET_TTL_MS) return structuredClone(hit.data) as T;
  let shared = inflight.get(key);
  if (!shared) {
    const startedIn = generation;
    const p: Promise<unknown> = request<unknown>(path, opts)
      .then((data) => {
        // Not if a write happened meanwhile: this answer may predate it.
        if (cacheable && startedIn === generation) recent.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => {
        if (inflight.get(key) === p) inflight.delete(key);
      });
    inflight.set(key, p);
    shared = p;
  }
  // Each caller gets its own copy, so one screen sorting or editing what it
  // was given cannot change what another was given.
  return structuredClone(await shared) as T;
}

async function request<T>(path: string, opts: Options): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (data.message as string) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/**
 * Multipart POST, for the endpoints that take a file.
 *
 * Kept separate from `api` rather than folded into it: the browser has to set
 * its own `Content-Type` on a FormData body so the multipart boundary comes
 * out right, and `api` always sets JSON.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  invalidateApiCache();
  try {
    return await upload<T>(path, form);
  } finally {
    invalidateApiCache();
  }
}

async function upload<T>(path: string, form: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, (data.message as string) || `Request failed (${res.status})`);
  }
  return data as T;
}
