// Departments and designations HR creates here, before anyone holds them.
//
// The roster still decides who is where; these lists only add names to pick
// from (the Add user wizard offers them), and a saved name nobody holds yet
// shows on its page with no one in it.
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { IconPlus } from '../icons';
import { getCompanySettings, updateCompanySettings } from '../../services/hrms';

export type SavedNameKind = 'departmentList' | 'designationList';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The org's saved names of one kind, and adding or removing one. */
export function useSavedNames(kind: SavedNameKind) {
  const { flash } = useStore();
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCompanySettings().then((s) => setSaved(s[kind] ?? [])).catch(() => setSaved([]));
  }, [kind]);

  const write = useCallback(async (next: string[], done: string) => {
    setBusy(true);
    try {
      const settings = await updateCompanySettings({ [kind]: next });
      setSaved(settings[kind] ?? []);
      flash(done);
      return true;
    } catch (e) {
      flash(e instanceof Error && e.message ? e.message : 'Could not save. Try again.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [kind, flash]);

  const add = (name: string) => write([...saved, name.trim()], `${name.trim()} added`);
  const remove = (name: string) => write(saved.filter((n) => !same(n, name)), `${name} removed`);
  return { saved, busy, add, remove };
}

/** "Add department": a button that opens a one-line form in place. */
export function AddNameButton({
  noun,
  existing,
  busy,
  onAdd,
}: {
  noun: 'department' | 'designation';
  /** Every name already in use or saved, so a repeat is caught here. */
  existing: string[];
  busy: boolean;
  onAdd: (name: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const taken = trimmed !== '' && existing.some((n) => same(n, trimmed));
  const tooLong = trimmed.length > 80;
  const submit = async () => {
    if (!trimmed || taken || tooLong || busy) return;
    if (await onAdd(trimmed)) {
      setName('');
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button style={primaryBtn} onClick={() => setOpen(true)}>
        <IconPlus size={15} /> Add {noun}
      </button>
    );
  }
  return (
    <form
      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <input
          autoFocus
          aria-label={`New ${noun}`}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setName(''); setOpen(false); } }}
          placeholder={`New ${noun} name`}
          style={{ ...inputStyle, width: 240, borderColor: taken ? '#C24141' : '#EBEBEB' }}
        />
        {taken && <span style={{ fontSize: 11.5, color: '#C24141' }}>That {noun} already exists.</span>}
      </div>
      <button type="submit" style={{ ...primaryBtn, opacity: !trimmed || taken || busy ? 0.5 : 1 }} disabled={!trimmed || taken || busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" style={ghostBtn} onClick={() => { setName(''); setOpen(false); }}>Cancel</button>
    </form>
  );
}

const primaryBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0571A6', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: 'pointer' };
const ghostBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: '#484848', border: '1px solid #EBEBEB', padding: '9px 15px', borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: 'pointer' };
const inputStyle: CSSProperties = { padding: '9px 11px', border: '1px solid #EBEBEB', borderRadius: 10, fontSize: 13.5, fontFamily: 'inherit', background: '#fff', color: '#222222' };
