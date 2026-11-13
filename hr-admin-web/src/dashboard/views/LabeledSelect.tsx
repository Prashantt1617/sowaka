// A pill-shaped filter with its label inside ("Department  All departments ⌄"),
// laid out in a row with `.ar-filters`. Shared by the Attendance report and the
// Time office pages.
import './labeled-select.css';

export function LabeledSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="ar-sel">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
