import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Spinner } from './ui';
import { downloadBlob } from '../lib/links';

/**
 * The full PDF, page by page (pdfjs-dist, loaded on demand), with zoom (100% ↔ 130%),
 * download and a page counter. If pdf.js cannot load, falls back to the browser's own
 * viewer in an <object>, still with download.
 */
type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void>; cancel: () => void };
  }>;
  destroy: () => Promise<void>;
};

let pdfjsPromise: Promise<{ getDocument: (o: { data: Uint8Array }) => { promise: Promise<PdfDoc> } }> | null = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib as unknown as { getDocument: (o: { data: Uint8Array }) => { promise: Promise<PdfDoc> } };
    });
  }
  return pdfjsPromise;
}

export interface PdfReady {
  pages: number;
  download: () => void;
}

export function PdfViewer({
  load,
  fileName,
  zoom: zoomProp,
  toolbar = false,
  onReady,
  onOpened,
  className,
  label,
}: {
  load: () => Promise<ArrayBuffer>;
  fileName: string;
  /** Controlled zoom (parent renders the buttons); ignored when `toolbar` is on. */
  zoom?: boolean;
  /** Draw the web toolbar (file name, pages, Page n of N, Zoom in, Download PDF). */
  toolbar?: boolean;
  onReady?: (r: PdfReady) => void;
  /** Called once the first page is on screen (letters: "opened"). */
  onOpened?: () => void;
  className?: string;
  label?: string;
}) {
  const [bytes, setBytes] = useState<ArrayBuffer>();
  const [doc, setDoc] = useState<PdfDoc>();
  const [error, setError] = useState<string>();
  const [fallbackUrl, setFallbackUrl] = useState<string>();
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [zoomOwn, setZoomOwn] = useState(false);
  const zoom = toolbar ? zoomOwn : !!zoomProp;
  const boxRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const openedCb = useRef(onOpened);
  openedCb.current = onOpened;

  const download = useCallback(() => {
    if (bytes) downloadBlob(bytes, 'application/pdf', fileName);
  }, [bytes, fileName]);

  // fetch + parse
  useEffect(() => {
    let live = true;
    let loaded: PdfDoc | undefined;
    setDoc(undefined);
    setError(undefined);
    openedRef.current = false;
    loadRef
      .current()
      .then(async (buf) => {
        if (!live) return;
        setBytes(buf);
        try {
          const pdfjs = await loadPdfjs();
          loaded = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
          if (live) setDoc(loaded);
        } catch {
          if (live) setFallbackUrl(URL.createObjectURL(new Blob([buf], { type: 'application/pdf' })));
        }
      })
      .catch((e: Error) => live && setError(e.message || 'We couldn’t open this PDF.'));
    return () => {
      live = false;
      loaded?.destroy().catch(() => undefined);
    };
  }, [fileName]);

  useEffect(() => () => {
    if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
  }, [fallbackUrl]);

  useEffect(() => {
    if (doc || fallbackUrl) readyRef.current?.({ pages: doc?.numPages ?? 0, download });
  }, [doc, fallbackUrl, download]);

  useEffect(() => {
    if (fallbackUrl && !openedRef.current) {
      openedRef.current = true;
      openedCb.current?.();
    }
  }, [fallbackUrl]);

  // container width
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // page counter
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !doc) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (vis) setPage(Number((vis.target as HTMLElement).dataset.page));
      },
      { root: el, threshold: [0.25, 0.5, 0.75] },
    );
    el.querySelectorAll('[data-page]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [doc, width]);

  const pageWidth = Math.max(200, (width - 2) * (zoom ? 1.3 : 1));

  return (
    <div className={`pdf ${toolbar ? 'pdf--web' : ''} ${className ?? ''}`}>
      {toolbar && (
        <div className="pdf__toolbar">
          <span className="pdf__badge" aria-hidden="true">
            PDF
          </span>
          <span className="pdf__name">
            <span className="body-strong">{fileName}</span>
            {doc && <span className="label">{doc.numPages} {doc.numPages === 1 ? 'page' : 'pages'}</span>}
          </span>
          {doc && (
            <span className="label pdf__counter-text" aria-live="polite">
              Page {page} of {doc.numPages}
            </span>
          )}
          <button type="button" className="icon-btn" aria-label={zoom ? 'Zoom out' : 'Zoom in'} aria-pressed={zoom} onClick={() => setZoomOwn((z) => !z)} disabled={!doc}>
            <Icon name={zoom ? 'zoomOut' : 'zoomIn'} />
          </button>
          <button type="button" className="icon-btn" aria-label="Download PDF" onClick={download} disabled={!bytes}>
            <Icon name="download" />
          </button>
        </div>
      )}
      <div className="pdf__scroll" ref={boxRef} tabIndex={0} aria-label={label ?? fileName} role="document">
        {error && (
          <div className="pdf__error" role="alert">
            {error}
          </div>
        )}
        {!error && !doc && !fallbackUrl && <Spinner label="Opening the PDF" />}
        {fallbackUrl && (
          <object data={fallbackUrl} type="application/pdf" className="pdf__object" aria-label={fileName}>
            <p className="body pdf__error">
              Your browser can’t show this PDF here.{' '}
              <button type="button" className="link-btn" onClick={download}>
                Download it
              </button>{' '}
              to read it.
            </p>
          </object>
        )}
        {doc &&
          width > 0 &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage
              key={i}
              doc={doc}
              n={i + 1}
              width={pageWidth}
              onRendered={
                i === 0
                  ? () => {
                      if (!openedRef.current) {
                        openedRef.current = true;
                        openedCb.current?.();
                      }
                    }
                  : undefined
              }
            />
          ))}
      </div>
      {!toolbar && doc && (
        <span className="pdf__counter" aria-live="polite">
          <span className="sr-only">Page </span>
          {page} / {doc.numPages}
        </span>
      )}
    </div>
  );
}

function PdfPage({ doc, n, width, onRendered }: { doc: PdfDoc; n: number; width: number; onRendered?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414);
  const done = useRef(onRendered);
  done.current = onRendered;
  useEffect(() => {
    let task: { cancel: () => void } | undefined;
    let live = true;
    doc.getPage(n).then((p) => {
      if (!live || !ref.current) return;
      const base = p.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = (width / base.width) * dpr;
      const vp = p.getViewport({ scale });
      const canvas = ref.current;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const t = p.render({ canvasContext: ctx, viewport: vp });
      task = t;
      t.promise.then(() => live && done.current?.()).catch(() => undefined);
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, n, width]);
  return (
    <div className="pdf__page" data-page={n} style={{ width, height: width * ratio }}>
      <canvas ref={ref} style={{ width: '100%', height: '100%' }} aria-label={`Page ${n}`} role="img" />
    </div>
  );
}
