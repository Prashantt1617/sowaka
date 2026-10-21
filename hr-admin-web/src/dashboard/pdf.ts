// Saves a self-contained HTML document (a payslip, a TDS work sheet) as a PDF file
// in the browser: no print dialog, a real file named the way Zoho names them.
import html2pdf from 'html2pdf.js';

export async function downloadHtmlAsPdf(html: string, filename: string): Promise<void> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const styles = [...doc.querySelectorAll('style')].map((s) => s.outerHTML).join('');
  // html2pdf lays the string out in its own overlay at A4 width; an element we
  // placed off screen ourselves comes out blank.
  await html2pdf()
    .set({
      margin: [8, 8, 8, 8],
      filename,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    })
    .from(`${styles}${doc.body.innerHTML}`, 'string')
    .save();
}
