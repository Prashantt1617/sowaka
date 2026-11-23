// The pieces of a person's profile page, shared by the Employee profile and a candidate's
// pre-boarding profile so the two look the same: the identity header with its facts, the
// section cards with their label/value rows, and the documents list.
import type { ReactNode } from 'react';
import { IconFile } from '../icons';
import { Avatar, Pill, Skeleton, SkeletonFrame } from '../ui';
import { FileChips } from './lifecycle/preboardingParts';
import type { FileLinkItem } from './lifecycle/preboardingParts';
import { Field, inputStyle } from './AddEmployeeWizard';
import { PdLock } from './pdIcons';
import { nameParts } from './profileWords';
import './people.css';

type Tone = { bg: string; fg: string };

/** The identity card at the top: photo, name with its pills, a line under it, then the facts. */
export function ProfileHeader({ name, photoUrl, pills, sub, children }: { name: string; photoUrl?: string; pills?: ReactNode; sub: ReactNode; children: ReactNode }) {
  return (
    <section className="pd-card pd-phead">
      <div className="ph-id">
        <Avatar name={name} size={52} font={21} src={photoUrl} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="pn">
            <h1>{name}</h1>
            {pills}
          </div>
          <span className="sub">{sub}</span>
        </div>
      </div>
      <div className="pd-facts">{children}</div>
    </section>
  );
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="pd-fact">
      <span className="pd-eyebrow">{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function Section({ title, icon, action, children, labelId }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; labelId?: string }) {
  return (
    <section className="pd-card pd-psec" aria-labelledby={labelId}>
      <div className="pd-sec-h">
        {icon && <span className="pd-ps-i">{icon}</span>}
        <h3 id={labelId}>{title}</h3>
        {action}
      </div>
      <div className="pd-sec-b">{children}</div>
    </section>
  );
}

/** Placeholder pairs shaped like a Grid of Rows. */
export function SkeletonGrid({ rows }: { rows: number }) {
  return (
    <SkeletonFrame style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 26px' }}>
      {Array.from({ length: rows * 2 }, (_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Skeleton w={70} h={9} style={{ opacity: 0.7 }} />
          <Skeleton w={i % 3 ? '58%' : '72%'} h={12} />
        </div>
      ))}
    </SkeletonFrame>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="pd-pfg">{children}</div>;
}

export function Row({ label, value, strong }: { label: string; value: string; wide?: boolean; strong?: boolean }) {
  return (
    <div className="pd-pf">
      <span className="pl">{label}</span>
      <span className="pv" style={strong ? { fontWeight: 500 } : undefined}>{value}</span>
    </div>
  );
}

/** One document in a DocumentList. `files: null` hides them (someone who only sees where each one is). */
export interface ProfileDocItem {
  id: string;
  title: ReactNode;
  sub: ReactNode;
  status?: { label: string; tone: Tone } | null;
  files: FileLinkItem[] | null;
  /** Under the files: a note, the review buttons. */
  extra?: ReactNode;
}

/** Documents in groups (a group's title shows once there is more than one); each file opens or downloads. */
export function DocumentList({ groups }: { groups: Array<{ key: string; title: string; list: ProfileDocItem[] }> }) {
  const shown = groups.filter((g) => g.list.length > 0);
  const titled = shown.length > 1;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {shown.map((g) => (
        <div key={g.key} style={{ display: 'grid', gap: 4 }}>
          {titled && <span className="pd-eyebrow" style={{ color: 'var(--ink-3)' }}>{g.title}</span>}
          <div className="pd-list">
            {g.list.map((doc) => (
              <div key={doc.id} className="pd-li" style={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 8 }}>
                <span className="pd-li-i">
                  <IconFile size={15} stroke="currentColor" />
                </span>
                <span className="grow" style={{ minWidth: 160 }}>
                  <b>{doc.title}</b>
                  <span className="s" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.sub}</span>
                </span>
                {doc.status && <Pill label={doc.status.label} tone={doc.status.tone} fontSize={11} padding="2px 9px" />}
                {(doc.files || doc.extra) && (
                  <span style={{ flexBasis: '100%', paddingLeft: 46, display: 'grid', gap: 8 }}>
                    {doc.files && (doc.files.length > 0 ? <FileChips files={doc.files} /> : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>No file attached</span>)}
                    {doc.extra}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** What the Basic details card shows, already in words ('' shows as a dash). */
export interface BasicDetails {
  name: string; employeeId: string; joining: string; workEmail: string; designation: string; department: string;
  workLocation: string; employeeType: string; mobile: string; gender: string; dob: string;
  /** Left out (undefined) where there is none to speak of yet, e.g. before joining. */
  manager?: string;
  isDirector?: boolean;
}

/** The Basic details card's rows, the same for an employee and for a candidate before joining. */
export function BasicDetailsGrid({ d }: { d: BasicDetails }) {
  const { first, middle, last } = nameParts(d.name);
  const v = (x: string) => x || '—';
  return (
    <Grid>
      <Row label="First name" value={v(first)} />
      <Row label="Middle name" value={v(middle)} />
      <Row label="Last name" value={v(last)} />
      <Row label="Employee ID" value={v(d.employeeId)} />
      <Row label="Date of joining" value={v(d.joining)} />
      <Row label="Work email" value={v(d.workEmail)} />
      <Row label="Designation" value={v(d.designation)} />
      <Row label="Department" value={v(d.department)} />
      <Row label="Work location" value={v(d.workLocation)} />
      <Row label="Employee type" value={v(d.employeeType)} />
      <Row label="Mobile number" value={v(d.mobile)} />
      <Row label="Gender" value={v(d.gender)} />
      <Row label="Date of birth" value={v(d.dob)} />
      {d.manager !== undefined && <Row label="Reporting manager" value={v(d.manager)} />}
      {d.isDirector !== undefined && <Row label="Director / substantial interest" value={d.isDirector ? 'Yes' : 'No'} />}
    </Grid>
  );
}

/** A field that stays in view while the rest are edited, greyed and locked. */
export function LockedField({ label, value, title = 'This field can\'t be edited' }: { label: string; value: string; title?: string }) {
  return (
    <Field label={label}>
      <div title={title} aria-disabled="true"
        style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface-2, var(--line-2, #f3f3f7))', color: 'var(--ink-4)', cursor: 'not-allowed' }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</span>
        <span style={{ display: 'inline-flex', color: 'var(--ink-4)' }} aria-label={title}><PdLock size={14} /></span>
      </div>
    </Field>
  );
}
