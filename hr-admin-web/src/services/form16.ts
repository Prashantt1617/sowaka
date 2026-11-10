// Form 16 on the dashboard: HR uploads each employee's PDF for a FY (Sowaka
// does not generate it), one at a time or as a batch named by PAN or
// employee ID. The app shows them under Payroll › Downloads › Form 16.
import { api, apiUpload } from './http';

export type Form16Part = 'A' | 'B' | 'combined';

export type Form16DocumentDTO = {
  id: string;
  fy: string;
  part: Form16Part;
  fileName: string;
  size: number;
  uploadedAt: string;
};

export type Form16EmployeeDTO = {
  userId: string;
  name: string;
  employeeId: string | null;
  panLast4: string | null;
  documents: Form16DocumentDTO[];
};

export type Form16ListDTO = {
  fy: string;
  /** 15 June after the FY ends. */
  readyBy: string;
  /** Uploads are taken only for a FY that has ended. */
  ended: boolean;
  counts: { employees: number; withForm16: number };
  employees: Form16EmployeeDTO[];
};

export type Form16BulkDTO = {
  fy: string;
  uploaded: Array<{ fileName: string; userId: string; name: string; employeeId: string | null; matchedBy: 'pan' | 'employeeId'; document: Form16DocumentDTO }>;
  unmatched: Array<{ fileName: string; reason: string }>;
};

/** Files per bulk request, as the server takes them. */
export const FORM16_BATCH = 30;

export const listForm16 = (fy: string) => api<Form16ListDTO>(`/admin/payroll/form16?fy=${encodeURIComponent(fy)}`);

export function uploadForm16(userId: string, fy: string, file: File, part: Form16Part = 'combined') {
  const form = new FormData();
  form.append('fy', fy);
  form.append('part', part);
  form.append('file', file);
  return apiUpload<{ document: Form16DocumentDTO }>(`/admin/payroll/form16/employees/${encodeURIComponent(userId)}`, form).then((r) => r.document);
}

/** One batch of at most FORM16_BATCH files; the part comes from each name unless `part` is given. */
export function bulkUploadForm16(fy: string, files: File[], part?: Form16Part) {
  const form = new FormData();
  form.append('fy', fy);
  if (part) form.append('part', part);
  for (const file of files) form.append('files', file);
  return apiUpload<Form16BulkDTO>('/admin/payroll/form16/bulk', form);
}

export const form16FileUrl = (documentId: string) =>
  api<{ url: string }>(`/admin/payroll/form16/${encodeURIComponent(documentId)}/file`).then((r) => r.url);

export const deleteForm16 = (documentId: string) =>
  api<{ removed: Form16DocumentDTO }>(`/admin/payroll/form16/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
