/**
 * HTTP client for the portal endpoints. The candidate's session is a portal JWT
 * (aud 'portal') kept in sessionStorage and sent as `Authorization: Bearer`.
 * In dev with VITE_MOCK=1 every call goes to the fixture handler instead
 * (the import sits behind import.meta.env.DEV, so production builds drop it).
 */

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || 'http://localhost:4000';
export const MOCK = import.meta.env.DEV && import.meta.env.VITE_MOCK === '1';

const TOKEN_KEY = 'sowaka.portal.session';
let memoryToken: string | null = null;

export function getSession(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setSession(token: string | null): void {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: memory only */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Fired when a portal call comes back 401 so the app can send the candidate to sign in. */
export const SESSION_EXPIRED_EVENT = 'portal:session-expired';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  /** Return the raw bytes instead of JSON (PDFs, .ics). */
  binary?: boolean;
}

type MockHandler = (method: string, path: string, body: unknown, auth: string | null) => Promise<unknown>;
let mockHandler: MockHandler | null = null;
async function loadMock(): Promise<MockHandler> {
  if (!mockHandler) {
    if (import.meta.env.DEV) {
      const m = await import('../mock/handler');
      mockHandler = m.handleMock;
    } else {
      throw new Error('Mock mode is not available in production builds');
    }
  }
  return mockHandler;
}

export function resolveUrl(path: string): string {
  if (/^https?:\/\//.test(path) || path.startsWith('blob:') || path.startsWith('data:')) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

function onUnauthorized(auth: boolean) {
  if (!auth) return;
  setSession(null);
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const auth = opts.auth ?? true;
  const token = auth ? getSession() : null;

  if (MOCK) {
    const handler = await loadMock();
    try {
      return (await handler(method, path, opts.body, token)) as T;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized(auth);
      throw err;
    }
  }

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(resolveUrl(path), { method, headers, body });
  } catch {
    throw new ApiError(0, 'We couldn’t reach the server. Check your connection and try again.');
  }

  if (!res.ok) {
    let message = 'Something went wrong. Please try again.';
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) onUnauthorized(auth);
    throw new ApiError(res.status, message);
  }
  if (opts.binary) return (await res.arrayBuffer()) as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Multipart upload with progress (fetch has no upload progress). Mock mode
 * simulates the progress.
 */
export async function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  const token = getSession();
  if (MOCK) {
    const handler = await loadMock();
    for (let i = 1; i <= 10; i++) {
      await new Promise((r) => setTimeout(r, 70));
      onProgress?.(i / 10);
    }
    return (await handler('POST', path, form, token)) as T;
  }
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', resolveUrl(path));
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, 'The upload stopped. Check your connection and try again.'));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        if (xhr.status === 401) onUnauthorized(true);
        reject(new ApiError(xhr.status, (data as { error?: string } | null)?.error ?? 'The upload failed. Please try again.'));
      }
    };
    xhr.send(form);
  });
}
