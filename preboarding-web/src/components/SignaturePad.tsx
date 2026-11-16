import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';

export interface SignatureValue {
  method: 'draw' | 'type';
  typedName?: string;
  imageDataUrl?: string;
}

/** Draw | Type signature. Calls onChange with a value once something is drawn or typed, else null. */
export function SignaturePad({ defaultName, onChange, disabled }: { defaultName: string; onChange: (v: SignatureValue | null) => void; disabled?: boolean }) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typed, setTyped] = useState(defaultName);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const inputId = useId();
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (mode === 'type') changeRef.current(typed.trim() ? { method: 'type', typedName: typed.trim() } : null);
    else changeRef.current(hasInk.current && canvasRef.current ? { method: 'draw', imageDataUrl: canvasRef.current.toDataURL('image/png') } : null);
  }, [mode, typed]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || mode !== 'draw') return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = c.getBoundingClientRect();
    c.width = Math.floor(rect.width * dpr);
    c.height = Math.floor(rect.height * dpr);
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#222222';
    }
    hasInk.current = false;
  }, [mode]);

  const pos = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    hasInk.current = false;
    onChange(null);
  };

  return (
    <div className={`sig ${disabled ? 'is-disabled' : ''}`}>
      <div className="seg" role="tablist" aria-label="Signature method">
        {(['draw', 'type'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`seg__btn ${mode === m ? 'is-on' : ''}`}
            onClick={() => setMode(m)}
            disabled={disabled}
          >
            {m === 'draw' ? 'Draw' : 'Type'}
          </button>
        ))}
      </div>
      {mode === 'draw' ? (
        <div className="sig__pad-wrap">
          <canvas
            ref={canvasRef}
            className="sig__pad"
            aria-label="Signature pad. Draw your signature with your finger or mouse."
            role="img"
            onPointerDown={(e) => {
              if (disabled) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drawing.current = true;
              last.current = pos(e);
            }}
            onPointerMove={(e) => {
              if (!drawing.current || !last.current) return;
              const ctx = e.currentTarget.getContext('2d');
              const p = pos(e);
              if (ctx) {
                ctx.beginPath();
                ctx.moveTo(last.current.x, last.current.y);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
              }
              last.current = p;
              hasInk.current = true;
            }}
            onPointerUp={() => {
              drawing.current = false;
              last.current = null;
              if (hasInk.current && canvasRef.current) onChange({ method: 'draw', imageDataUrl: canvasRef.current.toDataURL('image/png') });
            }}
          />
          <span className="sig__line" aria-hidden="true" />
          <button type="button" className="link-btn sig__clear" onClick={clear} disabled={disabled}>
            Clear
          </button>
        </div>
      ) : (
        <div className="sig__type">
          <label className="field__label" htmlFor={inputId}>
            Type your full name
          </label>
          <input id={inputId} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="name" disabled={disabled} />
          <p className="sig__preview" aria-hidden="true">
            {typed || ' '}
          </p>
        </div>
      )}
    </div>
  );
}
