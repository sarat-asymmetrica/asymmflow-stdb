// Minimal type declarations for pdfmake (no @types/pdfmake installed)
declare module 'pdfmake/build/pdfmake' {
  interface TCreatedPdf {
    open(): void;
    download(filename?: string): void;
    getBase64(cb: (data: string) => void): void;
    getBlob(cb: (blob: Blob) => void): void;
  }

  interface PdfMakeStatic {
    vfs: Record<string, string>;
    createPdf(documentDefinition: object): TCreatedPdf;
  }

  const pdfMake: PdfMakeStatic;
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  const pdfFonts: Record<string, string>;
  export default pdfFonts;
}
