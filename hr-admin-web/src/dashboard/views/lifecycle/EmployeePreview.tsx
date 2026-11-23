// Employee preview: the template as the employee will see it, drawn like the real screens.
// Pre-boarding is the joining portal (web): its home tiles, the Joining details page and About
// the company with the culture videos. Every other stage is the app's Onboarding home (the
// stage hero and strip, the tiles) with the Meetings, Tasks and Watch list pages a tile opens.
// It reads the editor's copy, so unsaved edits show; people are samples.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DesignStage, DesignWatchItem, MeetWith, TemplateDesign } from '../../../services/lifecycle';
import { TileThumb } from './designParts';
import { MEET_LABEL, STAGES, clock, stageName, tourName } from './designWords';

const SAMPLE = { joiner: 'Kabir', hr: 'Ritu Arora', manager: 'Neel Kapoor', buddy: 'Tara Sen', it: 'Imran Sheikh', head_of_department: 'Rhea Malhotra' } as const;
const PERSON: Record<MeetWith, string> = { hr: SAMPLE.hr, manager: SAMPLE.manager, buddy: SAMPLE.buddy, it: SAMPLE.it, head_of_department: SAMPLE.head_of_department };
const FACE_BG: Record<MeetWith, string> = { hr: '#F3EEFF', manager: '#EAF1FE', buddy: '#EAF9EE', it: '#FFF4E5', head_of_department: '#FDECEC' };
const FACE_FG: Record<MeetWith, string> = { hr: '#6B4FBB', manager: '#2563EB', buddy: '#1F9D45', it: '#B45309', head_of_department: '#B42318' };
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The sample joining date: a week from today. */
const joining = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d; })();
const dayMonthYear = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// —— The app's colours (onboarding_kit.dart OnbColors) ——
const C = {
  primary: '#0571A6', text: '#222222', text3: '#717171', screen: '#F7F7F9', line: '#EBEBEB',
  skyTint: '#E8F4FA', skyText: '#BEEDFF', violet: '#6B4FBB', violetTint: '#F3EEFF', amber: '#B45309', amberTint: '#FFF4E5',
  blue: '#2563EB', blueTint: '#EAF1FE', tour: 'linear-gradient(135deg, #CC4A12 0%, #B23500 50%, #872800 100%)',
};

type PortalPage = 'home' | 'joining' | 'about';
type AppPage = 'home' | 'meetings' | 'tasks' | 'watch';

/** The phone around a screen. */
function Frame({ children, bg = '#fff' }: { children: ReactNode; bg?: string }) {
  return (
    <div style={{ width: 380, height: 760, maxHeight: 'calc(100vh - 120px)', boxSizing: 'border-box', background: bg, color: C.text, border: '10px solid #16181D', borderRadius: 46, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 60px rgba(22,24,29,0.35)', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 22px 6px', fontSize: 12, fontWeight: 600, flex: 'none' }}><span>9:41</span><span style={{ width: 96, height: 24, borderRadius: 999, background: '#16181D' }} /><span>5G</span></div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>{children}</div>
    </div>
  );
}

const chevron = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>;
const back = (onClick: () => void, title: string) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px 12px' }}>
    <button type="button" onClick={onClick} aria-label="Back" style={{ width: 36, height: 36, borderRadius: '50%', border: `1px solid ${C.line}`, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'scaleX(-1)' }}>{chevron}</button>
    <span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>
  </div>
);

// —— Pre-boarding: the portal ——————————————————————————————————————————————

function PortalTile({ bg, icon, title, sub, chip, tall, onClick, children }: { bg: string; icon: string; title: string; sub?: string; chip?: string; tall?: boolean; onClick?: () => void; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      style={{ background: bg, border: 0, borderRadius: 20, padding: 14, textAlign: 'left', fontFamily: 'inherit', color: C.text, cursor: onClick ? 'pointer' : 'default', display: 'flex', flexDirection: tall ? 'column' : 'column', justifyContent: 'space-between', gap: 12, minHeight: tall ? 196 : undefined, flex: 1, minWidth: 0 }}>
      <span style={{ display: 'flex', flexDirection: tall ? 'column' : 'row', alignItems: tall ? 'flex-start' : 'center', gap: tall ? 10 : 12 }}>
        <img src={`/brand/fig3d/${icon}.png`} alt="" width={tall ? 52 : 48} height={tall ? 52 : 48} />
        <span style={{ display: 'grid', gap: 2 }}>
          <span style={{ fontSize: tall ? 15 : 17, fontWeight: 700 }}>{title}</span>
          {sub && <span style={{ fontSize: 13, color: C.text3 }}>{sub}</span>}
        </span>
      </span>
      {children}
      {chip && <span style={{ alignSelf: tall ? 'stretch' : 'flex-start', height: 36, borderRadius: 999, background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '0 12px 0 14px', fontSize: 13, fontWeight: 600 }}>{chip}{chevron}</span>}
    </button>
  );
}

function Portal({ d, company }: { d: TemplateDesign; company: string }) {
  const [page, setPage] = useState<PortalPage>('home');
  const rows = d.preboarding.rows;
  const r = d.preboarding.reporting;
  const meets = r.meets === 'manager' ? SAMPLE.manager : r.meets === 'buddy' ? SAMPLE.buddy : SAMPLE.hr;
  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px' }}>
      <span style={{ width: 32, height: 32, borderRadius: 9, background: '#16181D', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(company || 'Co')}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{company || 'Your company'}</span>
    </div>
  );
  if (page === 'joining') {
    const directions = r.mapLink ?? (r.place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.place)}` : undefined);
    const line = (label: string, value: ReactNode, extra?: ReactNode) => (
      <div style={{ padding: '12px 0', borderTop: `1px solid ${C.line}`, display: 'grid', gap: 2 }}>
        <span style={{ fontSize: 12, color: C.text3 }}>{label}</span><span style={{ fontSize: 15, fontWeight: 600 }}>{value}</span>{extra}
      </div>
    );
    return (
      <Frame>
        {back(() => setPage('home'), 'Joining details')}
        <div style={{ padding: '0 16px 20px', display: 'grid', gap: 14 }}>
          <span style={{ fontSize: 13, color: C.text3 }}>Everything you need for your first day. HR will email you if anything changes.</span>
          <div style={{ background: C.skyTint, borderRadius: 16, padding: 14, display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: C.primary }}>YOUR FIRST DAY</span>
            <span style={{ fontSize: 22, fontWeight: 800 }}>{DAYS[joining.getDay()]}, {dayMonthYear(joining)}</span>
            <span style={{ fontSize: 13, color: C.text3 }}>In 7 days{r.time ? ` · please arrive by ${clock(r.time)}` : ''}</span>
          </div>
          <div>
            {line('Reporting time', r.time ? clock(r.time) : 'HR will share it soon')}
            {line('Reporting place', r.place || 'HR will share it soon', directions && <a href={directions} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: C.primary }}>Get directions</a>)}
            {line('Report to', `${SAMPLE.manager}, Team lead`)}
            {line('Ask for', meets)}
            {line('Day-1 pass', 'Arrives a week before you join')}
          </div>
          {r.bring && <div style={{ display: 'grid', gap: 6 }}><span style={{ fontSize: 15, fontWeight: 700 }}>What to bring</span><span style={{ fontSize: 14 }}>• {r.bring}</span></div>}
          {r.notes && <div style={{ fontSize: 13, color: C.text3 }}>{r.notes}</div>}
          <span style={{ fontSize: 13, color: C.text3 }}>Can’t make it on {dayMonthYear(joining).replace(/ \d{4}$/, '')}? <b style={{ color: C.primary }}>Ask HR for another date</b></span>
        </div>
      </Frame>
    );
  }
  if (page === 'about') {
    const vids = rows.watch ? d.preboarding.videos : [];
    return (
      <Frame>
        {back(() => setPage('home'), 'About the company')}
        <div style={{ padding: '0 16px 20px', display: 'grid', gap: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>Culture and values</span>
          {vids.length ? (
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
              {vids.map((v, i) => (
                <div key={v.id ?? i} style={{ display: 'grid', gap: 6, width: 120, flex: 'none' }}>
                  <TileThumb media={v.media} w={120} h={180} emptyText="Not uploaded yet" />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{v.title}</span>
                </div>
              ))}
            </div>
          ) : <span style={{ fontSize: 13, color: C.text3 }}>{rows.watch ? 'No videos added yet.' : 'The watch list is switched off for this template.'}</span>}
        </div>
      </Frame>
    );
  }
  return (
    <Frame bg={C.screen}>
      {head}
      <div style={{ padding: '10px 16px 20px', display: 'grid', gap: 12 }}>
        <span style={{ fontSize: 28, fontWeight: 800 }}>Hello, {SAMPLE.joiner} 👋</span>
        {(rows.offerLetter || rows.joiningDetails) && (
          <div style={{ display: 'flex', gap: 10 }}>
            {rows.offerLetter && <PortalTile tall bg="#EAF9EE" icon="document-approved" title="View offer letter" sub="Your offer from HR" chip="Review" />}
            {rows.joiningDetails && <PortalTile tall bg="#EAF1FE" icon="calendar" title="Joining details" sub={dayMonthYear(joining)} chip="View details" onClick={() => setPage('joining')} />}
          </div>
        )}
        {rows.profile && (
          <PortalTile bg="#FFF4E5" icon="user" title="Employee profile" sub="0 of 6 sections done">
            <span style={{ display: 'grid', gap: 6 }}><b style={{ fontSize: 13 }}>0% done</b><span style={{ height: 6, borderRadius: 3, background: '#fff' }} /></span>
          </PortalTile>
        )}
        <PortalTile bg="#FDECEC" icon="team" title="About the company" chip="View" onClick={() => setPage('about')} />
        {!rows.offerLetter && !rows.joiningDetails && !rows.profile && <span style={{ fontSize: 13, color: C.text3 }}>Only About the company is switched on in Pre-boarding.</span>}
      </div>
    </Frame>
  );
}

// —— Day 1 onwards: the app ————————————————————————————————————————————————

function Face({ who, size = 34 }: { who: MeetWith; size?: number }) {
  return <span title={MEET_LABEL[who]} style={{ width: size, height: size, borderRadius: '50%', background: FACE_BG[who], color: FACE_FG[who], border: '2px solid #fff', fontSize: size * 0.34, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: -8 }}>{initials(PERSON[who])}</span>;
}

function AppTile({ name, eyebrow, title, meta, top, bg = '#fff', light, onClick }: { name?: string; eyebrow?: string; title: string; meta?: string; top?: ReactNode; bg?: string; light?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      style={{ background: bg, color: light ? '#fff' : C.text, border: light ? 0 : `1px solid ${C.line}`, borderRadius: 20, padding: 14, minHeight: 132, boxSizing: 'border-box', textAlign: 'left', fontFamily: 'inherit', cursor: onClick ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: top ? 8 : 0 }}>{top}{name && <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>}</span>
      <span style={{ display: 'grid', gap: 2 }}>
        {eyebrow && <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: light ? C.skyText : C.text3 }}>{eyebrow}</span>}
        <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{title}</span>
        {meta && <span style={{ fontSize: 12, color: light ? C.skyText : C.text3 }}>{meta}</span>}
      </span>
    </button>
  );
}

function WideTile({ chipBg, chipFg, glyph, title, meta, bar, end }: { chipBg: string; chipFg: string; glyph: string; title: string; meta?: string; bar?: { value: number; color: string; text: string }; end?: ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 44, height: 44, borderRadius: 14, background: chipBg, color: chipFg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flex: 'none' }}>{glyph}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
        {meta && <span style={{ fontSize: 12, color: C.text3 }}>{meta}</span>}
        {bar && <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ flex: 1, height: 6, borderRadius: 3, background: C.line, overflow: 'hidden' }}><span style={{ display: 'block', width: `${Math.round(bar.value * 100)}%`, height: '100%', background: bar.color }} /></span><span style={{ fontSize: 11, color: C.text3 }}>{bar.text}</span></span>}
      </span>
      {end}
    </div>
  );
}

const listRow = (key: string | number, title: string, meta?: string, lead?: ReactNode, right?: ReactNode) => (
  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${C.line}` }}>
    {lead}
    <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>{meta && <span style={{ fontSize: 12, color: C.text3 }}>{meta}</span>}</span>
    {right}
  </div>
);

function App({ d, stage }: { d: TemplateDesign; stage: Exclude<DesignStage, 'pre'> }) {
  const [page, setPage] = useState<AppPage>('home');
  const months = d.probation.months;
  const order = STAGES.indexOf(stage);
  const meetings = d.meetings.filter((m) => m.stage === stage);
  const tasks = d.tasks.filter((t) => t.stage === stage);
  const watch: DesignWatchItem[] = [...d.watch, ...d.trainings].filter((w) => w.stage === stage);
  const checkin = d.checkins.find((c) => c.stage === stage);
  const early = stage === 'd1' || stage === 'w1';
  const lessons = d.tour;
  const lesson = stage === 'd1' ? lessons[0] : lessons[1] ?? lessons[0];
  const minutes = watch.reduce((t, w) => t + (w.media.minutes ?? 0), 0);
  const verb = { do: 'Start', review: 'Review', ack: 'Read', sign: 'Sign', form: 'Fill in', other: 'Open' } as const;

  if (page !== 'home') {
    const title = page === 'meetings' ? 'Meetings' : page === 'tasks' ? 'Tasks' : 'Watch list';
    return (
      <Frame bg={C.screen}>
        {back(() => setPage('home'), title)}
        <div style={{ margin: '0 16px 20px', background: '#fff', borderRadius: 20, padding: '4px 14px', border: `1px solid ${C.line}` }}>
          {page === 'meetings' && (meetings.length ? meetings.map((m, i) => listRow(i, m.title, `With ${PERSON[m.meetWith]} (${MEET_LABEL[m.meetWith]})${m.agenda.length ? ` · ${m.agenda.length} points` : ''}`, <Face who={m.meetWith} size={36} />, <span style={{ fontSize: 12, fontWeight: 600, color: C.text3 }}>Not yet</span>)) : <p style={{ fontSize: 13, color: C.text3 }}>No meetings in {stageName(stage, months)}.</p>)}
          {page === 'tasks' && (tasks.length ? tasks.map((t, i) => listRow(i, t.title, stageName(stage, months), <span style={{ width: 36, height: 36, borderRadius: 12, background: C.violetTint, color: C.violet, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>, <span style={{ height: 30, padding: '0 12px', borderRadius: 999, background: C.primary, color: '#fff', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{verb[t.type] ?? 'Open'}</span>)) : <p style={{ fontSize: 13, color: C.text3 }}>No tasks in {stageName(stage, months)}.</p>)}
          {page === 'watch' && (watch.length ? watch.map((w, i) => listRow(i, w.title, w.media.minutes ? `${w.media.minutes} min` : w.media.type === 'pdf' ? 'PDF' : undefined, <TileThumb media={w.media} w={56} h={80} emptyText="" />)) : <p style={{ fontSize: 13, color: C.text3 }}>Nothing to watch in {stageName(stage, months)}.</p>)}
        </div>
      </Frame>
    );
  }

  const half: ReactNode[] = [];
  if (meetings.length) half.push(<AppTile key="m" top={<span style={{ display: 'flex' }}>{[...new Set(meetings.map((m) => m.meetWith))].slice(0, 4).map((w) => <Face key={w} who={w} />)}</span>} title="Meetings" meta={`0 of ${meetings.length} met`} onClick={() => setPage('meetings')} />);
  if (tasks.length) half.push(<AppTile key="t" name="Tasks" top={<span style={{ width: 30, height: 30, borderRadius: 10, background: C.violetTint, color: C.violet, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: -8 }}>✓</span>} eyebrow="UP NEXT" title={tasks[0].title} meta={`${tasks.length} to do`} onClick={() => setPage('tasks')} />);
  if (early && lesson) half.push(<AppTile key="tour" name="Sowaka tour" bg={C.tour} light eyebrow="UP NEXT" title={tourName(lesson)} meta={`2 min · 0 of ${lessons.length} done`} />);
  if (watch.length) half.push(<AppTile key="w" name="Watch list" bg={C.primary} light eyebrow="UP NEXT" title={watch[0].title} meta={[minutes ? `${minutes} min` : '', `${watch.length} ${watch.length === 1 ? 'item' : 'items'}`].filter(Boolean).join(' · ')} onClick={() => setPage('watch')} />);
  return (
    <Frame bg={C.screen}>
      <div style={{ padding: '4px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 20, fontWeight: 800 }}>Onboarding</span>
      </div>
      <div style={{ padding: '0 16px 20px', display: 'grid', gap: 10 }}>
        <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 20, padding: '14px 0', display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
            <span style={{ width: 56, height: 64, borderRadius: 16, background: C.skyTint, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontSize: 34 }}>🌱</span>
            <span style={{ display: 'grid', gap: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: C.primary }}>YOU ARE HERE</span>
              <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{stageName(stage, months)}</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 16px' }}>
            {STAGES.filter((s) => s !== 'pre').map((s) => {
              const i = STAGES.indexOf(s);
              const done = i < order;
              const here = s === stage;
              return <span key={s} style={{ flex: 'none', height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, background: here ? C.primary : done ? '#EAF9EE' : C.screen, color: here ? '#fff' : done ? '#1F9D45' : C.text3 }}>{done ? '✓ ' : ''}{stageName(s, months)}</span>;
            })}
            <span style={{ flex: 'none', height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', background: C.screen, color: C.text3 }}>Confirmed</span>
          </div>
        </div>
        {half.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>{half}</div>}
        {checkin && <WideTile chipBg={C.violetTint} chipFg={C.violet} glyph="💬" title="Check-ins" meta={`${checkin.title} · about a minute`} end={<span style={{ height: 32, padding: '0 14px', borderRadius: 999, background: C.primary, color: '#fff', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Start</span>} />}
        {stage === 'd1' && d.accesses.length > 0 && <WideTile chipBg={C.blueTint} chipFg={C.blue} glyph="💻" title="Devices and accesses" bar={{ value: 0, color: C.blue, text: `0 of ${d.accesses.length} ready` }} />}
        <WideTile chipBg={C.amberTint} chipFg={C.amber} glyph="👤" title="Your profile" meta="6 of 6 sections done" bar={{ value: 1, color: '#1F9D45', text: '100%' }} />
      </div>
    </Frame>
  );
}

/** The phone for a stage of the template being edited. */
export function EmployeePreview({ d, stage, company }: { d: TemplateDesign; stage: DesignStage; company: string }) {
  const style: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 };
  return (
    <div style={style}>
      {stage === 'pre' ? <Portal key="pre" d={d} company={company} /> : <App key={stage} d={d} stage={stage} />}
      <span style={{ fontSize: 12, color: 'var(--on-sel, #fff)', opacity: 0.85 }}>{stage === 'pre' ? 'The joining portal, on the web' : 'The Sowaka app'} · sample people · tap a tile to open it</span>
    </div>
  );
}
