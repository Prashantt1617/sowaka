import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { getCompanySettings, updateCompanySettings } from '../../services/hrms';
import type { CompanySettings } from '../../services/hrms';
import { ApiError } from '../../services/http';
import { Card } from '../ui';
import { cycleRange, periodLabel } from '../period';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_A = MONTHS_SHORT[new Date().getMonth()];
const MONTH_B = MONTHS_SHORT[(new Date().getMonth() + 1) % 12];

/** "2026-09" — the example cycle name used in the helper text. */
function sampleCycle(): string {
  const d = new Date();
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function ordinal(d: number): string {
  if (d % 100 >= 11 && d % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][d % 10] ?? 'th';
}

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

// A pill-style on/off toggle used for both the week-off days and the per-team
// overtime switches.
function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${on ? '#B7D0B0' : '#F7F7F9'}`,
        background: on ? '#EDF3E9' : '#F7F7F9',
        color: on ? '#3C6340' : '#717171',
        borderRadius: 10,
        padding: '9px 14px',
        fontSize: 16,
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'all .12s',
      }}
    >
      {label}
    </button>
  );
}

export function Settings() {
  const { flash, reload } = useStore();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [weekoff, setWeekoff] = useState<number[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  // Held as text so a half-typed value isn't coerced to something valid.
  const [cycleDay, setCycleDay] = useState('1');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    getCompanySettings()
      .then((s) => {
        if (!live) return;
        setSettings(s);
        setWeekoff(s.weekoffDays);
        setDisabled(s.overtimeDisabledDepartments);
        setCycleDay(String(s.reviewCycleStartDay));
      })
      .catch((e) => {
        if (!live) return;
        setError(e instanceof ApiError ? e.message : 'Could not load settings.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const toggleWeekoff = (day: number) =>
    setWeekoff((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));

  // "on" = overtime enabled for the team = NOT in the disabled list.
  const toggleTeam = (dep: string) =>
    setDisabled((prev) => (prev.includes(dep) ? prev.filter((d) => d !== dep) : [...prev, dep]));

  // 1-28: capped so the cycle opens on a day every month actually has.
  const cycleDayValid = /^\d+$/.test(cycleDay.trim()) &&
    Number(cycleDay) >= 1 && Number(cycleDay) <= 28;

  const dirty =
    settings != null &&
    (JSON.stringify([...weekoff].sort((a, b) => a - b)) !==
      JSON.stringify([...settings.weekoffDays].sort((a, b) => a - b)) ||
      JSON.stringify([...disabled].sort()) !==
        JSON.stringify([...settings.overtimeDisabledDepartments].sort()) ||
      false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateCompanySettings({
        weekoffDays: weekoff,
        overtimeDisabledDepartments: disabled,
      });
      setSettings(updated);
      setWeekoff(updated.weekoffDays);
      setDisabled(updated.overtimeDisabledDepartments);
      setCycleDay(String(updated.reviewCycleStartDay));
      // The cycle start day changes which review cycle the whole dashboard is
      // in, and the store caches that from its own load — refresh it so the
      // KPI and Performance Review pages don't keep showing the old one.
      void reload();
      flash('Settings saved');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, color: '#717171', fontSize: 16 }}>Loading settings…</div>;
  }
  if (error) {
    return <div style={{ padding: 40, color: '#A8475F', fontSize: 16 }}>{error}</div>;
  }

  return (
    <div style={{ animation: 'fade .3s ease both', maxWidth: 720 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.4px', color: '#222222' }}>Settings</div>
        <div style={{ fontSize: 16, color: '#717171', marginTop: 4 }}>
          Company-wide rules for overtime and the performance review cycle.
        </div>
      </div>

      <Card style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Review cycle</div>
        <div style={{ fontSize: 14, color: '#717171', marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
          The day each monthly review cycle opens. A cycle is named after the month it starts in,
          so the cycle called “{sampleCycle()}” runs from this day in {MONTH_A} to the same day in {MONTH_B}.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, color: '#484848', fontWeight: 600 }}>Opens on day</span>
          <input
            value={cycleDay}
            disabled
            aria-label="Day of month the review cycle opens"
            style={{
              width: 74, border: '1px solid #EBEBEB', borderRadius: 10, padding: '9px 12px',
              fontSize: 16, fontFamily: 'inherit', background: '#F7F7F9', color: '#717171',
              fontWeight: 700, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
            }}
          />
          <span style={{ fontSize: 15, color: '#717171' }}>
            of each month{cycleDayValid && <> — the {cycleDay}{ordinal(Number(cycleDay))}</>}
          </span>
        </div>
        <div style={{ fontSize: 13, color: '#9197A2', marginTop: 12, lineHeight: 1.5 }}>
          Fixed for now — moving the boundary re-files which cycle new feedback and assignments
          land in, so it is not something to change while a cycle is running.
          {settings && (
            <>
              {' '}Current cycle is <strong style={{ color: '#717171' }}>{periodLabel(settings.currentCycle.period)}</strong>,
              running {cycleRange(settings.currentCycle.start, settings.currentCycle.end)}.
            </>
          )}
        </div>
      </Card>

      <Card style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Week-off days</div>
        <div style={{ fontSize: 14, color: '#717171', marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
          Days treated as a week-off. Full-day overtime can only be applied on a week-off or a company holiday.
        </div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {WEEKDAYS.map((d) => (
            <Toggle key={d.value} label={d.label} on={weekoff.includes(d.value)} onClick={() => toggleWeekoff(d.value)} />
          ))}
        </div>
      </Card>

      <Card style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#222222' }}>Overtime by team</div>
        <div style={{ fontSize: 14, color: '#717171', marginTop: 4, marginBottom: 16, lineHeight: 1.5 }}>
          Turn overtime off for specific teams — those employees won’t see the overtime option in the app.
        </div>
        {settings && settings.departments.length === 0 ? (
          <div style={{ fontSize: 16, color: '#717171' }}>No teams found in your organization yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {settings?.departments.map((dep) => {
              const on = !disabled.includes(dep);
              return (
                <div
                  key={dep}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '11px 14px',
                    border: '1px solid #F0F0F2',
                    borderRadius: 12,
                    background: '#FFFDF9',
                  }}
                >
                  <span style={{ fontSize: 16, fontWeight: 600, color: '#3A342C' }}>{dep}</span>
                  <Toggle label={on ? 'Enabled' : 'Disabled'} on={on} onClick={() => toggleTeam(dep)} />
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={save}
          disabled={!dirty || saving || !cycleDayValid}
          style={{
            border: 'none',
            background: dirty && !saving && cycleDayValid ? '#4F7A52' : '#9197A2',
            color: '#fff',
            borderRadius: 12,
            padding: '12px 26px',
            fontSize: 16,
            fontWeight: 700,
            cursor: dirty && !saving && cycleDayValid ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
