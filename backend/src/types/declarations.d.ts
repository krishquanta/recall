declare module 'pdf-parse' {
  interface PDFOptions {
    pagerender?: (pageData: any) => Promise<string> | string;
    max?: number;
    version?: string;
  }

  interface PDFData {
    numpages: number;
    numrender: number;
    info: any;
    metadata: any;
    text: string;
    version: string;
  }

  function PDF(dataBuffer: Buffer, options?: PDFOptions): Promise<PDFData>;

  export = PDF;
}

declare module 'mammoth' {
  interface MammothResult {
    value: string;
    messages: any[];
  }
  export const images: any;
  export function extractRawText(input: { path?: string; buffer?: Buffer }, options?: any): Promise<MammothResult>;
  export function convertToMarkdown(input: { path?: string; buffer?: Buffer }, options?: any): Promise<MammothResult>;
  export function convertToHtml(input: { path?: string; buffer?: Buffer }, options?: any): Promise<MammothResult>;
}
