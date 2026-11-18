/**
 * What a handover upload may be: documents, images, spreadsheets, slides and
 * archives. Decided from the file's own bytes (its signature), not its name,
 * so a program renamed to .pdf is still refused; a name that says "program"
 * (.exe, .sh, …) is refused whatever the bytes are.
 */

export interface HandoverType { contentType: string; ext: string }

const PROGRAM_EXT = /\.(exe|msi|bat|cmd|com|scr|pif|cpl|dll|sys|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|jar|apk|aab|ipa|app|dmg|pkg|deb|rpm|sh|bash|zsh|command|run|bin|elf|so|dylib|lnk|reg|iso)$/i;

const OFFICE_ZIP: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  key: 'application/vnd.apple.keynote',
  pages: 'application/vnd.apple.pages',
  numbers: 'application/vnd.apple.numbers',
};
const OLE: Record<string, string> = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' };
const TEXT: Record<string, string> = { txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', json: 'application/json', tsv: 'text/tab-separated-values' };

const starts = (b: Buffer, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const extOf = (name: string) => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? '').toLowerCase();

/** The upload's type, or null when it is not one a handover may carry. */
export function handoverFileType(name: string, bytes: Buffer): HandoverType | null {
  if (!bytes.length || PROGRAM_EXT.test(name.trim())) return null;
  // Programs and scripts, whatever they are called.
  if (starts(bytes, [0x4d, 0x5a])) return null;                                   // MZ: Windows .exe/.dll
  if (starts(bytes, [0x7f, 0x45, 0x4c, 0x46])) return null;                        // ELF
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]].some((s) => starts(bytes, s))) return null; // Mach-O / Java class
  if (starts(bytes, [0x23, 0x21])) return null;                                   // #! script
  const ext = extOf(name);
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { contentType: 'application/pdf', ext: '.pdf' };
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { contentType: 'image/jpeg', ext: '.jpg' };
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: 'image/png', ext: '.png' };
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) return { contentType: 'image/gif', ext: '.gif' };
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { contentType: 'image/webp', ext: '.webp' };
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)$/.test(bytes.subarray(8, 12).toString('ascii'))) return { contentType: 'image/heic', ext: '.heic' };
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) || starts(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    // ZIP: Office/OpenDocument files are ZIPs; anything else is an archive.
    return OFFICE_ZIP[ext] ? { contentType: OFFICE_ZIP[ext], ext: `.${ext}` } : { contentType: 'application/zip', ext: '.zip' };
  }
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return OLE[ext] ? { contentType: OLE[ext], ext: `.${ext}` } : null; // old Office (also .msi: refused above)
  if (starts(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return { contentType: 'application/x-7z-compressed', ext: '.7z' };
  if (starts(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return { contentType: 'application/vnd.rar', ext: '.rar' };
  if (starts(bytes, [0x1f, 0x8b])) return { contentType: 'application/gzip', ext: '.gz' };
  // Plain text (notes, CSV): only by name, and only when the bytes really are text.
  if (TEXT[ext] && !bytes.includes(0) && isUtf8(bytes)) return { contentType: TEXT[ext], ext: `.${ext}` };
  return null;
}

function isUtf8(bytes: Buffer): boolean {
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
}

export const HANDOVER_TYPES_MESSAGE = 'Upload a document, image, spreadsheet, slides or an archive (PDF, Word, Excel, PowerPoint, images, ZIP, text). Programs and scripts are not accepted.';
