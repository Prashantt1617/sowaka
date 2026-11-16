import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import { useCopy } from '../lib/hooks';
import { mailto } from '../lib/links';

/** The one primary button per screen: 56 px, radius 14. */
export function PrimaryButton({ children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn btn--primary ${className ?? ''}`} {...rest}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn btn--secondary ${className ?? ''}`} {...rest}>
      {children}
    </button>
  );
}

/** 36 px outline pill — only inside cards. */
export function PillButton({ children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`pill-btn ${className ?? ''}`} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  to,
  href,
  className,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  to?: string;
  href?: string;
  className?: string;
  disabled?: boolean;
}) {
  const cls = `icon-btn ${className ?? ''}`;
  if (to)
    return (
      <Link to={to} className={cls} aria-label={label}>
        <Icon name={icon} />
      </Link>
    );
  if (href)
    return (
      <a href={href} className={cls} aria-label={label}>
        <Icon name={icon} />
      </a>
    );
  return (
    <button type="button" className={cls} aria-label={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

/** Pinned at the bottom on phones; inline on wide layouts. */
export function BottomBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`bottom-bar ${className ?? ''}`}>{children}</div>;
}

export function Tag({ kind, children }: { kind: 'done' | 'review' | 'todo' | 'water' | 'back' | 'public'; children: ReactNode }) {
  return <span className={`tag tag--${kind}`}>{children}</span>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow ${className ?? ''}`}>{children}</p>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <p>{error.message}</p>
      {onRetry && (
        <PillButton onClick={onRetry}>Try again</PillButton>
      )}
    </div>
  );
}

/** Story bar: 4 px segments; done segments fill, the current one is half. */
export function StoryBar({ total, current, done, light }: { total: number; current: number; done?: boolean[]; light?: boolean }) {
  return (
    <div className={`story-bar ${light ? 'story-bar--light' : ''}`} role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={Math.min(current + 1, total)} aria-label={`Step ${Math.min(current + 1, total)} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`story-seg ${i < current || done?.[i] ? 'is-done' : i === current ? 'is-current' : ''}`} />
      ))}
    </div>
  );
}

/** Copy button that flips to "Copied ✓". */
export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [copied, copy] = useCopy();
  return (
    <button type="button" className={`pill-btn copy-btn ${copied ? 'is-copied' : ''} ${className ?? ''}`} onClick={() => copy(text)} aria-live="polite">
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

/** "Any questions or queries? Write to HR" row (mailto + Copy). */
export function AskHrRow({ email, subject }: { email: string; subject: string }) {
  return (
    <div className="ask-row">
      <a className="ask-row__link" href={mailto(email, subject)}>
        <span className="ask-row__q">Any questions or queries? Write to HR</span>
        <span className="ask-row__email">{email}</span>
      </a>
      <CopyButton text={email} />
    </div>
  );
}

/** Modal dialog (bottom sheet on phones). Esc and the scrim close it; focus is kept inside. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () =>
      Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])') ?? []).filter(
        (n) => !n.hasAttribute('disabled'),
      );
    (focusables()[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`sheet ${wide ? 'sheet--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
        tabIndex={-1}
      >
        <span className="sheet__grabber" aria-hidden="true" />
        {title && (
          <div className="sheet__head">
            <h2 id={titleId} className="h1">
              {title}
            </h2>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** "Ask HR" sheet: write to HR (mailto, reply subject) with the address and Copy in case no mail app opens. */
export function AskHrSheet({ open, onClose, name, email, subject }: { open: boolean; onClose: () => void; name: string; email: string; subject: string }) {
  return (
    <Sheet open={open} onClose={onClose} title="Ask HR">
      <p className="body">Write to {name} and they’ll reply by email.</p>
      <div className="card ask-card">
        <div>
          <p className="label">HR</p>
          <p className="body-strong">{email}</p>
        </div>
        <CopyButton text={email} />
      </div>
      <a className="btn btn--primary" href={mailto(email, subject)}>
        <Icon name="mail" /> Write to HR
      </a>
    </Sheet>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <p className="field__hint">{hint}</p>}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A single-select chip row (role=radiogroup). */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
  render,
}: {
  label: string;
  options: readonly T[];
  value: T | undefined;
  onChange: (v: T) => void;
  name: string;
  render?: (v: T) => ReactNode;
}) {
  const id = useId();
  return (
    <fieldset className="chips" aria-labelledby={id}>
      <legend id={id} className="field__label">
        {label}
      </legend>
      <div className="chips__row">
        {options.map((o) => (
          <label key={o} className={`chip ${value === o ? 'is-on' : ''}`}>
            <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} />
            <span>{render ? render(o) : o}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Done / current / next steps (P4 status, 3 steps). */
export function Steps({ steps }: { steps: Array<{ title: string; sub?: string; state: 'done' | 'current' | 'todo' }> }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={s.title} className={`step step--${s.state}`}>
          <span className={`node node--${s.state}`} aria-hidden="true">
            {s.state === 'done' ? <Icon name="check" size={16} /> : i + 1}
          </span>
          <span className="step__text">
            <span className="body-strong">{s.title}</span>
            {s.sub && <span className="label">{s.sub}</span>}
            <span className="sr-only">{s.state === 'done' ? ', done' : s.state === 'current' ? ', in progress' : ', next'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Desktop "Back" link (the W screens carry it in the page; phones use the header). */
export function BackLink({ to, children = 'Back to home' }: { to: string; children?: ReactNode }) {
  return (
    <Link to={to} className="back-link wide-only">
      <Icon name="back" size={18} /> {children}
    </Link>
  );
}

/** Round progress ring with a count (Up-next card). */
export function Ring({ done, total, light }: { done: number; total: number; light?: boolean }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <span className={`ring ${light ? 'ring--light' : ''}`} aria-label={`${done} of ${total} done`} role="img">
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="ring__track" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="4"
          className="ring__fill"
          strokeDasharray={`${c * frac} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="ring__count" aria-hidden="true">
        {done}/{total}
      </span>
    </span>
  );
}
