// Organisation — top-level tab with subtabs. "Profile" is the org identity /
// address / contact screen; "Work locations" lists the physical sites employees
// are mapped to. Subtabs are local state (the sidebar has one Organisation entry).
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { OrganisationProfile } from './OrganisationProfile';
import { WorkLocations } from './WorkLocations';

type SubTab = 'profile' | 'locations';
const TABS: { key: SubTab; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'locations', label: 'Work locations' },
];

export function Organisation() {
  const [tab, setTab] = useState<SubTab>('profile');
  return (
    <div>
      <div style={tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...tabBtn,
                color: active ? '#0571A6' : '#717171',
                borderBottomColor: active ? '#0571A6' : 'transparent',
                fontWeight: active ? 800 : 600,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'profile' ? <OrganisationProfile /> : <WorkLocations />}
    </div>
  );
}

const tabBar: CSSProperties = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid #EBEBEB',
  marginBottom: 22,
};
const tabBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  borderBottom: '2.5px solid transparent',
  padding: '0 4px 11px',
  marginRight: 20,
  fontSize: 16,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
