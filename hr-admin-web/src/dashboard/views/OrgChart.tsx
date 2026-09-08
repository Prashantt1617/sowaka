// People › Org chart — a full-bleed, scrollable flow chart of the company.
// Starts from the three founders (CEO / CTO / CBO) and runs ~8 layers deep so the
// canvas scrolls both vertically and horizontally.
// NOTE: frontend-capture phase — renders from local mock data, no API calls.
// The connector lines come from the .oc-tree CSS block in styles.css.
import type { CSSProperties } from 'react';
import { Avatar } from '../ui';

type Kind = 'company' | 'founder' | 'normal';
type OrgNode = { name: string; title: string; kind?: Kind; children?: OrgNode[] };

// —— Mock organisation ————————————————————————————————————————————————
const ORG: OrgNode = {
  name: 'Convrse Spaces',
  title: 'Organisation',
  kind: 'company',
  children: [
    {
      name: 'Aarav Mehta',
      title: 'Chief Executive Officer',
      kind: 'founder',
      children: [
        {
          name: 'Anjali Gupta',
          title: 'VP, Finance',
          children: [
            { name: 'Siddharth Rao', title: 'Finance Manager', children: [
              { name: 'Divya Nair', title: 'Finance Analyst', children: [
                { name: 'Aman Das', title: 'Accountant' },
              ] },
            ] },
          ],
        },
        {
          name: 'Kiara Menon',
          title: 'VP, People',
          children: [
            { name: 'Rahul Sharma', title: 'HR Manager', children: [
              { name: 'Ira Bose', title: 'People Operations', children: [
                { name: 'Nina Rao', title: 'HR Associate' },
              ] },
            ] },
          ],
        },
        {
          name: 'Manish Iyer',
          title: 'Head of Operations',
          children: [
            { name: 'Sana Kapoor', title: 'Operations Manager', children: [
              { name: 'Dhruv Shetty', title: 'Operations Analyst' },
            ] },
          ],
        },
      ],
    },
    {
      name: 'Kabir Rao',
      title: 'Chief Technology Officer',
      kind: 'founder',
      children: [
        {
          name: 'Rohan Iyer',
          title: 'VP, Engineering',
          children: [
            {
              name: 'Neha Gupta',
              title: 'Director, Platform Engineering',
              children: [
                {
                  name: 'Arjun Das',
                  title: 'Engineering Manager, Backend',
                  children: [
                    { name: 'Vikram Singh', title: 'Backend Lead', children: [
                      { name: 'Ananya Rao', title: 'Sr. Software Engineer', children: [
                        { name: 'Ishaan Bose', title: 'Software Engineer', children: [
                          { name: 'Tara Kapoor', title: 'Associate Software Engineer' },
                          { name: 'Om Verma', title: 'Software Engineer Intern' },
                        ] },
                      ] },
                      { name: 'Karan Menon', title: 'Sr. Software Engineer' },
                    ] },
                    { name: 'Sneha Joshi', title: 'QA Lead', children: [
                      { name: 'Nikhil Pillai', title: 'QA Engineer' },
                    ] },
                  ],
                },
                {
                  name: 'Priya Reddy',
                  title: 'Engineering Manager, Frontend',
                  children: [
                    { name: 'Dev Malhotra', title: 'Frontend Lead', children: [
                      { name: 'Riya Shetty', title: 'Sr. Software Engineer', children: [
                        { name: 'Varun Bhat', title: 'Software Engineer' },
                      ] },
                    ] },
                  ],
                },
              ],
            },
            {
              name: 'Aditya Kulkarni',
              title: 'Director, Infrastructure',
              children: [
                { name: 'Meera Chopra', title: 'SRE Manager', children: [
                  { name: 'Yash Nair', title: 'SRE Lead', children: [
                    { name: 'Sana Rao', title: 'Site Reliability Engineer' },
                  ] },
                ] },
              ],
            },
          ],
        },
        {
          name: 'Kavya Sharma',
          title: 'VP, Product',
          children: [
            { name: 'Nitin Gupta', title: 'Group Product Manager', children: [
              { name: 'Zoya Khan', title: 'Product Manager', children: [
                { name: 'Harsh Mehta', title: 'Associate Product Manager' },
              ] },
            ] },
          ],
        },
        {
          name: 'Isha Menon',
          title: 'Head of Design',
          children: [
            { name: 'Manav Rao', title: 'Design Lead', children: [
              { name: 'Aarti Iyer', title: 'Product Designer', children: [
                { name: 'Rehan Das', title: 'UX Designer' },
              ] },
            ] },
          ],
        },
      ],
    },
    {
      name: 'Diya Nair',
      title: 'Chief Business Officer',
      kind: 'founder',
      children: [
        {
          name: 'Simran Kaur',
          title: 'VP, Sales',
          children: [
            {
              name: 'Gaurav Malhotra',
              title: 'Regional Sales Head, North',
              children: [
                { name: 'Payal Verma', title: 'Sales Manager', children: [
                  { name: 'Kunal Shetty', title: 'Account Executive', children: [
                    { name: 'Naina Bhat', title: 'Sales Development Rep' },
                  ] },
                ] },
              ],
            },
            {
              name: 'Vivek Nair',
              title: 'Regional Sales Head, South',
              children: [
                { name: 'Ritu Pillai', title: 'Sales Manager', children: [
                  { name: 'Sahil Rao', title: 'Account Executive' },
                ] },
              ],
            },
          ],
        },
        {
          name: 'Nisha Kapoor',
          title: 'VP, Marketing',
          children: [
            { name: 'Tarun Joshi', title: 'Growth Manager', children: [
              { name: 'Ved Menon', title: 'Content Lead', children: [
                { name: 'Lata Das', title: 'Marketing Associate' },
              ] },
            ] },
          ],
        },
        {
          name: 'Bhavna Singh',
          title: 'Head of Customer Success',
          children: [
            { name: 'Raj Chopra', title: 'Customer Success Manager', children: [
              { name: 'Pooja Reddy', title: 'Customer Success Executive' },
            ] },
          ],
        },
      ],
    },
  ],
};

function countPeople(n: OrgNode): number {
  const self = n.kind === 'company' ? 0 : 1;
  return self + (n.children ?? []).reduce((s, c) => s + countPeople(c), 0);
}

export function OrgChart() {
  const total = countPeople(ORG);
  return (
    <div style={fullBleed}>
      {/* Header bar */}
      <div style={headerBar}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Organisation chart</div>
          <div style={{ fontSize: 14, color: '#717171', marginTop: 2 }}>{total} people · 3 founders — scroll to explore</div>
        </div>
        <div style={legend}>
          <LegendDot color="#0571A6" label="Founder" />
          <LegendDot color="#9197A2" label="Team member" />
        </div>
      </div>

      {/* Scroll canvas */}
      <div style={canvas} className="scry">
        <div className="oc-tree" style={{ display: 'inline-block', minWidth: '100%', padding: '44px 64px 90px' }}>
          <ul>
            {ORG.children!.map((f) => <NodeItem key={f.name} n={f} />)}
          </ul>
        </div>
      </div>
    </div>
  );
}

function NodeItem({ n }: { n: OrgNode }) {
  return (
    <li>
      <NodeCard n={n} />
      {n.children && n.children.length > 0 && (
        <ul>
          {n.children.map((c) => <NodeItem key={c.name} n={c} />)}
        </ul>
      )}
    </li>
  );
}

function NodeCard({ n }: { n: OrgNode }) {
  const founder = n.kind === 'founder';
  return (
    <div style={{ ...cardBase, ...(founder ? founderCard : normalCard), whiteSpace: 'normal' }}>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <Avatar name={n.name} size={founder ? 52 : 44} font={founder ? 16 : 14} />
        {founder && <span style={founderBadge}>★</span>}
      </div>
      <div style={{ fontSize: founder ? 16 : 14, fontWeight: 700, color: '#222222' }}>{n.name}</div>
      <div style={{ fontSize: 12, color: '#717171', marginTop: 2, lineHeight: 1.35 }}>{n.title}</div>
      {founder && <div style={coFounderTag}>Co-founder</div>}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#717171', fontWeight: 600 }}>
      <span style={{ width: 11, height: 11, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

// —— styles ————————————————————————————————————————————————————————————
// Break out of the padded content area to fill the viewport, with an internal
// scroll region (page padding is 28px top / 34px sides / 60px bottom).
const fullBleed: CSSProperties = {
  margin: '-28px -34px -60px',
  height: 'calc(100% + 88px)',
  display: 'flex',
  flexDirection: 'column',
  background: '#F7F7F9',
};
const headerBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '16px 34px',
  borderBottom: '1px solid #EBEBEB',
  background: '#F7F7F9',
  flexShrink: 0,
};
const legend: CSSProperties = { marginLeft: 'auto', display: 'flex', gap: 18, alignItems: 'center' };
const canvas: CSSProperties = { flex: 1, overflow: 'auto' };

const cardBase: CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: 176,
  padding: '14px 14px 12px',
  borderRadius: 14,
  background: '#fff',
  boxShadow: '0 3px 10px rgba(34,34,34,.07)',
  textAlign: 'center',
};
const normalCard: CSSProperties = { border: '1px solid #EBEBEB' };
const founderCard: CSSProperties = { border: '2px solid #0571A6', boxShadow: '0 6px 18px rgba(5,113,166,.16)', width: 190 };
const founderBadge: CSSProperties = {
  position: 'absolute',
  right: -4,
  bottom: -2,
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: '#0571A6',
  color: '#fff',
  border: '2px solid #fff',
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const coFounderTag: CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: '#0571A6',
  background: '#E7F4FB',
  borderRadius: 999,
  padding: '3px 9px',
};
