// One company policy, full screen: what "Policies to read" and the policies story open.
// The text is read exactly as the app reads it (mobile-app policies_models.dart
// parsePolicyBody) and as the dashboard's preview shows it (Policies.tsx blocksOf):
// a blank line ends a card, a "## " line is a section heading, a "- " line is a bullet,
// and nothing else is formatting. Keep the three in step.
import { useEffect } from 'react';
import { FigBack } from './icons';

export type PortalPolicy = { key: string; title: string; summary: string; body: string };

type Block = { kind: 'heading'; text: string } | { kind: 'card'; lines: { text: string; bullet: boolean }[] };

/** The app's parsePolicyBody, line for line. */
export function policyBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let lines: { text: string; bullet: boolean }[] = [];
  const close = () => { if (lines.length) blocks.push({ kind: 'card', lines }); lines = []; };
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) close();
    else if (line === '##' || line.startsWith('## ')) { close(); const t = line.slice(2).trim(); if (t) blocks.push({ kind: 'heading', text: t }); }
    else if (line === '-' || line.startsWith('- ')) { const t = line.slice(1).trim(); if (t) lines.push({ text: t, bullet: true }); }
    else lines.push({ text: line, bullet: false });
  }
  close();
  return blocks;
}

/** The app's policyHeading: "Leave" reads "Leave policy"; a title that already says so is left alone. */
export const policyHeading = (title: string) => (/\b(policy|policies)$/i.test(title.trim()) ? title.trim() : `${title.trim()} policy`);

export function G2Policy({ policy, onClose }: { policy: PortalPolicy; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const blocks = policyBlocks(policy.body);
  return (
    <div className="a1-story" role="dialog" aria-modal="true" aria-label={policyHeading(policy.title)}>
      <div className="g2-policy">
        <header className="fig-head fig-head--back g2-policy__head">
          <button type="button" className="fig-head__back" aria-label="Back" onClick={onClose}><FigBack /></button>
          <h1 className="fig-head__title">{policyHeading(policy.title)}</h1>
        </header>
        <div className="g2-policy__body">
          {policy.summary && <p className="g2-policy__summary">{policy.summary}</p>}
          {blocks.map((b, n) => b.kind === 'heading'
            ? <h2 key={n} className="g2-policy__h">{b.text}</h2>
            : (
              <div key={n} className="g2-policy__card">
                {b.lines.some((l) => l.bullet)
                  ? <ul>{b.lines.map((l, m) => (l.bullet ? <li key={m}>{l.text}</li> : <li key={m} className="g2-policy__plain">{l.text}</li>))}</ul>
                  : b.lines.map((l, m) => <p key={m}>{l.text}</p>)}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
