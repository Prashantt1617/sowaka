declare module 'html2pdf.js' {
  interface Html2Pdf {
    set(options: Record<string, unknown>): Html2Pdf;
    from(source: HTMLElement | string, type?: 'string' | 'element'): Html2Pdf;
    save(): Promise<void>;
    outputPdf(type: 'blob'): Promise<Blob>;
  }
  const html2pdf: () => Html2Pdf;
  export default html2pdf;
}
