// The profile's step segments (Figma "Header · <section> Step N of 7"): 7 × 4 px bars, 4 px apart,
// done = success green, this step = brand, to do = subtle grey. Built by G2, shared: pass it as
// `below` to FigBackHeader (it adds the 8 px gap above and the 12 px below, inside the white header).
import '../../styles/fig-g2.css';

export type G2Seg = 'done' | 'on' | 'todo';

/** `onPick`: each segment is a button that opens its step (the profile's sections); `titles` name them for screen readers. */
export function G2Steps({ segs, label = 'Employee profile progress', onPick, titles }: { segs: G2Seg[]; label?: string; onPick?: (i: number) => void; titles?: string[] }) {
  if (onPick) {
    return (
      <nav className="g2-steps" aria-label={label}>
        {segs.map((s, i) => (
          <button key={i} type="button" className={`g2-steps__seg g2-steps__seg--${s} g2-steps__seg--tap`} aria-current={s === 'on' ? 'step' : undefined}
            aria-label={`${titles?.[i] ?? `Step ${i + 1}`}${s === 'done' ? ' (done)' : ''}`} onClick={() => onPick(i)} />
        ))}
      </nav>
    );
  }
  return (
    <div className="g2-steps" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={segs.length} aria-valuenow={segs.filter((s) => s === 'done').length}>
      {segs.map((s, i) => <span key={i} className={`g2-steps__seg g2-steps__seg--${s}`} />)}
    </div>
  );
}
