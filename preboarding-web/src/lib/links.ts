import type { PortalPass } from '../api/types';
import { addDays } from './format';

/** "Ask HR": a reply to the offer email. One subject everywhere so HR keeps one thread. */
export function offerSubject(companyName: string): string {
  return `Re: Your offer from ${companyName}`;
}

export function mailto(email: string, subject?: string): string {
  return `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
}

/** The app's open link (deep links, go.getsowaka.com/open). */
export const APP_LINK = (import.meta.env.VITE_APP_LINK as string | undefined) || 'https://go.getsowaka.com/open';

export function directionsUrl(pass: PortalPass): string | undefined {
  if (pass.mapLink) return pass.mapLink;
  if (pass.place) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pass.place)}`;
  return undefined;
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Client-side .ics for the Day-1 pass (used in mock mode; the server serves /portal/pass.ics). */
export function buildIcs(pass: PortalPass, date: string, companyName: string): string {
  const day = date.replace(/-/g, '');
  const [h, m] = (pass.reportingTime ?? '09:30').split(':');
  const start = `${day}T${h.padStart(2, '0')}${(m ?? '00').padStart(2, '0')}00`;
  const end = `${day}T180000`;
  const desc = [
    pass.askFor ? `Ask for ${pass.askFor.name}${pass.askFor.phone ? ` (${pass.askFor.phone})` : ''}` : '',
    pass.bring?.length ? `Bring: ${pass.bring.join(', ')}` : '',
    pass.meetingLink ?? '',
  ]
    .filter(Boolean)
    .join('\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sowaka//Joining portal//EN',
    'BEGIN:VEVENT',
    `UID:day1-${day}@portal`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(`Day 1 at ${companyName}`)}`,
    pass.place ? `LOCATION:${icsEscape(pass.place)}` : '',
    desc ? `DESCRIPTION:${icsEscape(desc)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}

export function downloadBlob(data: BlobPart, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The next n Mondays after a day. */
export function nextMondays(after: string, n: number): string[] {
  const out: string[] = [];
  let d = addDays(after, 1);
  while (out.length < n) {
    const wd = new Date(`${d}T00:00:00`).getDay();
    if (wd === 1) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}
