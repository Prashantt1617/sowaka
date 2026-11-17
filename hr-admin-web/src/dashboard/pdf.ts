// Saves a self-contained HTML document (a payslip, a TDS work sheet) as a PDF file
// in the browser: no print dialog, a real file named the way Zoho names them.
// htmlToPdfBlob makes the same PDF as bytes, for a letter the dashboard uploads.

type Html2PdfModule = typeof import('html2pdf.js');

async function pdfOf(html: string, filename: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const styles = [...doc.querySelectorAll('style')].map((s) => s.outerHTML).join('');
  // html2pdf (with jsPDF and html2canvas) is large; it is fetched the first time someone saves a PDF.
  // A page opened before a deploy asks for the old build's copy, which is gone:
  // say so rather than show the browser's error.
  const { default: html2pdf } = (await import('html2pdf.js').catch(() => {
    throw new Error('The dashboard was updated. Refresh the page and try again.');
  })) as Html2PdfModule;
  // html2pdf lays the string out in its own overlay at A4 width; an element we
  // placed off screen ourselves comes out blank.
  const worker = html2pdf()
    .set({
      margin: [8, 8, 8, 8],
      filename,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    })
    // Always a light document, whatever theme the dashboard is in.
    .from(`${styles}<div style="color:#222;background:#fff;color-scheme:light">${doc.body.innerHTML}</div>`, 'string');
  // The html2pdf worker is itself a thenable, so it travels wrapped: awaiting it bare would run it.
  return { worker };
}

export async function downloadHtmlAsPdf(html: string, filename: string): Promise<void> {
  await (await pdfOf(html, filename)).worker.save();
}

/** The same PDF as base64 (no data: prefix), for a document the server emails (the final settlement). */
export async function htmlToPdfBase64(html: string, filename: string): Promise<string> {
  const uri = await (await pdfOf(html, filename)).worker.outputPdf('datauristring');
  return uri.slice(uri.indexOf(',') + 1);
}

/** The same PDF as bytes, to upload rather than save. */
export async function htmlToPdfBlob(html: string, filename = 'document.pdf'): Promise<Blob> {
  return (await pdfOf(html, filename)).worker.outputPdf('blob');
}
