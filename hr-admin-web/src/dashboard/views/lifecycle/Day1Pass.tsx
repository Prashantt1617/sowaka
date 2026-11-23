// The Day-1 pass on the journey's Joining day (24 Nov): what it says (no agenda: the dashboard neither
// shows nor edits it; a stored agenda is kept as it is), "View pass", the pass as the joiner sees it on the
// joining portal (preboarding-web's Pass screen at phone width: the blue pass card, its facts in the
// portal's order and words, Add to calendar, directions, then "Your Day 1"), and "Edit pass", the
// editor in a dialog. What the portal shows is the template's joining and reporting details where HR
// has not typed this joiner's own (portal.ts passWithTemplate), read the same way here.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Day1Pass, DesignReporting } from '../../../services/lifecycle';
import { useBrand } from '../../brand';
import { Field, Modal } from './shared';
import { addDays, areaStyle, inputStyle, longDay, todayKey } from './format';
import { useCompanyName } from './hooks';

/** Key facts: a narrow label column, the value in medium weight (the journey's own look). */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v != null && v !== '');
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: '8px 14px', margin: 0, fontSize: 12.5 }}>
      {shown.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--ink-3)' }}>{k}</dt>
          <dd style={{ margin: 0, color: 'var(--ink)', fontWeight: 500, overflowWrap: 'anywhere' }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface PassPeople {
  name: string; designation?: string; department?: string; managerName?: string; buddyName?: string;
}

/** The pass HR edits: without the server's mark and the names it was made with. */
const editable = (v?: Day1Pass): Day1Pass => { const rest = { ...v }; delete rest.auto; delete rest.managerName; delete rest.buddyName; return rest; };

/**
 * Joining day's Day-1 pass: the summary, View pass and Edit pass (a dialog). `onSave` keeps the
 * agenda as stored (the editor does not touch it).
 */
export function Day1PassBlock({ value, tj, reporting, people, onSave, busy }: {
  value?: Day1Pass; tj?: string; reporting?: DesignReporting; people: PassPeople;
  onSave: (p: Day1Pass) => Promise<boolean>; busy: boolean;
}) {
  const [open, setOpen] = useState<'view' | 'edit' | null>(null);
  const auto = value?.auto;
  const filledIn = Boolean(auto || (value && (value.reportingTime || value.place || value.meetingLink)));
  // The server makes the pass from the template 7 days before joining (or on its next run, inside the week).
  const makesOn = tj ? addDays(tj, -7) : undefined;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {auto && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Made automatically on {longDay(auto.at)} from the template. It follows the template and the joining date until you edit it.</div>}
      {filledIn ? (
        <Facts rows={[
          ['Date', longDay(auto ? tj : value?.date ?? tj)],
          ['Reporting time', value?.reportingTime],
          ['Place', value?.place],
          ['Map link', value?.mapLink ? <a key="m" href={value.mapLink} target="_blank" rel="noopener noreferrer">Directions</a> : ''],
          ['Meeting link', value?.meetingLink],
          ['Ask for', value?.askFor ? `${value.askFor.name}${value.askFor.phone ? ` · ${value.askFor.phone}` : ''}` : ''],
          ['Manager', auto ? value?.managerName : ''],
          ['Buddy', auto ? value?.buddyName : ''],
          ['HR contact', value?.hrContact ? [value.hrContact.name, value.hrContact.email, value.hrContact.phone].filter(Boolean).join(' · ') : ''],
          ['Bring', value?.bring?.length ? value.bring.join(', ') : ''],
        ]} />
      ) : (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          {makesOn && makesOn > todayKey()
            ? `Made automatically on ${longDay(makesOn)} from the template’s joining and reporting details, and shown to the candidate. You can fill it in yourself before then.`
            : 'Being made from the template’s joining and reporting details: it shows here within the hour. You can fill it in yourself instead.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="pd-btn sm" onClick={() => setOpen('edit')}>{filledIn ? 'Edit pass' : 'Fill in now'}</button>
        <button type="button" className="pd-btn sm" onClick={() => setOpen('view')}>View pass</button>
      </div>
      {open === 'view' && <PassPreviewDialog value={value} tj={tj} reporting={reporting} people={people} onClose={() => setOpen(null)} />}
      {open === 'edit' && <PassEditorDialog value={value} tj={tj} busy={busy} onClose={() => setOpen(null)} onSave={async (p) => { if (await onSave(p)) setOpen(null); }} />}
    </div>
  );
}

/** The editor, in a dialog: Save keeps the stored agenda (not shown here). */
function PassEditorDialog({ value, tj, busy, onClose, onSave }: { value?: Day1Pass; tj?: string; busy: boolean; onClose: () => void; onSave: (p: Day1Pass) => Promise<void> }) {
  const [p, setP] = useState<Day1Pass>(() => editable(value));
  const [bring, setBring] = useState((value?.bring ?? []).join('\n'));
  const set = (patch: Partial<Day1Pass>) => setP((x) => ({ ...x, ...patch }));
  const save = () => void onSave({ ...p, bring: bring.split('\n').map((x) => x.trim()).filter(Boolean) });
  return (
    <Modal title="Edit the Day-1 pass" sub="The candidate sees it on the joining portal from 7 days before joining." onClose={onClose} busy={busy} width={560}
      footer={(
        <>
          <button type="button" className="pd-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="pd-btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save pass'}</button>
        </>
      )}>
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Date"><input type="date" value={p.date ?? tj ?? ''} onChange={(e) => set({ date: e.target.value })} style={inputStyle} /></Field>
          <Field label="Reporting time"><input type="time" value={p.reportingTime ?? ''} onChange={(e) => set({ reportingTime: e.target.value })} style={inputStyle} /></Field>
        </div>
        <Field label="Place"><input value={p.place ?? ''} onChange={(e) => set({ place: e.target.value })} placeholder="e.g. Reception, Block A, Main Campus" style={inputStyle} /></Field>
        <Field label="Map link"><input value={p.mapLink ?? ''} onChange={(e) => set({ mapLink: e.target.value })} style={inputStyle} /></Field>
        <Field label="Meeting link" hint="For a remote first day"><input value={p.meetingLink ?? ''} onChange={(e) => set({ meetingLink: e.target.value })} style={inputStyle} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Ask for"><input value={p.askFor?.name ?? ''} onChange={(e) => set({ askFor: { ...p.askFor, name: e.target.value } })} placeholder="Name" style={inputStyle} /></Field>
          <Field label="Their phone"><input value={p.askFor?.phone ?? ''} onChange={(e) => set({ askFor: { name: p.askFor?.name ?? '', phone: e.target.value } })} style={inputStyle} /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="HR contact"><input value={p.hrContact?.name ?? ''} onChange={(e) => set({ hrContact: { ...p.hrContact, name: e.target.value } })} placeholder="Name" style={inputStyle} /></Field>
          <Field label="HR email"><input value={p.hrContact?.email ?? ''} onChange={(e) => set({ hrContact: { name: p.hrContact?.name ?? '', ...p.hrContact, email: e.target.value } })} style={inputStyle} /></Field>
        </div>
        <Field label="What to bring" hint="One per line"><textarea value={bring} onChange={(e) => setBring(e.target.value)} style={{ ...areaStyle, minHeight: 70 }} placeholder={'Original ID proof\nTwo passport photos'} /></Field>
      </div>
    </Modal>
  );
}

// —— The pass as the joiner sees it ——————————————————————————————————————————

// The portal's colours (preboarding-web styles/tokens.css) and its date and time words (lib/format.ts).
const P = { brand: '#0571A6', text: '#222222', text2: '#484848', text3: '#717171', surface: '#F7F7F9', border: '#EBEBEB' };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekday = (key: string) => { const d = new Date(`${key.slice(0, 10)}T00:00:00`); return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const time12 = (hhmm?: string) => {
  if (!hhmm) return undefined;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const eyebrow = { fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' } as const;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** What the portal's pass reads: this joiner's pass over the template's reporting details (passWithTemplate). */
function portalPass(value: Day1Pass | undefined, tj: string | undefined, reporting: DesignReporting | undefined, people: PassPeople): Day1Pass & { date?: string } {
  const stored = editable(value);
  if (value?.auto) return { ...stored, ...(tj ? { date: tj } : {}) };
  const meets = reporting?.meets === 'manager' ? people.managerName : reporting?.meets === 'buddy' ? people.buddyName : undefined;
  return {
    ...(reporting?.time ? { reportingTime: reporting.time } : {}), ...(reporting?.place ? { place: reporting.place } : {}),
    ...(reporting?.mapLink ? { mapLink: reporting.mapLink } : {}), ...(reporting?.bring ? { bring: [reporting.bring] } : {}),
    ...(meets && !stored.askFor ? { askFor: { name: meets } } : {}),
    ...stored,
    date: stored.date ?? tj,
  };
}

function PassPreviewDialog({ value, tj, reporting, people, onClose }: { value?: Day1Pass; tj?: string; reporting?: DesignReporting; people: PassPeople; onClose: () => void }) {
  const company = useCompanyName();
  const logo = useBrand().icon;
  const pass = portalPass(value, tj, reporting, people);
  const directions = pass.mapLink || (pass.place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pass.place)}` : undefined);
  // The portal's phone facts, in its order and words.
  const facts: Array<[string, string | undefined]> = [
    ['You', people.name], ['Team', people.department],
    ['Date', pass.date ? weekday(pass.date) : undefined], ['Reporting time', time12(pass.reportingTime)],
    ['Where', pass.place ?? (pass.meetingLink ? 'Online' : undefined)],
    ['Ask for', pass.askFor?.name ? `${pass.askFor.name}${pass.askFor.phone ? ` · ${pass.askFor.phone}` : ''}` : pass.hrContact?.name],
    ['Bring', pass.bring?.join(', ')],
  ];
  return (
    <Modal title="The Day-1 pass, as the candidate sees it" sub="On the joining portal, from 7 days before joining." onClose={onClose} width={460}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: 380, maxWidth: '100%', height: 720, maxHeight: 'calc(100vh - 220px)', boxSizing: 'border-box', background: P.surface, color: P.text, border: '10px solid #16181D', borderRadius: 46, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(22,24,29,0.35)', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 22px 6px', fontSize: 12, fontWeight: 600, flex: 'none' }}><span>9:41</span><span style={{ width: 96, height: 24, borderRadius: 999, background: '#16181D' }} /><span>5G</span></div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 16px 24px', display: 'grid', gap: 16, alignContent: 'start' }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.01em' }}>Your Day-1 pass</div>
              <div style={{ fontSize: 14, color: P.text2, marginTop: 6 }}>Show this at reception when you arrive</div>
            </div>
            <section aria-label="Day-1 pass" style={{ background: P.brand, color: '#fff', borderRadius: 28, padding: '24px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16, position: 'relative', overflow: 'hidden', boxShadow: '0 12px 28px rgba(5, 113, 166, 0.25)' }}>
              <span aria-hidden style={{ position: 'absolute', right: -60, top: -60, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span style={{ ...eyebrow, color: 'rgba(255,255,255,0.92)' }}>Day-1 pass</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
                  {logo
                    ? <img src={logo} alt="" width={30} height={30} style={{ borderRadius: 9, background: '#fff', objectFit: 'contain', flex: 'none' }} />
                    : <span aria-hidden style={{ width: 30, height: 30, borderRadius: 9, background: '#fff', color: P.brand, display: 'grid', placeItems: 'center', fontSize: 12, flex: 'none' }}>{initials(company) || '•'}</span>}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{company}</span>
                </span>
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', borderTop: '1px dashed rgba(255,255,255,0.4)', paddingTop: 16, margin: 0 }}>
                {facts.filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} style={{ minWidth: 0 }}>
                    <dt style={{ ...eyebrow, color: 'rgba(255,255,255,0.82)' }}>{k}</dt>
                    <dd style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#fff', overflowWrap: 'anywhere' }}>{v}</dd>
                  </div>
                ))}
              </dl>
              {pass.meetingLink && <span style={{ color: '#fff', fontWeight: 600, fontSize: 14, textDecoration: 'underline' }}>Join the meeting ↗</span>}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', position: 'relative', zIndex: 1 }}>
                <span style={{ minHeight: 36, borderRadius: 999, background: '#fff', color: P.brand, fontWeight: 600, fontSize: 13, padding: '0 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
                  Add to calendar
                </span>
                {directions && (
                  <span aria-label="Get directions" style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.16)', color: '#fff', display: 'inline-grid', placeItems: 'center' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
                  </span>
                )}
              </div>
            </section>
            {pass.agenda && pass.agenda.length > 0 && (
              <section style={{ background: '#fff', border: `1px solid ${P.border}`, borderRadius: 24, boxShadow: '0 1px 3px rgba(17,24,39,0.06)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>Your Day 1</div>
                <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {pass.agenda.map((a, i) => (
                    <li key={`${a.time}-${a.title}-${i}`} style={{ display: 'flex', gap: 14, padding: '10px 0', borderTop: i ? `1px solid ${P.border}` : 0 }}>
                      <span style={{ width: 64, flex: 'none', fontSize: 12, fontWeight: 600, color: P.brand, paddingTop: 2 }}>{time12(a.time) ?? a.time}</span>
                      <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{a.title}</span>
                        {a.with && <span style={{ fontSize: 12, color: P.text3 }}>{a.with}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
