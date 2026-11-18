import { request, upload, setSession } from './client';
import type {
  AboutYou,
  ClosedSignIn,
  CandidateDocumentView,
  DateRequestReason,
  DateRequestView,
  MeetItem,
  PortalClient,
  PortalHome,
  PortalLetter,
  PortalOfferView,
  PortalPass,
} from './types';

const enc = encodeURIComponent;

/** Where the offer comes from: the emailed link (no login) or the signed-in session. */
export type OfferSource = { kind: 'link'; token: string } | { kind: 'session' };

export const portal = {
  // ── Offer link (no login) ─────────────────────────────────────────────
  offer: (src: OfferSource) =>
    src.kind === 'link'
      ? request<PortalOfferView>(`/portal/offer/${enc(src.token)}`, { auth: false })
      : // not in CONTRACT: the signed-in candidate opens the revised offer from home (P7b → P3 v2).
        request<PortalOfferView>('/portal/me/offer'),
  offerPdf: (src: OfferSource) =>
    src.kind === 'link'
      ? request<ArrayBuffer>(`/portal/offer/${enc(src.token)}/pdf`, { auth: false, binary: true })
      : request<ArrayBuffer>('/portal/me/offer/pdf', { binary: true }),
  acceptOffer: (src: OfferSource) =>
    src.kind === 'link'
      ? request<PortalOfferView>(`/portal/offer/${enc(src.token)}/accept`, { method: 'POST', auth: false })
      : request<PortalOfferView>('/portal/me/offer/accept', { method: 'POST' }),

  // ── Account ───────────────────────────────────────────────────────────
  /** The right password: a session, or (a closed portal) which closed screen to show and no session. */
  async signIn(email: string, password: string): Promise<{ token: string } | { closed: ClosedSignIn }> {
    const out = await request<{ token?: string; closed?: ClosedSignIn }>('/portal/auth/sign-in', {
      method: 'POST',
      auth: false,
      body: { email, password },
    });
    if (out.closed?.state) return { closed: out.closed };
    setSession(out.token!);
    return { token: out.token! };
  },
  forgot: (email: string) => request<{ ok: true }>('/portal/auth/forgot', { method: 'POST', auth: false, body: { email } }),
  reset: (token: string, password: string) =>
    request<{ ok: true }>('/portal/auth/reset', { method: 'POST', auth: false, body: { token, password } }),
  signOut: () => setSession(null),
  /** The client a mail's link names (`?c=`): its logo and HR, for sign-in on a fresh device. */
  client: (token: string) => request<PortalClient>(`/portal/client/${enc(token)}`, { auth: false }),

  // ── Signed in ─────────────────────────────────────────────────────────
  me: () => request<PortalHome>('/portal/me'),

  documents: () => request<{ documents: CandidateDocumentView[] }>('/portal/documents'),
  uploadDocument: (id: string, files: File[], onProgress?: (f: number) => void) => {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return upload<{ documents: CandidateDocumentView[] }>(`/portal/documents/${enc(id)}/upload`, form, onProgress);
  },
  removeDocumentFile: (id: string, fileId: string) =>
    request<{ documents: CandidateDocumentView[] }>(`/portal/documents/${enc(id)}/files/${enc(fileId)}`, { method: 'DELETE' }),

  about: () => request<AboutYou>('/portal/about'),
  saveAbout: (body: Pick<AboutYou, 'emergencyContact' | 'pf'>) => request<AboutYou>('/portal/about', { method: 'PUT', body }),

  meet: () => request<{ items: MeetItem[] }>('/portal/meet'),
  meetSeen: (itemId: string) => request<{ ok?: boolean }>('/portal/meet/seen', { method: 'POST', body: { itemId } }),

  letters: () => request<{ letters: PortalLetter[] }>('/portal/letters'),
  letterOpened: (id: string) => request<unknown>(`/portal/letters/${enc(id)}/opened`, { method: 'POST' }),
  signLetter: (id: string, body: { method: 'draw' | 'type'; typedName?: string; imageDataUrl?: string }) =>
    request<unknown>(`/portal/letters/${enc(id)}/sign`, { method: 'POST', body }),
  letterPdf: (id: string) => request<ArrayBuffer>(`/portal/letters/${enc(id)}/pdf`, { binary: true }),

  pass: () => request<PortalPass>('/portal/pass'),
  passIcs: () => request<ArrayBuffer>('/portal/pass.ics', { binary: true }),

  requestDate: (body: { requestedTj: string; reason: DateRequestReason; note?: string }) =>
    request<{ request: DateRequestView }>('/portal/date-request', { method: 'POST', body }),
};
