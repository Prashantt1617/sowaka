// Suwi's one line above an import preview: what in this import could hurt
// ("3 people lose their reporting manager; 12 values removed"). Hidden while
// loading, when Suwi is off, or if the summary can't be had: the preview
// itself is the record, this is only a nudge.
import { useEffect, useState } from 'react';
import { api } from '../../services/http';
import { SuwiOrb } from './SuwiPanel';

type Risk = { key: string; level: 'high' | 'medium' | 'info'; count: number; text: string; people: string[] };
type ImportRisk = { enabled: false } | { enabled: true; level: Risk['level']; summary: string; phrasedBy: 'rules' | 'model'; risks: Risk[] };

export function ImportRiskLine({ importId }: { importId: string }) {
  const [r, setR] = useState<{ id: string; data: ImportRisk } | null>(null);
  useEffect(() => {
    let live = true;
    api<ImportRisk>(`/suwi/import-risk/${importId}`).then((data) => { if (live) setR({ id: importId, data }); }).catch(() => undefined);
    return () => { live = false; };
  }, [importId]);
  if (!r || r.id !== importId || !r.data.enabled) return null;
  const d = r.data;
  return (
    <div role="status" className={`suwi-risk ${d.level}`}>
      <SuwiOrb size={20} />
      <span><strong>Suwi:</strong> {d.summary}</span>
    </div>
  );
}
